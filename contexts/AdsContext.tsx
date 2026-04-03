import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import createContextHook from '@nkzw/create-context-hook';
import { canUseNativeAds } from '@/lib/adsConfig';

export const [AdsProvider, useAds] = createContextHook(() => {
  const nativeAdsEnabled = canUseNativeAds(Platform.OS);
  const [adsSdkReady, setAdsSdkReady] = useState<boolean>(!nativeAdsEnabled);

  useEffect(() => {
    if (!nativeAdsEnabled) {
      setAdsSdkReady(true);
      return;
    }

    let cancelled = false;

    const initializeAds = async () => {
      try {
        // Request App Tracking Transparency permission on iOS before initializing ads
        if (Platform.OS === 'ios') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { requestTrackingPermissionsAsync } = require('expo-tracking-transparency');
            await requestTrackingPermissionsAsync();
          } catch {
            // ATT module not available — continue without it
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('react-native-google-mobile-ads');
        const mobileAds = mod?.default ?? null;
        if (!mobileAds) {
          if (!cancelled) {
            setAdsSdkReady(false);
          }
          return;
        }

        await mobileAds().initialize();
        if (!cancelled) {
          setAdsSdkReady(true);
        }
      } catch {
        if (!cancelled) {
          setAdsSdkReady(false);
        }
      }
    };

    void initializeAds();

    return () => {
      cancelled = true;
    };
  }, [nativeAdsEnabled]);

  return {
    adsSdkReady,
    nativeAdsEnabled,
  };
});
