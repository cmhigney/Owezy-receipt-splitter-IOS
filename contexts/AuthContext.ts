import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import {
  createUserWithEmailAndPassword,
  deleteUser as deleteFirebaseUser,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile as updateFirebaseProfile,
  type User as FirebaseUser,
} from "firebase/auth";

import { firebaseAuth } from "@/lib/firebase";
import { trpcClient, setAuthToken } from "@/lib/trpc";
import { User } from "@/types";

const AUTH_USER_KEY = "owezy_auth_user";
const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const AUTH_DISPLAY_NAME_MAX_LENGTH = 15;
const VERBOSE_AUTH_LOGS = typeof __DEV__ !== "undefined" && __DEV__;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthOperation = "idle" | "signup" | "login" | "logout" | "delete";

function authLog(message: string, ...args: unknown[]) {
  if (VERBOSE_AUTH_LOGS) {
    console.log(message, ...args);
  }
}

function normalizeEmailInput(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized || !EMAIL_PATTERN.test(normalized)) {
    throw new Error("Enter a valid email address.");
  }
  return normalized;
}

function normalizePasswordInput(value: unknown, mode: "signup" | "login"): string {
  const password = typeof value === "string" ? value : "";
  if (!password) {
    throw new Error("Enter your password.");
  }
  if (mode === "signup" && password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return password;
}

function normalizeDisplayNameInput(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error("Enter your display name.");
  }
  return trimmed.slice(0, AUTH_DISPLAY_NAME_MAX_LENGTH);
}

function normalizeOptionalPhoneInput(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function deriveRecoveryDisplayName(firebaseUser: FirebaseUser): string {
  const displayName = firebaseUser.displayName?.trim();
  if (displayName) {
    return displayName.slice(0, AUTH_DISPLAY_NAME_MAX_LENGTH);
  }

  const emailLocalPart = firebaseUser.email?.split("@")[0]?.replace(/[._-]+/g, " ")?.trim();
  if (emailLocalPart) {
    return emailLocalPart.slice(0, AUTH_DISPLAY_NAME_MAX_LENGTH);
  }

  return "Owezy User";
}

function getTrpcErrorCode(error: unknown): string {
  const e = error as {
    data?: { code?: string };
    message?: string;
    shape?: { data?: { code?: string } };
  } | null;
  return e?.data?.code ?? e?.shape?.data?.code ?? "";
}

function isUnauthorizedError(error: unknown): boolean {
  const code = getTrpcErrorCode(error);
  const message = String((error as { message?: string } | null)?.message ?? "");
  return (
    code === "UNAUTHORIZED" ||
    message.includes("UNAUTHORIZED") ||
    message.includes("Not authenticated")
  );
}

function isNotFoundError(error: unknown): boolean {
  const code = getTrpcErrorCode(error);
  const message = String((error as { message?: string } | null)?.message ?? "");
  return code === "NOT_FOUND" || message.includes("User not found");
}

function mapUserFromBackend(raw: any): User {
  return {
    id: raw.id,
    email: raw.email,
    emailVerified: !!raw.emailVerified,
    emailVerifiedAt: raw.emailVerifiedAt ?? undefined,
    displayName: raw.displayName,
    username: raw.username,
    phone: raw.phone ?? undefined,
    profilePicture: raw.profilePicture ?? undefined,
    createdAt: raw.createdAt,
    lastUsernameChangeAt: raw.lastUsernameChangeAt ?? undefined,
    totalReceiptsScanned: Number(raw.totalReceiptsScanned) || 0,
    totalAmountSplit: Number(raw.totalAmountSplit) || 0,
    totalFriendsSplitWith: Number(raw.totalFriendsSplitWith) || 0,
    venmoUsername: raw.venmoUsername ?? undefined,
    cashAppUsername: raw.cashAppUsername ?? undefined,
    zelleUsername: raw.zelleUsername ?? undefined,
    paypalUsername: raw.paypalUsername ?? undefined,
  };
}

function normalizeBackendErrorMessage(error: unknown, fallback: string): string {
  const e = error as {
    message?: string;
    shape?: { message?: string };
    data?: { message?: string };
  } | null;
  const message = e?.message ?? e?.shape?.message ?? e?.data?.message ?? "";

  if (message.includes("Unexpected token") || message.includes("Unexpected character") || message.includes("<")) {
    return "Backend returned HTML instead of API JSON. Verify EXPO_PUBLIC_API_BASE_URL and redeploy Firebase Functions.";
  }

  if (message.includes("Network request failed") || message.includes("Failed to fetch")) {
    return "Cannot reach backend. Confirm internet access and that your backend URL is correct.";
  }

  if (
    message.includes("expected string") &&
    message.includes("invalid_type") &&
    (message.includes("email") || message.includes("password"))
  ) {
    return "Could not process that sign-in request. Please re-enter your email and password.";
  }

  if (message.includes("Invalid input")) {
    return "Could not process that request. Please check your details and try again.";
  }

  return message || fallback;
}

function normalizeFirebaseErrorMessage(error: unknown, fallback: string): string {
  const code = String((error as { code?: string } | null)?.code ?? "");

  if (code === "auth/email-already-in-use") {
    return "An account already exists for this email.";
  }
  if (
    code === "auth/invalid-credential" ||
    code === "auth/invalid-login-credentials" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  ) {
    return "Invalid email or password.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please try again later.";
  }
  if (code === "auth/network-request-failed") {
    return "Cannot reach Firebase Auth. Check your connection and Firebase config.";
  }
  if (code === "auth/invalid-email") {
    return "Enter a valid email address.";
  }
  if (code === "auth/weak-password") {
    return "Password must be at least 6 characters.";
  }
  if (code === "auth/requires-recent-login") {
    return "Please log in again and retry.";
  }

  return String((error as { message?: string } | null)?.message ?? fallback);
}

function normalizeAuthErrorMessage(error: unknown, fallback: string): string {
  const firebaseCode = String((error as { code?: string } | null)?.code ?? "");
  if (firebaseCode.startsWith("auth/")) {
    return normalizeFirebaseErrorMessage(error, fallback);
  }
  return normalizeBackendErrorMessage(error, fallback);
}

function normalizeProfileUpdateErrorMessage(error: unknown): string {
  const e = error as {
    message?: string;
    shape?: { message?: string };
    data?: { message?: string };
  } | null;
  const message = String(e?.message ?? e?.shape?.message ?? e?.data?.message ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("profilepicture") &&
    (lower.includes("too_big") || lower.includes("too big") || lower.includes("characters"))
  ) {
    return "Profile photo is too large. Choose a smaller photo or crop tighter.";
  }

  if (lower.includes("profile picture must be an https url or an image data url")) {
    return "Profile photo format is invalid. Choose a different photo and try again.";
  }

  if (lower.includes("invalid input")) {
    return "Could not update your profile. Check the fields and try again.";
  }

  return normalizeBackendErrorMessage(error, "Could not update profile");
}

function shouldAttemptLegacyMigration(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? "");
  return (
    code === "auth/invalid-credential" ||
    code === "auth/invalid-login-credentials" ||
    code === "auth/user-not-found"
  );
}

function isFirebaseUserNotFound(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? "");
  return code === "auth/user-not-found";
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const authSyncIdRef = useRef(0);
  const authOperationRef = useRef<AuthOperation>("idle");

  const persistUser = useCallback(async (nextUser: User | null) => {
    setUser(nextUser);
    if (nextUser) {
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser));
      return;
    }
    await AsyncStorage.removeItem(AUTH_USER_KEY);
  }, []);

  const clearLocalAuth = useCallback(async () => {
    setAuthToken(null);
    await persistUser(null);
  }, [persistUser]);

  const syncFirebaseToken = useCallback(async (firebaseUser: FirebaseUser, forceRefresh = false) => {
    const token = await firebaseUser.getIdToken(forceRefresh);
    setAuthToken(token);
    return token;
  }, []);

  const refreshBackendUser = useCallback(async (
    firebaseUser: FirebaseUser,
    forceTokenRefresh = false,
  ): Promise<User | null> => {
    await syncFirebaseToken(firebaseUser, forceTokenRefresh);

    try {
      const fresh = await trpcClient.users.me.query();
      if (!fresh) {
        await persistUser(null);
        return null;
      }

      const userData = mapUserFromBackend(fresh);
      await persistUser(userData);
      authLog("[auth] Refreshed user data from backend");
      return userData;
    } catch (error) {
      if (isUnauthorizedError(error) && !forceTokenRefresh) {
        return refreshBackendUser(firebaseUser, true);
      }

      if (isNotFoundError(error)) {
        authLog("[auth] Firebase session exists but backend profile is missing");
        await persistUser(null);
        return null;
      }

      throw error;
    }
  }, [persistUser, syncFirebaseToken]);

  const refreshCurrentSession = useCallback(async () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) {
      return null;
    }

    try {
      await reload(currentUser);
      return await refreshBackendUser(currentUser, true);
    } catch (error) {
      authLog("[auth] Failed to refresh active session:", error);
      return null;
    }
  }, [refreshBackendUser]);

  const repairMissingBackendProfile = useCallback(async (firebaseUser: FirebaseUser): Promise<User | null> => {
    await syncFirebaseToken(firebaseUser, true);

    const result = await trpcClient.users.signup.mutate({
      displayName: deriveRecoveryDisplayName(firebaseUser),
      phone: undefined,
    });

    if (result?.user) {
      const repairedUser = mapUserFromBackend(result.user);
      await persistUser(repairedUser);
      authLog("[auth] Repaired missing backend profile from Firebase session");
      return repairedUser;
    }

    return refreshBackendUser(firebaseUser, true);
  }, [persistUser, refreshBackendUser, syncFirebaseToken]);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(AUTH_USER_KEY)
      .then((raw) => {
        if (cancelled || !raw) {
          return;
        }

        try {
          setUser(mapUserFromBackend(JSON.parse(raw)));
        } catch {
          void AsyncStorage.removeItem(AUTH_USER_KEY);
        }
      })
      .catch(() => undefined);

    const unsubscribe = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      const syncId = ++authSyncIdRef.current;
      setIsLoading(true);

      try {
        if (!firebaseUser) {
          await clearLocalAuth();
          return;
        }

        const refreshedUser = await refreshBackendUser(firebaseUser);
        if (!refreshedUser && authOperationRef.current === "idle") {
          authLog("[auth] Clearing stale Firebase session with missing backend profile");
          await signOut(firebaseAuth);
          await clearLocalAuth();
        }
      } catch (error) {
        authLog("[auth] Failed to sync Firebase session:", error);
      } finally {
        if (!cancelled && syncId === authSyncIdRef.current) {
          setIsLoading(false);
          setAuthChecked(true);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [clearLocalAuth, refreshBackendUser]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }
      void refreshCurrentSession();
    });

    return () => subscription.remove();
  }, [refreshCurrentSession]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    displayName: string,
    phone?: string,
  ) => {
    const normalizedEmail = normalizeEmailInput(email);
    const normalizedPassword = normalizePasswordInput(password, "signup");
    const trimmedName = normalizeDisplayNameInput(displayName);
    const normalizedPhone = normalizeOptionalPhoneInput(phone);
    let firebaseUser: FirebaseUser | null = null;
    authOperationRef.current = "signup";

    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, normalizedPassword);
      firebaseUser = credential.user;

      if (trimmedName && firebaseUser.displayName !== trimmedName) {
        await updateFirebaseProfile(firebaseUser, { displayName: trimmedName });
      }

      await syncFirebaseToken(firebaseUser, true);

      let createdProfile: User | null = null;
      try {
        const result = await trpcClient.users.signup.mutate({
          displayName: trimmedName,
          phone: normalizedPhone,
        });

        if (result?.user) {
          createdProfile = mapUserFromBackend(result.user);
          await persistUser(createdProfile);
        } else {
          createdProfile = await refreshBackendUser(firebaseUser, true);
        }
      } catch (error) {
        const recoveredProfile = await refreshBackendUser(firebaseUser, true).catch(() => null);
        if (recoveredProfile) {
          authLog("[auth] Signup recovered after backend error");
          return recoveredProfile;
        }

        try {
          await deleteFirebaseUser(firebaseUser);
        } catch (rollbackError) {
          authLog("[auth] Failed to roll back Firebase user after signup error:", rollbackError);
        }
        throw error;
      }

      try {
        await sendEmailVerification(firebaseUser);
      } catch (error) {
        authLog("[auth] Failed to send verification email:", error);
      }

      if (!createdProfile) {
        throw new Error("Signup failed");
      }

      authLog("[auth] Signup successful");
      return createdProfile;
    } catch (error) {
      throw new Error(normalizeAuthErrorMessage(error, "Signup failed"));
    } finally {
      authOperationRef.current = "idle";
    }
  }, [persistUser, refreshBackendUser, syncFirebaseToken]);

  const logIn = useCallback(async (email: string, password: string) => {
    const normalizedEmail = normalizeEmailInput(email);
    const normalizedPassword = normalizePasswordInput(password, "login");
    authOperationRef.current = "login";

    const completeLogin = async () => {
      const credential = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, normalizedPassword);
      let refreshedUser = await refreshBackendUser(credential.user, true);
      if (!refreshedUser) {
        refreshedUser = await repairMissingBackendProfile(credential.user);
      }
      if (!refreshedUser) {
        await signOut(firebaseAuth).catch(() => undefined);
        await clearLocalAuth();
        throw new Error("Account profile is missing. Please sign in again or contact support.");
      }
      return refreshedUser;
    };

    try {
      const userData = await completeLogin();
      authLog("[auth] Login successful");
      return userData;
    } catch (error) {
      if (!shouldAttemptLegacyMigration(error)) {
        throw new Error(normalizeAuthErrorMessage(error, "Login failed"));
      }

      try {
        await trpcClient.users.migrateLogin.mutate({
          email: normalizedEmail,
          password: normalizedPassword,
        });
        const userData = await completeLogin();
        authLog("[auth] Legacy account migrated during login");
        return userData;
      } catch (migrationError) {
        throw new Error(normalizeAuthErrorMessage(migrationError, "Login failed"));
      }
    } finally {
      authOperationRef.current = "idle";
    }
  }, [clearLocalAuth, refreshBackendUser, repairMissingBackendProfile]);

  const requestPasswordResetCode = useCallback(async (email: string) => {
    const normalizedEmail = normalizeEmailInput(email);

    try {
      await trpcClient.users.requestPasswordResetCode.mutate({ email: normalizedEmail });
      try {
        await sendPasswordResetEmail(firebaseAuth, normalizedEmail);
      } catch (error) {
        if (!isFirebaseUserNotFound(error)) {
          throw error;
        }
      }
    } catch (error) {
      throw new Error(normalizeAuthErrorMessage(error, "Could not send reset email"));
    }
  }, []);

  const requestEmailVerificationCode = useCallback(async () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) {
      throw new Error("Not authenticated");
    }

    try {
      await trpcClient.users.requestEmailVerificationCode.mutate();
      await sendEmailVerification(currentUser);
    } catch (error) {
      throw new Error(normalizeAuthErrorMessage(error, "Could not send verification email"));
    }
  }, []);

  const verifyEmailVerificationCode = useCallback(async (): Promise<boolean> => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) {
      throw new Error("Not authenticated");
    }

    try {
      await reload(currentUser);
      const refreshedUser = await refreshBackendUser(currentUser, true);
      return !!refreshedUser?.emailVerified;
    } catch (error) {
      throw new Error(normalizeAuthErrorMessage(error, "Could not refresh verification status"));
    }
  }, [refreshBackendUser]);

  const logOut = useCallback(async () => {
    authLog("[auth] Logging out");
    authOperationRef.current = "logout";
    try {
      await trpcClient.users.logout.mutate();
    } catch (error) {
      authLog("[auth] Logout API call failed (continuing anyway):", error);
    }

    try {
      await signOut(firebaseAuth);
      await clearLocalAuth();
    } finally {
      authOperationRef.current = "idle";
    }
  }, [clearLocalAuth]);

  const deleteAccount = useCallback(async () => {
    authLog("[auth] Deleting account");
    authOperationRef.current = "delete";
    try {
      await trpcClient.users.deleteAccount.mutate();
    } catch (error) {
      authOperationRef.current = "idle";
      throw new Error(normalizeAuthErrorMessage(error, "Could not delete account"));
    }

    try {
      await signOut(firebaseAuth);
      await clearLocalAuth();
    } finally {
      authOperationRef.current = "idle";
    }
  }, [clearLocalAuth]);

  const updateProfile = useCallback(async (
    updates: Partial<
      Pick<
        User,
        | "displayName"
        | "username"
        | "phone"
        | "profilePicture"
        | "venmoUsername"
        | "cashAppUsername"
        | "zelleUsername"
        | "paypalUsername"
      >
    >,
  ) => {
    if (!firebaseAuth.currentUser) {
      throw new Error("Not authenticated");
    }

    try {
      const result = await trpcClient.users.updateProfile.mutate(updates);
      if (!result) {
        throw new Error("Profile update failed");
      }

      const userData = mapUserFromBackend(result);
      await persistUser(userData);
      authLog("[auth] Profile updated");
    } catch (error) {
      throw new Error(normalizeProfileUpdateErrorMessage(error));
    }
  }, [persistUser]);

  const incrementStats = useCallback(async (receiptTotal: number, friendCount: number) => {
    if (!user) {
      return;
    }

    try {
      const result = await trpcClient.users.incrementStats.mutate({ receiptTotal, friendCount });
      if (result) {
        await persistUser(mapUserFromBackend(result));
      }
    } catch (error) {
      authLog("[auth] Failed to increment stats on backend, updating locally:", error);
      const updatedUser: User = {
        ...user,
        totalReceiptsScanned: user.totalReceiptsScanned + 1,
        totalAmountSplit: Math.round((user.totalAmountSplit + receiptTotal) * 100) / 100,
        totalFriendsSplitWith: user.totalFriendsSplitWith + friendCount,
      };
      await persistUser(updatedUser);
    }
  }, [persistUser, user]);

  const isUsernameTaken = useCallback(async (username: string): Promise<boolean> => {
    try {
      const result = await trpcClient.users.checkUsername.query({
        username,
        excludeUserId: user?.id,
      });
      return !result.available;
    } catch (error) {
      authLog("[auth] Username check failed:", error);
      return false;
    }
  }, [user?.id]);

  const getUsernameChangeCooldown = useCallback((): { canChange: boolean; daysRemaining: number } => {
    if (!user?.lastUsernameChangeAt) {
      return { canChange: true, daysRemaining: 0 };
    }

    const lastChange = new Date(user.lastUsernameChangeAt);
    const now = new Date();
    const daysSince = (now.getTime() - lastChange.getTime()) / (1000 * 60 * 60 * 24);
    const remaining = Math.ceil(USERNAME_CHANGE_COOLDOWN_DAYS - daysSince);
    return {
      canChange: daysSince >= USERNAME_CHANGE_COOLDOWN_DAYS,
      daysRemaining: Math.max(0, remaining),
    };
  }, [user?.lastUsernameChangeAt]);

  return {
    user,
    isLoading,
    authChecked,
    signUp,
    logIn,
    requestPasswordResetCode,
    requestEmailVerificationCode,
    verifyEmailVerificationCode,
    logOut,
    deleteAccount,
    updateProfile,
    incrementStats,
    isUsernameTaken,
    getUsernameChangeCooldown,
  };
});
