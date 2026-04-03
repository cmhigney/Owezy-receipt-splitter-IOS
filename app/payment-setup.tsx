import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CreditCard, ChevronRight, AlertCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { usePreferredPayment, PREFERRED_OPTIONS } from '@/utils/preferredPayment';
import Colors from '@/constants/colors';

interface PaymentService {
  key: 'venmoUsername' | 'cashAppUsername' | 'zelleUsername' | 'paypalUsername';
  label: string;
  placeholder: string;
  icon: string;
  color: string;
  hint: string;
}

const PAYMENT_SERVICES: PaymentService[] = [
  {
    key: 'venmoUsername',
    label: 'Venmo',
    placeholder: '@username',
    icon: 'V',
    color: Colors.venmo,
    hint: 'Your Venmo username (e.g. @john-doe)',
  },
  {
    key: 'cashAppUsername',
    label: 'Cash App',
    placeholder: '$cashtag',
    icon: '$',
    color: Colors.cashApp,
    hint: 'Your Cash App $cashtag (e.g. $johndoe)',
  },
  {
    key: 'zelleUsername',
    label: 'Zelle',
    placeholder: 'Email or phone',
    icon: 'Z',
    color: Colors.zelle,
    hint: 'The email or phone linked to your Zelle',
  },
  {
    key: 'paypalUsername',
    label: 'PayPal',
    placeholder: 'PayPal.me username',
    icon: 'P',
    color: Colors.paypal,
    hint: 'Your PayPal.me link name (e.g. johndoe)',
  },
];

export default function PaymentSetupScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { updateProfile } = useAuth();
  const { colors } = useTheme();
  const { preferred, setPreferredPayment } = usePreferredPayment();
  const [saving, setSaving] = useState<boolean>(false);
  const [values, setValues] = useState<Record<string, string>>({
    venmoUsername: '',
    cashAppUsername: '',
    zelleUsername: '',
    paypalUsername: '',
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnims = useRef(PAYMENT_SERVICES.map(() => new Animated.Value(30))).current;
  const isNarrowScreen = screenWidth < 360;
  const isCompactHeight = screenHeight < 700;
  const horizontalPadding = isNarrowScreen ? 16 : screenWidth >= 430 ? 28 : 24;
  const contentMaxWidth = 520;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    PAYMENT_SERVICES.forEach((_, i) => {
      Animated.timing(slideAnims[i], {
        toValue: 0,
        duration: 400,
        delay: 150 + i * 80,
        useNativeDriver: true,
      }).start();
    });
  }, [fadeAnim, slideAnims]);

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const sanitizeUsername = useCallback((key: string, value: string): string => {
    let cleaned = value.trim();
    if (key === 'venmoUsername') {
      cleaned = cleaned.replace(/^@+/, '');
    } else if (key === 'cashAppUsername') {
      cleaned = cleaned.replace(/^\$+/, '');
    }
    return cleaned;
  }, []);

  const handleFinish = useCallback(async () => {
    setSaving(true);
    try {
      const updates: Partial<Record<PaymentService['key'], string>> = {};
      for (const service of PAYMENT_SERVICES) {
        const val = sanitizeUsername(service.key, values[service.key] || '');
        if (val) {
          updates[service.key] = val;
        }
      }
      if (Object.keys(updates).length > 0) {
        await updateProfile(updates);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/(scan)' as any);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save payment info');
    } finally {
      setSaving(false);
    }
  }, [values, updateProfile, sanitizeUsername]);

  const handleSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace('/(tabs)/(scan)' as any);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: horizontalPadding,
              paddingBottom: isCompactHeight ? 160 : 180,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.contentWrap, { maxWidth: contentMaxWidth }]}>
            <Animated.View style={[styles.headerSection, { opacity: fadeAnim }]}>
              <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
                <CreditCard color={colors.primary} size={28} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>Link Your Payment Apps</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Add your payment usernames so friends can easily pay you back. Double-check each one is correct!
              </Text>
            </Animated.View>

            <View style={[styles.warningBanner, { backgroundColor: colors.accentLight }]}>
              <AlertCircle color={colors.accent} size={18} />
              <Text style={[styles.warningText, { color: colors.accent }]}>
                Make sure your usernames are exactly right - incorrect info means missed payments.
              </Text>
            </View>

            <View style={styles.servicesSection}>
              {PAYMENT_SERVICES.map((service, index) => (
                <Animated.View
                  key={service.key}
                  style={[
                    styles.serviceCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: values[service.key]?.trim() ? service.color + '40' : colors.border,
                      transform: [{ translateY: slideAnims[index] }],
                      opacity: fadeAnim,
                    },
                  ]}
                >
                  <View style={styles.serviceHeader}>
                    <View style={[styles.serviceIcon, { backgroundColor: service.color + '18' }]}>
                      <Text style={[styles.serviceIconText, { color: service.color }]}>{service.icon}</Text>
                    </View>
                    <Text style={[styles.serviceLabel, { color: colors.text }]}>{service.label}</Text>
                    {values[service.key]?.trim() ? (
                      <View style={[styles.connectedBadge, { backgroundColor: colors.successLight }]}>
                        <Text style={[styles.connectedText, { color: colors.success }]}>Added</Text>
                      </View>
                    ) : null}
                  </View>
                  <TextInput
                    style={[styles.serviceInput, { backgroundColor: colors.surface, color: colors.text }]}
                    placeholder={service.placeholder}
                    placeholderTextColor={colors.textMuted}
                    value={values[service.key]}
                    onChangeText={(v) => handleChange(service.key, v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID={`payment-${service.key}`}
                  />
                  <Text style={[styles.serviceHint, { color: colors.textMuted }]}>{service.hint}</Text>
                </Animated.View>
              ))}
            </View>

            <View style={styles.preferredSection}>
              <Text style={[styles.preferredLabel, { color: colors.text }]}>Preferred Payment Method</Text>
              <Text style={[styles.preferredHint, { color: colors.textSecondary }]}>
                This method will be highlighted on your payment screen
              </Text>
              <View style={styles.preferredGrid}>
                {PREFERRED_OPTIONS.map((option) => {
                  const isSelected = preferred === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.preferredPill,
                        { backgroundColor: isSelected ? option.color + '18' : colors.surface },
                        isSelected && { borderColor: option.color, borderWidth: 1.5 },
                      ]}
                      onPress={() => setPreferredPayment(isSelected ? null : option.value)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.preferredPillIcon, { color: option.color }]}>{option.icon}</Text>
                      <Text style={[styles.preferredPillLabel, { color: isSelected ? option.color : colors.textSecondary }]}>
                        {option.label}
                      </Text>
                      {isSelected && <Text style={[styles.preferredCheck, { color: option.color }]}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, 16),
              paddingHorizontal: horizontalPadding,
            },
          ]}
        >
          <View style={[styles.footerInner, { maxWidth: contentMaxWidth }]}>
          <TouchableOpacity
            style={[styles.finishButton, { backgroundColor: colors.primary }]}
            onPress={handleFinish}
            disabled={saving}
            activeOpacity={0.8}
            testID="payment-finish"
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={styles.finishInner}>
                <Text style={styles.finishText}>
                  {'Create Account'}
                </Text>
                <ChevronRight color="#FFFFFF" size={20} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            testID="payment-skip"
          >
            <Text style={[styles.skipText, { color: colors.textMuted }]}>Skip for now - add later in Settings</Text>
          </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 180,
  },
  contentWrap: {
    width: '100%',
    alignSelf: 'center',
  },
  headerSection: {
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 20,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center' as const,
    paddingHorizontal: 8,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    lineHeight: 18,
  },
  servicesSection: {
    gap: 14,
  },
  serviceCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
  },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  serviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIconText: {
    fontSize: 18,
    fontWeight: '800' as const,
  },
  serviceLabel: {
    fontSize: 17,
    fontWeight: '700' as const,
    flex: 1,
  },
  connectedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  connectedText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  serviceInput: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  serviceHint: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
  },
  footerInner: {
    width: '100%',
    alignSelf: 'center',
  },
  finishButton: {
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  finishInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  finishText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  skipButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: 44,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  preferredSection: {
    marginTop: 28,
  },
  preferredLabel: {
    fontSize: 17,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  preferredHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  preferredGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  preferredPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    width: '47%' as any,
  },
  preferredPillIcon: {
    fontSize: 15,
    fontWeight: '800' as const,
  },
  preferredPillLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    flex: 1,
  },
  preferredCheck: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
});

