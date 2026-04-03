import React from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useAds } from '@/contexts/AdsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { canUseNativeAds } from '@/lib/adsConfig';
import { getOptionalRuntimeValue } from '@/lib/runtimeConfig';

type InlineAdBannerProps = {
  placement: 'history' | 'friends';
};

function getConfiguredAdUnitId(placement: InlineAdBannerProps['placement']): string {
  if (placement === 'history') {
    return getOptionalRuntimeValue('EXPO_PUBLIC_ADMOB_HISTORY_BANNER_ID', 'adMobHistoryBannerId') || '';
  }
  return getOptionalRuntimeValue('EXPO_PUBLIC_ADMOB_FRIENDS_BANNER_ID', 'adMobFriendsBannerId') || '';
}

export default function InlineAdBanner({ placement }: InlineAdBannerProps) {
  const { colors } = useTheme();
  const { adsSdkReady, nativeAdsEnabled } = useAds();
  const { isPro, adsEnabled } = useSubscription();
  const { width } = useWindowDimensions();

  if (!adsEnabled || isPro) {
    return null;
  }

  const cardWidth = Math.max(280, Math.min(width - 32, 360));
  const configuredAdUnitId = getConfiguredAdUnitId(placement);
  const canShowNativeBanner =
    Boolean(configuredAdUnitId) && nativeAdsEnabled && canUseNativeAds(Platform.OS) && adsSdkReady;

  let BannerAd: unknown = null;
  let BannerAdSize: unknown = null;

  if (canShowNativeBanner) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-google-mobile-ads');
      BannerAd = mod?.BannerAd ?? null;
      BannerAdSize = mod?.BannerAdSize ?? null;
    } catch {
      BannerAd = null;
      BannerAdSize = null;
    }
  }

  if (configuredAdUnitId && BannerAd && BannerAdSize) {
    const NativeBanner = BannerAd as React.ComponentType<{
      unitId: string;
      size: string;
      requestOptions?: {
        requestNonPersonalizedAdsOnly?: boolean;
      };
    }>;
    const nativeBannerSize = (BannerAdSize as { ANCHORED_ADAPTIVE_BANNER: string }).ANCHORED_ADAPTIVE_BANNER;

    return (
      <View style={styles.outer}>
        <View
          style={[
            styles.container,
            styles.bannerCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              width: cardWidth,
            },
          ]}
        >
          <Text style={[styles.sponsored, { color: colors.textMuted }]}>Sponsored</Text>
          <View style={styles.bannerWrap}>
            <NativeBanner
              unitId={configuredAdUnitId}
              size={nativeBannerSize}
              requestOptions={{ requestNonPersonalizedAdsOnly: true }}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outer}>
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            width: cardWidth,
          },
        ]}
      >
        <Text style={[styles.fallbackEyebrow, { color: colors.textMuted }]}>Owezy Pro</Text>
        <Text style={[styles.fallbackTitle, { color: colors.text }]}>Need more scans this month?</Text>
        <Text style={[styles.fallbackSub, { color: colors.textSecondary }]}>
          Upgrade to Pro for more monthly scans and an ad-free experience.
        </Text>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.primaryLight }]}
          onPress={() => router.push('/(tabs)/profile/pro' as any)}
        >
          <Text style={[styles.ctaText, { color: colors.primary }]}>View Plans</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 18,
  },
  container: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  bannerCard: {
    minHeight: 96,
  },
  sponsored: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  bannerWrap: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  fallbackTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  fallbackSub: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  cta: {
    marginTop: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
