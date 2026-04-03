import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import createContextHook from '@nkzw/create-context-hook';
import { useAuth } from '@/contexts/AuthContext';
import { trpcClient } from '@/lib/trpc';
import { getOptionalRuntimeValue, getRuntimeFlag } from '@/lib/runtimeConfig';

type RevenueCatPackage = {
  identifier: string;
  packageType: string;
  product?: {
    identifier?: string;
    title?: string;
    description?: string;
    priceString?: string;
  };
};

type ProPackage = {
  id: string;
  title: string;
  description: string;
  priceLabel: string;
  packageType: string;
  sortOrder: number;
  includedScans: number | null;
  kind: OfferKind;
  rcPackage: RevenueCatPackage;
};

type ScanUsage = {
  monthKey: string;
  scansUsed: number;
};

type ScanStatus = {
  monthKey: string;
  freeScansPerMonth: number;
  allowanceScans: number;
  displayAllowanceScans: number;
  scansUsed: number;
  remainingScans: number;
  displayRemainingScans: number;
  hasPaidAccess: boolean;
  hasActiveSubscription: boolean;
  planKind: OfferKind | 'free';
  hasUnlimitedOverride: boolean;
  proDisabled: boolean;
};

type OfferKind = 'pro_monthly' | 'pro_yearly' | 'other';

type OfferMetadata = {
  title: string;
  description: string;
  fallbackPriceLabel: string;
  sortOrder: number;
  includedScans: number | null;
};

type PurchasesCustomerInfo = {
  entitlements?: {
    active?: Record<string, { productIdentifier?: string; product_identifier?: string } | undefined>;
  };
};

type PurchasesResult = {
  customerInfo?: PurchasesCustomerInfo;
};

type PurchasesModule = {
  LOG_LEVEL?: {
    VERBOSE?: unknown;
    INFO?: unknown;
  };
  setLogLevel?: (level: unknown) => void;
  configure: (config: { apiKey: string; appUserID?: string }) => void;
  logIn?: (appUserId: string) => Promise<unknown>;
  logOut?: () => Promise<unknown>;
  getCustomerInfo: () => Promise<PurchasesCustomerInfo>;
  getOfferings: () => Promise<{
    current?: {
      availablePackages?: RevenueCatPackage[];
    };
  }>;
  purchasePackage: (pkg: RevenueCatPackage) => Promise<PurchasesResult | PurchasesCustomerInfo>;
  restorePurchases: () => Promise<PurchasesCustomerInfo>;
  addCustomerInfoUpdateListener?: (listener: (customerInfo: PurchasesCustomerInfo) => void) => void;
  removeCustomerInfoUpdateListener?: (listener: (customerInfo: PurchasesCustomerInfo) => void) => void;
};

type PurchasesUiModule = {
  PAYWALL_RESULT?: {
    PURCHASED?: unknown;
    RESTORED?: unknown;
  };
  presentPaywall: (options: { displayCloseButton: boolean }) => Promise<unknown>;
};

const DEFAULT_FREE_SCANS_PER_MONTH = Math.max(
  0,
  Number(process.env.EXPO_PUBLIC_FREE_SCANS_PER_MONTH ?? 5) || 5,
);
const DEFAULT_PRO_MONTHLY_SCANS = 40;
const DEFAULT_PRO_YEARLY_SCANS = 60;
const REVENUECAT_SYNC_GRACE_MS = 90 * 1000;
const USAGE_KEY_PREFIX = 'owezy_scan_usage';

const OFFER_METADATA: Record<OfferKind, OfferMetadata> = {
  pro_monthly: {
    title: 'Pro Monthly',
    description: `${DEFAULT_PRO_MONTHLY_SCANS} scans each month + no ads`,
    fallbackPriceLabel: '$4.99',
    sortOrder: 1,
    includedScans: DEFAULT_PRO_MONTHLY_SCANS,
  },
  pro_yearly: {
    title: 'Pro Annual',
    description: `${DEFAULT_PRO_YEARLY_SCANS} scans each month + no ads`,
    fallbackPriceLabel: '$29.99',
    sortOrder: 2,
    includedScans: DEFAULT_PRO_YEARLY_SCANS,
  },
  other: {
    title: 'Owezy Pro',
    description: 'More scans each month with no ads',
    fallbackPriceLabel: '',
    sortOrder: 99,
    includedScans: null,
  },
};

let configuredApiKeySingleton: string | null = null;
let configuredAppUserSingleton: string | null = null;

function getMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getUsageStorageKey(userId?: string | null): string {
  return `${USAGE_KEY_PREFIX}_${userId || 'guest'}`;
}

function normalizeUsage(raw: string | null): ScanUsage {
  const currentMonth = getMonthKey();
  if (!raw) {
    return { monthKey: currentMonth, scansUsed: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ScanUsage>;
    if (parsed.monthKey === currentMonth && Number.isFinite(parsed.scansUsed)) {
      return {
        monthKey: currentMonth,
        scansUsed: Math.max(0, Number(parsed.scansUsed) || 0),
      };
    }
  } catch {
    // Ignore malformed persisted value and reset the counter.
  }

  return { monthKey: currentMonth, scansUsed: 0 };
}

function getRevenueCatApiKey(): string {
  if (Platform.OS === 'ios') {
    return getOptionalRuntimeValue('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', 'revenueCatIosApiKey') || '';
  }
  if (Platform.OS === 'android') {
    return getOptionalRuntimeValue('EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY', 'revenueCatAndroidApiKey') || '';
  }
  return '';
}

function loadPurchasesModule(): PurchasesModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }

  if (!getRevenueCatApiKey()) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    return (mod?.default ?? mod) as PurchasesModule;
  } catch {
    return null;
  }
}

function loadPurchasesUiModule(): PurchasesUiModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases-ui');
    return (mod?.default ?? mod) as PurchasesUiModule;
  } catch {
    return null;
  }
}

function isExpoGoRuntime(): boolean {
  const appOwnership = (Constants as { appOwnership?: string }).appOwnership;
  const executionEnvironment = (Constants as { executionEnvironment?: string }).executionEnvironment;
  return appOwnership === 'expo' || executionEnvironment === 'storeClient';
}

function detectOfferKind(pkg: RevenueCatPackage): OfferKind {
  const packageType = String(pkg.packageType || '').toLowerCase();
  const productId = String(pkg.product?.identifier || '').toLowerCase();
  const identifier = String(pkg.identifier || '').toLowerCase();
  const haystack = `${identifier} ${packageType} ${productId}`;

  if ((haystack.includes('year') || haystack.includes('annual')) && haystack.includes('pro')) return 'pro_yearly';
  if (haystack.includes('month') && haystack.includes('pro')) return 'pro_monthly';
  if (packageType === 'monthly') return 'pro_monthly';
  if (packageType === 'annual') return 'pro_yearly';
  return 'other';
}

function mapPackages(
  availablePackages: RevenueCatPackage[],
  preferFallbackPrices: boolean,
): ProPackage[] {
  const mapped = availablePackages.map((pkg, index) => {
    const kind = detectOfferKind(pkg);
    const meta = OFFER_METADATA[kind];
    const storePriceLabel = pkg.product?.priceString || '';
    const fallbackPriceLabel = meta.fallbackPriceLabel || storePriceLabel;
    const useStoreMarketingCopy = kind === 'other';
    return {
      id: pkg.identifier || pkg.packageType || `${kind}_${index}`,
      title: useStoreMarketingCopy ? (pkg.product?.title || meta.title) : meta.title,
      description: useStoreMarketingCopy ? (pkg.product?.description || meta.description) : meta.description,
      priceLabel: preferFallbackPrices ? fallbackPriceLabel : (storePriceLabel || fallbackPriceLabel),
      packageType: pkg.packageType || 'custom',
      sortOrder: meta.sortOrder,
      includedScans: meta.includedScans,
      kind,
      rcPackage: pkg,
    };
  });

  return mapped.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

function getFallbackAllowanceScans(customerInfo: PurchasesCustomerInfo | null, entitlementId: string): number {
  if (!customerInfo) return DEFAULT_FREE_SCANS_PER_MONTH;

  const activeEntitlement = customerInfo.entitlements?.active?.[entitlementId];
  const entitlementProductId = String(
    activeEntitlement?.productIdentifier || activeEntitlement?.product_identifier || '',
  ).toLowerCase();
  if (activeEntitlement) {
    if (entitlementProductId.includes('year') || entitlementProductId.includes('annual')) {
      return DEFAULT_PRO_YEARLY_SCANS;
    }
    return DEFAULT_PRO_MONTHLY_SCANS;
  }

  return DEFAULT_FREE_SCANS_PER_MONTH;
}

function isEntitled(customerInfo: PurchasesCustomerInfo | null, entitlementId: string): boolean {
  return Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
}

function getCurrentPlanKind(customerInfo: PurchasesCustomerInfo | null, entitlementId: string): OfferKind | 'free' {
  const activeEntitlement = customerInfo?.entitlements?.active?.[entitlementId];
  if (!activeEntitlement) {
    return 'free';
  }
  const entitlementProductId = String(
    activeEntitlement.productIdentifier || activeEntitlement.product_identifier || '',
  ).toLowerCase();
  if (entitlementProductId.includes('year') || entitlementProductId.includes('annual')) {
    return 'pro_yearly';
  }
  return 'pro_monthly';
}

export const [SubscriptionProvider, useSubscription] = createContextHook(() => {
  const { user } = useAuth();
  const entitlementId =
    getOptionalRuntimeValue('EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID', 'revenueCatEntitlementId') || 'pro';
  const apiKey = getRevenueCatApiKey();
  const usingExpoGo = isExpoGoRuntime();
  const preferFallbackPrices = apiKey.startsWith('test_');
  const adsEnabled = !getOptionalRuntimeValue('EXPO_PUBLIC_ADS_ENABLED', 'adsEnabled')
    || getRuntimeFlag('EXPO_PUBLIC_ADS_ENABLED', 'adsEnabled');

  const [ready, setReady] = useState<boolean>(false);
  const [storeReady, setStoreReady] = useState<boolean>(false);
  const [packages, setPackages] = useState<ProPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState<boolean>(false);
  const [purchaseBusy, setPurchaseBusy] = useState<boolean>(false);
  const [scanUsage, setScanUsage] = useState<ScanUsage>({ monthKey: getMonthKey(), scansUsed: 0 });
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [paywallReady, setPaywallReady] = useState<boolean>(false);
  const [customerInfo, setCustomerInfo] = useState<PurchasesCustomerInfo | null>(null);
  const [optimisticEntitlementUntilMs, setOptimisticEntitlementUntilMs] = useState<number>(0);

  const purchasesRef = useRef<PurchasesModule | null>(null);
  const purchasesUiRef = useRef<PurchasesUiModule | null>(null);
  const configuredRef = useRef<boolean>(false);
  const listenerRef = useRef<((customerInfo: PurchasesCustomerInfo) => void) | null>(null);

  const refreshScanStatus = useCallback(async (options?: { force?: boolean }) => {
    try {
      const next = options?.force
        ? await trpcClient.scans.refreshSubscriptionStatus.mutate()
        : await trpcClient.scans.scanStatus.query();
      setScanStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  const refreshCustomerInfo = useCallback(async () => {
    const purchases = purchasesRef.current;
    if (!purchases || !configuredRef.current) {
      setCustomerInfo(null);
      setOptimisticEntitlementUntilMs(0);
      return;
    }

    try {
      const info = await purchases.getCustomerInfo();
      setCustomerInfo(info);
    } catch {
      setCustomerInfo(null);
      setOptimisticEntitlementUntilMs(0);
    }
  }, []);

  const refreshOfferings = useCallback(async () => {
    const purchases = purchasesRef.current;
    if (!purchases || !configuredRef.current) {
      setPackages([]);
      return;
    }

    setLoadingPackages(true);
    try {
      const offerings = await purchases.getOfferings();
      const available = offerings?.current?.availablePackages || [];
      setPackages(mapPackages(available, preferFallbackPrices));
    } catch {
      setPackages([]);
    } finally {
      setLoadingPackages(false);
    }
  }, [preferFallbackPrices]);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      setReady(false);
      configuredRef.current = false;
      const usageKey = getUsageStorageKey(user?.id);

      const storedUsage = await AsyncStorage.getItem(usageKey);
      if (!active) return;

      const normalizedUsage = normalizeUsage(storedUsage);
      setScanUsage(normalizedUsage);
      if (normalizedUsage.monthKey !== getMonthKey()) {
        await AsyncStorage.setItem(usageKey, JSON.stringify(normalizedUsage));
      }

      const purchases = loadPurchasesModule();
      const purchasesUi = loadPurchasesUiModule();
      purchasesRef.current = purchases;
      purchasesUiRef.current = purchasesUi;

      const canUseStore = Boolean(purchases && apiKey);
      setStoreReady(canUseStore);
      setPaywallReady(Boolean(purchasesUi && canUseStore && !usingExpoGo));

      try {
        if (canUseStore && purchases) {
          const targetAppUserId = user?.id || null;
          const shouldConfigure = configuredApiKeySingleton !== apiKey;

          if (shouldConfigure) {
            if (typeof purchases.setLogLevel === 'function' && purchases.LOG_LEVEL) {
              const verbose = purchases.LOG_LEVEL.VERBOSE ?? purchases.LOG_LEVEL.INFO;
              purchases.setLogLevel(verbose);
            }
            purchases.configure({
              apiKey,
              appUserID: targetAppUserId || undefined,
            });
            configuredApiKeySingleton = apiKey;
            configuredAppUserSingleton = targetAppUserId;
          } else if (
            targetAppUserId &&
            targetAppUserId !== configuredAppUserSingleton &&
            typeof purchases.logIn === 'function'
          ) {
            await purchases.logIn(targetAppUserId);
            configuredAppUserSingleton = targetAppUserId;
          } else if (
            !targetAppUserId &&
            configuredAppUserSingleton &&
            typeof purchases.logOut === 'function'
          ) {
            await purchases.logOut();
            configuredAppUserSingleton = null;
            setCustomerInfo(null);
            setOptimisticEntitlementUntilMs(0);
          }

          configuredRef.current = true;

          if (listenerRef.current && typeof purchases.removeCustomerInfoUpdateListener === 'function') {
            purchases.removeCustomerInfoUpdateListener(listenerRef.current);
          }

          if (typeof purchases.addCustomerInfoUpdateListener === 'function') {
            const listener = (nextCustomerInfo: PurchasesCustomerInfo) => {
              setCustomerInfo(nextCustomerInfo);
              if (!isEntitled(nextCustomerInfo, entitlementId)) {
                setOptimisticEntitlementUntilMs(0);
              }
            };
            listenerRef.current = listener;
            purchases.addCustomerInfoUpdateListener(listener);
          }

          await Promise.all([refreshCustomerInfo(), refreshOfferings()]);
        } else {
          setPackages([]);
          setCustomerInfo(null);
          setOptimisticEntitlementUntilMs(0);
        }
      } catch {
        setPackages([]);
        setCustomerInfo(null);
        setOptimisticEntitlementUntilMs(0);
      } finally {
        await refreshScanStatus();
        if (active) {
          setReady(true);
        }
      }
    };

    void initialize();

    return () => {
      active = false;
    };
  }, [apiKey, entitlementId, refreshCustomerInfo, refreshOfferings, refreshScanStatus, user?.id, usingExpoGo]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshCustomerInfo();
      void refreshScanStatus({ force: true });
    });

    return () => subscription.remove();
  }, [refreshCustomerInfo, refreshScanStatus]);

  useEffect(() => {
    if (!optimisticEntitlementUntilMs) return;
    const timeoutMs = optimisticEntitlementUntilMs - Date.now();
    if (timeoutMs <= 0) {
      setOptimisticEntitlementUntilMs(0);
      return;
    }
    const timeout = setTimeout(() => {
      setOptimisticEntitlementUntilMs(0);
    }, timeoutMs);
    return () => clearTimeout(timeout);
  }, [optimisticEntitlementUntilMs]);

  const fallbackAllowanceScans = useMemo(() => {
    return getFallbackAllowanceScans(customerInfo, entitlementId);
  }, [customerInfo, entitlementId]);

  const isProDisabledForUser = Boolean(scanStatus?.proDisabled);

  const localPlanKind = useMemo(() => {
    if (isProDisabledForUser) {
      return 'free';
    }
    return getCurrentPlanKind(customerInfo, entitlementId);
  }, [customerInfo, entitlementId, isProDisabledForUser]);

  const hasLocalEntitlement = useMemo(() => {
    return localPlanKind !== 'free';
  }, [localPlanKind]);

  const shouldUseOptimisticLocalEntitlement = useMemo(() => {
    if (isProDisabledForUser) return false;
    if (!hasLocalEntitlement) return false;
    if (!scanStatus) return true;
    if (scanStatus.hasPaidAccess || scanStatus.planKind !== 'free') return false;
    return optimisticEntitlementUntilMs > Date.now();
  }, [hasLocalEntitlement, isProDisabledForUser, optimisticEntitlementUntilMs, scanStatus]);

  const allowanceScans = useMemo(() => {
    if (shouldUseOptimisticLocalEntitlement) {
      return fallbackAllowanceScans;
    }
    return scanStatus?.allowanceScans ?? fallbackAllowanceScans;
  }, [fallbackAllowanceScans, scanStatus?.allowanceScans, shouldUseOptimisticLocalEntitlement]);

  const displayAllowanceScans = useMemo(() => {
    if (shouldUseOptimisticLocalEntitlement) {
      return fallbackAllowanceScans;
    }
    return scanStatus?.displayAllowanceScans ?? fallbackAllowanceScans;
  }, [fallbackAllowanceScans, scanStatus?.displayAllowanceScans, shouldUseOptimisticLocalEntitlement]);

  const scansUsed = useMemo(() => {
    return scanStatus?.scansUsed ?? scanUsage.scansUsed;
  }, [scanStatus?.scansUsed, scanUsage.scansUsed]);

  const freeScansPerMonth = useMemo(() => {
    return scanStatus?.freeScansPerMonth ?? DEFAULT_FREE_SCANS_PER_MONTH;
  }, [scanStatus?.freeScansPerMonth]);

  const remainingScans = useMemo(() => {
    if (allowanceScans >= Number.MAX_SAFE_INTEGER) return null;
    if (scanStatus && !shouldUseOptimisticLocalEntitlement) {
      return Math.max(0, scanStatus.remainingScans);
    }
    return Math.max(0, allowanceScans - scansUsed);
  }, [allowanceScans, scanStatus, scansUsed, shouldUseOptimisticLocalEntitlement]);

  const displayRemainingScans = useMemo(() => {
    if (scanStatus && !shouldUseOptimisticLocalEntitlement) {
      return Math.max(0, scanStatus.displayRemainingScans);
    }
    return Math.max(0, displayAllowanceScans - scansUsed);
  }, [displayAllowanceScans, scanStatus, scansUsed, shouldUseOptimisticLocalEntitlement]);

  const canUseScan = useMemo(() => {
    if (allowanceScans >= Number.MAX_SAFE_INTEGER) return true;
    if (typeof remainingScans !== 'number') return true;
    return remainingScans > 0;
  }, [allowanceScans, remainingScans]);

  const hasPaidAccess = useMemo(() => {
    if (isProDisabledForUser) return false;
    if (shouldUseOptimisticLocalEntitlement) return true;
    if (scanStatus) return scanStatus.hasPaidAccess;
    return hasLocalEntitlement || allowanceScans > freeScansPerMonth;
  }, [allowanceScans, freeScansPerMonth, hasLocalEntitlement, isProDisabledForUser, scanStatus, shouldUseOptimisticLocalEntitlement]);

  const currentPlanKind = useMemo(() => {
    if (isProDisabledForUser) {
      return 'free';
    }
    if (shouldUseOptimisticLocalEntitlement) {
      return localPlanKind;
    }
    if (scanStatus?.planKind && scanStatus.planKind !== 'free') {
      return scanStatus.planKind;
    }
    return scanStatus?.planKind ?? localPlanKind;
  }, [isProDisabledForUser, localPlanKind, scanStatus?.planKind, shouldUseOptimisticLocalEntitlement]);

  const isPro = useMemo(() => {
    return hasPaidAccess || currentPlanKind !== 'free';
  }, [currentPlanKind, hasPaidAccess]);

  useEffect(() => {
    if (!ready || !hasLocalEntitlement) return;
    if (scanStatus?.hasPaidAccess || (scanStatus?.planKind && scanStatus.planKind !== 'free')) {
      setOptimisticEntitlementUntilMs(0);
      return;
    }
    void refreshScanStatus({ force: true });
  }, [hasLocalEntitlement, ready, refreshScanStatus, scanStatus?.hasPaidAccess, scanStatus?.planKind]);

  const recordSuccessfulScan = useCallback(async () => {
    const key = getUsageStorageKey(user?.id);
    const currentMonth = getMonthKey();
    // BUG-H1 fix: use functional update so we always read the latest scanUsage,
    // not a potentially stale closure value captured at callback creation time.
    let next: ScanUsage = { monthKey: currentMonth, scansUsed: 0 };
    setScanUsage((prev) => {
      const base =
        prev.monthKey === currentMonth
          ? prev
          : { monthKey: currentMonth, scansUsed: 0 };
      next = { monthKey: currentMonth, scansUsed: base.scansUsed + 1 };
      return next;
    });
    await AsyncStorage.setItem(key, JSON.stringify(next));
    void refreshScanStatus();
  }, [refreshScanStatus, user?.id]);

  const purchasePro = useCallback(async (packageId: string): Promise<boolean> => {
    if (isProDisabledForUser) {
      return false;
    }
    const purchases = purchasesRef.current;
    const target = packages.find((pkg) => pkg.id === packageId);
    if (!purchases || !configuredRef.current || !target) {
      return false;
    }

    setPurchaseBusy(true);
    try {
      const result = await purchases.purchasePackage(target.rcPackage);
      const info = (result as PurchasesResult)?.customerInfo ?? (result as PurchasesCustomerInfo);
      setCustomerInfo(info);
      const entitled = isEntitled(info, entitlementId);
      setOptimisticEntitlementUntilMs(entitled ? Date.now() + REVENUECAT_SYNC_GRACE_MS : 0);
      await Promise.all([refreshOfferings(), refreshScanStatus({ force: true })]);
      return entitled;
    } catch (error: unknown) {
      if (typeof error === 'object' && error && 'userCancelled' in error && (error as { userCancelled?: boolean }).userCancelled) {
        return false;
      }
      throw error;
    } finally {
      setPurchaseBusy(false);
    }
  }, [entitlementId, isProDisabledForUser, packages, refreshOfferings, refreshScanStatus]);

  const restorePro = useCallback(async (): Promise<boolean> => {
    if (isProDisabledForUser) {
      return false;
    }
    const purchases = purchasesRef.current;
    if (!purchases || !configuredRef.current) {
      return false;
    }

    setPurchaseBusy(true);
    try {
      const info = await purchases.restorePurchases();
      setCustomerInfo(info);
      const entitled = isEntitled(info, entitlementId);
      setOptimisticEntitlementUntilMs(entitled ? Date.now() + REVENUECAT_SYNC_GRACE_MS : 0);
      await Promise.all([refreshOfferings(), refreshScanStatus({ force: true })]);
      return entitled;
    } finally {
      setPurchaseBusy(false);
    }
  }, [entitlementId, isProDisabledForUser, refreshOfferings, refreshScanStatus]);

  const presentPaywall = useCallback(async (): Promise<boolean> => {
    if (isProDisabledForUser) {
      return false;
    }
    const purchasesUi = purchasesUiRef.current;
    if (!purchasesUi || !configuredRef.current || usingExpoGo) {
      return false;
    }

    setPurchaseBusy(true);
    try {
      const result = await purchasesUi.presentPaywall({
        displayCloseButton: true,
      });
      const paywallResult = purchasesUi.PAYWALL_RESULT ?? {};
      const purchased =
        result === paywallResult.PURCHASED || result === paywallResult.RESTORED;
      if (purchased) {
        setOptimisticEntitlementUntilMs(Date.now() + REVENUECAT_SYNC_GRACE_MS);
        await Promise.all([refreshCustomerInfo(), refreshOfferings(), refreshScanStatus({ force: true })]);
      }
      return purchased;
    } finally {
      setPurchaseBusy(false);
    }
  }, [isProDisabledForUser, refreshCustomerInfo, refreshOfferings, refreshScanStatus, usingExpoGo]);

  return {
    ready,
    storeReady: storeReady && !isProDisabledForUser,
    isPro,
    hasPaidAccess,
    packages,
    loadingPackages,
    purchaseBusy,
    paywallReady: paywallReady && !isProDisabledForUser,
    adsEnabled,
    freeScansPerMonth,
    allowanceScans,
    displayAllowanceScans,
    scansUsed,
    remainingScans,
    displayRemainingScans,
    currentPlanKind,
    canUseScan,
    recordSuccessfulScan,
    refreshOfferings,
    refreshCustomerInfo,
    refreshScanStatus,
    purchasePro,
    restorePro,
    presentPaywall,
  };
});
