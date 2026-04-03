import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import {
  createFirebaseUser,
  deleteFirebaseUserByUid,
  getFirebaseUserByEmail,
  updateFirebaseUserByUid,
} from "../../firebase-auth";
import { store, StoredUser } from "../../store";
import {
  validateUsername,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from "../../../utils/moderation";
import {
  assertWithinRateLimit,
  getClientIp,
  hashRateLimitIdentifier,
} from "../../security/request-security";

const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const DISPLAY_NAME_MAX_LENGTH = 15;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEYLEN = 32;
const PASSWORD_DIGEST = "sha256";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_RATE_LIMIT_PER_IP = 20;
const SIGNUP_RATE_LIMIT_PER_EMAIL = 8;
const LOGIN_RATE_LIMIT_PER_IP = 60;
const LOGIN_RATE_LIMIT_PER_EMAIL = 20;
const RESET_REQUEST_RATE_LIMIT_PER_IP = 20;
const RESET_REQUEST_RATE_LIMIT_PER_EMAIL = 10;
const EMAIL_VERIFY_REQUEST_RATE_LIMIT_PER_IP = 20;
const EMAIL_VERIFY_REQUEST_RATE_LIMIT_PER_USER = 10;
const CHECK_USERNAME_RATE_LIMIT_PER_IP = 240;
const FIND_BY_USERNAME_RATE_LIMIT_PER_USER = 60;
const FIND_BY_USERNAME_RATE_LIMIT_PER_IP = 240;
const GENERATED_USERNAME_SUFFIX_LENGTH = 4;
const GENERATED_USERNAME_FALLBACK = "user";
const PROFILE_PICTURE_MAX_LENGTH = 800_000;
const PAYMENT_HANDLE_MAX_LENGTH = 64;
const PHONE_MAX_LENGTH = 32;
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 256;
const USER_ID_MAX_LENGTH = 128;
const PAYMENT_HANDLE_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const ZELLE_HANDLE_PATTERN = /^[a-zA-Z0-9@._+\-()\s]{1,64}$/;
const PHONE_PATTERN = /^[0-9()+\-\s]{1,32}$/;
const PROFILE_PICTURE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i;
const VERBOSE_SERVER_LOGS =
  !process.env.K_SERVICE && !process.env.FUNCTION_TARGET && process.env.NODE_ENV !== "production";

function logSecurityEvent(event: string, metadata: Record<string, unknown>): void {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...metadata,
  };

  try {
    console.info(`[security] ${JSON.stringify(payload)}`);
  } catch {
    console.info(`[security] ${event}`);
  }
}

function getFirebaseAuthErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function generateFirebasePlaceholderPassword(): string {
  return randomBytes(24).toString("base64url");
}

function generateUsername(name: string): string {
  const baseMaxLength = Math.max(1, USERNAME_MAX_LENGTH - GENERATED_USERNAME_SUFFIX_LENGTH);
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, baseMaxLength);
  const normalizedBase = base || GENERATED_USERNAME_FALLBACK.slice(0, baseMaxLength);
  const suffix = randomInt(0, 10000).toString().padStart(4, "0");
  return `${normalizedBase}${suffix}`.slice(0, USERNAME_MAX_LENGTH);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasOwnProperty(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeOptionalInput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePhone(phone: string | undefined): string | undefined {
  const normalized = normalizeOptionalInput(phone);
  if (!normalized) return undefined;
  if (!PHONE_PATTERN.test(normalized)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phone number format." });
  }
  return normalized;
}

function normalizePaymentHandle(params: {
  value: string | undefined;
  label: string;
  pattern: RegExp;
  stripPrefix?: RegExp;
}): string | undefined {
  const normalized = normalizeOptionalInput(params.value);
  if (!normalized) return undefined;

  const stripped = params.stripPrefix ? normalized.replace(params.stripPrefix, "") : normalized;
  if (!stripped) return undefined;

  if (!params.pattern.test(stripped)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${params.label} has an invalid format.`,
    });
  }
  return stripped;
}

function normalizeProfilePicture(profilePicture: string | undefined): string | undefined {
  const normalized = normalizeOptionalInput(profilePicture);
  if (!normalized) return undefined;

  const allowedHttp =
    normalized.startsWith("https://") ||
    normalized.startsWith("http://localhost") ||
    normalized.startsWith("http://127.0.0.1");
  const allowedDataImage = PROFILE_PICTURE_DATA_URL_PATTERN.test(normalized);
  if (!allowedHttp && !allowedDataImage) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Profile picture must be an HTTPS URL or an image data URL.",
    });
  }

  return normalized;
}

function isConflictError(error: unknown, field: "email" | "username"): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  if (!message) return false;

  const checksByField = {
    email: [
      "email already in use",
      "user uniqueness constraint violated",
      "users.email",
    ],
    username: [
      "username already in use",
      "username is already taken",
      "user uniqueness constraint violated",
      "users.username",
    ],
  };

  return checksByField[field].some((part) => message.includes(part));
}

function sanitizeUser(user: StoredUser | null | undefined) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEYLEN,
    PASSWORD_DIGEST,
  ).toString("hex");
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, iterRaw, salt, expectedHash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterRaw || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const expected = Buffer.from(expectedHash, "hex");
  const computed = Buffer.from(
    pbkdf2Sync(password, salt, iterations, expected.length, PASSWORD_DIGEST),
  );

  if (expected.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(expected, computed);
}

async function syncStoredUserWithAuthState(
  user: StoredUser,
  authEmail: string | null,
  authEmailVerified: boolean,
): Promise<StoredUser> {
  const updates: Partial<StoredUser> = {};
  const normalizedAuthEmail = authEmail ? normalizeEmail(authEmail) : null;

  if (normalizedAuthEmail && normalizedAuthEmail !== user.email) {
    updates.email = normalizedAuthEmail;
  }

  if (user.emailVerified !== authEmailVerified) {
    updates.emailVerified = authEmailVerified;
    updates.emailVerifiedAt = authEmailVerified ? user.emailVerifiedAt ?? new Date().toISOString() : undefined;
  }

  if (!Object.keys(updates).length) {
    return user;
  }

  const updated = await store.updateUser(user.id, updates);
  return updated ?? user;
}

async function ensureFirebaseAuthUser(params: {
  user: StoredUser;
  password?: string;
}): Promise<void> {
  const { user, password } = params;

  let existing:
    | {
        uid: string;
      }
    | null = null;

  try {
    const found = await getFirebaseUserByEmail(user.email);
    existing = { uid: found.uid };
  } catch (error) {
    if (getFirebaseAuthErrorCode(error) !== "auth/user-not-found") {
      throw error;
    }
  }

  if (existing) {
    if (existing.uid !== user.id) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Account already exists with a different identity. Contact support.",
      });
    }

    await updateFirebaseUserByUid(user.id, {
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      ...(password ? { password } : {}),
    });
    return;
  }

  try {
    await createFirebaseUser({
      uid: user.id,
      email: user.email,
      password: password ?? generateFirebasePlaceholderPassword(),
      displayName: user.displayName,
      emailVerified: user.emailVerified,
    });
  } catch (error) {
    const errorCode = getFirebaseAuthErrorCode(error);
    if (errorCode === "auth/email-already-exists") {
      const retry = await getFirebaseUserByEmail(user.email);
      if (retry.uid !== user.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Account already exists with a different identity. Contact support.",
        });
      }
      await updateFirebaseUserByUid(user.id, {
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        ...(password ? { password } : {}),
      });
      return;
    }

    if (errorCode === "auth/uid-already-exists") {
      await updateFirebaseUserByUid(user.id, {
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        ...(password ? { password } : {}),
      });
      return;
    }

    throw error;
  }
}

const DUMMY_PASSWORD_HASH = hashPassword("owezy_dummy_password_hash");

export const usersRouter = createTRPCRouter({
  signup: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
        phone: z.string().trim().max(PHONE_MAX_LENGTH).optional(),
      }).strict()
    )
    .mutation(async ({ ctx, input }) => {
      const normalizedEmail = ctx.authEmail ? normalizeEmail(ctx.authEmail) : null;
      if (!normalizedEmail) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Authenticated Firebase user is missing an email address.",
        });
      }

      const clientIpKey = hashRateLimitIdentifier(getClientIp(ctx.req));
      await assertWithinRateLimit({
        key: `signup:ip:${clientIpKey}`,
        maxRequests: SIGNUP_RATE_LIMIT_PER_IP,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many signup attempts. Please try again later.",
      });
      await assertWithinRateLimit({
        key: `signup:email:${hashRateLimitIdentifier(normalizedEmail)}`,
        maxRequests: SIGNUP_RATE_LIMIT_PER_EMAIL,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many signup attempts for this email. Please try again later.",
      });
      if (VERBOSE_SERVER_LOGS) {
        console.log("[users.signup] Attempting signup");
      }

      const existingById = await store.getUserById(ctx.userId);
      if (existingById) {
        const synced = await syncStoredUserWithAuthState(
          existingById,
          normalizedEmail,
          ctx.authEmailVerified,
        );
        return { user: sanitizeUser(synced) };
      }

      const existingByEmail = await store.getUserByEmail(normalizedEmail);
      if (existingByEmail && existingByEmail.id !== ctx.userId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account already exists for this email. Log in instead.",
        });
      }

      const displayName = input.displayName.trim();
      let username = generateUsername(displayName);
      let attempts = 0;
      while ((await store.isUsernameTaken(username)) && attempts < 10) {
        username = generateUsername(displayName);
        attempts++;
      }

      if (await store.isUsernameTaken(username)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not generate unique username" });
      }

      const now = new Date().toISOString();

      try {
        await store.createUser({
          id: ctx.userId,
          email: normalizedEmail,
          password: hashPassword(generateFirebasePlaceholderPassword()),
          passwordHistory: [],
          emailVerified: ctx.authEmailVerified,
          emailVerifiedAt: ctx.authEmailVerified ? now : undefined,
          displayName,
          username,
          phone: normalizePhone(input.phone),
          createdAt: now,
          lastUsernameChangeAt: undefined,
          totalReceiptsScanned: 0,
          totalAmountSplit: 0,
          totalFriendsSplitWith: 0,
        });
      } catch (error) {
        if (isConflictError(error, "email")) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
        }
        if (isConflictError(error, "username")) {
          throw new TRPCError({ code: "CONFLICT", message: "Username is already taken" });
        }
        throw error;
      }

      const user = await store.getUserById(ctx.userId);

      if (VERBOSE_SERVER_LOGS) {
        console.log(`[users.signup] User profile created: ${ctx.userId}`);
      }
      return { user: sanitizeUser(user) };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().trim().max(EMAIL_MAX_LENGTH).email(),
        password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
      }).strict()
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Direct password login has moved to Firebase Auth. Update the app and sign in again.",
      });
    }),

  migrateLogin: publicProcedure
    .input(
      z.object({
        email: z.string().trim().max(EMAIL_MAX_LENGTH).email(),
        password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
      }).strict()
    )
    .mutation(async ({ ctx, input }) => {
      const normalizedEmail = normalizeEmail(input.email);
      const clientIpKey = hashRateLimitIdentifier(getClientIp(ctx.req));
      const emailHash = hashRateLimitIdentifier(normalizedEmail);
      await assertWithinRateLimit({
        key: `login:ip:${clientIpKey}`,
        maxRequests: LOGIN_RATE_LIMIT_PER_IP,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many login attempts. Please try again later.",
      });
      await assertWithinRateLimit({
        key: `login:email:${emailHash}`,
        maxRequests: LOGIN_RATE_LIMIT_PER_EMAIL,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many login attempts for this account. Please try again later.",
      });

      const user = await store.getUserByEmail(normalizedEmail);
      if (!user) {
        logSecurityEvent("users.login.failed", {
          reason: "user_not_found",
          emailHash,
          ipHash: clientIpKey,
        });
        void verifyPassword(input.password, DUMMY_PASSWORD_HASH);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      const isHashed = user.password.startsWith("pbkdf2$");
      const validPassword = isHashed
        ? verifyPassword(input.password, user.password)
        : user.password === input.password;

      if (!validPassword) {
        logSecurityEvent("users.login.failed", {
          reason: "invalid_password",
          userId: user.id,
          emailHash,
          ipHash: clientIpKey,
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }

      let nextUser = user;
      if (!isHashed) {
        const updated = await store.updateUser(user.id, {
          password: hashPassword(input.password),
          passwordHistory: Array.isArray(user.passwordHistory) ? user.passwordHistory : [],
        });
        nextUser = updated ?? user;
      }

      await ensureFirebaseAuthUser({
        user: nextUser,
        password: input.password,
      });

      logSecurityEvent("users.login.migrated", {
        userId: nextUser.id,
        emailHash,
        ipHash: clientIpKey,
      });
      return {
        migrated: true,
        user: sanitizeUser(nextUser),
      };
    }),

  requestPasswordResetCode: publicProcedure
    .input(
      z.object({
        email: z.string().trim().max(EMAIL_MAX_LENGTH).email(),
      }).strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const normalizedEmail = normalizeEmail(input.email);
      const clientIpKey = hashRateLimitIdentifier(getClientIp(ctx.req));
      const emailHash = hashRateLimitIdentifier(normalizedEmail);
      await assertWithinRateLimit({
        key: `reset-request:ip:${clientIpKey}`,
        maxRequests: RESET_REQUEST_RATE_LIMIT_PER_IP,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many password reset requests. Please try again later.",
      });
      await assertWithinRateLimit({
        key: `reset-request:email:${emailHash}`,
        maxRequests: RESET_REQUEST_RATE_LIMIT_PER_EMAIL,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many password reset requests for this account. Please try again later.",
      });
      const user = await store.getUserByEmail(normalizedEmail);
      if (!user) {
        logSecurityEvent("users.password_reset.requested", {
          userExists: false,
          emailHash,
          ipHash: clientIpKey,
        });
        return { success: true };
      }

      try {
        await ensureFirebaseAuthUser({ user });
      } catch (error) {
        console.error("[users.password_reset] Failed to prepare Firebase account:", error);
        logSecurityEvent("users.password_reset.prepare_failed", {
          userId: user.id,
          emailHash,
          ipHash: clientIpKey,
        });
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Could not prepare password reset. Please try again later.",
        });
      }

      await store.deletePasswordResetCodeByEmail(normalizedEmail);
      logSecurityEvent("users.password_reset.prepared", {
        userId: user.id,
        emailHash,
        ipHash: clientIpKey,
      });
      return { success: true };
    }),

  requestEmailVerificationCode: protectedProcedure
    .mutation(async ({ ctx }) => {
      const user = await store.getUserById(ctx.userId);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const clientIpKey = hashRateLimitIdentifier(getClientIp(ctx.req));
      await assertWithinRateLimit({
        key: `email-verify-request:ip:${clientIpKey}`,
        maxRequests: EMAIL_VERIFY_REQUEST_RATE_LIMIT_PER_IP,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many email verification requests. Please try again later.",
      });
      await assertWithinRateLimit({
        key: `email-verify-request:user:${ctx.userId}`,
        maxRequests: EMAIL_VERIFY_REQUEST_RATE_LIMIT_PER_USER,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many email verification requests for this account. Please try again later.",
      });

      const synced = await syncStoredUserWithAuthState(user, ctx.authEmail, ctx.authEmailVerified);
      if (synced.emailVerified) {
        return { success: true, alreadyVerified: true };
      }

      logSecurityEvent("users.email_verification.requested", {
        userId: ctx.userId,
        ipHash: clientIpKey,
      });

      return { success: true };
    }),

  verifyEmailVerificationCode: protectedProcedure
    .mutation(async ({ ctx }) => {
      const user = await store.getUserById(ctx.userId);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const synced = await syncStoredUserWithAuthState(user, ctx.authEmail, ctx.authEmailVerified);
      return { verified: synced.emailVerified, user: sanitizeUser(synced) };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await store.getUserById(ctx.userId);
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    const synced = await syncStoredUserWithAuthState(user, ctx.authEmail, ctx.authEmailVerified);
    return sanitizeUser(synced);
  }),

  checkUsername: publicProcedure
    .input(
      z.object({
        username: z.string().trim().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH),
        excludeUserId: z.string().trim().min(1).max(USER_ID_MAX_LENGTH).optional(),
      }).strict(),
    )
    .query(async ({ ctx, input }) => {
      const clientIpKey = hashRateLimitIdentifier(getClientIp(ctx.req));
      await assertWithinRateLimit({
        key: `check-username:ip:${clientIpKey}`,
        maxRequests: CHECK_USERNAME_RATE_LIMIT_PER_IP,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many username checks. Please try again later.",
      });
      const username = normalizeUsername(input.username);
      const validation = validateUsername(username);
      if (!validation.valid) {
        return { available: false };
      }

      const taken = await store.isUsernameTaken(username, input.excludeUserId);
      return { available: !taken };
    }),

  findByUsername: protectedProcedure
    .input(
      z.object({
        username: z.string().trim().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH),
      }).strict(),
    )
    .query(async ({ ctx, input }) => {
      const clientIpKey = hashRateLimitIdentifier(getClientIp(ctx.req));
      await assertWithinRateLimit({
        key: `find-by-username:user:${ctx.userId}`,
        maxRequests: FIND_BY_USERNAME_RATE_LIMIT_PER_USER,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many user lookups. Please try again later.",
      });
      await assertWithinRateLimit({
        key: `find-by-username:ip:${clientIpKey}`,
        maxRequests: FIND_BY_USERNAME_RATE_LIMIT_PER_IP,
        windowMs: RATE_LIMIT_WINDOW_MS,
        message: "Too many user lookups. Please try again later.",
      });
      const username = normalizeUsername(input.username);
      const validation = validateUsername(username);
      if (!validation.valid) {
        logSecurityEvent("users.find_by_username.failed", {
          reason: "invalid_username",
          actorUserId: ctx.userId,
          ipHash: clientIpKey,
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const found = await store.getUserByUsername(username);
      if (!found || found.id === ctx.userId) {
        logSecurityEvent("users.find_by_username.failed", {
          reason: "not_found",
          actorUserId: ctx.userId,
          ipHash: clientIpKey,
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      logSecurityEvent("users.find_by_username.succeeded", {
        actorUserId: ctx.userId,
        targetUserId: found.id,
        ipHash: clientIpKey,
      });

      return {
        id: found.id,
        displayName: found.displayName,
        username: found.username,
        profilePicture: found.profilePicture ?? undefined,
      };
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
        username: z
          .string()
          .trim()
          .min(USERNAME_MIN_LENGTH)
          .max(USERNAME_MAX_LENGTH)
          .optional(),
        phone: z.string().trim().max(PHONE_MAX_LENGTH).optional(),
        profilePicture: z.string().trim().max(PROFILE_PICTURE_MAX_LENGTH).optional(),
        venmoUsername: z.string().trim().max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
        cashAppUsername: z.string().trim().max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
        zelleUsername: z.string().trim().max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
        paypalUsername: z.string().trim().max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
      }).strict()
    )
    .mutation(async ({ ctx, input }) => {
      if (VERBOSE_SERVER_LOGS) {
        console.log(`[users.updateProfile] Updating profile for: ${ctx.userId}`);
      }

      const user = await store.getUserById(ctx.userId);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const updates: Partial<StoredUser> = { ...input };
      if (hasOwnProperty(input, "phone")) {
        updates.phone = normalizePhone(input.phone);
      }
      if (hasOwnProperty(input, "profilePicture")) {
        updates.profilePicture = normalizeProfilePicture(input.profilePicture);
      }
      if (hasOwnProperty(input, "venmoUsername")) {
        updates.venmoUsername = normalizePaymentHandle({
          value: input.venmoUsername,
          label: "Venmo username",
          pattern: PAYMENT_HANDLE_PATTERN,
          stripPrefix: /^@+/,
        });
      }
      if (hasOwnProperty(input, "cashAppUsername")) {
        updates.cashAppUsername = normalizePaymentHandle({
          value: input.cashAppUsername,
          label: "Cash App username",
          pattern: PAYMENT_HANDLE_PATTERN,
          stripPrefix: /^\$+/,
        });
      }
      if (hasOwnProperty(input, "zelleUsername")) {
        updates.zelleUsername = normalizePaymentHandle({
          value: input.zelleUsername,
          label: "Zelle handle",
          pattern: ZELLE_HANDLE_PATTERN,
        });
      }
      if (hasOwnProperty(input, "paypalUsername")) {
        updates.paypalUsername = normalizePaymentHandle({
          value: input.paypalUsername,
          label: "PayPal username",
          pattern: PAYMENT_HANDLE_PATTERN,
          stripPrefix: /^@+/,
        });
      }

      if (updates.username) {
        updates.username = normalizeUsername(updates.username);
      }

      if (updates.username && updates.username !== user.username.toLowerCase()) {
        const validation = validateUsername(updates.username);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.error ?? "Invalid username",
          });
        }

        if (await store.isUsernameTaken(updates.username, ctx.userId)) {
          throw new TRPCError({ code: "CONFLICT", message: "Username is already taken" });
        }

        if (user.lastUsernameChangeAt) {
          const lastChange = new Date(user.lastUsernameChangeAt);
          const now = new Date();
          const daysSinceLastChange = (now.getTime() - lastChange.getTime()) / (1000 * 60 * 60 * 24);

          if (daysSinceLastChange < USERNAME_CHANGE_COOLDOWN_DAYS) {
            const daysRemaining = Math.ceil(USERNAME_CHANGE_COOLDOWN_DAYS - daysSinceLastChange);
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: `You can only change your username once every ${USERNAME_CHANGE_COOLDOWN_DAYS} days. Please wait ${daysRemaining} more day${daysRemaining === 1 ? "" : "s"}.`,
            });
          }
        }

        updates.lastUsernameChangeAt = new Date().toISOString();
      }

      let updated: StoredUser | undefined;
      try {
        updated = await store.updateUser(ctx.userId, updates);
      } catch (error) {
        if (isConflictError(error, "username")) {
          throw new TRPCError({ code: "CONFLICT", message: "Username is already taken" });
        }
        if (isConflictError(error, "email")) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
        }
        throw error;
      }
      if (VERBOSE_SERVER_LOGS) {
        console.log(`[users.updateProfile] Profile updated for: ${ctx.userId}`);
      }
      return sanitizeUser(updated);
    }),

  incrementStats: protectedProcedure
    .input(
      z.object({
        receiptTotal: z.number().finite().min(0).max(1_000_000),
        friendCount: z.number().int().min(0).max(1_000),
      }).strict()
    )
    .mutation(async ({ ctx, input }) => {
      const user = await store.getUserById(ctx.userId);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const updated = await store.updateUser(ctx.userId, {
        totalReceiptsScanned: user.totalReceiptsScanned + 1,
        totalAmountSplit: Math.round((user.totalAmountSplit + input.receiptTotal) * 100) / 100,
        totalFriendsSplitWith: user.totalFriendsSplitWith + input.friendCount,
      });

      return sanitizeUser(updated);
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (VERBOSE_SERVER_LOGS) {
      console.log(`[users.logout] User ${ctx.userId} logging out`);
    }
    return { success: true };
  }),

  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    if (VERBOSE_SERVER_LOGS) {
      console.log(`[users.deleteAccount] Deleting account for user ${ctx.userId}`);
    }
    const user = await store.getUserById(ctx.userId);
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    try {
      await deleteFirebaseUserByUid(ctx.userId);
    } catch (error) {
      if (getFirebaseAuthErrorCode(error) !== "auth/user-not-found") {
        throw error;
      }
    }

    await store.deleteUserById(ctx.userId);
    return { success: true };
  }),
});
