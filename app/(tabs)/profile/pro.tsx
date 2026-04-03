import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Check, Crown, Sparkles, ShieldCheck, ReceiptText, Clock3 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

export default function ProScreen() {
  const { colors } = useTheme();
  const {
    isPro,
    storeReady,
    ready,
    packages,
    loadingPackages,
    purchaseBusy,
    paywallReady,
    displayAllowanceScans,
    displayRemainingScans,
    currentPlanKind,
    purchasePro,
    restorePro,
    presentPaywall,
    refreshOfferings,
  } = useSubscription();
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  const closeToProfile = useCallback(() => {
    router.replace('/(tabs)/profile' as any);
  }, []);

  const openPrivacyPolicy = useCallback(() => {
    router.push('/privacy-policy' as any);
  }, []);

  const openTermsOfUse = useCallback(() => {
    router.push('/terms-of-use' as any);
  }, []);

  const proFeatures = useMemo(
    () => [
      {
        icon: ReceiptText,
        title: 'Higher Scan Limits',
        subtitle: 'Keep high-accuracy receipt scanning with more room each month',
      },
      {
        icon: Clock3,
        title: 'Monthly Included Scans',
        subtitle: 'Monthly and annual plans both renew your scan allowance each month',
      },
      {
        icon: ShieldCheck,
        title: 'No Ads on Pro',
        subtitle: 'History and Friends stay ad-free with active Pro',
      },
    ],
    [],
  );

  const handlePurchase = useCallback(async () => {
    if (!selectedPackageId) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const success = await purchasePro(selectedPackageId);
      if (success) {
        Alert.alert('Plan Activated', 'Your Pro subscription is now active.');
      }
    } catch (error: unknown) {
      const message = typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: string }).message || '')
        : '';
      Alert.alert('Purchase Failed', message || 'Could not complete purchase');
    }
  }, [purchasePro, selectedPackageId]);

  const handleRestore = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const restored = await restorePro();
      if (restored) {
        Alert.alert('Restored', 'Your previous subscription has been restored.');
      } else {
        Alert.alert('No Subscription Found', 'No active Pro subscription was found for this account.');
      }
    } catch (error: unknown) {
      const message = typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: string }).message || '')
        : '';
      Alert.alert('Restore Failed', message || 'Could not restore purchases');
    }
  }, [restorePro]);

  const handlePaywall = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const success = await presentPaywall();
      if (success) {
        Alert.alert('Welcome to Owezy Pro', 'Your Pro subscription is now active.');
      }
    } catch (error: unknown) {
      const message = typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: string }).message || '')
        : '';
      Alert.alert('Paywall Failed', message || 'Could not open paywall');
    }
  }, [presentPaywall]);

  const primaryPackage = packages[0];
  const canBuy = Boolean(storeReady && selectedPackageId && !purchaseBusy);
  const planLabel = currentPlanKind === 'pro_yearly'
    ? 'Pro Annual'
    : currentPlanKind === 'pro_monthly'
      ? 'Pro Monthly'
      : 'Free plan';

  if (!ready) {
    return (
      <View style={[styles.loadingWrap, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <LinearGradient
        colors={isPro ? [colors.primaryDark, colors.primary] : ['#1E2B1A', '#526A44', '#7A9E63']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View style={styles.crownBadge}>
            <Crown color="#23301C" size={18} />
          </View>
          <Text style={styles.heroTitle}>Owezy Pro</Text>
          <Text style={styles.heroSub}>
            {isPro ? 'Subscription active' : 'Choose the plan that fits your usage'}
          </Text>
        </View>
        <View style={styles.heroBottom}>
          <Text style={styles.heroStatLabel}>Scans left this month</Text>
          <Text style={styles.heroStatValue}>{displayRemainingScans}</Text>
          <Text style={styles.heroHint}>
            {displayRemainingScans} of {displayAllowanceScans} remaining on {planLabel}
          </Text>
        </View>
      </LinearGradient>

      {proFeatures.map((feature) => {
        const Icon = feature.icon;
        return (
          <View key={feature.title} style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.featureIcon, { backgroundColor: colors.primaryLight }]}>
              <Icon color={colors.primary} size={18} />
            </View>
            <View style={styles.featureText}>
              <Text style={[styles.featureTitle, { color: colors.text }]}>{feature.title}</Text>
              <Text style={[styles.featureSub, { color: colors.textSecondary }]}>{feature.subtitle}</Text>
            </View>
            <Check color={colors.success} size={16} />
          </View>
        );
      })}

      {isPro ? (
        <View style={[styles.statusCard, { backgroundColor: colors.successLight, borderColor: colors.success + '45' }]}>
          <Sparkles color={colors.success} size={16} />
          <View style={styles.statusCopy}>
            <Text style={[styles.statusTitle, { color: colors.success }]}>You are on Pro</Text>
            <Text style={[styles.statusSub, { color: colors.textSecondary }]}>
              {planLabel} active. {displayRemainingScans} scan{displayRemainingScans === 1 ? '' : 's'} left this month.
            </Text>
          </View>
        </View>
      ) : null}

      {!isPro && storeReady ? (
        <View style={[styles.packagesWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose a subscription</Text>
          {loadingPackages ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : null}
          {!loadingPackages && packages.length === 0 ? (
            <TouchableOpacity style={[styles.refreshBtn, { backgroundColor: colors.surface }]} onPress={refreshOfferings}>
              <Text style={[styles.refreshText, { color: colors.textSecondary }]}>Retry loading plans</Text>
            </TouchableOpacity>
          ) : null}
          {packages.map((pkg) => {
            const selected = selectedPackageId === pkg.id;
            return (
              <TouchableOpacity
                key={pkg.id}
                style={[
                  styles.packageCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                  selected && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                ]}
                onPress={() => setSelectedPackageId(pkg.id)}
              >
                <View style={styles.packageLeft}>
                  <Text style={[styles.packageTitle, { color: colors.text }]}>{pkg.title}</Text>
                  <Text style={[styles.packageSub, { color: colors.textSecondary }]}>{pkg.description}</Text>
                </View>
                <Text style={[styles.packagePrice, { color: colors.text }]}>{pkg.priceLabel || pkg.packageType}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.buyBtn, { backgroundColor: canBuy ? colors.primary : colors.surfaceDark }]}
            onPress={handlePurchase}
            disabled={!canBuy}
          >
            {purchaseBusy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[styles.buyBtnText, { color: canBuy ? colors.white : colors.textMuted }]}>
                Continue to Purchase
              </Text>
            )}
          </TouchableOpacity>
          {paywallReady ? (
            <TouchableOpacity
              style={[styles.paywallBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={handlePaywall}
              disabled={purchaseBusy}
            >
              <Text style={[styles.paywallBtnText, { color: colors.text }]}>Open Paywall</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={purchaseBusy}>
            <Text style={[styles.restoreText, { color: colors.textSecondary }]}>Restore Purchases</Text>
          </TouchableOpacity>
          <Text style={[styles.legalHint, { color: colors.textMuted }]}>
            Subscription products auto-renew until cancelled in your {Platform.OS === 'ios' ? 'Apple' : 'Google'} account settings.
          </Text>
          <View style={styles.legalLinks}>
            <TouchableOpacity style={[styles.legalLink, { borderColor: colors.border }]} onPress={openPrivacyPolicy}>
              <Text style={[styles.legalLinkText, { color: colors.textSecondary }]}>Privacy Policy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.legalLink, { borderColor: colors.border }]} onPress={openTermsOfUse}>
              <Text style={[styles.legalLinkText, { color: colors.textSecondary }]}>Terms of Use</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {!storeReady ? (
        <View style={[styles.offlineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.offlineTitle, { color: colors.text }]}>Subscriptions Temporarily Unavailable</Text>
          <Text style={[styles.offlineSub, { color: colors.textSecondary }]}>
            This build could not connect to in-app purchases. Please update the app or contact support before purchasing.
          </Text>
          <View style={styles.legalLinks}>
            <TouchableOpacity style={[styles.legalLink, { borderColor: colors.border }]} onPress={openPrivacyPolicy}>
              <Text style={[styles.legalLinkText, { color: colors.textSecondary }]}>Privacy Policy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.legalLink, { borderColor: colors.border }]} onPress={openTermsOfUse}>
              <Text style={[styles.legalLinkText, { color: colors.textSecondary }]}>Terms of Use</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {!isPro && primaryPackage ? (
        <Text style={[styles.bottomHint, { color: colors.textMuted }]}>
          Most users choose {primaryPackage.priceLabel || 'the yearly plan'} for best value.
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={closeToProfile}
        activeOpacity={0.8}
      >
        <Text style={[styles.backBtnText, { color: colors.text }]}>Back to Profile</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 36,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    borderRadius: 22,
    padding: 20,
    marginBottom: 14,
  },
  heroTop: {
    alignItems: 'flex-start',
  },
  crownBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5D67B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 3,
  },
  heroBottom: {
    marginTop: 16,
    paddingTop: 14,
    borderTopColor: 'rgba(255,255,255,0.22)',
    borderTopWidth: 1,
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroStatValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 2,
  },
  heroHint: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    marginTop: 3,
  },
  featureCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  featureSub: {
    marginTop: 2,
    fontSize: 12,
  },
  statusCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 6,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusSub: {
    marginTop: 2,
    fontSize: 12,
  },
  packagesWrap: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  packageCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  packageLeft: {
    flex: 1,
    paddingRight: 8,
  },
  packageTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  packageSub: {
    fontSize: 12,
    marginTop: 2,
  },
  packagePrice: {
    fontSize: 14,
    fontWeight: '800',
  },
  buyBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    minHeight: 52,
  },
  paywallBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
  },
  paywallBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  buyBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  restoreBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    minHeight: 44,
  },
  restoreText: {
    fontSize: 13,
    fontWeight: '600',
  },
  legalHint: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  legalLinks: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  legalLink: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  legalLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  refreshBtn: {
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  refreshText: {
    fontSize: 13,
    fontWeight: '600',
  },
  offlineCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
  },
  offlineTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  offlineSub: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
  },
  bottomHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  backBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
