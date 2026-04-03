import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Alert,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AdsProvider } from "@/contexts/AdsContext";
import { FriendsProvider } from "@/contexts/FriendsContext";
import { HistoryProvider } from "@/contexts/HistoryContext";
import { SplitFlowProvider } from "@/contexts/SplitFlowContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { E2E_SKIP_EMAIL_VERIFICATION } from "@/lib/e2e";
import { trpc, trpcClient } from "@/lib/trpc";

SplashScreen.preventAutoHideAsync().catch(() => { });
const DEBUG_INTERACTION_LOGS = __DEV__;
const SPLIT_LOGO_IMAGE = require("../assets/images/brand-mark.png");
const JOINED_LOGO_IMAGE = require("../assets/images/brand-mark-joined.png");

function interactionLog(event: string, payload?: Record<string, unknown>) {
  if (!DEBUG_INTERACTION_LOGS) return;
  const timestamp = new Date().toISOString();
  if (payload) {
    console.log(`[ui][${timestamp}] ${event}`, payload);
    return;
  }
  console.log(`[ui][${timestamp}] ${event}`);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

const SKIP_EMAIL_VERIFICATION_FOR_E2E = E2E_SKIP_EMAIL_VERIFICATION;

function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    user,
    authChecked,
    requestEmailVerificationCode,
    verifyEmailVerificationCode,
    logOut,
  } = useAuth();
  const { colors } = useTheme();
  const segments = useSegments();
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const lastRouteRef = useRef<string>("");
  const lastTouchLogAtMsRef = useRef<number>(0);
  const splashHiddenRef = useRef<boolean>(false);
  const introStartedRef = useRef<boolean>(false);
  const launchIntroProgress = useRef(new Animated.Value(0)).current;
  const [launchIntroComplete, setLaunchIntroComplete] = useState(false);

  const needsEmailVerification = Boolean(
    user && !user.emailVerified && !SKIP_EMAIL_VERIFICATION_FOR_E2E,
  );
  const currentRoute = `/${segments.filter(Boolean).join("/")}`;
  const inAuth = (segments[0] as string) === "auth";
  const inOnboarding = (segments[0] as string) === "onboarding";
  const isPublicLegalRoute =
    (segments[0] as string) === "privacy-policy" ||
    (segments[0] as string) === "terms-of-use";

  const redirectTarget =
    !authChecked
      ? null
      : !user && !inAuth && !isPublicLegalRoute
        ? "/auth"
        : user && needsEmailVerification && !inAuth && !isPublicLegalRoute
          ? "/auth"
          : user && !needsEmailVerification && (inAuth || inOnboarding)
            ? "/(tabs)/(scan)"
            : null;

  const redirectingOutOfAuth = Boolean(
    authChecked &&
      user &&
      !needsEmailVerification &&
      (inAuth || inOnboarding) &&
      redirectTarget,
  );

  useEffect(() => {
    if (!authChecked || redirectTarget || introStartedRef.current) return;
    introStartedRef.current = true;
    if (!splashHiddenRef.current) {
      splashHiddenRef.current = true;
      SplashScreen.hideAsync().catch(() => { });
    }

    launchIntroProgress.setValue(0);
    Animated.sequence([
      Animated.delay(80),
      Animated.timing(launchIntroProgress, {
        toValue: 1,
        duration: 620,
        easing: Easing.bezier(0.2, 0.84, 0.24, 1),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setLaunchIntroComplete(true);
    });
  }, [authChecked, launchIntroProgress, redirectTarget]);

  useEffect(() => {
    if (!authChecked) return;
    interactionLog("route_state", {
      route: currentRoute || "/",
      inAuth,
      hasUser: Boolean(user),
      needsEmailVerification,
    });
    if (redirectTarget) {
      router.replace(redirectTarget as any);
    }
  }, [user, authChecked, currentRoute, needsEmailVerification, inAuth, inOnboarding, redirectTarget]);

  useEffect(() => {
    if (lastRouteRef.current === currentRoute) return;
    lastRouteRef.current = currentRoute;
    interactionLog("route_changed", { route: currentRoute || "/" });
  }, [currentRoute]);

  const sendVerificationEmail = useCallback(async (showAlert: boolean) => {
    if (!user || user.emailVerified) return;
    setSendingCode(true);
    try {
      await requestEmailVerificationCode();
      if (showAlert) {
        Alert.alert(
          "Verification Email Sent",
          `We sent a verification email to ${user.email}.`,
        );
      }
    } catch (error: any) {
      if (showAlert) {
        Alert.alert("Send Failed", error?.message || "Could not send verification email.");
      }
    } finally {
      setSendingCode(false);
    }
  }, [requestEmailVerificationCode, user]);

  const handleRefreshVerification = useCallback(async () => {
    setVerifyingCode(true);
    try {
      const verified = await verifyEmailVerificationCode();
      if (!verified) {
        Alert.alert(
          "Still Unverified",
          "Open the verification email, tap the link, then come back and try again.",
        );
        return;
      }
      introStartedRef.current = true;
      setLaunchIntroComplete(true);
      interactionLog("email_verified", { route: currentRoute || "/" });
    } catch (error: any) {
      Alert.alert("Verification Failed", error?.message || "Could not refresh verification status.");
    } finally {
      setVerifyingCode(false);
    }
  }, [currentRoute, verifyEmailVerificationCode]);

  useEffect(() => {
    if (!needsEmailVerification) return;
    interactionLog("email_verification_modal_opened", {
      route: currentRoute || "/",
      email: user?.email || "",
    });
  }, [needsEmailVerification, currentRoute, user?.email]);

  const handleRootTouch = useCallback((event: any) => {
    const now = Date.now();
    if (now - lastTouchLogAtMsRef.current < 180) return;
    lastTouchLogAtMsRef.current = now;
    const pageX = Math.round(Number(event?.nativeEvent?.pageX || 0));
    const pageY = Math.round(Number(event?.nativeEvent?.pageY || 0));
    interactionLog("touch", {
      route: currentRoute || "/",
      x: pageX,
      y: pageY,
      needsEmailVerification,
    });
  }, [currentRoute, needsEmailVerification]);

  const waitingForRouteGuard =
    !authChecked ||
    (Boolean(redirectTarget) && !redirectingOutOfAuth);
  const contentOpacity = launchIntroProgress.interpolate({
    inputRange: [0, 0.58, 1],
    outputRange: [0, 0, 1],
  });
  const contentScale = launchIntroProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.965, 1],
  });
  const joinedLogoOpacity = launchIntroProgress.interpolate({
    inputRange: [0, 0.42, 0.68],
    outputRange: [1, 1, 0],
  });
  const splitLogoOpacity = launchIntroProgress.interpolate({
    inputRange: [0.28, 0.62, 1],
    outputRange: [0, 1, 1],
  });
  const introOpacity = launchIntroProgress.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [1, 1, 0],
  });

  if (waitingForRouteGuard) {
    return (
      <View style={[styles.bootScreen, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.bootText, { color: colors.textSecondary }]}>Loading Owezy...</Text>
      </View>
    );
  }

  return (
    <>
      <Animated.View
        style={{
          flex: 1,
          opacity: launchIntroComplete ? 1 : contentOpacity,
          transform: [{ scale: launchIntroComplete ? 1 : contentScale }],
        }}
        onTouchStart={handleRootTouch}
      >
        {children}
      </Animated.View>
      {!launchIntroComplete ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.launchIntro,
            {
              backgroundColor: colors.background,
              opacity: introOpacity,
            },
          ]}
        >
          <Animated.View
            style={{
              transform: [
                {
                  scale: launchIntroProgress.interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [0.9, 1, 1.04],
                  }),
                },
                {
                  translateY: launchIntroProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, -10],
                  }),
                },
              ],
            }}
          >
            <Animated.View
              style={{
                opacity: joinedLogoOpacity,
                transform: [
                  {
                    scale: launchIntroProgress.interpolate({
                      inputRange: [0, 0.68, 1],
                      outputRange: [1, 1.01, 1.03],
                    }),
                  },
                ],
              }}
            >
              <View style={styles.launchLogoTile}>
                <Image source={JOINED_LOGO_IMAGE} style={styles.launchLogoImage} resizeMode="cover" />
              </View>
            </Animated.View>
            <Animated.View
              style={[
                styles.launchLogoOverlay,
                {
                  opacity: splitLogoOpacity,
                  transform: [
                    {
                      scale: launchIntroProgress.interpolate({
                        inputRange: [0, 0.62, 1],
                        outputRange: [0.97, 1, 1.02],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.launchLogoTile}>
                <Image source={SPLIT_LOGO_IMAGE} style={styles.launchLogoImage} resizeMode="cover" />
              </View>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      ) : null}
      <Modal
        visible={needsEmailVerification}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => undefined}
      >
        <KeyboardAvoidingView
          style={[styles.overlay, { backgroundColor: colors.overlay }]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Verify Your Email</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Check the verification email sent to {user?.email}. Open the link, then come back here. Owezy will refresh automatically when the app becomes active, or you can confirm below.
            </Text>

            <TouchableOpacity
              style={[styles.secondaryBtn, { backgroundColor: colors.secondaryLight }]}
              onPress={() => void sendVerificationEmail(true)}
              disabled={sendingCode || verifyingCode}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.secondary }]}>
                {sendingCode ? "Sending..." : "Resend Email"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => void handleRefreshVerification()}
              disabled={sendingCode || verifyingCode}
            >
              <Text style={styles.primaryBtnText}>
                {verifyingCode ? "Checking..." : "I've Verified"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.ghostBtn, { borderColor: colors.border }]}
              onPress={() => void logOut()}
              disabled={sendingCode || verifyingCode}
            >
              <Text style={[styles.ghostBtnText, { color: colors.textSecondary }]}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function RootLayoutNav() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: colors.headerBg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        animation: 'slide_from_right',
      }}
    >
      {/* Fade in — launch animation already ran, a slide would fight it */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="auth" options={{ headerShown: false, animation: 'fade' }} />
      {/* First-run onboarding — shown before auth for new users */}
      <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} />
      {/* Slide up — feels like an onboarding gate appearing on top */}
      <Stack.Screen name="payment-setup" options={{ headerShown: false, gestureEnabled: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="privacy-policy" options={{ title: "Privacy Policy" }} />
      <Stack.Screen name="terms-of-use" options={{ title: "Terms of Use" }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    interactionLog("app_started");
    const subscription = AppState.addEventListener("change", (state) => {
      interactionLog("app_state_changed", { state });
    });
    return () => subscription.remove();
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeProvider>
            <AuthProvider>
              <AdsProvider>
                <SubscriptionProvider>
                  <FriendsProvider>
                    <HistoryProvider>
                      <SplitFlowProvider>
                        <AuthGate>
                          <RootLayoutNav />
                        </AuthGate>
                      </SplitFlowProvider>
                    </HistoryProvider>
                  </FriendsProvider>
                </SubscriptionProvider>
              </AdsProvider>
            </AuthProvider>
          </ThemeProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  bootText: {
    fontSize: 14,
    fontWeight: "600",
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  launchIntro: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  launchLogoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  launchLogoTile: {
    width: 172,
    height: 172,
    borderRadius: 38,
    overflow: "hidden",
    backgroundColor: "#6A9363",
  },
  launchLogoImage: {
    width: "100%",
    height: "100%",
  },
  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  ghostBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: "center",
  },
  ghostBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
