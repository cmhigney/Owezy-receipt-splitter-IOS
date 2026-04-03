import Constants from "expo-constants";

type RuntimeExtraConfig = {
  apiBaseUrl?: string;
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
  revenueCatIosApiKey?: string;
  revenueCatAndroidApiKey?: string;
  revenueCatEntitlementId?: string;
  adsEnabled?: boolean | number | string;
  adMobIosAppId?: string;
  adMobAndroidAppId?: string;
  adMobHistoryBannerId?: string;
  adMobFriendsBannerId?: string;
  iosOnDeviceOcrEnabled?: boolean | number | string;
  iosOnDeviceOcrFallbackOnlyOnNoItems?: boolean | number | string;
  iosOnDeviceOcrMinConfidence?: string | number;
  ocrParseTimeoutMs?: string | number;
  e2eSkipEmailVerification?: boolean | number | string;
  e2eEnableTestReceipts?: boolean | number | string;
};

const expoExtra = ((Constants.expoConfig as { extra?: RuntimeExtraConfig } | null | undefined)?.extra ??
  {}) as RuntimeExtraConfig;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function isEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
}

export function getOptionalRuntimeValue(
  envName: string,
  extraKey: keyof RuntimeExtraConfig,
): string | undefined {
  const envValue = normalizeString((process.env as Record<string, string | undefined>)[envName]);
  if (envValue) {
    return envValue;
  }

  return normalizeString(expoExtra[extraKey]);
}

export function getRuntimeFlag(
  envName: string,
  extraKey: keyof RuntimeExtraConfig,
): boolean {
  return isEnabled((process.env as Record<string, string | undefined>)[envName]) || isEnabled(expoExtra[extraKey]);
}
