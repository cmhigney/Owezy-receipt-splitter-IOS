const { withInfoPlist } = require('@expo/config-plugins');

function loadBaseConfig() {
  const appJson = require('./app.json');
  return appJson.expo;
}

function hasPackageInstalled(packageName) {
  try {
    require.resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function withPlugin(plugins, pluginEntry) {
  const pluginName = Array.isArray(pluginEntry) ? pluginEntry[0] : pluginEntry;
  const next = plugins.filter((entry) => {
    if (Array.isArray(entry)) {
      return entry[0] !== pluginName;
    }
    return entry !== pluginName;
  });
  next.push(pluginEntry);
  return next;
}

function getBackendUrl() {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isPrivateOrLoopbackHost(hostname) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === 'localhost' || normalized === '127.0.0.1') {
    return true;
  }

  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  if (octets[0] === 10 || octets[0] === 127) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  return false;
}

module.exports = ({ config }) => {
  const baseConfig = {
    ...loadBaseConfig(),
    ...config,
  };

  const iosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID?.trim() || '';
  const androidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID?.trim() || '';
  const hasGoogleMobileAds = hasPackageInstalled('react-native-google-mobile-ads');
  const newArchEnabled = process.env.EXPO_NO_NEW_ARCH !== '1';
  let plugins = [...(baseConfig.plugins ?? [])];

  if (!hasGoogleMobileAds || (!iosAppId && !androidAppId)) {
    plugins = plugins.filter((entry) =>
      Array.isArray(entry)
        ? entry[0] !== 'react-native-google-mobile-ads'
        : entry !== 'react-native-google-mobile-ads',
    );
  } else {
    plugins = withPlugin(plugins, [
      'react-native-google-mobile-ads',
      {
        ...(iosAppId ? { iosAppId } : {}),
        ...(androidAppId ? { androidAppId } : {}),
      },
    ]);
  }

  const finalConfig = {
    ...baseConfig,
    plugins,
    newArchEnabled,
    extra: {
      // Only client-safe runtime config belongs in Expo extra because it is bundled into the app.
      // Keep all server secrets in non-EXPO_PUBLIC environment variables on the backend runtime.
      ...(baseConfig.extra ?? {}),
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || undefined,
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() || undefined,
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() || undefined,
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim() || undefined,
      revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() || undefined,
      revenueCatAndroidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() || undefined,
      revenueCatEntitlementId: process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() || undefined,
      adsEnabled: process.env.EXPO_PUBLIC_ADS_ENABLED?.trim() || undefined,
      adMobIosAppId: iosAppId || undefined,
      adMobAndroidAppId: androidAppId || undefined,
      adMobHistoryBannerId: process.env.EXPO_PUBLIC_ADMOB_HISTORY_BANNER_ID?.trim() || undefined,
      adMobFriendsBannerId: process.env.EXPO_PUBLIC_ADMOB_FRIENDS_BANNER_ID?.trim() || undefined,
      iosOnDeviceOcrEnabled: process.env.EXPO_PUBLIC_IOS_ON_DEVICE_OCR_ENABLED?.trim() || undefined,
      iosOnDeviceOcrFallbackOnlyOnNoItems:
        process.env.EXPO_PUBLIC_IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS?.trim() || undefined,
      iosOnDeviceOcrMinConfidence:
        process.env.EXPO_PUBLIC_IOS_ON_DEVICE_OCR_MIN_CONFIDENCE?.trim() || undefined,
      ocrParseTimeoutMs: process.env.EXPO_PUBLIC_OCR_PARSE_TIMEOUT_MS?.trim() || undefined,
      e2eSkipEmailVerification: process.env.EXPO_PUBLIC_E2E_SKIP_EMAIL_VERIFICATION === '1',
      e2eEnableTestReceipts: process.env.EXPO_PUBLIC_E2E_ENABLE_TEST_RECEIPTS === '1',
    },
  };

  const backendUrl = getBackendUrl();
  const insecureBackendDomain = backendUrl?.protocol === 'http:' ? backendUrl.hostname : null;
  const allowsLocalNetworking = backendUrl ? isPrivateOrLoopbackHost(backendUrl.hostname) : false;

  return withInfoPlist(finalConfig, (configWithInfoPlist) => {
    const modResults = configWithInfoPlist.modResults ?? {};
    const existingAts = modResults.NSAppTransportSecurity ?? {};
    const ats = { ...existingAts };
    delete ats.NSAllowsArbitraryLoads;

    if (allowsLocalNetworking) {
      ats.NSAllowsLocalNetworking = true;
    } else {
      delete ats.NSAllowsLocalNetworking;
    }

    const existingExceptionDomains = existingAts.NSExceptionDomains ?? {};
    const nextExceptionDomains = { ...existingExceptionDomains };
    const existingExceptionDomain =
      insecureBackendDomain && typeof existingExceptionDomains[insecureBackendDomain] === 'object'
        ? existingExceptionDomains[insecureBackendDomain]
        : {};

    if (insecureBackendDomain) {
      nextExceptionDomains[insecureBackendDomain] = {
        ...existingExceptionDomain,
        NSExceptionAllowsInsecureHTTPLoads: true,
        NSIncludesSubdomains: false,
      };
    }

    if (Object.keys(nextExceptionDomains).length > 0) {
      ats.NSExceptionDomains = nextExceptionDomains;
    } else {
      delete ats.NSExceptionDomains;
    }

    if (Object.keys(ats).length > 0) {
      modResults.NSAppTransportSecurity = ats;
    } else {
      delete modResults.NSAppTransportSecurity;
    }

    configWithInfoPlist.modResults = modResults;
    return configWithInfoPlist;
  });
};
