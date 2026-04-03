import { getOptionalRuntimeValue, getRuntimeFlag } from '@/lib/runtimeConfig';

type SupportedAdPlatform = 'ios' | 'android';

function isAdsEnabled(): boolean {
  return !getOptionalRuntimeValue('EXPO_PUBLIC_ADS_ENABLED', 'adsEnabled')
    || getRuntimeFlag('EXPO_PUBLIC_ADS_ENABLED', 'adsEnabled');
}

export function getAdMobAppId(platform: string): string {
  if (platform === 'ios') {
    return getOptionalRuntimeValue('EXPO_PUBLIC_ADMOB_IOS_APP_ID', 'adMobIosAppId') || '';
  }

  if (platform === 'android') {
    return getOptionalRuntimeValue('EXPO_PUBLIC_ADMOB_ANDROID_APP_ID', 'adMobAndroidAppId') || '';
  }

  return '';
}

export function canUseNativeAds(platform: string): platform is SupportedAdPlatform {
  if (!isAdsEnabled()) {
    return false;
  }

  return getAdMobAppId(platform).length > 0;
}
