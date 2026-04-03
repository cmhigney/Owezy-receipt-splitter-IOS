import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Phone, X } from "lucide-react-native";

import AuthShowcasePhone from "@/components/auth/AuthShowcasePhone";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AuthTab } from "@/types";
import { formatUsPhoneInput } from "@/utils/phone";

type RouteMode = "signup" | "login" | undefined;

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { colors } = useTheme();
  const { signUp, logIn, requestPasswordResetCode } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<AuthTab>("signup");
  const [loading, setLoading] = useState(false);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const backdropAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const heroFloat = useRef(new Animated.Value(0)).current;
  const routeModeAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(heroFloat, {
          toValue: 1,
          duration: 3600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heroFloat, {
          toValue: 0,
          duration: 3600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    floatLoop.start();
    return () => floatLoop.stop();
  }, [heroFloat]);

  const routeMode = useMemo<RouteMode>(() => {
    const rawMode = typeof params.mode === "string" ? params.mode : undefined;
    return rawMode === "login" || rawMode === "signup" ? rawMode : undefined;
  }, [params.mode]);

  const isValidEmail = useCallback((email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, []);

  const signupReady = useMemo(() => {
    return (
      isValidEmail(signupEmail) &&
      signupPassword.length >= 8 &&
      signupConfirm.length > 0 &&
      signupConfirm === signupPassword &&
      signupName.trim().length > 0
    );
  }, [isValidEmail, signupConfirm, signupEmail, signupName, signupPassword]);

  const loginReady = isValidEmail(loginEmail) && loginPassword.length > 0;
  const showPasswordMismatch =
    signupConfirm.length > 0 && signupConfirm !== signupPassword;

  const openSheet = useCallback((mode: AuthTab) => {
    setActiveTab(mode);
    setSheetVisible(true);
    backdropAnim.setValue(0);
    sheetAnim.setValue(0);

    Animated.parallel([
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(sheetAnim, {
        toValue: 1,
        damping: 22,
        stiffness: 230,
        mass: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropAnim, sheetAnim]);

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(sheetAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setSheetVisible(false);
      }
    });
  }, [backdropAnim, sheetAnim]);

  useEffect(() => {
    if (!routeMode || routeModeAppliedRef.current === routeMode) {
      return;
    }
    routeModeAppliedRef.current = routeMode;
    openSheet(routeMode);
  }, [openSheet, routeMode]);

  const switchTab = useCallback((nextTab: AuthTab) => {
    if (nextTab === activeTab) {
      return;
    }
    setActiveTab(nextTab);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab]);

  const handleSignUp = useCallback(async () => {
    if (!signupReady) {
      return;
    }

    setLoading(true);
    try {
      await signUp(
        signupEmail,
        signupPassword,
        signupName.trim(),
        signupPhone.trim() || undefined,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/payment-setup" as any);
    } catch (error: any) {
      Alert.alert("Sign Up Failed", error?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [
    signUp,
    signupEmail,
    signupName,
    signupPassword,
    signupPhone,
    signupReady,
  ]);

  const handleLogIn = useCallback(async () => {
    if (!loginReady) {
      return;
    }

    setLoading(true);
    try {
      await logIn(loginEmail, loginPassword);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert("Login Failed", error?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [logIn, loginEmail, loginPassword, loginReady]);

  const openForgotPassword = useCallback(() => {
    setForgotEmail(loginEmail.trim().toLowerCase());
    setShowForgotModal(true);
  }, [loginEmail]);

  const closeForgotPassword = useCallback(() => {
    setShowForgotModal(false);
    setForgotLoading(false);
    setForgotEmail("");
  }, []);

  const handleSendResetEmail = useCallback(async () => {
    const normalizedEmail = forgotEmail.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      Alert.alert("Invalid Email", "Please enter a valid email address.");
      return;
    }

    setForgotLoading(true);
    try {
      await requestPasswordResetCode(normalizedEmail);
      closeForgotPassword();
      Alert.alert(
        "Reset Email Sent",
        "If an account exists for that email, a password reset link was sent.",
      );
    } catch (error: any) {
      Alert.alert("Send Failed", error?.message || "Could not send reset email.");
    } finally {
      setForgotLoading(false);
    }
  }, [closeForgotPassword, forgotEmail, isValidEmail, requestPasswordResetCode]);

  const backdropOpacity = backdropAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [54, 0],
  });

  const heroTranslateY = heroFloat.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 4],
  });

  const phoneScale = Math.max(
    0.62,
    Math.min(
      0.88,
      (screenHeight - (insets.top + insets.bottom + 320)) / 588,
    ),
  );
  const phoneHeight = Math.round(588 * phoneScale);
  const isCompact = screenHeight < 780;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={["#FBFCF8", "#F3F5EE", "#EEF1E6"]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      <View
        style={[
          styles.safeContent,
          {
            paddingTop: insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 18),
          },
        ]}
      >
        <View style={styles.headerWrap}>
          <Text style={[styles.brand, { color: colors.text }]}>Owezy</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Split receipts in seconds
          </Text>
        </View>

        <Animated.View
          style={[
            styles.phoneWrap,
            {
              height: phoneHeight,
              marginTop: isCompact ? 10 : 18,
              marginBottom: isCompact ? 18 : 26,
              transform: [{ translateY: heroTranslateY }],
            },
          ]}
        >
          <View style={{ transform: [{ scale: phoneScale }] }}>
            <AuthShowcasePhone
              accentColor={colors.primary}
              accentSoft={colors.primaryLight}
              borderColor={colors.border}
              cardColor={colors.card}
              mutedColor={colors.textMuted}
              textColor={colors.text}
            />
          </View>
        </Animated.View>

        <View style={styles.copyWrap}>
          <Text style={[styles.bodyCopy, { color: colors.textSecondary }]}>
            Scan the receipt, assign items, and send clean payment requests without the awkward math.
          </Text>
        </View>

        <View style={[styles.bottomCtaWrap, { paddingTop: isCompact ? 8 : 12 }]}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            activeOpacity={0.9}
            onPress={() => openSheet("signup")}
            testID="hero-get-started"
          >
            <Text style={styles.primaryButtonText}>Get Started</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            activeOpacity={0.85}
            onPress={() => openSheet("login")}
            testID="hero-login"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
              I already have an account
            </Text>
          </TouchableOpacity>

          <View style={styles.legalRow}>
            <TouchableOpacity
              onPress={() => router.push("/privacy-policy" as any)}
              activeOpacity={0.75}
            >
              <Text style={[styles.legalLink, { color: colors.textMuted }]}>
                Privacy Policy
              </Text>
            </TouchableOpacity>
            <Text style={[styles.legalDot, { color: colors.textMuted }]}>.</Text>
            <TouchableOpacity
              onPress={() => router.push("/terms-of-use" as any)}
              activeOpacity={0.75}
            >
              <Text style={[styles.legalLink, { color: colors.textMuted }]}>
                Terms of Use
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal
        transparent
        visible={sheetVisible}
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Animated.View
            style={[
              styles.modalBackdrop,
              { backgroundColor: colors.overlay, opacity: backdropOpacity },
            ]}
          >
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeSheet} />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHandleWrap}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <Text style={[styles.sheetTitle, { color: colors.text }]}>
                  {activeTab === "signup" ? "Create your account" : "Welcome back"}
                </Text>
                <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
                  {activeTab === "signup"
                    ? "Start with your email, then we will take you straight into the app."
                    : "Pick up where you left off and get back to splitting."}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: colors.surface }]}
                onPress={closeSheet}
                activeOpacity={0.8}
              >
                <X color={colors.textSecondary} size={18} />
              </TouchableOpacity>
            </View>

            <View style={[styles.segmentedControl, { backgroundColor: colors.surface }]}>
              {(["signup", "login"] as AuthTab[]).map((tab) => {
                const selected = tab === activeTab;
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[
                      styles.segmentButton,
                      selected && { backgroundColor: colors.primary },
                    ]}
                    activeOpacity={0.88}
                    onPress={() => switchTab(tab)}
                    testID={tab === "signup" ? "sheet-tab-signup" : "sheet-tab-login"}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        { color: selected ? "#FFFFFF" : colors.textSecondary },
                      ]}
                    >
                      {tab === "signup" ? "Get Started" : "Log In"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={[
                styles.sheetScrollContent,
                { paddingBottom: Math.max(insets.bottom, 24) },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {activeTab === "signup" ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Display name
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surface,
                          color: colors.text,
                        },
                      ]}
                      value={signupName}
                      onChangeText={setSignupName}
                      placeholder="What should friends call you?"
                      placeholderTextColor={colors.textMuted}
                      maxLength={15}
                      autoCapitalize="words"
                      testID="signup-name"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Email
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surface,
                          color: colors.text,
                        },
                      ]}
                      value={signupEmail}
                      onChangeText={setSignupEmail}
                      placeholder="name@example.com"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="signup-email"
                    />
                    {signupEmail.length > 0 && !isValidEmail(signupEmail) ? (
                      <Text style={[styles.helperText, { color: colors.danger }]}>
                        Enter a valid email address.
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Password
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surface,
                          color: colors.text,
                        },
                      ]}
                      value={signupPassword}
                      onChangeText={setSignupPassword}
                      placeholder="At least 8 characters"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      testID="signup-password"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Confirm password
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surface,
                          color: colors.text,
                        },
                      ]}
                      value={signupConfirm}
                      onChangeText={setSignupConfirm}
                      placeholder="Re-enter your password"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      testID="signup-confirm"
                    />
                    {showPasswordMismatch ? (
                      <Text style={[styles.helperText, { color: colors.danger }]}>
                        Passwords do not match.
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Phone number
                    </Text>
                    <View
                      style={[
                        styles.phoneInputWrap,
                        { backgroundColor: colors.surface },
                      ]}
                    >
                      <Phone color={colors.textMuted} size={18} />
                      <TextInput
                        style={[styles.phoneInput, { color: colors.text }]}
                        value={signupPhone}
                        onChangeText={(value) => setSignupPhone(formatUsPhoneInput(value))}
                        placeholder="Optional"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        testID="signup-phone"
                      />
                    </View>
                  </View>

                  <View
                    style={[styles.noteCard, { backgroundColor: colors.primaryLight }]}
                  >
                    <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                      Accounts use email verification. After sign up, you will confirm your email before scanning.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.submitButton,
                      { backgroundColor: colors.primary },
                      !signupReady && styles.disabledButton,
                    ]}
                    disabled={!signupReady || loading}
                    activeOpacity={0.9}
                    onPress={handleSignUp}
                    testID="signup-button"
                  >
                    {loading && activeTab === "signup" ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.submitButtonText}>Create Account</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Email
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surface,
                          color: colors.text,
                        },
                      ]}
                      value={loginEmail}
                      onChangeText={setLoginEmail}
                      placeholder="name@example.com"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="login-email"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                      Password
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surface,
                          color: colors.text,
                        },
                      ]}
                      value={loginPassword}
                      onChangeText={setLoginPassword}
                      placeholder="Enter your password"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      testID="login-password"
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.inlineLinkButton}
                    onPress={openForgotPassword}
                    activeOpacity={0.75}
                    testID="forgot-password-button"
                  >
                    <Text style={[styles.inlineLinkText, { color: colors.primary }]}>
                      Forgot password?
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.submitButton,
                      { backgroundColor: colors.primary },
                      !loginReady && styles.disabledButton,
                    ]}
                    disabled={!loginReady || loading}
                    activeOpacity={0.9}
                    onPress={handleLogIn}
                    testID="login-button"
                  >
                    {loading && activeTab === "login" ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.submitButtonText}>Log In</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showForgotModal}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={closeForgotPassword}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.forgotBackdrop, { backgroundColor: colors.overlay }]}>
            <View style={[styles.forgotCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.forgotTitle, { color: colors.text }]}>
                Reset your password
              </Text>
              <Text style={[styles.forgotSubtitle, { color: colors.textSecondary }]}>
                Enter the email tied to your Owezy account and we will send a reset link.
              </Text>

              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    color: colors.text,
                  },
                ]}
                value={forgotEmail}
                onChangeText={setForgotEmail}
                placeholder="name@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="forgot-email"
              />

              <View style={styles.forgotActions}>
                <TouchableOpacity
                  style={[styles.forgotCancel, { backgroundColor: colors.surface }]}
                  onPress={closeForgotPassword}
                  disabled={forgotLoading}
                >
                  <Text style={[styles.forgotCancelText, { color: colors.textSecondary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.forgotSubmit, { backgroundColor: colors.primary }]}
                  onPress={handleSendResetEmail}
                  disabled={forgotLoading}
                  testID="forgot-send-button"
                >
                  {forgotLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.forgotSubmitText}>Send Email</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeContent: {
    flex: 1,
    paddingHorizontal: 22,
  },
  bgOrbTop: {
    position: "absolute",
    top: -110,
    right: -50,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(151,184,126,0.16)",
  },
  bgOrbBottom: {
    position: "absolute",
    bottom: -120,
    left: -40,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(151,184,126,0.12)",
  },
  headerWrap: {
    alignItems: "center",
  },
  brand: {
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: 16,
    fontWeight: "500",
    marginTop: 8,
  },
  phoneWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  copyWrap: {
    alignItems: "center",
    paddingHorizontal: 18,
    marginTop: 2,
  },
  bodyCopy: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 340,
  },
  bottomCtaWrap: {
    gap: 12,
  },
  primaryButton: {
    minHeight: 58,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 8,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 56,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.76)",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 4,
  },
  legalLink: {
    fontSize: 12,
    fontWeight: "600",
  },
  legalDot: {
    fontSize: 12,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingBottom: 6,
    maxHeight: "84%",
  },
  sheetHandleWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    paddingTop: 10,
  },
  sheetTitleWrap: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  sheetSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentedControl: {
    flexDirection: "row",
    borderRadius: 18,
    padding: 4,
    marginTop: 20,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "700",
  },
  sheetScroll: {
    marginTop: 18,
  },
  sheetScrollContent: {
    gap: 14,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  helperText: {
    fontSize: 12,
    marginTop: -2,
    marginLeft: 2,
  },
  phoneInputWrap: {
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
  },
  noteCard: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 4,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 19,
  },
  submitButton: {
    minHeight: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.4,
  },
  inlineLinkButton: {
    alignSelf: "flex-end",
    marginTop: -4,
  },
  inlineLinkText: {
    fontSize: 14,
    fontWeight: "700",
  },
  forgotBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  forgotCard: {
    borderRadius: 24,
    padding: 20,
  },
  forgotTitle: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  forgotSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 18,
  },
  forgotActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  forgotCancel: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotCancelText: {
    fontSize: 15,
    fontWeight: "700",
  },
  forgotSubmit: {
    flex: 1.2,
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotSubmitText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
