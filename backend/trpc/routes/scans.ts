import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { getOptionalServerEnv, getOptionalServerSecret } from "../../config/server-env";
import { store } from "../../store";

const scanRegionSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0).max(1),
  height: z.number().finite().min(0).max(1),
}).strict();
const scanInputSchema = z.object({
  imageBase64: z
    .string()
    .trim()
    .min(1)
    .max(8_000_000)
    .regex(/^(?:data:[^;]+;base64,)?[A-Za-z0-9+/=\r\n]+$/),
  mimeType: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/)
    .optional(),
  scanRegion: scanRegionSchema.optional(),
}).strict();
const scanTextInputSchema = z.object({
  text: z.string().trim().min(1).max(200_000),
  source: z.string().trim().min(1).max(64).optional(),
  lines: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2_000),
        confidence: z.number().finite().min(0).max(1).nullable().optional(),
        boundingBox: z
          .object({
            x: z.number().finite().min(0).max(1),
            y: z.number().finite().min(0).max(1),
            width: z.number().finite().min(0).max(1),
            height: z.number().finite().min(0).max(1),
          })
          .strict()
          .nullable()
          .optional(),
      }).strict(),
    )
    .max(2_000)
    .optional(),
}).strict();

const scanResultItemSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  quantity: z.number().int().min(1),
}).strict();

type ParsedItem = z.infer<typeof scanResultItemSchema>;
type StructuredOcrLine = {
  text: string;
  confidence: number | null;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};
type TipCandidate = {
  amount: number;
  label: string;
};
type AutoGratuityInfo = {
  detected: boolean;
  partySizeMin: number | null;
  policyText: string | null;
  includedInTotal: boolean;
  autoGratuityAmount: number | null;
  additionalTipAmount: number | null;
};
type OcrExecutionMeta = {
  selectedSource: "vision" | "docai" | "apple_vision_text";
  visionParseAttempts: number;
  visionTextFallbackCalls: number;
  docAiAttempts: number;
  estimatedOcrCostUsd: number;
};

type FeeCandidateItem = { type: string; label: string; amount: number };
type TaxCandidateItem = { type: string; label: string; amount: number };
type DiscountCandidateItem = { type: string; label: string; amount: number };
type RawAmountCandidateRecord = {
  raw_text: string;
  label_text: string;
  amount_text: string;
  parsed_amount: number;
  line_index: number;
  classification_result: string;
  status: string;
  status_reason: string;
  selected_as?: string;
};
type NormalizedReceiptData = {
  fees: FeeCandidateItem[];
  discounts: DiscountCandidateItem[];
  mandatoryCharges: FeeCandidateItem[];
  taxesDetail: TaxCandidateItem[];
  payments: { label: string; amount: number; method: string }[];
  rawAmountCandidates: RawAmountCandidateRecord[];
  totalsDetected: {
    raw_label: string;
    raw_value_text: string;
    parsed_amount: number;
    confidence: number;
    selected: boolean;
    rejection_reason?: string;
  }[];
  calculationCheckPassed: boolean;
  calculationDelta: number;
  calculationToleranceUsed: number;
  reviewRequired: boolean;
  reviewReasons: string[];
  receiptType: string;
  documentValidity: string;
  fraudFlags: string[];
  isOpenTab: boolean;
  isMerchantCopy: boolean;
  isSplitCheck: boolean;
  checkNumber?: string;
  totalChecks?: number;
  taxIncluded: boolean;
  feeTotalForMath: number;
  mandatoryChargeTotalForMath: number;
  optionalTipAmount: number;
  actualTaxTotal: number;
  parserVersion: string;
};

type ParsedReceipt = {
  restaurantName: string;
  items: ParsedItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  autoGratuity: AutoGratuityInfo;
  _ocrMeta?: OcrExecutionMeta;
  detectedCurrency?: string;
  currencyConversionRate?: number;
  _normalized?: NormalizedReceiptData;
};

type ParseConsistency = {
  isConsistent: boolean;
  score: number;
  totalDelta: number;
  subtotalDelta: number;
};
type ScanRegion = z.infer<typeof scanRegionSchema>;
type OcrRoutingMode = "docai_first" | "vision_first_guarded" | "vision_only";
type ParsedTotals = {
  items: ParsedItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  autoGratuity: AutoGratuityInfo;
};
type RevenueCatEntitlement = {
  product_identifier?: string | null;
  expires_date?: string | null;
};
type RevenueCatSubscription = {
  expires_date?: string | null;
};
type RevenueCatNonSubscriptionPurchase = {
  purchase_date?: string | null;
  id?: string | null;
};
type RevenueCatSubscriber = {
  entitlements?: Record<string, RevenueCatEntitlement | undefined> | null;
  subscriptions?: Record<string, RevenueCatSubscription | undefined> | null;
  non_subscriptions?: Record<string, RevenueCatNonSubscriptionPurchase[] | undefined> | null;
};
type ScanAllowance = {
  monthlyAllowance: number;
  displayMonthlyAllowance: number;
  hasPaidAccess: boolean;
  hasActiveSubscription: boolean;
  planKind: "free" | "pro_monthly" | "pro_yearly";
};
type ScanStatusResult = {
  monthKey: string;
  freeScansPerMonth: number;
  allowanceScans: number;
  displayAllowanceScans: number;
  scansUsed: number;
  remainingScans: number;
  displayRemainingScans: number;
  hasPaidAccess: boolean;
  hasActiveSubscription: boolean;
  planKind: "free" | "pro_monthly" | "pro_yearly";
  hasUnlimitedOverride: boolean;
  proDisabled: boolean;
};

const receiptKeywords = [
  "subtotal",
  "sub total",
  "sub-total",
  "tax",
  "sales tax",
  "vat",
  "gst",
  "hst",
  "pst",
  "qst",
  "tip",
  "gratuity",
  "service charge",
  "surcharge",
  "total",
  "grand total",
  "order total",
  "net amount",
  "amount payable",
  "amount due",
  "balance due",
  "change",
  "cash",
  "visa",
  "mastercard",
  "amex",
  "debit",
  "credit",
  "card",
  "auth",
  "approval",
  "transaction",
  "invoice",
  "receipt",
  "table",
  "server",
  "guest",
  "www.",
  "http",
  "thank you",
  "welcome",
];

const nonItemKeywords = [
  "station",
  "order",
  "serv",
  "server",
  "table",
  "check",
  "guest",
  "parties",
  "party",
  "auth",
  "approval",
  "trans",
  "receipt",
  "subtotal",
  "total",
  "tax",
  "tip",
  "gratuity",
  "service charge",
  "surcharge",
  "balance",
  "amount due",
  "change",
];

let visionClient: any;
let docAiClient: any;
const OCR_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const OCR_RATE_LIMIT_MAX_REQUESTS = 30;
const FREE_SCANS_PER_MONTH = Math.max(
  0,
  Number(process.env.OWEZY_FREE_SCANS_PER_MONTH ?? 5) || 5,
);
const PRO_MONTHLY_SCANS_PER_MONTH = Math.max(
  0,
  Number(process.env.OWEZY_PRO_MONTHLY_SCANS_PER_MONTH ?? 40) || 40,
);
const PRO_YEARLY_SCANS_PER_MONTH = Math.max(
  0,
  Number(process.env.OWEZY_PRO_YEARLY_SCANS_PER_MONTH ?? 60) || 60,
);
const REVENUECAT_CACHE_TTL_MS = 60 * 1000;
const revenueCatSubscriberCache = new Map<
  string,
  { subscriber: RevenueCatSubscriber | null; checkedAtMs: number }
>();
const DEFAULT_FORCE_PRO_EMAILS = new Set<string>();
const FORCE_PRO_EMAILS = new Set(
  [
    ...DEFAULT_FORCE_PRO_EMAILS,
    ...((process.env.OWEZY_FORCE_PRO_EMAILS ?? ""))
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ],
);
const FORCE_PRO_USER_IDS = new Set(
  ((process.env.OWEZY_FORCE_PRO_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)),
);
const DISABLED_PRO_EMAILS = new Set(
  [
    ...((process.env.OWEZY_DISABLED_PRO_EMAILS ?? ""))
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ],
);
const DISABLED_PRO_USER_IDS = new Set(
  ((process.env.OWEZY_DISABLED_PRO_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)),
);
const RC_PRO_MONTHLY_PRODUCT_IDS = new Set(
  (process.env.OWEZY_RC_PRODUCT_IDS_PRO_MONTHLY ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const RC_PRO_YEARLY_PRODUCT_IDS = new Set(
  (process.env.OWEZY_RC_PRODUCT_IDS_PRO_YEARLY ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const VERBOSE_SCAN_LOGS =
  !process.env.K_SERVICE && !process.env.FUNCTION_TARGET && process.env.NODE_ENV !== "production";
const PARSE_CACHE_VERSION = "v4";
const RECEIPT_PARSER_VERSION = "2.0.0";
const OCR_ROUTING_MODE = (() : OcrRoutingMode => {
  const routingMode = (process.env.OWEZY_OCR_ROUTING_MODE ?? "vision_first_guarded")
    .trim()
    .toLowerCase();
  if (routingMode === "vision_only") return "vision_only";
  if (routingMode === "docai_first") return "docai_first";
  return "vision_first_guarded";
})();
const VISION_FIRST_MAX_SCORE = Math.max(
  0,
  Number(process.env.OWEZY_VISION_FIRST_MAX_SCORE ?? 0.08) || 0.08,
);
const VISION_FIRST_MIN_ITEM_COUNT = Math.max(
  1,
  Number(process.env.OWEZY_VISION_FIRST_MIN_ITEM_COUNT ?? 2) || 2,
);
const OCR_COST_DOCAI_PER_DOC = Math.max(
  0,
  Number(process.env.OWEZY_COST_DOCAI_PER_DOC ?? 0.1) || 0.1,
);
const OCR_COST_VISION_PER_CALL = Math.max(
  0,
  Number(process.env.OWEZY_COST_VISION_PER_CALL ?? 0.0015) || 0.0015,
);
const PARSED_RECEIPT_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.OCR_PARSE_CACHE_TTL_MS ?? 30 * 60 * 1000) || 30 * 60 * 1000,
);
const PARSED_RECEIPT_CACHE_MAX_ENTRIES = Math.max(
  100,
  Number(process.env.OCR_PARSE_CACHE_MAX_ENTRIES ?? 1500) || 1500,
);
const DOC_AI_RESULT_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.DOCAI_RESULT_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000,
);
const DOC_AI_RESULT_CACHE_MAX_ENTRIES = Math.max(
  100,
  Number(process.env.DOCAI_RESULT_CACHE_MAX_ENTRIES ?? 1500) || 1500,
);
type TimedCacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};
const parsedReceiptCache = new Map<string, TimedCacheEntry<ParsedReceipt>>();
const parsedReceiptInFlight = new Map<string, Promise<ParsedReceipt>>();
const parsedReceiptTextCache = new Map<string, TimedCacheEntry<ParsedReceipt>>();
const parsedReceiptTextInFlight = new Map<string, Promise<ParsedReceipt>>();
const docAiParsedCache = new Map<string, TimedCacheEntry<ParsedReceipt>>();
const docAiInFlight = new Map<string, Promise<ParsedReceipt | null>>();

function logScan(message: string) {
  if (VERBOSE_SCAN_LOGS) {
    console.log(message);
  }
}

function logScanError(message: string, error: unknown) {
  if (VERBOSE_SCAN_LOGS) {
    console.error(message, error);
  } else {
    console.error(message);
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundCost(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readTimedCache<T>(cache: Map<string, TimedCacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeTimedCache<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
): void {
  while (cache.size >= maxEntries) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) break;
    cache.delete(firstKey);
  }
  cache.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
}

function evaluateParseConsistency(parsed: ParsedReceipt): ParseConsistency {
  const subtotal = roundCurrency(parsed.subtotal || 0);
  const tax = roundCurrency(parsed.tax || 0);
  const tip = roundCurrency(parsed.tip || 0);
  const total = roundCurrency(parsed.total || 0);
  const expectedTotal = roundCurrency(subtotal + tax + tip);
  const totalDelta =
    total > 0 && expectedTotal > 0
      ? Math.abs(roundCurrency(total - expectedTotal))
      : 0;

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const itemSum = roundCurrency(
    items.reduce((sum, item) => sum + (Number(item?.price) || 0), 0),
  );
  const hasSyntheticOnly =
    items.length === 1 && cleanLine(String(items[0]?.name || "")).toLowerCase() === "receipt items";
  const subtotalDelta =
    subtotal > 0 && itemSum > 0 && !hasSyntheticOnly
      ? Math.abs(roundCurrency(subtotal - itemSum))
      : 0;

  const totalNorm = total > 0 ? totalDelta / total : 0;
  const subtotalNorm = subtotal > 0 ? subtotalDelta / subtotal : 0;
  const score = roundCurrency(totalNorm * 2 + subtotalNorm);

  const totalWithinTolerance =
    totalDelta <= Math.max(0.2, roundCurrency(total * 0.06));
  const subtotalWithinTolerance =
    subtotalDelta <= Math.max(0.2, roundCurrency(subtotal * 0.65));

  return {
    isConsistent: totalWithinTolerance && subtotalWithinTolerance,
    score,
    totalDelta,
    subtotalDelta,
  };
}

function hasSyntheticOnlyReceiptItems(parsed: ParsedReceipt): boolean {
  return (
    parsed.items.length === 1 &&
    cleanLine(String(parsed.items[0]?.name || "")).toLowerCase() === "receipt items"
  );
}

function isVisionParseAcceptable(
  parsed: ParsedReceipt,
  consistency: ParseConsistency,
): boolean {
  if (!consistency.isConsistent) return false;
  if (consistency.score > VISION_FIRST_MAX_SCORE) return false;
  if (hasSyntheticOnlyReceiptItems(parsed)) return false;

  const itemCount = parsed.items.length;
  const subtotal = roundCurrency(parsed.subtotal || 0);
  const tax = roundCurrency(parsed.tax || 0);
  const tip = roundCurrency(parsed.tip || 0);
  const total = roundCurrency(parsed.total || 0);
  const hasSyntheticOnly = hasSyntheticOnlyReceiptItems(parsed);
  const itemSum = roundCurrency(
    parsed.items.reduce((sum, item) => sum + (Number(item?.price) || 0), 0),
  );
  const hasMeaningfulTotals =
    total > 0 || subtotal > 0 || tax > 0 || tip > 0;

  // Guard against low-quality parses that only detect a total but miss all components.
  if (total > 0 && subtotal <= 0 && tax <= 0 && tip <= 0) return false;
  // Guard against itemized parses that miss subtotal entirely.
  if (!hasSyntheticOnly && itemSum > 0 && subtotal <= 0) return false;

  if (!hasMeaningfulTotals && itemCount === 0) return false;
  if (itemCount < VISION_FIRST_MIN_ITEM_COUNT && !hasMeaningfulTotals) return false;

  return true;
}

function hasSuspiciousUnlabeledBottomAmounts(
  text: string,
  parsed: ParsedReceipt,
): boolean {
  const itemCount = parsed.items.length;
  const subtotal = roundCurrency(parsed.subtotal || 0);
  const tax = roundCurrency(parsed.tax || 0);
  const tip = roundCurrency(parsed.tip || 0);
  const total = roundCurrency(parsed.total || 0);

  if (itemCount < 2 || subtotal <= 0 || total <= 0) return false;
  if (Math.abs(total - subtotal) > 0.05) return false;
  if (tax > 0 || tip > 0) return false;

  const lines = mergeSplitAmountLines(
    text
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(Boolean),
  );
  if (lines.length < 4) return false;

  const lowerHalfStart = Math.floor(lines.length * 0.5);
  const bottomAmounts = lines
    .map((line, index) => ({ index, lineAmount: getLineAmount(line) }))
    .filter(
      (entry): entry is { index: number; lineAmount: NonNullable<ReturnType<typeof getLineAmount>> } =>
        Boolean(entry.lineAmount),
    )
    .filter((entry) => entry.index >= lowerHalfStart)
    .map((entry) => roundCurrency(entry.lineAmount.amount))
    .filter((amount) => amount > 0);

  const distinctBottomAmounts = [...new Set(bottomAmounts)];
  if (distinctBottomAmounts.length < 2) return false;

  const maxBottomAmount = Math.max(...distinctBottomAmounts);
  const minBottomAmount = Math.min(...distinctBottomAmounts);
  return roundCurrency(maxBottomAmount - minBottomAmount) >= 0.5;
}

function getVisionDocAiFallbackReason(text: string, parsed: ParsedReceipt): string | null {
  const itemCount = parsed.items.length;
  const subtotal = roundCurrency(parsed.subtotal || 0);
  const tax = roundCurrency(parsed.tax || 0);
  const tip = roundCurrency(parsed.tip || 0);
  const total = roundCurrency(parsed.total || 0);
  const normalizedText = text.toLowerCase();

  if (itemCount <= 3 && subtotal > 0 && total > subtotal && tax > 0 && tip > 0) {
    return "short_receipt_dual_charge_cross_check";
  }

  if (
    itemCount >= 8 &&
    tip <= 0 &&
    /\b(?:tip|gratuity)\b/.test(normalizedText) &&
    total > subtotal
  ) {
    return "large_receipt_tip_text_missing_tip_amount";
  }

  return null;
}

function reconcileParsedTotals(params: ParsedTotals): ParsedTotals {
  let items = [...params.items];
  let subtotal = roundCurrency(params.subtotal || 0);
  let tax = roundCurrency(params.tax || 0);
  let tip = roundCurrency(params.tip || 0);
  const total = roundCurrency(params.total || 0);
  let autoGratuity = { ...params.autoGratuity };

  const hasSyntheticOnly =
    items.length === 1 &&
    cleanLine(String(items[0]?.name || "")).toLowerCase() === "receipt items";
  const expectedTotal = roundCurrency(subtotal + tax + tip);
  const mismatch = roundCurrency(total - expectedTotal);

  if (mismatch > 0.1) {
    if (hasSyntheticOnly) {
      subtotal = roundCurrency(Math.max(0, total - tax - tip));
      items = [{ ...items[0], price: subtotal, quantity: 1 }];
    } else if (
      !autoGratuity.detected &&
      mismatch <= roundCurrency(Math.max(0.1, subtotal * 0.35))
    ) {
      tax = roundCurrency(tax + mismatch);
    }
  } else if (mismatch < -0.1) {
    const baseTotal = roundCurrency(subtotal + tax);
    const inferredDiscount = roundCurrency(baseTotal - total);
    if (inferredDiscount > 0 && inferredDiscount <= roundCurrency(subtotal * 0.5)) {
      subtotal = roundCurrency(subtotal - inferredDiscount);
    }
    if (tip > 0 && Math.abs(total - roundCurrency(subtotal + tax)) <= 0.1) {
      tip = 0;
    }
  }

  if (tip <= 0 && autoGratuity.detected) {
    autoGratuity = {
      ...autoGratuity,
      includedInTotal: false,
      autoGratuityAmount: null,
      additionalTipAmount: null,
    };
  }

  return {
    items,
    subtotal: roundCurrency(subtotal),
    tax: roundCurrency(tax),
    tip: roundCurrency(tip),
    total: roundCurrency(total),
    autoGratuity,
  };
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function getVisionClient() {
  if (!visionClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vision = require("@google-cloud/vision") as {
      ImageAnnotatorClient: new () => any;
    };
    visionClient = new vision.ImageAnnotatorClient();
  }
  return visionClient;
}

function getDocAiClient() {
  if (!docAiClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const documentai = require("@google-cloud/documentai") as {
      DocumentProcessorServiceClient: new () => any;
    };
    docAiClient = new documentai.DocumentProcessorServiceClient();
  }
  return docAiClient;
}

function getMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRevenueCatSecretKey(): string {
  return getOptionalServerSecret("OWEZY_REVENUECAT_SECRET_API_KEY");
}

function getRevenueCatEntitlementId(): string {
  return getOptionalServerEnv("OWEZY_REVENUECAT_ENTITLEMENT_ID") || "pro";
}

function isRevenueCatEnforcementEnabled(): boolean {
  return Boolean(getRevenueCatSecretKey());
}

function isEntitlementActive(entitlement: RevenueCatEntitlement | null | undefined): boolean {
  if (!entitlement || typeof entitlement !== "object") return false;
  const expiresAtRaw = entitlement.expires_date;
  if (!expiresAtRaw) return true;
  const expiresAtMs = new Date(String(expiresAtRaw)).getTime();
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs > Date.now();
}

function detectProductKind(productIdRaw: string | null | undefined):
  | "pro_monthly"
  | "pro_yearly"
  | "unknown" {
  const productId = String(productIdRaw || "").trim().toLowerCase();
  if (!productId) return "unknown";

  if (RC_PRO_MONTHLY_PRODUCT_IDS.has(productId)) return "pro_monthly";
  if (RC_PRO_YEARLY_PRODUCT_IDS.has(productId)) return "pro_yearly";
  if ((productId.includes("year") || productId.includes("annual")) && productId.includes("pro")) {
    return "pro_yearly";
  }
  if (productId.includes("month") && productId.includes("pro")) return "pro_monthly";
  return "unknown";
}

async function getRevenueCatSubscriber(userId: string): Promise<RevenueCatSubscriber | null> {
  const cached = revenueCatSubscriberCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.checkedAtMs < REVENUECAT_CACHE_TTL_MS) {
    return cached.subscriber;
  }

  const secretKey = getRevenueCatSecretKey();
  if (!secretKey) {
    revenueCatSubscriberCache.set(userId, { subscriber: null, checkedAtMs: now });
    return null;
  }

  try {
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`REVENUECAT_HTTP_${response.status}`);
    }

    const payload = (await response.json()) as {
      subscriber?: RevenueCatSubscriber;
    };
    const subscriber = payload?.subscriber ?? null;
    revenueCatSubscriberCache.set(userId, { subscriber, checkedAtMs: now });
    return subscriber;
  } catch (error) {
    logScanError("[scans.parseReceipt] RevenueCat fetch failed", error);
    const fallbackSubscriber = cached?.subscriber ?? null;
    revenueCatSubscriberCache.set(userId, { subscriber: fallbackSubscriber, checkedAtMs: now });
    return fallbackSubscriber;
  }
}

function clearRevenueCatSubscriberCache(userId: string): void {
  revenueCatSubscriberCache.delete(userId);
}

async function resolveScanAllowance(userId: string, forcePro: boolean): Promise<ScanAllowance> {
  const defaultAllowance: ScanAllowance = {
    monthlyAllowance: FREE_SCANS_PER_MONTH,
    displayMonthlyAllowance: FREE_SCANS_PER_MONTH,
    hasPaidAccess: false,
    hasActiveSubscription: false,
    planKind: "free",
  };
  if (!isRevenueCatEnforcementEnabled()) {
    if (forcePro) {
      return {
        monthlyAllowance: Number.MAX_SAFE_INTEGER,
        displayMonthlyAllowance: PRO_MONTHLY_SCANS_PER_MONTH,
        hasPaidAccess: true,
        hasActiveSubscription: false,
        planKind: "pro_monthly",
      };
    }
    return defaultAllowance;
  }

  const subscriber = await getRevenueCatSubscriber(userId);
  if (!subscriber) {
    if (forcePro) {
      return {
        monthlyAllowance: Number.MAX_SAFE_INTEGER,
        displayMonthlyAllowance: PRO_MONTHLY_SCANS_PER_MONTH,
        hasPaidAccess: true,
        hasActiveSubscription: false,
        planKind: "pro_monthly",
      };
    }
    return defaultAllowance;
  }

  const entitlement = subscriber.entitlements?.[getRevenueCatEntitlementId()];
  const hasActiveSubscription = isEntitlementActive(entitlement);
  let monthlyAllowance = FREE_SCANS_PER_MONTH;
  let displayMonthlyAllowance = FREE_SCANS_PER_MONTH;
  let planKind: "free" | "pro_monthly" | "pro_yearly" = "free";

  if (hasActiveSubscription) {
    const entitlementProductId = String(entitlement?.product_identifier || "");
    planKind = detectProductKind(entitlementProductId) === "pro_yearly" ? "pro_yearly" : "pro_monthly";
    if (planKind === "pro_yearly") {
      monthlyAllowance = PRO_YEARLY_SCANS_PER_MONTH;
      displayMonthlyAllowance = PRO_YEARLY_SCANS_PER_MONTH;
    } else {
      monthlyAllowance = PRO_MONTHLY_SCANS_PER_MONTH;
      displayMonthlyAllowance = PRO_MONTHLY_SCANS_PER_MONTH;
    }
  }

  if (forcePro) {
    return {
      monthlyAllowance: Number.MAX_SAFE_INTEGER,
      displayMonthlyAllowance:
        planKind === "pro_yearly" ? PRO_YEARLY_SCANS_PER_MONTH : PRO_MONTHLY_SCANS_PER_MONTH,
      hasPaidAccess: true,
      hasActiveSubscription,
      planKind: planKind === "free" ? "pro_monthly" : planKind,
    };
  }

  const hasPaidAccess = hasActiveSubscription;
  return {
    monthlyAllowance,
    displayMonthlyAllowance,
    hasPaidAccess,
    hasActiveSubscription,
    planKind,
  };
}

async function isProDisabledUser(userId: string): Promise<boolean> {
  if (DISABLED_PRO_USER_IDS.has(userId)) {
    return true;
  }
  if (DISABLED_PRO_EMAILS.size === 0) {
    return false;
  }
  const user = await store.getUserById(userId);
  if (!user?.email) {
    return false;
  }
  return DISABLED_PRO_EMAILS.has(user.email.toLowerCase());
}

async function isForceProUser(userId: string): Promise<boolean> {
  if (FORCE_PRO_USER_IDS.has(userId)) {
    return true;
  }
  if (FORCE_PRO_EMAILS.size === 0) {
    return false;
  }
  const user = await store.getUserById(userId);
  if (!user?.email) {
    return false;
  }
  return FORCE_PRO_EMAILS.has(user.email.toLowerCase());
}

async function assertScanRateLimit(userId: string): Promise<void> {
  const key = `ocr:${userId}`;
  const result = await store.consumeRateLimit(
    key,
    OCR_RATE_LIMIT_MAX_REQUESTS,
    OCR_RATE_LIMIT_WINDOW_MS,
  );
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many scans. Please wait a bit and try again.",
    });
  }
}

function getProjectId(): string | null {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  try {
    const firebaseConfig = process.env.FIREBASE_CONFIG
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : null;
    if (firebaseConfig?.projectId) return firebaseConfig.projectId;
  } catch {
    // ignore
  }
  return null;
}

function getDocAiProcessorName(): string | null {
  const explicit = getOptionalServerEnv("DOCAI_PROCESSOR_NAME");
  if (explicit) return explicit;

  const processorId = getOptionalServerEnv("DOCAI_PROCESSOR_ID");
  if (!processorId) return null;

  const location = getOptionalServerEnv("DOCAI_LOCATION") || "us";
  const projectId = getProjectId();
  if (!projectId) return null;

  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

function getParsedReceiptCacheKey(userId: string, base64: string, mimeType: string): string {
  const processorName = getDocAiProcessorName() ?? "vision-fallback-only";
  return `${PARSE_CACHE_VERSION}:${OCR_ROUTING_MODE}:${userId}:${mimeType}:${processorName}:${sha256Hex(base64)}`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeScanRegion(scanRegion: ScanRegion | undefined): ScanRegion | null {
  if (!scanRegion) return null;
  const x = clampUnit(scanRegion.x);
  const y = clampUnit(scanRegion.y);
  const width = clampUnit(scanRegion.width);
  const height = clampUnit(scanRegion.height);
  if (width <= 0 || height <= 0) return null;
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

function getScanRegionCacheKey(scanRegion: ScanRegion | null): string {
  if (!scanRegion) return "full";
  return `${scanRegion.x.toFixed(4)}:${scanRegion.y.toFixed(4)}:${scanRegion.width.toFixed(4)}:${scanRegion.height.toFixed(4)}`;
}

async function cropImageBase64ToScanRegion(
  base64: string,
  mimeType: string,
  scanRegion: ScanRegion | null,
): Promise<{ base64: string; mimeType: string; wasCropped: boolean }> {
  if (!scanRegion) {
    return { base64, mimeType, wasCropped: false };
  }

  const normalizedMimeType = mimeType.toLowerCase();
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(normalizedMimeType)) {
    return { base64, mimeType, wasCropped: false };
  }

  try {
    const Jimp = (await import("jimp-compact")).default as {
      read: (input: Buffer) => Promise<any>;
      MIME_JPEG?: string;
      MIME_PNG?: string;
      MIME_WEBP?: string;
    };
    const image = await Jimp.read(Buffer.from(base64, "base64"));
    const bitmapWidth = Number(image?.bitmap?.width || 0);
    const bitmapHeight = Number(image?.bitmap?.height || 0);

    if (bitmapWidth <= 0 || bitmapHeight <= 0) {
      return { base64, mimeType, wasCropped: false };
    }

    const cropX = Math.max(0, Math.min(bitmapWidth - 1, Math.round(scanRegion.x * bitmapWidth)));
    const cropY = Math.max(0, Math.min(bitmapHeight - 1, Math.round(scanRegion.y * bitmapHeight)));
    const cropWidth = Math.max(
      1,
      Math.min(bitmapWidth - cropX, Math.round(scanRegion.width * bitmapWidth)),
    );
    const cropHeight = Math.max(
      1,
      Math.min(bitmapHeight - cropY, Math.round(scanRegion.height * bitmapHeight)),
    );

    image.crop(cropX, cropY, cropWidth, cropHeight);

    const outputMime =
      normalizedMimeType === "image/png"
        ? Jimp.MIME_PNG || "image/png"
        : normalizedMimeType === "image/webp"
          ? Jimp.MIME_WEBP || "image/webp"
          : Jimp.MIME_JPEG || "image/jpeg";
    const croppedBuffer: Buffer = await image.getBufferAsync(outputMime);
    return {
      base64: croppedBuffer.toString("base64"),
      mimeType: outputMime,
      wasCropped: true,
    };
  } catch (error) {
    logScanError("[scans.parseReceipt] Failed to crop framed scan region", error);
    return { base64, mimeType, wasCropped: false };
  }
}

function getParsedReceiptTextCacheKey(
  userId: string,
  text: string,
  structuredLines: StructuredOcrLine[] = [],
): string {
  const structuredKey =
    structuredLines.length > 0
      ? sha256Hex(
          JSON.stringify(
            structuredLines.map((line) => ({
              text: cleanLine(line.text),
              confidence: line.confidence == null ? null : roundCurrency(line.confidence),
              boundingBox: line.boundingBox
                ? {
                    x: roundCurrency(line.boundingBox.x),
                    y: roundCurrency(line.boundingBox.y),
                    width: roundCurrency(line.boundingBox.width),
                    height: roundCurrency(line.boundingBox.height),
                  }
                : null,
            })),
          ),
        )
      : "no_layout";
  return `${PARSE_CACHE_VERSION}:${OCR_ROUTING_MODE}:${userId}:text:${sha256Hex(text)}:${structuredKey}`;
}

function getDocAiCacheKey(processorName: string, base64: string, mimeType: string): string {
  return `${processorName}:${mimeType}:${sha256Hex(base64)}`;
}

function parseCurrencyToken(
  token: string,
): { amount: number; hadDecimal: boolean } | null {
  const hadDecimal = token.includes(".");
  const cleaned = token.replace(/[$,\s]/g, "").trim();
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { amount: value, hadDecimal };
}

function normalizeAmount(
  rawAmount: number,
  hadDecimal: boolean,
  _label: string,
): number {
  if (hadDecimal) return roundCurrency(rawAmount);

  // Only divide by 100 for very large integers (e.g. a printer that outputs cents
  // as a 4-5 digit integer like "4599" meaning $45.99).  Round dollar amounts in
  // the $100–$999 range (e.g. "Subtotal 150" = $150.00) must NOT be divided.
  if (rawAmount >= 1000) {
    return roundCurrency(rawAmount / 100);
  }

  return roundCurrency(rawAmount);
}

function getLineAmount(
  line: string,
): { label: string; amount: number; hadDecimal: boolean } | null {
  const cleaned = cleanLine(line);
  if (!cleaned) return null;

  // Filter out matches immediately followed by '%' — those are percentages, not currency.
  const amountMatches = [...cleaned.matchAll(/\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?/g)]
    .filter((m) => cleaned[m.index + m[0].length] !== "%");
  if (!amountMatches.length) return null;

  const lastMatch = amountMatches[amountMatches.length - 1];
  if (!lastMatch || lastMatch.index === undefined) return null;

  const parsed = parseCurrencyToken(lastMatch[0]);
  if (!parsed) return null;

  const label = cleanLine(cleaned.slice(0, lastMatch.index).replace(/[:\-]$/, ""));
  if (!label) return null;
  const rawMatchedToken = lastMatch[0].replace(/^\$/, "");
  if (/^\d{5}$/.test(rawMatchedToken) && looksLikeAddressOrLocationLabel(label)) {
    return null;
  }

  // Detect a minus sign immediately before the matched token — e.g. "COMP -$4.50" or "VOID -5.00".
  // The regex can't capture '-', so check the character just before the match start.
  const isNegative = lastMatch.index > 0 && cleaned[lastMatch.index - 1] === "-";
  const amount = normalizeAmount(isNegative ? -parsed.amount : parsed.amount, parsed.hadDecimal, label);
  return {
    label,
    amount,
    hadDecimal: parsed.hadDecimal,
  };
}

function getStandaloneAmountLine(
  line: string,
): { amount: number; hadDecimal: boolean } | null {
  const cleaned = cleanLine(line);
  if (!cleaned || cleaned.includes("%")) return null;
  if (!/^\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?$/.test(cleaned)) return null;
  return parseCurrencyToken(cleaned);
}

function hasKeyword(value: string, keywords: string[]): boolean {
  const lower = value.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function looksLikeAutoGratuityLabel(label: string): boolean {
  const lower = label.toLowerCase();
  // "Addl Gratuity", "Additional Gratuity" are customer-written additions, not automatic
  if (/\b(?:addl|additional)\s+gratuity\b/.test(lower)) return false;
  return (
    /\bgratuity\b|\bservice charge\b|\bservice fee\b|\bsurcharge\b/.test(lower) ||
    /\bauto(?:matic)?\b/.test(lower) ||
    /\blarge party\b/.test(lower) ||
    /\bpart(?:y|ies)\b/.test(lower)
  );
}

function isDiscountLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return /\bdiscount\b|\bcoupon\b|\bpromo\b|\bhappy hour\b|\bcomp\b|\bvoid\b|\brefund\b|\bloyalty\b|\brewards?\b/.test(lower);
}

function classifyFeeLabel(label: string): { isFee: boolean; feeType: string } {
  const lower = label.toLowerCase();
  if (/\bdelivery\s*fee\b|\bdelivery\s*charge\b/.test(lower)) return { isFee: true, feeType: "delivery_fee" };
  if (/\bservice\s*fee\b/.test(lower)) return { isFee: true, feeType: "service_fee" };
  if (
    /\bprocessing\s*fee\b|\bcredit\s*card\s*surcharge\b|\bcard\s*surcharge\b|\bpayment\s*surcharge\b|\bcc\s*surcharge\b/.test(
      lower,
    )
  )
    return { isFee: true, feeType: "processing_fee" };
  if (/\bconvenience\s*fee\b/.test(lower)) return { isFee: true, feeType: "convenience_fee" };
  if (/\border\s*fee\b|\bplatform\s*fee\b/.test(lower)) return { isFee: true, feeType: "platform_fee" };
  if (/\bsmall\s*order\s*fee\b|\bminimum\s*order\s*fee\b/.test(lower)) return { isFee: true, feeType: "small_order_fee" };
  if (/\bbag\s*fee\b|\bbag\s*charge\b|\bplastic\s*bag\b/.test(lower)) return { isFee: true, feeType: "bag_fee" };
  if (/\bbottle\s*deposit\b|\bcrf\s*fee\b|\bcontainer\s*deposit\b/.test(lower))
    return { isFee: true, feeType: "bottle_deposit" };
  if (/\benvironmental\s*(?:fee|charge|levy|surcharge)\b|\benv\.\s*fee\b/.test(lower))
    return { isFee: true, feeType: "environmental_fee" };
  if (/\bfuel\s*surcharge\b/.test(lower)) return { isFee: true, feeType: "fuel_surcharge" };
  if (/\bregulatory\s*(?:fee|charge|recovery)\b/.test(lower)) return { isFee: true, feeType: "regulatory_fee" };
  if (/\bpackaging\s*(?:fee|charge)\b/.test(lower)) return { isFee: true, feeType: "packaging_fee" };
  if (/\bsplit\s*check\s*fee\b|\bcheck\s*split\s*fee\b/.test(lower)) return { isFee: true, feeType: "split_check_fee" };
  if (/\bkiosk\s*fee\b/.test(lower)) return { isFee: true, feeType: "kiosk_fee" };
  if (/\bcover\s*charge\b|\btable\s*fee\b/.test(lower)) return { isFee: true, feeType: "cover_charge" };
  if (/\bvenue\s*fee\b|\bevent\s*fee\b/.test(lower)) return { isFee: true, feeType: "venue_fee" };
  if (/\bmerchant\s*adjustment\b/.test(lower)) return { isFee: true, feeType: "merchant_adjustment" };
  if (/\brounding\s*(?:adjustment|fee)\b/.test(lower)) return { isFee: true, feeType: "rounding_adjustment" };
  return { isFee: false, feeType: "" };
}

function isFeeLabel(label: string): boolean {
  return classifyFeeLabel(label.toLowerCase()).isFee;
}

function classifyDiscountLabel(label: string): { isDiscount: boolean; discountType: string } {
  const lower = label.toLowerCase();
  if (/\bvoid\b/.test(lower)) return { isDiscount: true, discountType: "voided_item" };
  if (/\bcoupon\b/.test(lower)) return { isDiscount: true, discountType: "coupon" };
  if (/\bloyalty\b|\bpoints\b|\brewards?\b/.test(lower)) return { isDiscount: true, discountType: "loyalty_discount" };
  if (/\bpromo(?:tion)?\b|\bspecial\b|\bsale\b/.test(lower)) return { isDiscount: true, discountType: "promotional_discount" };
  if (/\bhappy\s*hour\b/.test(lower)) return { isDiscount: true, discountType: "happy_hour_discount" };
  if (/\bcombo\b/.test(lower)) return { isDiscount: true, discountType: "combo_discount" };
  if (/\bmanufacturer\b/.test(lower)) return { isDiscount: true, discountType: "manufacturer_coupon" };
  if (/\bemployee\b/.test(lower)) return { isDiscount: true, discountType: "employee_discount" };
  if (/\bsenior\b/.test(lower)) return { isDiscount: true, discountType: "senior_discount" };
  if (/\bmember\b/.test(lower)) return { isDiscount: true, discountType: "member_discount" };
  if (/\bdeposit\s*return\b|\brefund\b/.test(lower)) return { isDiscount: true, discountType: "returned_deposit" };
  if (/\bdiscount\b|\bcomp\b/.test(lower)) return { isDiscount: true, discountType: "promotional_discount" };
  return { isDiscount: false, discountType: "" };
}

function classifyTaxLabel(label: string): string {
  const lower = label.toLowerCase();
  if (/\bvat\b|\bvalue\s*added\b/.test(lower)) return "vat";
  if (/\bgst\b|\bgoods\s*and\s*services\b/.test(lower)) return "gst";
  if (/\bhst\b|\bharmonized\b/.test(lower)) return "sales_tax";
  if (/\bpst\b|\bprovincial\b/.test(lower)) return "state_tax";
  if (/\bqst\b/.test(lower)) return "local_tax";
  if (/\balcohol\s*tax\b|\bliquor\s*tax\b/.test(lower)) return "alcohol_tax";
  if (/\bfood\s*tax\b/.test(lower)) return "food_tax";
  if (/\bprepared\s*food\b/.test(lower)) return "prepared_food_tax";
  if (/\blocal\s*tax\b/.test(lower)) return "local_tax";
  if (/\bstate\s*tax\b/.test(lower)) return "state_tax";
  if (/\bcounty\s*tax\b/.test(lower)) return "county_tax";
  return "sales_tax";
}

function isPaymentLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    /^(?:visa|mc|mastercard|amex|discover|debit|credit card|cash|change|payment|charged|paid|tendered?)\b/.test(lower) ||
    /\b(?:cash\s+paid|change\s+due|amount\s+tendered)\b/.test(lower) ||
    /\bx{3,4}\d{4}\b/.test(lower)
  );
}

function classifyPaymentMethod(label: string): string {
  const lower = label.toLowerCase();
  if (/\bcash\b/.test(lower)) return "cash";
  if (/\bgift\s*card\b/.test(lower)) return "gift_card";
  if (/\bstore\s*credit\b/.test(lower)) return "store_credit";
  if (/\bdebit\b/.test(lower)) return "debit";
  if (/\bcredit\b|\bvisa\b|\bmastercard\b|\bamex\b|\bdiscover\b/.test(lower)) return "credit";
  if (/\bsplit\b/.test(lower)) return "split";
  return "unknown";
}

function detectOpenTab(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (/\bopen\s+tab\b|\bbar\s+tab\b/.test(lower) && !/\btab\s+(?:closed|settled|paid)\b/.test(lower)) ||
    /\bauthorization\s+slip\b|\bauth(?:orization)?\s+only\b/.test(lower)
  );
}

function detectMerchantCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return /\bmerchant\s+copy\b|\bmerchant\s+receipt\b|\brestaurant\s+copy\b|\bestablishment\s+copy\b/.test(lower);
}

function detectSplitCheck(
  text: string,
): { isSplitCheck: boolean; checkNumber?: string; totalChecks?: number } {
  const lower = text.toLowerCase();
  const isSplit = /\bcheck\s+\d+\s+of\s+\d+\b|\bsplit\s+check\b/.test(lower);
  if (!isSplit) return { isSplitCheck: false };
  const checkMatch = text.match(/check\s+#?\s*(\d+)\s+of\s+(\d+)/i);
  if (checkMatch) {
    return {
      isSplitCheck: true,
      checkNumber: checkMatch[1],
      totalChecks: parseInt(checkMatch[2], 10),
    };
  }
  return { isSplitCheck: true };
}

function detectTaxIncluded(text: string): boolean {
  const lower = text.toLowerCase();
  return /\btax\s+(?:included|incl\.?|inclusive)\b|\bprices\s+include\s+(?:tax|vat|gst)\b|\bvat\s+included\b|\ball\s+prices\s+(?:include|inclusive)\b/.test(
    lower,
  );
}

function detectDocumentValidity(text: string): string {
  const lower = text.toLowerCase();
  const hasReceipt = /\breceipt\b|\bthank\s+you\s+for\s+your\s+(?:visit|business|order)\b/.test(lower);
  const hasFinancialTerms = /\bsubtotal\b|\btax\b|\btotal\b|\bgrand\s+total\b|\bamount\s+due\b/.test(lower);
  const hasPayment = /\bvisa\b|\bmastercard\b|\bamex\b|\bdebit\b|\bcash\b/.test(lower);
  const hasItemsOrQty = /\$\d|\bqty\b|\bquantity\b|\bunit\s+price\b/.test(lower);
  const isPackingSlip = /\bpacking\s+slip\b|\bship(?:ped|ping)\s+to\b|\btracking\s+number\b/.test(lower);
  const isInvoice =
    /\binvoice\s+(?:number|#|no\.?)\b|\bdue\s+date\b|\bnet\s+\d+\b/.test(lower) && !hasReceipt;
  const isMenu = /\bmenu\b/.test(lower) && !/\breceipt\b|\btotal\b/.test(lower);
  const isMiscDoc =
    /\bcontract\b|\bagreement\b|\bterms\s+and\s+conditions\b|\bprivacy\s+policy\b/.test(lower);

  if (isMiscDoc || isPackingSlip) return "invalid";
  if (isInvoice) return "uncertain";
  if (isMenu) return "uncertain";
  if (hasReceipt && hasFinancialTerms) return "valid";
  if (hasFinancialTerms && (hasPayment || hasItemsOrQty)) return "likely_valid";
  if (hasFinancialTerms) return "uncertain";
  return "uncertain";
}

function detectReceiptType(
  text: string,
  autoGratuityDetected: boolean,
  hasDeliveryFee: boolean,
  hasBagFee: boolean,
): string {
  const lower = text.toLowerCase();
  if (
    hasDeliveryFee ||
    /\bdoordash\b|\bubereats\b|\bgrubhub\b|\bpostmates\b|\binstacart\b/.test(lower)
  )
    return "delivery_platform";
  if (/\bbar\s+tab\b|\bopen\s+tab\b/.test(lower)) return "bar_tab";
  if (autoGratuityDetected) return "restaurant_auto_gratuity";
  if (/\bsplit\s+check\b|\bcheck\s+\d+\s+of\b/.test(lower)) return "restaurant_split_check";
  if (/\bmerchant\s+copy\b|\brestaurant\s+copy\b/.test(lower)) return "restaurant_merchant_copy";
  if (/\bcustomer\s+copy\b/.test(lower)) return "restaurant_customer_copy";
  if (/\bsigned\s+slip\b|\bsignature\s+slip\b|\bsign\s+here\b/.test(lower)) return "restaurant_signed_slip";
  if (/\bcafe\b|\bcoffee\b|\blatte\b|\bespresso\b/.test(lower)) return "cafe";
  if (/\bfast\s+food\b|\bdrive[\s-]?thru\b|\bcombo\s+meal\b/.test(lower)) return "fast_food";
  if (/\bself[\s-]?checkout\b|\bkiosk\b/.test(lower)) return "self_checkout";
  if (hasBagFee || /\bgrocery\b|\bproduce\b|\baisle\b/.test(lower)) return "grocery";
  if (/\bpharmacy\b|\brx\b|\bprescription\b/.test(lower)) return "pharmacy";
  if (/\bgas\s+station\b|\bgallons\b|\bpump\s+\d\b/.test(lower)) return "gas_station";
  if (/\bsalon\b|\bbarber\b|\bhaircut\b/.test(lower)) return "salon_barber";
  if (/\btakeout\b|\bto[\s-]?go\b|\bpickup\b/.test(lower)) return "takeout";
  if (/\bsubtotal\b/.test(lower)) return "restaurant_itemized";
  return "unknown";
}

function detectFraudSignals(text: string): string[] {
  const flags: string[] = [];
  const totalMatches = [...text.matchAll(/\btotal\b[^$\d]*\$?(\d{1,5}(?:\.\d{2})?)/gi)];
  if (totalMatches.length >= 3) {
    const amounts = totalMatches.map((m) => parseFloat(m[1])).filter((n) => n > 0);
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    if (max > 0 && min > 0 && max / min > 3) flags.push("conflicting_total_amounts");
  }
  const dateMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (dateMatch) {
    const year = parseInt(dateMatch[3], 10);
    const fullYear = year < 100 ? 2000 + year : year;
    if (fullYear < 2000 || fullYear > new Date().getFullYear() + 1) flags.push("implausible_date");
  }
  const highAmounts = [...text.matchAll(/\$?(\d{1,6}(?:\.\d{2})?)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => n > 10000);
  if (highAmounts.length > 0) flags.push("unusually_high_amounts");
  return flags;
}

function buildNormalizedData(params: {
  text: string;
  taxCandidates: TaxCandidateItem[];
  feeCandidates: FeeCandidateItem[];
  discountCandidates: DiscountCandidateItem[];
  paymentCandidates: { label: string; amount: number; method: string }[];
  totalCandidates: { amount: number; index: number; label: string }[];
  rawAmountCandidates: RawAmountCandidateRecord[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  autoGratuity: AutoGratuityInfo;
}): NormalizedReceiptData {
  const {
    text,
    taxCandidates,
    feeCandidates,
    discountCandidates,
    paymentCandidates,
    totalCandidates,
    rawAmountCandidates,
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
  } = params;

  const actualTaxTotal = roundCurrency(taxCandidates.reduce((sum, t) => sum + t.amount, 0));
  const feeTotalForMath = roundCurrency(
    feeCandidates.filter((f) => f.amount > 0).reduce((sum, f) => sum + f.amount, 0),
  );
  const mandatoryChargesFromAutoGrat = roundCurrency(autoGratuity.autoGratuityAmount ?? 0);
  const mandatoryChargeItems: FeeCandidateItem[] =
    mandatoryChargesFromAutoGrat > 0
      ? [
          {
            type: "auto_gratuity",
            label: autoGratuity.policyText || "Auto Gratuity",
            amount: mandatoryChargesFromAutoGrat,
          },
        ]
      : [];
  const optionalTipAmount = roundCurrency(Math.max(0, tip - mandatoryChargesFromAutoGrat));

  const totalsDetected = totalCandidates.map((tc) => ({
    raw_label: tc.label,
    raw_value_text: tc.amount.toFixed(2),
    parsed_amount: tc.amount,
    confidence: 0.9,
    selected: Math.abs(tc.amount - total) < 0.01,
    rejection_reason:
      Math.abs(tc.amount - total) >= 0.01 ? "not_selected_as_final_total" : undefined,
  }));

  const calculationToleranceUsed = 0.03;
  const detectedTaxIncludedEarly = detectTaxIncluded(text);
  // For tax-inclusive receipts the reported tax is informational and already baked into
  // the subtotal/total, so the check should be subtotal ≈ total (ignoring tax).
  const expectedFinalTotal = detectedTaxIncludedEarly
    ? roundCurrency(subtotal + tip)
    : roundCurrency(subtotal + tax + tip);
  const calculationDelta = roundCurrency(Math.abs(total - expectedFinalTotal));
  const calculationCheckPassed =
    total <= 0 || calculationDelta <= Math.max(0.2, roundCurrency(total * calculationToleranceUsed));

  const detectedIsOpenTab = detectOpenTab(text);
  const detectedIsMerchantCopy = detectMerchantCopy(text);
  const splitCheckInfo = detectSplitCheck(text);
  const detectedTaxIncluded = detectedTaxIncludedEarly;
  const detectedDocumentValidity = detectDocumentValidity(text);
  const detectedReceiptType = detectReceiptType(
    text,
    autoGratuity.detected,
    feeCandidates.some((f) => f.type === "delivery_fee"),
    feeCandidates.some((f) => f.type === "bag_fee"),
  );
  const detectedFraudFlags = detectFraudSignals(text);

  const reviewReasons: string[] = [];
  if (!calculationCheckPassed && total > 0) reviewReasons.push("calculation_mismatch");
  if (autoGratuity.detected) reviewReasons.push("auto_gratuity_detected");
  if (detectedDocumentValidity === "uncertain") reviewReasons.push("document_validity_uncertain");
  if (detectedDocumentValidity === "invalid") reviewReasons.push("document_validity_invalid");
  if (detectedFraudFlags.length > 0) reviewReasons.push("fraud_signals_detected");
  if (detectedIsOpenTab) reviewReasons.push("open_tab_receipt");
  if (detectedIsMerchantCopy) reviewReasons.push("merchant_copy_receipt");

  return {
    fees: feeCandidates.filter((f) => f.amount > 0),
    discounts: discountCandidates.filter((d) => d.amount > 0),
    mandatoryCharges: mandatoryChargeItems,
    taxesDetail: taxCandidates.filter((t) => t.amount > 0),
    payments: paymentCandidates,
    rawAmountCandidates,
    totalsDetected,
    calculationCheckPassed,
    calculationDelta,
    calculationToleranceUsed,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    receiptType: detectedReceiptType,
    documentValidity: detectedDocumentValidity,
    fraudFlags: detectedFraudFlags,
    isOpenTab: detectedIsOpenTab,
    isMerchantCopy: detectedIsMerchantCopy,
    isSplitCheck: splitCheckInfo.isSplitCheck,
    checkNumber: splitCheckInfo.checkNumber,
    totalChecks: splitCheckInfo.totalChecks,
    taxIncluded: detectedTaxIncluded,
    feeTotalForMath,
    mandatoryChargeTotalForMath: mandatoryChargesFromAutoGrat,
    optionalTipAmount,
    actualTaxTotal,
    parserVersion: RECEIPT_PARSER_VERSION,
  };
}

function normalizeTipLabelForKey(label: string): string {
  return cleanLine(label)
    .toLowerCase()
    .replace(/[^a-z0-9% ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelySuggestedTipLabel(label: string): boolean {
  const lower = label.toLowerCase();
  if (!lower) return false;

  if (
    /\bsuggest(?:ed|ion)?\b|\brecommended\b|\btip\s*(guide|options?|amounts?)\b/.test(lower)
  ) {
    return true;
  }

  // Labels that start with "tip" or "gratuity" are real charges, not suggestions.
  // e.g. "Tip (15%)", "Tip (20% pre-disc)", "Gratuity (21.00%)" are actual tip lines.
  if (/^(?:tip|gratuity|grat)\b/.test(lower)) return false;

  // Note: no trailing \b — %: and %) have no word boundary after % but are still percentages.
  const hasPercent = /\b\d{1,2}(?:\.\d+)?\s*%/.test(lower);
  const hasAutoOrActualTipContext =
    /\bgratuity\b|\bservice charge\b|\bsurcharge\b|\bauto(?:matic)?\b|\badded\b|\bpaid\b|\bactual\b/.test(
      lower,
    );

  return hasPercent && !hasAutoOrActualTipContext;
}

function isLikelyPolicyThresholdTipLabel(label: string, amount: number): boolean {
  const lower = label.toLowerCase();
  const mentionsPartyThreshold =
    /\bpart(?:y|ies)\b/.test(lower) &&
    (/\bor more\b|\+\b/.test(lower) ||
      /\bpart(?:y|ies)\s+of\b/.test(lower) ||
      /\bfor\s+part(?:y|ies)\s+of\b/.test(lower));
  if (!mentionsPartyThreshold) return false;
  return Number.isFinite(amount) && amount > 0 && amount <= 20 && Math.abs(amount - Math.round(amount)) <= 0.001;
}

function dedupeTipCandidates(candidates: TipCandidate[]): TipCandidate[] {
  const seen = new Set<string>();
  const out: TipCandidate[] = [];

  for (const candidate of candidates) {
    const amount = roundCurrency(candidate.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const label = cleanLine(candidate.label || "");
    const key = `${amount.toFixed(2)}|${normalizeTipLabelForKey(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ amount, label });
  }

  return out;
}

function getMeaningfulTipCandidates(candidates: TipCandidate[]): TipCandidate[] {
  return dedupeTipCandidates(candidates).filter(
    (candidate) =>
      candidate.amount > 0 &&
      candidate.amount <= 10_000 &&
      !isLikelySuggestedTipLabel(candidate.label) &&
      !isLikelyPolicyThresholdTipLabel(candidate.label, candidate.amount),
  );
}

function deriveTipFromCandidates(candidates: TipCandidate[]): number {
  const cleaned = getMeaningfulTipCandidates(candidates);

  if (!cleaned.length) return 0;

  const autoLike = cleaned.filter((candidate) => looksLikeAutoGratuityLabel(candidate.label));
  const nonAuto = cleaned.filter((candidate) => !looksLikeAutoGratuityLabel(candidate.label));

  if (autoLike.length > 0 && nonAuto.length > 0) {
    const autoAmount = Math.max(...autoLike.map((candidate) => candidate.amount));
    const nonAutoAmount = Math.max(...nonAuto.map((candidate) => candidate.amount));
    return roundCurrency(autoAmount + nonAutoAmount);
  }

  return roundCurrency(cleaned[cleaned.length - 1].amount);
}

function applyTipBreakdownFromCandidates(params: {
  candidates: TipCandidate[];
  subtotal: number;
  tip: number;
  autoGratuity: AutoGratuityInfo;
}): AutoGratuityInfo {
  const { subtotal, autoGratuity } = params;
  const tip = roundCurrency(params.tip);
  if (!autoGratuity.detected || tip <= 0) {
    return {
      ...autoGratuity,
      autoGratuityAmount: null,
      additionalTipAmount: null,
    };
  }

  const cleaned = getMeaningfulTipCandidates(params.candidates);
  if (!cleaned.length) {
    return autoGratuity;
  }

  const autoLike = cleaned.filter((candidate) => looksLikeAutoGratuityLabel(candidate.label));
  const nonAuto = cleaned.filter((candidate) => !looksLikeAutoGratuityLabel(candidate.label));
  const policyPercent = extractPercentFromText(autoGratuity.policyText);
  const expectedAuto =
    policyPercent !== null && subtotal > 0
      ? roundCurrency(subtotal * (policyPercent / 100))
      : null;
  const tolerance = Math.max(0.2, roundCurrency(Math.max(0, subtotal) * 0.03));

  if (autoLike.length > 0 && nonAuto.length > 0) {
    const autoFromLine = roundCurrency(Math.max(...autoLike.map((candidate) => candidate.amount)));
    const additionalFromLine = roundCurrency(Math.max(...nonAuto.map((candidate) => candidate.amount)));
    const combinedFromLines = roundCurrency(autoFromLine + additionalFromLine);

    if (Math.abs(combinedFromLines - tip) <= tolerance) {
      return {
        ...autoGratuity,
        autoGratuityAmount: autoFromLine,
        additionalTipAmount: additionalFromLine,
      };
    }

    if (autoFromLine < tip - 0.1) {
      return {
        ...autoGratuity,
        autoGratuityAmount: autoFromLine,
        additionalTipAmount: roundCurrency(Math.max(0, tip - autoFromLine)),
      };
    }
  }

  if (autoLike.length > 0) {
    return {
      ...autoGratuity,
      autoGratuityAmount: tip,
      additionalTipAmount: null,
    };
  }

  if (expectedAuto !== null && tip > expectedAuto + tolerance) {
    return {
      ...autoGratuity,
      autoGratuityAmount: expectedAuto,
      additionalTipAmount: roundCurrency(Math.max(0, tip - expectedAuto)),
    };
  }

  return autoGratuity;
}

function extractPartySizeThreshold(text: string): number | null {
  const normalized = cleanLine(text);
  if (!normalized) return null;

  const patterns = [
    /part(?:y|ies)\s*(?:of)?\s*(\d{1,2})\s*(?:\+|or\s+more)?/i,
    /(\d{1,2})\s*(?:\+|or\s+more)\s*part(?:y|ies)/i,
    /for\s*part(?:y|ies)\s*(?:of)?\s*(\d{1,2})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value <= 99) {
      return Math.round(value);
    }
  }

  return null;
}

function isSeparatorLine(line: string): boolean {
  const normalized = cleanLine(line).replace(/\s+/g, "");
  return /^[-=*_~]{5,}$/.test(normalized);
}

function looksLikeMetadataLabel(label: string): boolean {
  const normalized = cleanLine(label);
  if (!normalized) return false;

  const lower = normalized.toLowerCase();
  if (looksLikeAddressOrLocationLabel(normalized)) return true;
  if (isSeparatorLine(normalized)) return true;
  if (/^=+\s*seat\b.*=+$/i.test(normalized)) return true;

  if (
    /\b(?:server|serv|table|tbl|guest|guests|party|order(?:ed|ing)?|check|chk|disc|invoice|receipt|transaction|approval|auth|bar tab)\b/.test(
      lower,
    )
  ) {
    return true;
  }

  if (/^(?:chk|check)\s*[:#-]?\s*\d*$/i.test(normalized)) {
    return true;
  }

  // Tax registration / VAT numbers (e.g. "MwSt Nr.: 430 234", "VAT No.", "Tax ID")
  if (
    /\b(?:mwst|ust|vat|tax|gst|tva|iva)\s*(?:nr\.?|no\.?|id|reg\.?|registration|number|#)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  // German/European receipt metadata
  if (
    /\b(?:tisch|rech(?:\.|nr|\.nr)?|bon\s*(?:nr|no|#)?|pers(?:onen)?|kellner|bedienung|entspricht)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(?:tel|phone|www|http|visa|mastercard|amex|debit|credit|card|charged to room|room \/ sig|signature|new total|additional tip)\b/.test(
      lower,
    )
  ) {
    return true;
  }

  if (
    /\b(?:seat\s+\d+|seat\s+\d+\s+subtotal|shared subtotal|room:\s*\d+|guest:\s*[a-z]|server:\s*[a-z]|table:\s*\w+|seat:\s*[a-z0-9-]+|bar tab seat:\s*[a-z0-9-]+)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(lower) || /\b\d{1,2}:\d{2}\b/.test(lower)) {
    return true;
  }

  if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(normalized)) {
    return true;
  }

  if (/^(?:mc|visa|amex|disc)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function extractAutoGratuityInfo(
  receiptText: string,
  tipAmount: number,
  tipLabels: string[] = [],
): AutoGratuityInfo {
  const lines = receiptText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const policyLine =
    lines.find((line) => {
      const lower = line.toLowerCase();
      const hasFeeWord = /\bgratuity\b|\bservice charge\b|\bservice fee\b|\bsurcharge\b/.test(lower);
      const hasAutoContext =
        /\bauto(?:matic)?\b|\bincluded\b|\badded\b|\bapply\b|\bapplied\b|\blarge party\b|\bpart(?:y|ies)\b|\bor more\b|\+\b/.test(
          lower,
        );
      return hasFeeWord && hasAutoContext;
    }) ?? null;

  const hasAutoTipLabel = tipLabels.some(looksLikeAutoGratuityLabel);
  const partySizeMin = extractPartySizeThreshold(lines.join(" "));
  const detected = hasAutoTipLabel || Boolean(policyLine) || partySizeMin !== null;

  return {
    detected,
    partySizeMin: detected ? partySizeMin : null,
    policyText: detected ? policyLine : null,
    includedInTotal: detected && tipAmount > 0,
    autoGratuityAmount: null,
    additionalTipAmount: null,
  };
}

function extractPercentFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 60) return null;
  return value;
}

function inferTipFromTotals(subtotal: number, tax: number, total: number): number {
  const base = roundCurrency(Math.max(0, subtotal + tax));
  if (base <= 0 || total <= 0) return 0;
  const delta = roundCurrency(total - base);
  // Guardrail: auto gratuity/service charges usually won't exceed 60% of the base.
  if (delta <= 0 || delta > roundCurrency(base * 0.6)) return 0;
  return delta;
}

function applyAutoGratuityInference(params: {
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  autoGratuity: AutoGratuityInfo;
}): { tip: number; total: number; autoGratuity: AutoGratuityInfo } {
  const { subtotal, tax, autoGratuity } = params;
  let tip = roundCurrency(params.tip);
  let total = roundCurrency(params.total);
  let inferredFromTotals = false;
  let nextAutoGratuity: AutoGratuityInfo = { ...autoGratuity };

  if (tip <= 0) {
    const inferredFromReceiptTotals = inferTipFromTotals(subtotal, tax, total);
    if (inferredFromReceiptTotals > 0) {
      tip = inferredFromReceiptTotals;
      inferredFromTotals = true;
    } else if (nextAutoGratuity.detected) {
      const policyPercent = extractPercentFromText(nextAutoGratuity.policyText);
      if (policyPercent !== null) {
        const base = roundCurrency(Math.max(0, subtotal + tax)) || roundCurrency(Math.max(0, subtotal));
        if (base > 0) {
          tip = roundCurrency(base * (policyPercent / 100));
        }
      }
    }
  }

  if (total <= 0 && (subtotal > 0 || tax > 0 || tip > 0)) {
    total = roundCurrency(subtotal + tax + tip);
  }

  const baseTotal = roundCurrency(subtotal + tax);
  const policyPercent = extractPercentFromText(nextAutoGratuity.policyText);
  const expectedAutoByPolicy =
    policyPercent !== null && subtotal > 0
      ? roundCurrency(subtotal * (policyPercent / 100))
      : null;
  const totalsTipDelta = roundCurrency(total - baseTotal);

  // If a policy percent exists, reconcile parsed tip against charged totals.
  // This catches receipts where OCR picks only the added tip line (or only the auto line).
  if (
    nextAutoGratuity.detected &&
    expectedAutoByPolicy !== null &&
    totalsTipDelta > 0 &&
    baseTotal > 0
  ) {
    const tolerance = Math.max(0.2, roundCurrency(subtotal * 0.02));
    const expectedCombinedByLines = roundCurrency(expectedAutoByPolicy + tip);
    const totalsMatchCombined =
      Math.abs(totalsTipDelta - expectedCombinedByLines) <= tolerance;
    const totalsMatchAutoOnly =
      Math.abs(totalsTipDelta - expectedAutoByPolicy) <= tolerance;

    if (
      totalsMatchCombined &&
      totalsTipDelta > tip + 0.1
    ) {
      tip = totalsTipDelta;
      inferredFromTotals = true;
    } else if (
      totalsMatchAutoOnly &&
      tip < expectedAutoByPolicy - tolerance
    ) {
      tip = totalsTipDelta;
      inferredFromTotals = true;
    }
  }

  const reconstructedTotal = roundCurrency(baseTotal + tip);
  const mismatch = roundCurrency(total - reconstructedTotal);

  // Some receipts include both auto gratuity and an additional tip line.
  // If OCR captured only one of them, total will exceed subtotal+tax+tip by ~18-20% of subtotal.
  if (mismatch > 0.1 && nextAutoGratuity.detected && subtotal > 0) {
    const expectedAutoByPolicy =
      policyPercent !== null ? roundCurrency(subtotal * (policyPercent / 100)) : null;
    const policyTolerance = Math.max(0.2, roundCurrency(subtotal * 0.03));
    const matchesPolicy =
      expectedAutoByPolicy !== null &&
      Math.abs(mismatch - expectedAutoByPolicy) <= policyTolerance;
    const mismatchPercent = roundCurrency((mismatch / subtotal) * 100);
    const matchesCommonAutoRange = mismatchPercent >= 15 && mismatchPercent <= 25;

    if (matchesPolicy || matchesCommonAutoRange) {
      tip = roundCurrency(tip + mismatch);
      inferredFromTotals = true;
      if (!nextAutoGratuity.policyText) {
        nextAutoGratuity = {
          ...nextAutoGratuity,
          policyText: `Inferred additional ${mismatchPercent}% gratuity from total mismatch`,
        };
      }
    }
  }

  // Some receipts list "suggested tip" values not included in the charged total.
  // If total aligns with subtotal+tax (without tip), drop tip from parsed totals.
  if (mismatch < -0.1 && tip > 0) {
    if (Math.abs(total - baseTotal) <= 0.1) {
      tip = 0;
    }
  }

  if (nextAutoGratuity.detected && tip > 0) {
    const policyPercent = extractPercentFromText(nextAutoGratuity.policyText);
    const expectedAuto =
      policyPercent !== null && subtotal > 0
        ? roundCurrency(subtotal * (policyPercent / 100))
        : null;

    if (expectedAuto !== null) {
      const tolerance = Math.max(0.2, roundCurrency(subtotal * 0.03));
      const autoPortion = tip >= expectedAuto - tolerance
        ? roundCurrency(Math.min(tip, expectedAuto))
        : roundCurrency(tip);
      const additionalPortion = roundCurrency(Math.max(0, tip - autoPortion));
      nextAutoGratuity = {
        ...nextAutoGratuity,
        autoGratuityAmount: autoPortion > 0 ? autoPortion : null,
        additionalTipAmount: additionalPortion > 0 ? additionalPortion : null,
      };
    } else {
      nextAutoGratuity = {
        ...nextAutoGratuity,
        autoGratuityAmount: tip > 0 ? tip : null,
        additionalTipAmount: null,
      };
    }
  } else {
    nextAutoGratuity = {
      ...nextAutoGratuity,
      autoGratuityAmount: null,
      additionalTipAmount: null,
    };
  }

  const inferredTipPercent =
    subtotal > 0 && tip > 0
      ? roundCurrency((tip / subtotal) * 100)
      : 0;
  const inferredLooksLikeAuto =
    inferredFromTotals &&
    inferredTipPercent >= 15 &&
    inferredTipPercent <= 25;

  return {
    tip,
    total,
    autoGratuity: {
      ...nextAutoGratuity,
      detected: nextAutoGratuity.detected || inferredLooksLikeAuto,
      policyText:
        nextAutoGratuity.policyText ||
        (inferredLooksLikeAuto
          ? `Inferred ${inferredTipPercent}% gratuity from receipt totals`
          : null),
      includedInTotal:
        (nextAutoGratuity.detected || inferredLooksLikeAuto) &&
        tip > 0 &&
        (inferredFromTotals || total > 0),
    },
  };
}

function parseQuantityAndName(rawLabel: string): { quantity: number; name: string } | null {
  let label = cleanLine(rawLabel);
  if (!label) return null;
  const lower = label.toLowerCase();

  let quantity = 1;
  const qtyPrefix = label.match(/^(\d{1,2})\s*[xX]?\s+(.+)$/);
  if (qtyPrefix) {
    quantity = Math.max(1, Number(qtyPrefix[1]) || 1);
    label = cleanLine(qtyPrefix[2]);
  }

  if (label.length < 2) return null;
  if (!/[A-Za-z]/.test(label)) return null;
  if (hasKeyword(label, nonItemKeywords)) return null;
  if (isDiscountLabel(lower)) return null;
  if (isFeeLabel(lower)) return null;
  if (looksLikeAddressOrLocationLabel(label)) return null;
  if (looksLikeMetadataLabel(label)) return null;

  // Filter noisy OCR lines that are mostly numbers/symbols.
  const letters = (label.match(/[A-Za-z]/g) || []).length;
  const digits = (label.match(/\d/g) || []).length;
  if (digits > letters) return null;
  if (label.includes("#")) return null;

  return { quantity, name: label };
}

function looksLikeRestaurantBrandWord(label: string): boolean {
  return /\b(?:cafe|coffee|kitchen|restaurant|grill|bar|bistro|deli|taqueria|cantina|pizzeria|pizza|sushi|ramen|noodle|bbq|bakery|tavern|pub|steakhouse|eatery|house|market)\b/i.test(
    label,
  );
}

function looksLikeCommonMenuItemWord(label: string): boolean {
  return /^(?:burger|fries|salad|pizza|taco|burrito|pasta|sushi|ramen|latte|coffee|espresso|tea|soda|water|combo|meal|sandwich|wings|nuggets|appetizer|entree|dessert)$/i.test(
    cleanLine(label),
  );
}

function looksLikeGenericRestaurantDescriptor(label: string): boolean {
  const tokens = cleanLine(label)
    .toLowerCase()
    .split(/[\s&/.-]+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;

  const genericWords = new Set([
    "fresh",
    "mex",
    "mexican",
    "japanese",
    "steakhouse",
    "sushi",
    "kitchen",
    "grill",
    "bar",
    "bistro",
    "cafe",
    "coffee",
    "pub",
    "tavern",
    "bbq",
    "house",
    "restaurant",
    "cantina",
    "taqueria",
    "pizzeria",
    "pizza",
    "ramen",
    "noodle",
    "deli",
    "bakery",
  ]);

  return tokens.every((token) => genericWords.has(token));
}

function scoreRestaurantNameCandidate(line: string, index: number): number {
  const cleaned = cleanLine(line);
  if (!cleaned) return -1;
  if (!/[A-Za-z]/.test(cleaned)) return -1;
  if (hasKeyword(cleaned, receiptKeywords)) return -1;
  if (looksLikeAddressOrLocationLabel(cleaned)) return -1;
  if (looksLikeMetadataLabel(cleaned)) return -1;
  if (cleaned.length < 3 || cleaned.length > 42) return -1;
  if (getLineAmount(cleaned)) return -1;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return -1;

  const hasBrandingSignal =
    looksLikeRestaurantBrandWord(cleaned) ||
    /^[A-Z0-9 '&.-]+$/.test(cleaned) ||
    /[&'.-]/.test(cleaned) ||
    words.length >= 2;

  if (parseQuantityAndName(cleaned) && !hasBrandingSignal) {
    return -1;
  }
  if (words.length === 1 && looksLikeCommonMenuItemWord(words[0])) {
    return -1;
  }

  let score = 0;
  if (index === 0) score += 4;
  else if (index < 3) score += 3;
  else if (index < 6) score += 2;
  else score += 1;

  if (words.length >= 1 && words.length <= 4) score += 2;
  if (looksLikeRestaurantBrandWord(cleaned)) score += 2;
  if (/^[A-Z0-9 '&.-]+$/.test(cleaned)) score += 2;
  if (words.length === 1 && cleaned.length >= 8) score += 1;
  if (index === 0 && words.length === 2 && /^[A-Z0-9 '&.-]+$/.test(cleaned)) score += 1;
  if (/\d/.test(cleaned)) score -= 1;
  if (index > 0 && looksLikeGenericRestaurantDescriptor(cleaned)) score -= 2;

  return score;
}

function extractRestaurantName(lines: string[]): string {
  let bestCandidate: { name: string; score: number; index: number } | null = null;
  const topCandidates: { name: string; score: number; index: number }[] = [];

  // Search up to 30 lines. Receipts may have many header lines before the restaurant
  // name, and any unboxed lines (no bounding box) are appended at the end of the
  // geometry-aware array — so we need a wider window to catch them.
  for (const [index, line] of lines.slice(0, 30).entries()) {
    const cleaned = cleanLine(line);
    const score = scoreRestaurantNameCandidate(cleaned, index);
    if (score < 0) continue;

    topCandidates.push({ name: cleaned, score, index });

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { name: cleaned, score, index };
    }
  }

  const firstCandidate = topCandidates.find((candidate) => candidate.index === 0) ?? null;
  const secondCandidate = topCandidates.find((candidate) => candidate.index === 1) ?? null;

  if (firstCandidate && secondCandidate) {
    if (
      firstCandidate.score >= 7 &&
      looksLikeGenericRestaurantDescriptor(secondCandidate.name)
    ) {
      return firstCandidate.name;
    }

    const combinedName = `${firstCandidate.name} ${secondCandidate.name}`;
    if (
      firstCandidate.score >= 7 &&
      secondCandidate.score >= 7 &&
      combinedName.length <= 42 &&
      (/[&]/.test(secondCandidate.name) || looksLikeRestaurantBrandWord(secondCandidate.name)) &&
      !looksLikeGenericRestaurantDescriptor(firstCandidate.name)
    ) {
      return combinedName;
    }
  }

  if (!bestCandidate || bestCandidate.score < 5) {
    return "Unknown Restaurant";
  }

  return bestCandidate.name;
}

function looksLikeAddressOrLocationLabel(label: string): boolean {
  const normalized = cleanLine(label);
  if (!normalized) return false;

  // "City, ST" pattern (e.g. "Narragansett, RI")
  if (/^[A-Za-z .'-]+,\s*[A-Za-z]{2}$/.test(normalized)) {
    return true;
  }

  // Has a US zip code
  if (/\b\d{5}(?:-\d{4})?\b/.test(normalized)) {
    return true;
  }

  // Street address: starts with a house/building number AND contains a street suffix keyword.
  // Using both conditions prevents false positives for item names that start with digits
  // (e.g. "1 Dollar Single Smash Burger" after quantity-prefix stripping in parseQuantityAndName).
  if (/^\d+\s+[A-Za-z].*\b(?:st\.?|ave\.?|rd\.?|blvd\.?|ln\.?|dr\.?|ct\.?|pl\.?|way|hwy|street|avenue|road|boulevard|lane|drive|court|place|highway|pike|cir\.?)\b/i.test(normalized)) {
    return true;
  }

  // Suite/floor/unit identifiers are always part of an address
  if (/\b(?:suite|ste\.?|floor|fl\.?|unit|apt\.?|apartment)\b/i.test(normalized)) {
    return true;
  }

  // Known large-city names that would never appear as standalone restaurant name words
  if (/\b(?:new york|brooklyn|manhattan|queens|bronx)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function isSubtotalLabel(label: string): boolean {
  return /\bsub[\s-]?total\b|\bnet amount\b|\bsous[\s-]?total\b/.test(label);
}

function isTaxLabel(label: string): boolean {
  return /\btax\b|\bvat\b|\bgst\b|\bhst\b|\bpst\b|\bqst\b|\bmwst\b|\biva\b|\btva\b|\bbtw\b|\bmoms\b|\btaxes?\s*(?:[&]|and)\s*fees?\b/.test(label);
}

function isTipLabel(label: string): boolean {
  // "TOTAL WITH TIP" / "TOTAL WITH GRATUITY" is a total line, not a tip line.
  if (/\btotal\b/.test(label)) return false;
  if (!/\btip\b|\bgratuity\b|\bservice charge\b|\bsurcharge\b/.test(label)) return false;
  // Credit card / payment surcharges are not gratuity — exclude them.
  if (/\bcredit\b|\bcard\b|\bdebit\b|\bpayment\b|\bprocessing\b/.test(label)) return false;
  return true;
}

function isTotalLabel(label: string): boolean {
  return (
    /\bgrand total\b|\border total\b|\btotal\b|\bamount due\b|\bbalance due\b|\bamount payable\b|\blotal\b|\bgesamtbetrag\b|\bmontant\b|\btotale\b|\btotal\s+with\s+(?:tip|gratuity)\b/.test(
      label,
    ) && !isSubtotalLabel(label)
  );
}

function shouldExcludeAsNonItemLine(label: string): boolean {
  const normalized = cleanLine(label).toLowerCase();
  if (!normalized) return true;
  if (isSubtotalLabel(normalized)) return true;
  if (isTaxLabel(normalized)) return true;
  if (isTipLabel(normalized)) return true;
  if (isFeeLabel(normalized)) return true;
  if (isTotalLabel(normalized)) return true;
  if (looksLikeMetadataLabel(normalized)) return true;
  if (isDiscountLabel(normalized)) return true;
  return false;
}

function isLikelyVisionItemLine(line: string): boolean {
  const lineAmount = getLineAmount(line);
  if (!lineAmount) return false;
  if (lineAmount.amount <= 0 || lineAmount.amount > 1000) return false;
  return Boolean(parseQuantityAndName(lineAmount.label));
}

function findLikelyItemSectionStart(lines: string[], totalsSectionStartIndex: number): number {
  const separatorIndexes: number[] = [];
  for (let i = 0; i < totalsSectionStartIndex; i++) {
    if (isSeparatorLine(lines[i])) {
      separatorIndexes.push(i);
    }
  }

  for (let s = separatorIndexes.length - 1; s >= 0; s--) {
    const separatorIndex = separatorIndexes[s];
    const candidateIndexes: number[] = [];
    for (let i = separatorIndex + 1; i < totalsSectionStartIndex; i++) {
      if (isLikelyVisionItemLine(lines[i])) {
        candidateIndexes.push(i);
      }
    }
    if (candidateIndexes.length >= 2) {
      return candidateIndexes[0];
    }
  }

  const firstLikelyItemIndex = lines.findIndex(
    (line, index) => index < totalsSectionStartIndex && isLikelyVisionItemLine(line),
  );
  return firstLikelyItemIndex >= 0 ? firstLikelyItemIndex : 0;
}

function shouldMergeSplitAmountLine(
  currentLine: string,
  nextLine: string,
): boolean {
  const standaloneAmount = getStandaloneAmountLine(nextLine);
  if (!standaloneAmount) return false;

  const current = cleanLine(currentLine);
  if (!current) return false;

  // A lone currency code (e.g. "CHF" on its own line) is not a label for the next amount.
  if (isCurrencyCodeOnlyLine(current)) return false;

  const lower = current.toLowerCase();
  const isRecognizedChargeLabel =
    isSubtotalLabel(lower) ||
    isTaxLabel(lower) ||
    isTipLabel(lower) ||
    isTotalLabel(lower) ||
    isDiscountLabel(lower) ||
    isFeeLabel(lower);
  if (!isRecognizedChargeLabel && looksLikeMetadataLabel(current)) return false;
  const inlineAmount = getLineAmount(current);
  if (!inlineAmount) {
    return (
      Boolean(parseQuantityAndName(current)) ||
      isRecognizedChargeLabel
    );
  }

  return /\d{1,2}(?:\.\d+)?\s*%/.test(current) && (isTipLabel(lower) || looksLikeAutoGratuityLabel(current));
}

// Matches a line that is only a currency code — e.g. "CHF", "EUR", "CHF:"
function isCurrencyCodeOnlyLine(line: string): boolean {
  return /^(?:CHF|EUR|GBP|CAD|AUD|NZD|JPY|MXN|BRL|INR|SGD|HKD|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|ZAR|KRW|THB|AED|SAR|ILS|EGP|TWD|HRK|BGN|PHP|IDR|MYR|VND|CLP|COP|ARS|PEN)\s*:?\s*$/i.test(line);
}

function mergeSplitAmountLines(lines: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const current = cleanLine(lines[i]);
    if (!current) continue;

    const next = i + 1 < lines.length ? cleanLine(lines[i + 1]) : "";

    // 3-way merge: "Total\nCHF\n54.50" → "Total 54.50"
    // When a recognized charge label is followed by a lone currency-code line and then a standalone amount.
    if (next && isCurrencyCodeOnlyLine(next) && i + 2 < lines.length) {
      const nextNext = cleanLine(lines[i + 2]);
      if (nextNext && getStandaloneAmountLine(nextNext)) {
        const currentLower = current.toLowerCase();
        const isChargeLabel =
          isSubtotalLabel(currentLower) ||
          isTaxLabel(currentLower) ||
          isTipLabel(currentLower) ||
          isTotalLabel(currentLower) ||
          isDiscountLabel(currentLower) ||
          isFeeLabel(currentLower);
        if (isChargeLabel) {
          merged.push(`${current} ${nextNext}`);
          i += 2;
          continue;
        }
      }
    }

    if (next && shouldMergeSplitAmountLine(current, next)) {
      merged.push(`${current} ${next}`);
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

type ParserVisionLine = {
  text: string;
  boundingBox: StructuredOcrLine["boundingBox"];
};

type StructuredTextFlow = "horizontal" | "vertical_ccw" | "vertical_cw";

type StructuredOcrRow = {
  text: string;
  boundingBox: StructuredOcrLine["boundingBox"];
  entries: StructuredOcrLine[];
};

function normalizeStructuredOcrLines(lines: StructuredOcrLine[] = []): StructuredOcrLine[] {
  return lines
    .map((line) => {
      const text = cleanLine(line.text);
      if (!text) return null;

      const box = line.boundingBox;
      const boundingBox =
        box &&
        Number.isFinite(box.x) &&
        Number.isFinite(box.y) &&
        Number.isFinite(box.width) &&
        Number.isFinite(box.height) &&
        box.width > 0 &&
        box.height > 0
          ? {
              x: Math.max(0, Math.min(1, box.x)),
              y: Math.max(0, Math.min(1, box.y)),
              width: Math.max(0.0001, Math.min(1, box.width)),
              height: Math.max(0.0001, Math.min(1, box.height)),
            }
          : null;

      return {
        text,
        confidence: typeof line.confidence === "number" ? line.confidence : null,
        boundingBox,
      };
    })
    .filter((line): line is StructuredOcrLine => Boolean(line));
}

function unionBoundingBoxes(
  boxes: StructuredOcrLine["boundingBox"][],
): StructuredOcrLine["boundingBox"] {
  const present = boxes.filter(
    (box): box is NonNullable<StructuredOcrLine["boundingBox"]> => Boolean(box),
  );
  if (present.length === 0) return null;

  const left = Math.min(...present.map((box) => box.x));
  const top = Math.min(...present.map((box) => box.y));
  const right = Math.max(...present.map((box) => box.x + box.width));
  const bottom = Math.max(...present.map((box) => box.y + box.height));

  return {
    x: left,
    y: top,
    width: Math.max(0.0001, right - left),
    height: Math.max(0.0001, bottom - top),
  };
}

function detectStructuredTextFlow(lines: StructuredOcrLine[]): "horizontal" | "vertical" {
  const boxed = lines.filter(
    (line): line is StructuredOcrLine & { boundingBox: NonNullable<StructuredOcrLine["boundingBox"]> } =>
      Boolean(line.boundingBox),
  );
  if (boxed.length < 3) return "horizontal";

  let verticalCount = 0;
  let horizontalCount = 0;
  for (const line of boxed) {
    const { width, height } = line.boundingBox;
    if (height >= width * 1.2) {
      verticalCount += 1;
    } else if (width >= height * 1.2) {
      horizontalCount += 1;
    }
  }

  return verticalCount > horizontalCount && verticalCount >= Math.max(2, Math.floor(boxed.length * 0.45))
    ? "vertical"
    : "horizontal";
}

function compareStructuredOcrLines(
  lhs: StructuredOcrLine,
  rhs: StructuredOcrLine,
  flow: StructuredTextFlow = "horizontal",
): number {
  const leftBox = lhs.boundingBox;
  const rightBox = rhs.boundingBox;
  if (!leftBox && !rightBox) return lhs.text.localeCompare(rhs.text);
  if (!leftBox) return 1;
  if (!rightBox) return -1;

  if (flow === "vertical_ccw" || flow === "vertical_cw") {
    const columnTolerance = Math.max(leftBox.width, rightBox.width, 0.012) * 0.5;
    const horizontalDelta = leftBox.x - rightBox.x;
    if (Math.abs(horizontalDelta) <= columnTolerance) {
      return flow === "vertical_ccw"
        ? rightBox.y - leftBox.y
        : leftBox.y - rightBox.y;
    }
    return flow === "vertical_ccw"
      ? horizontalDelta
      : rightBox.x - leftBox.x;
  }

  const rowTolerance = Math.max(leftBox.height, rightBox.height, 0.012) * 0.5;
  const verticalDelta = leftBox.y - rightBox.y;
  if (Math.abs(verticalDelta) <= rowTolerance) {
    return leftBox.x - rightBox.x;
  }
  return verticalDelta;
}

function shouldGroupStructuredOcrLineIntoRow(
  currentEntries: StructuredOcrLine[],
  nextLine: StructuredOcrLine,
  flow: StructuredTextFlow = "horizontal",
): boolean {
  if (currentEntries.length === 0) return true;
  const nextBox = nextLine.boundingBox;
  const currentBox = unionBoundingBoxes(currentEntries.map((entry) => entry.boundingBox));
  if (!currentBox || !nextBox) return false;

  if (flow === "vertical_ccw" || flow === "vertical_cw") {
    const currentLeft = currentBox.x;
    const currentRight = currentBox.x + currentBox.width;
    const nextLeft = nextBox.x;
    const nextRight = nextBox.x + nextBox.width;
    const overlap = Math.max(0, Math.min(currentRight, nextRight) - Math.max(currentLeft, nextLeft));
    const minWidth = Math.max(0.0001, Math.min(currentBox.width, nextBox.width));
    const centerDelta = Math.abs(
      currentBox.x + currentBox.width / 2 - (nextBox.x + nextBox.width / 2),
    );

    return overlap / minWidth >= 0.35 || centerDelta <= Math.max(currentBox.width, nextBox.width) * 0.5;
  }

  const currentTop = currentBox.y;
  const currentBottom = currentBox.y + currentBox.height;
  const nextTop = nextBox.y;
  const nextBottom = nextBox.y + nextBox.height;
  const overlap = Math.max(0, Math.min(currentBottom, nextBottom) - Math.max(currentTop, nextTop));
  const minHeight = Math.max(0.0001, Math.min(currentBox.height, nextBox.height));
  const centerDelta = Math.abs(
    currentBox.y + currentBox.height / 2 - (nextBox.y + nextBox.height / 2),
  );

  return overlap / minHeight >= 0.35 || centerDelta <= Math.max(currentBox.height, nextBox.height) * 0.5;
}

function buildStructuredOcrRowText(
  entries: StructuredOcrLine[],
  flow: StructuredTextFlow = "horizontal",
): string {
  const sorted = [...entries]
    .sort((lhs, rhs) => compareStructuredOcrLines(lhs, rhs, flow))
    .filter((entry) => Boolean(cleanLine(entry.text)));

  const deduped: StructuredOcrLine[] = [];
  for (const entry of sorted) {
    const text = cleanLine(entry.text).toLowerCase();
    const prev = deduped[deduped.length - 1];
    if (prev && cleanLine(prev.text).toLowerCase() === text) {
      // Only skip if bounding boxes significantly overlap (true OCR scan artifact).
      // Two identical items ordered twice have the same text but different positions —
      // they must both be preserved.
      const prevBox = prev.boundingBox;
      const nextBox = entry.boundingBox;
      if (!prevBox || !nextBox) {
        // No bounding box info — treat as spatial duplicate and skip.
        continue;
      }
      const overlapY = Math.max(
        0,
        Math.min(prevBox.y + prevBox.height, nextBox.y + nextBox.height) - Math.max(prevBox.y, nextBox.y),
      );
      const overlapX = Math.max(
        0,
        Math.min(prevBox.x + prevBox.width, nextBox.x + nextBox.width) - Math.max(prevBox.x, nextBox.x),
      );
      const minHeight = Math.max(0.0001, Math.min(prevBox.height, nextBox.height));
      const minWidth = Math.max(0.0001, Math.min(prevBox.width, nextBox.width));
      const spatialOverlap = (overlapY / minHeight) * (overlapX / minWidth);
      if (spatialOverlap >= 0.25) {
        // Boxes overlap substantially in both axes — genuine duplicate observation.
        continue;
      }
    }
    deduped.push(entry);
  }

  return cleanLine(deduped.map((e) => cleanLine(e.text)).join(" "));
}

function buildStructuredOcrRows(
  lines: StructuredOcrLine[],
  flow: StructuredTextFlow = "horizontal",
): StructuredOcrRow[] {
  const boxedLines = lines
    .filter((line) => line.boundingBox)
    .sort((lhs, rhs) => compareStructuredOcrLines(lhs, rhs, flow));
  const unboxedLines = lines.filter((line) => !line.boundingBox);
  const rows: StructuredOcrRow[] = [];
  let currentEntries: StructuredOcrLine[] = [];

  const flushCurrentEntries = () => {
    if (currentEntries.length === 0) return;
    const text = buildStructuredOcrRowText(currentEntries, flow);
    if (text) {
      rows.push({
        text,
        boundingBox: unionBoundingBoxes(currentEntries.map((entry) => entry.boundingBox)),
        entries: [...currentEntries].sort((lhs, rhs) => compareStructuredOcrLines(lhs, rhs, flow)),
      });
    }
    currentEntries = [];
  };

  for (const line of boxedLines) {
    if (currentEntries.length === 0 || shouldGroupStructuredOcrLineIntoRow(currentEntries, line, flow)) {
      currentEntries.push(line);
      continue;
    }
    flushCurrentEntries();
    currentEntries.push(line);
  }
  flushCurrentEntries();

  for (const line of unboxedLines) {
    rows.push({
      text: line.text,
      boundingBox: null,
      entries: [line],
    });
  }

  return rows.filter((row) => Boolean(row.text));
}

function scoreOrderedParserVisionLines(lines: ParserVisionLine[]): number {
  if (lines.length === 0) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const financialIndices: number[] = [];
  let totalLineCount = 0;
  let subtotalLineCount = 0;
  let taxLineCount = 0;
  let tipLineCount = 0;
  let paymentTailCount = 0;
  let likelyItemBeforeTotalsCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const text = cleanLine(lines[i].text);
    if (!text) continue;

    const lower = text.toLowerCase();
    const amount = getLineAmount(text);
    const hasFinancialLabel =
      isSubtotalLabel(lower) || isTaxLabel(lower) || isTipLabel(lower) || isTotalLabel(lower);

    if (hasFinancialLabel) {
      financialIndices.push(i);
      if (i >= lines.length * 0.45) score += 4;
      if (isTotalLabel(lower)) totalLineCount += 1;
      if (isSubtotalLabel(lower)) subtotalLineCount += 1;
      if (isTaxLabel(lower)) taxLineCount += 1;
      if (isTipLabel(lower)) tipLineCount += 1;
    }

    if (isPaymentLabel(lower) && i >= lines.length * 0.65) {
      paymentTailCount += 1;
    }

    if (amount && isLikelyVisionItemLine(text) && financialIndices.length === 0) {
      likelyItemBeforeTotalsCount += 1;
    }
  }

  if (totalLineCount > 0) score += 12;
  if (subtotalLineCount > 0) score += 5;
  if (taxLineCount > 0) score += 3;
  if (tipLineCount > 0) score += 2;
  if (paymentTailCount > 0) score += paymentTailCount * 2;
  if (likelyItemBeforeTotalsCount > 1) score += Math.min(6, likelyItemBeforeTotalsCount);

  if (financialIndices.length > 0) {
    const firstFinancialIndex = financialIndices[0];
    if (firstFinancialIndex >= Math.floor(lines.length * 0.2)) score += 6;
    if (firstFinancialIndex >= Math.floor(lines.length * 0.3)) score += 4;
  } else {
    score -= 20;
  }

  return score;
}

function mergeParserVisionLines(lines: ParserVisionLine[]): ParserVisionLine[] {
  const merged: ParserVisionLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const current = {
      text: cleanLine(lines[i].text),
      boundingBox: lines[i].boundingBox,
    };
    if (!current.text) continue;

    const next =
      i + 1 < lines.length
        ? {
            text: cleanLine(lines[i + 1].text),
            boundingBox: lines[i + 1].boundingBox,
          }
        : null;

    if (next?.text && isCurrencyCodeOnlyLine(next.text) && i + 2 < lines.length) {
      const nextNext = {
        text: cleanLine(lines[i + 2].text),
        boundingBox: lines[i + 2].boundingBox,
      };
      if (nextNext.text && getStandaloneAmountLine(nextNext.text)) {
        const currentLower = current.text.toLowerCase();
        const isChargeLabel =
          isSubtotalLabel(currentLower) ||
          isTaxLabel(currentLower) ||
          isTipLabel(currentLower) ||
          isTotalLabel(currentLower) ||
          isDiscountLabel(currentLower) ||
          isFeeLabel(currentLower);
        if (isChargeLabel) {
          merged.push({
            text: cleanLine(`${current.text} ${nextNext.text}`),
            boundingBox: unionBoundingBoxes([current.boundingBox, next.boundingBox, nextNext.boundingBox]),
          });
          i += 2;
          continue;
        }
      }
    }

    if (next?.text && shouldMergeSplitAmountLine(current.text, next.text)) {
      merged.push({
        text: cleanLine(`${current.text} ${next.text}`),
        boundingBox: unionBoundingBoxes([current.boundingBox, next.boundingBox]),
      });
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function buildGeometryAwareParserLines(
  text: string,
  structuredLines: StructuredOcrLine[] = [],
): ParserVisionLine[] {
  const fallbackLines = mergeParserVisionLines(
    text
      .split(/\r?\n/)
      .map((line) => ({ text: cleanLine(line), boundingBox: null }))
      .filter((line) => Boolean(line.text)),
  );

  const normalizedLines = normalizeStructuredOcrLines(structuredLines);
  if (normalizedLines.length < 3) {
    return fallbackLines;
  }

  const textFlow = detectStructuredTextFlow(normalizedLines);
  const candidateFlows: StructuredTextFlow[] =
    textFlow === "vertical"
      ? ["vertical_ccw", "vertical_cw", "horizontal"]
      : ["horizontal"];

  const candidateGeometryLines = candidateFlows
    .map((flow) => {
      const rows = buildStructuredOcrRows(normalizedLines, flow);
      if (rows.length < 3) return null;

      const geometryLines = mergeParserVisionLines(
        rows.map((row) => ({
          text: row.text,
          boundingBox: row.boundingBox,
        })),
      );
      if (geometryLines.length < Math.max(3, Math.floor(fallbackLines.length * 0.5))) {
        return null;
      }

      return {
        flow,
        lines: geometryLines,
        score: scoreOrderedParserVisionLines(geometryLines),
      };
    })
    .filter(
      (
        candidate,
      ): candidate is { flow: StructuredTextFlow; lines: ParserVisionLine[]; score: number } =>
        Boolean(candidate),
    )
    .sort((lhs, rhs) => rhs.score - lhs.score);

  return candidateGeometryLines[0]?.lines ?? fallbackLines;
}

function findTotalsSectionStartIndex(
  lines: string[],
  parserLines: ParserVisionLine[],
): number {
  const firstFinancialIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return isSubtotalLabel(lower) || isTotalLabel(lower) || isTaxLabel(lower) || isTipLabel(lower);
  });

  const geometryCandidates = parserLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.boundingBox)
    .filter(({ line }) => {
      const lower = line.text.toLowerCase();
      return isSubtotalLabel(lower) || isTotalLabel(lower) || isTaxLabel(lower) || isTipLabel(lower);
    })
    .filter(({ line }) => {
      const box = line.boundingBox!;
      const centerY = box.y + box.height / 2;
      return centerY >= 0.42 || box.y >= 0.35;
    })
    .map(({ index }) => index);

  if (geometryCandidates.length > 0) {
    return geometryCandidates[0];
  }

  return firstFinancialIndex >= 0 ? firstFinancialIndex : lines.length;
}

// ─── Foreign currency detection & conversion ─────────────────────────────────

const FOREIGN_CURRENCY_CODES = [
  "EUR", "GBP", "CAD", "AUD", "CHF", "JPY", "CNY", "NZD", "MXN", "BRL",
  "INR", "SGD", "HKD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON",
  "TRY", "ZAR", "KRW", "THB", "AED", "SAR", "ILS", "EGP", "TWD", "PHP",
  "IDR", "MYR", "VND", "CLP", "COP", "ARS", "PEN",
];

function detectForeignCurrency(text: string): string | null {
  const upper = text.toUpperCase();
  const counts: Record<string, number> = {};
  for (const code of FOREIGN_CURRENCY_CODES) {
    const matches = upper.match(new RegExp(`\\b${code}\\b`, "g"));
    if (matches && matches.length >= 1) {
      counts[code] = matches.length;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

async function fetchUsdExchangeRate(fromCurrency: string): Promise<number | null> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${fromCurrency}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) return null;
    return data.rates["USD"] ?? null;
  } catch {
    return null;
  }
}

function applyUsdConversion(parsed: ParsedReceipt, rate: number, currency: string): ParsedReceipt {
  const r = (n: number) => Math.round(n * rate * 100) / 100;
  return {
    ...parsed,
    items: parsed.items.map((item) => ({ ...item, price: r(item.price) })),
    subtotal: r(parsed.subtotal),
    tax: r(parsed.tax),
    tip: r(parsed.tip),
    total: r(parsed.total),
    autoGratuity: {
      ...parsed.autoGratuity,
      autoGratuityAmount:
        parsed.autoGratuity.autoGratuityAmount != null
          ? r(parsed.autoGratuity.autoGratuityAmount)
          : null,
      additionalTipAmount:
        parsed.autoGratuity.additionalTipAmount != null
          ? r(parsed.autoGratuity.additionalTipAmount)
          : null,
    },
    detectedCurrency: currency,
    currencyConversionRate: rate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

function parseReceiptTextWithVision(
  text: string,
  structuredLines: StructuredOcrLine[] = [],
): ParsedReceipt {
  const parserLines = buildGeometryAwareParserLines(text, structuredLines);
  const lines = parserLines.map((line) => line.text);
  const parserText = lines.join("\n");

  const totalsSectionStartIndex = findTotalsSectionStartIndex(lines, parserLines);
  const itemSectionStartIndex = findLikelyItemSectionStart(lines, totalsSectionStartIndex);

  const restaurantName = extractRestaurantName(lines);
  let items: ParsedItem[] = [];

  const subtotalCandidates: number[] = [];
  const taxCandidates: TaxCandidateItem[] = [];
  const discountCandidates: DiscountCandidateItem[] = [];
  const feeCandidates: FeeCandidateItem[] = [];
  const paymentCandidates: { label: string; amount: number; method: string }[] = [];
  const tipCandidates: TipCandidate[] = [];
  const totalCandidates: { amount: number; index: number; label: string }[] = [];
  const genericAmounts: { amount: number; index: number; label: string; verticalPosition: number }[] = [];
  const rawAmountCandidates: RawAmountCandidateRecord[] = [];
  let sawDecimal = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineAmount = getLineAmount(line);
    if (!lineAmount) continue;
    sawDecimal = sawDecimal || lineAmount.hadDecimal;

    const lowerLabel = lineAmount.label.toLowerCase();
    const amount = lineAmount.amount;
    const amountText = lineAmount.hadDecimal ? amount.toFixed(2) : String(amount);

    if (isSubtotalLabel(lowerLabel)) {
      subtotalCandidates.push(amount);
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "subtotal",
        status: "included",
        status_reason: "matched subtotal label",
      });
      continue;
    }
    if (isTaxLabel(lowerLabel)) {
      const taxType = classifyTaxLabel(lowerLabel);
      taxCandidates.push({ type: taxType, label: lineAmount.label, amount });
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "tax",
        status: "included",
        status_reason: "matched tax label",
        selected_as: taxType,
      });
      continue;
    }
    if (isTipLabel(lowerLabel)) {
      tipCandidates.push({ amount, label: lineAmount.label });
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "tip",
        status: "included",
        status_reason: "matched tip label",
      });
      continue;
    }
    if (isDiscountLabel(lowerLabel)) {
      const { discountType } = classifyDiscountLabel(lowerLabel);
      discountCandidates.push({ type: discountType, label: lineAmount.label, amount });
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "discount",
        status: "included",
        status_reason: "matched discount label",
        selected_as: discountType,
      });
      continue;
    }
    {
      const { isFee, feeType } = classifyFeeLabel(lowerLabel);
      if (isFee) {
        feeCandidates.push({ type: feeType, label: lineAmount.label, amount });
        rawAmountCandidates.push({
          raw_text: line,
          label_text: lineAmount.label,
          amount_text: amountText,
          parsed_amount: amount,
          line_index: i,
          classification_result: "fee",
          status: "included",
          status_reason: "matched fee label",
          selected_as: feeType,
        });
        continue;
      }
    }
    if (isPaymentLabel(lowerLabel)) {
      const method = classifyPaymentMethod(lowerLabel);
      paymentCandidates.push({ label: lineAmount.label, amount, method });
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "payment",
        status: "excluded_wrong_payment_phase",
        status_reason: "payment tender line excluded from receipt totals",
      });
      continue;
    }
    if (isTotalLabel(lowerLabel)) {
      totalCandidates.push({ amount, index: i, label: lineAmount.label });
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "total",
        status: "included",
        status_reason: "matched total label",
      });
      continue;
    }

    if (isLikelySuggestedTipLabel(lowerLabel)) {
      rawAmountCandidates.push({
        raw_text: line,
        label_text: lineAmount.label,
        amount_text: amountText,
        parsed_amount: amount,
        line_index: i,
        classification_result: "suggested_tip",
        status: "excluded_suggestion",
        status_reason: "suggested tip table entry — not a charged amount",
      });
    }

    const box = parserLines[i]?.boundingBox;
    const verticalPosition =
      box && Number.isFinite(box.y) && Number.isFinite(box.height)
        ? box.y + box.height / 2
        : lines.length > 1
          ? i / (lines.length - 1)
          : 1;

    genericAmounts.push({ amount, index: i, label: lowerLabel, verticalPosition });

    const parsed = parseQuantityAndName(lineAmount.label);
    if (!parsed) continue;
    if (amount <= 0 || amount > 1000) continue;
    if (i < itemSectionStartIndex || i >= totalsSectionStartIndex) continue;

    items.push({
      name: parsed.name,
      price: amount,
      quantity: parsed.quantity,
    });
  }

  const subtotalLastCandidate = roundCurrency(subtotalCandidates.at(-1) ?? 0);
  let subtotal = subtotalLastCandidate;
  const feeTotal = roundCurrency(
    feeCandidates
      .filter((f) => f.amount > 0)
      .reduce((sum, f) => sum + f.amount, 0),
  );
  let tax = roundCurrency(taxCandidates.reduce((sum, t) => sum + t.amount, 0) + feeTotal);
  const tipCandidateLabels = dedupeTipCandidates(tipCandidates).map(
    (candidate) => candidate.label,
  );
  let tip = deriveTipFromCandidates(tipCandidates);

  let total = 0;
  if (totalCandidates.length > 0) {
    if (totalCandidates.length === 1) {
      total = roundCurrency(totalCandidates[0].amount);
    } else {
      // When multiple "Total" lines exist (e.g. real total + suggested gratuity totals),
      // prefer the candidate closest to subtotal+tax+tip. Break ties by earlier line index.
      const computedBase = roundCurrency(subtotal + tax + tip);
      const best = [...totalCandidates].sort((a, b) => {
        const da = Math.abs(a.amount - computedBase);
        const db = Math.abs(b.amount - computedBase);
        if (Math.abs(da - db) < 0.05) return a.index - b.index; // prefer earlier when similar
        return da - db;
      })[0];
      total = roundCurrency(best.amount);
    }
  } else if (subtotal > 0) {
    total = roundCurrency(subtotal + tax + tip);
  } else {
    const lowerHalfStart = Math.floor(lines.length * 0.5);
    const likelyTotals = genericAmounts
      .filter((entry) => entry.index >= lowerHalfStart || entry.verticalPosition >= 0.55)
      .filter((entry) => entry.amount > 0)
      .filter((entry) => !hasKeyword(entry.label, nonItemKeywords))
      .map((entry) => entry.amount);

    const fallbackCandidates = likelyTotals.length
      ? likelyTotals
      : genericAmounts
          .filter((entry) => entry.amount > 0 && !hasKeyword(entry.label, nonItemKeywords))
          .map((entry) => entry.amount);
    total = roundCurrency(Math.max(...fallbackCandidates, 0));
  }

  if (subtotalCandidates.length > 1 && total > 0) {
    const subtotalSumCandidates = roundCurrency(
      subtotalCandidates
        .filter((amount) => amount > 0)
        .reduce((sum, amount) => sum + amount, 0),
    );
    if (subtotalSumCandidates > 0) {
      const deltaLast = Math.abs(total - roundCurrency(subtotal + tax + tip));
      const deltaSum = Math.abs(total - roundCurrency(subtotalSumCandidates + tax + tip));
      if (deltaSum + 0.1 < deltaLast) {
        subtotal = subtotalSumCandidates;
      }
    }
  }

  if (discountCandidates.length > 0 && subtotal > 0 && total > 0) {
    const discountTotal = roundCurrency(discountCandidates.reduce((sum, d) => sum + d.amount, 0));
    const likelyDiscountTotal = discountTotal > 0 ? -discountTotal : discountTotal;
    const adjustedSubtotal = roundCurrency(subtotal + likelyDiscountTotal);
    if (adjustedSubtotal > 0) {
      const deltaCurrent = Math.abs(total - roundCurrency(subtotal + tax + tip));
      const deltaAdjusted = Math.abs(total - roundCurrency(adjustedSubtotal + tax + tip));
      if (deltaAdjusted + 0.1 < deltaCurrent) {
        subtotal = adjustedSubtotal;
      }
    }
  }

  if (tax <= 0 && subtotal > 0 && total > 0) {
    const inferredTax = roundCurrency(total - subtotal - tip);
    if (inferredTax > 0 && inferredTax <= roundCurrency(subtotal * 0.3)) {
      tax = inferredTax;
    }
  }

  // If OCR never found decimals and totals are very large, they are often cents without the decimal.
  if (!sawDecimal && subtotal === 0 && tax === 0 && tip === 0 && total >= 200) {
    total = roundCurrency(total / 100);
  }
  if (!sawDecimal && subtotal >= 200) {
    subtotal = roundCurrency(subtotal / 100);
  }
  if (!sawDecimal && tax >= 200) {
    tax = roundCurrency(tax / 100);
  }
  if (!sawDecimal && tip >= 200) {
    tip = roundCurrency(tip / 100);
  }

  if (items.length === 0 && (subtotal > 0 || total > 0)) {
    const derivedBase = subtotal > 0 ? subtotal : Math.max(0, total - tax - tip);
    const fallbackAmount = roundCurrency(derivedBase > 0 ? derivedBase : total);
    if (fallbackAmount > 0) {
      items.push({
        name: "Receipt Items",
        price: fallbackAmount,
        quantity: 1,
      });
    }
  } else if (items.length > 0 && subtotal > 0) {
    const itemSum = roundCurrency(items.reduce((sum, item) => sum + item.price, 0));
    if (itemSum <= 0 || subtotal > roundCurrency(itemSum * 1.8)) {
      items.splice(0, items.length, {
        name: "Receipt Items",
        price: subtotal,
        quantity: 1,
      });
    }
  }

  if (items.length === 0 && total === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "NO_ITEMS_OR_TOTAL" });
  }

  let autoGratuity = extractAutoGratuityInfo(
    parserText,
    tip,
    tipCandidateLabels,
  );
  ({ tip, total, autoGratuity } = applyAutoGratuityInference({
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
  }));
  autoGratuity = applyTipBreakdownFromCandidates({
    candidates: tipCandidates,
    subtotal,
    tip,
    autoGratuity,
  });

  const reconciled = reconcileParsedTotals({
    items,
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
  });
  items = reconciled.items;
  subtotal = reconciled.subtotal;
  tax = reconciled.tax;
  tip = reconciled.tip;
  total = reconciled.total;
  autoGratuity = reconciled.autoGratuity;

  const _normalized = buildNormalizedData({
    text: parserText,
    taxCandidates,
    feeCandidates,
    discountCandidates,
    paymentCandidates,
    totalCandidates,
    rawAmountCandidates,
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
  });

  return {
    restaurantName,
    items: scanResultItemSchema.array().parse(items.slice(0, 60)),
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
    _normalized,
  };
}

function parseDocAiMoneyValue(value: any): number {
  const units = Number(value?.units || 0);
  const nanos = Number(value?.nanos || 0);
  return roundCurrency(units + nanos / 1_000_000_000);
}

function parseDocAiNumberValue(value: any): number | null {
  if (value?.numberValue !== undefined && value?.numberValue !== null) {
    const num = Number(value.numberValue);
    return Number.isFinite(num) ? num : null;
  }
  if (value?.integerValue !== undefined && value?.integerValue !== null) {
    const num = Number(value.integerValue);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function getDocAiEntityAmount(entity: any): number {
  const moneyValue = entity?.normalizedValue?.moneyValue;
  if (moneyValue) return parseDocAiMoneyValue(moneyValue);
  const mentionValue = Number((entity?.mentionText || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(mentionValue) ? roundCurrency(mentionValue) : 0;
}

function getDocAiEntityText(entity: any): string {
  return cleanLine(entity?.mentionText || "");
}

function parseReceiptWithDocAi(document: any): ParsedReceipt | null {
  const entities: any[] = Array.isArray(document?.entities) ? document.entities : [];
  if (!entities.length) return null;

  const findFirstAmount = (types: string[]): number => {
    for (const type of types) {
      const entity = entities.find((e) => (e?.type || "").toLowerCase() === type.toLowerCase());
      if (!entity) continue;
      const amount = getDocAiEntityAmount(entity);
      if (amount > 0) return amount;
    }
    return 0;
  };
  const findAllAmounts = (types: string[]): number[] => {
    const normalizedTypes = new Set(types.map((type) => type.toLowerCase()));
    return entities
      .filter((entity) => normalizedTypes.has(String(entity?.type || "").toLowerCase()))
      .map((entity) => getDocAiEntityAmount(entity))
      .filter((amount) => amount > 0)
      .map((amount) => roundCurrency(amount));
  };
  const chooseSubtotalFromCandidates = (candidates: number[], taxAmount: number, totalAmount: number, tipAmount: number): number => {
    if (!candidates.length) return 0;
    if (candidates.length === 1) return roundCurrency(candidates[0]);

    const filtered = candidates.filter((amount) => amount > 0).map((amount) => roundCurrency(amount));
    const uniqueCandidates = Array.from(new Set([...filtered, roundCurrency(filtered.reduce((sum, amount) => sum + amount, 0))]))
      .filter((amount) => amount > 0);
    if (!uniqueCandidates.length) return 0;
    if (totalAmount <= 0) return roundCurrency(filtered[filtered.length - 1]);

    const targetBase = roundCurrency(totalAmount - taxAmount - tipAmount);
    let chosen = uniqueCandidates[0];
    let bestDelta = Math.abs(targetBase - chosen);
    for (const candidate of uniqueCandidates.slice(1)) {
      const delta = Math.abs(targetBase - candidate);
      if (delta < bestDelta) {
        chosen = candidate;
        bestDelta = delta;
      }
    }
    return roundCurrency(chosen);
  };

  const merchant =
    getDocAiEntityText(
      entities.find((e) =>
        ["supplier_name", "merchant_name", "vendor_name", "receiver_name"].includes(
          (e?.type || "").toLowerCase(),
        ),
      ),
    ) || "Unknown Restaurant";

  const subtotalCandidates = findAllAmounts(["subtotal_amount", "net_amount"]);
  const taxCandidates = findAllAmounts(["tax_amount", "total_tax_amount"]);
  const docAiTipCandidates: TipCandidate[] = entities
    .filter((entity) => {
      const type = String(entity?.type || "").toLowerCase();
      return (
        type.includes("tip") ||
        type.includes("gratuity") ||
        type.includes("service_charge") ||
        type.includes("service charge") ||
        type.includes("surcharge")
      );
    })
    .map((entity) => ({
      amount: getDocAiEntityAmount(entity),
      label: getDocAiEntityText(entity) || String(entity?.type || ""),
    }));

  let tip = deriveTipFromCandidates(docAiTipCandidates);
  if (tip <= 0) {
    tip = findFirstAmount(["tip_amount"]);
  }
  let total = findFirstAmount(["total_amount", "amount_due"]);
  const feeAmounts = entities
    .filter((entity) => {
      const type = String(entity?.type || "").toLowerCase();
      return (
        type.includes("delivery_fee") ||
        type.includes("service_fee") ||
        type.includes("processing_fee") ||
        type.includes("convenience_fee") ||
        type.includes("order_fee") ||
        type.includes("platform_fee")
      );
    })
    .map((entity) => getDocAiEntityAmount(entity))
    .filter((amount) => amount > 0)
    .map((amount) => roundCurrency(amount));
  let tax = roundCurrency(taxCandidates.reduce((sum, amount) => sum + amount, 0));
  if (feeAmounts.length > 0) {
    tax = roundCurrency(tax + feeAmounts.reduce((sum, amount) => sum + amount, 0));
  }
  let subtotal = chooseSubtotalFromCandidates(subtotalCandidates, tax, total, tip);
  if (tax <= 0 && subtotal > 0 && total > 0) {
    const inferredTax = roundCurrency(total - subtotal - tip);
    if (inferredTax > 0 && inferredTax <= roundCurrency(subtotal * 0.3)) {
      tax = inferredTax;
    }
  }
  const tipLabels = dedupeTipCandidates(docAiTipCandidates)
    .map((candidate) => candidate.label)
    .filter(Boolean);

  const lineItems = entities.filter((e) => (e?.type || "").toLowerCase() === "line_item");
  let parsedItems: ParsedItem[] = [];

  for (const lineItem of lineItems) {
    const properties: any[] = Array.isArray(lineItem?.properties) ? lineItem.properties : [];

    let description = "";
    let amount = 0;
    let unitPrice = 0;
    let quantity = 1;

    for (const property of properties) {
      const type = String(property?.type || "").toLowerCase();
      if (
        type === "line_item/description" ||
        type === "line_item/name" ||
        type.includes("description") ||
        type.includes("name")
      ) {
        description = getDocAiEntityText(property);
      } else if (type === "line_item/amount" || type.includes("amount")) {
        amount = getDocAiEntityAmount(property);
      } else if (type === "line_item/unit_price" || type.includes("unit_price")) {
        unitPrice = getDocAiEntityAmount(property);
      } else if (type.includes("quantity")) {
        const numberValue = parseDocAiNumberValue(property?.normalizedValue);
        if (numberValue && numberValue > 0) {
          quantity = Math.max(1, Math.round(numberValue));
        } else {
          const mentionNum = Number(String(property?.mentionText || "").replace(/[^\d.]/g, ""));
          if (Number.isFinite(mentionNum) && mentionNum > 0) {
            quantity = Math.max(1, Math.round(mentionNum));
          }
        }
      }
    }

    if (amount <= 0 && unitPrice > 0) {
      amount = roundCurrency(unitPrice * quantity);
    }

    if (description && amount > 0 && !shouldExcludeAsNonItemLine(description)) {
      parsedItems.push({
        name: description,
        price: roundCurrency(amount),
        quantity,
      });
    }
  }

  if (parsedItems.length === 0 && total === 0 && subtotal === 0) {
    return null;
  }

  if (parsedItems.length === 0) {
    const fallbackAmount = subtotal > 0 ? subtotal : total;
    if (fallbackAmount > 0) {
      parsedItems.push({
        name: "Receipt Items",
        price: roundCurrency(fallbackAmount),
        quantity: 1,
      });
    }
  } else if (subtotal > 0) {
    const itemSum = roundCurrency(parsedItems.reduce((sum, item) => sum + item.price, 0));
    if (itemSum <= 0 || subtotal > roundCurrency(itemSum * 1.8)) {
      parsedItems.splice(0, parsedItems.length, {
        name: "Receipt Items",
        price: subtotal,
        quantity: 1,
      });
    }
  }

  let autoGratuity = extractAutoGratuityInfo(
    String(document?.text || ""),
    roundCurrency(tip),
    tipLabels,
  );
  ({ tip, total, autoGratuity } = applyAutoGratuityInference({
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
  }));
  autoGratuity = applyTipBreakdownFromCandidates({
    candidates: docAiTipCandidates,
    subtotal,
    tip,
    autoGratuity,
  });

  const reconciled = reconcileParsedTotals({
    items: parsedItems,
    subtotal,
    tax,
    tip,
    total,
    autoGratuity,
  });
  parsedItems = reconciled.items;
  subtotal = reconciled.subtotal;
  tax = reconciled.tax;
  tip = reconciled.tip;
  total = reconciled.total;
  autoGratuity = reconciled.autoGratuity;

  const docAiFinalTotal = roundCurrency(total || Math.max(subtotal + tax + tip, 0));
  const docAiNormalized = buildNormalizedData({
    text: String(document?.text || ""),
    taxCandidates: taxCandidates.map((a) => ({ type: "sales_tax", label: "Tax", amount: a })),
    feeCandidates: feeAmounts.map((a) => ({ type: "unknown_fee", label: "Fee", amount: a })),
    discountCandidates: [],
    paymentCandidates: [],
    totalCandidates: docAiFinalTotal > 0
      ? [{ amount: docAiFinalTotal, index: 0, label: "total_amount" }]
      : [],
    rawAmountCandidates: [],
    subtotal: roundCurrency(subtotal),
    tax: roundCurrency(tax),
    tip: roundCurrency(tip),
    total: docAiFinalTotal,
    autoGratuity,
  });

  return {
    restaurantName: merchant,
    items: scanResultItemSchema.array().parse(parsedItems.slice(0, 60)),
    subtotal: roundCurrency(subtotal),
    tax: roundCurrency(tax),
    tip: roundCurrency(tip),
    total: docAiFinalTotal,
    autoGratuity,
    _normalized: docAiNormalized,
  };
}

async function parseWithDocAiIfConfigured(
  base64: string,
  mimeType: string,
): Promise<ParsedReceipt | null> {
  const processorName = getDocAiProcessorName();
  if (!processorName) return null;
  const docAiCacheKey = getDocAiCacheKey(processorName, base64, mimeType);

  const cachedParsed = readTimedCache(docAiParsedCache, docAiCacheKey);
  if (cachedParsed) {
    logScan("[scans.parseReceipt] Reused Document AI cache hit");
    return cachedParsed;
  }

  const inFlightParsed = docAiInFlight.get(docAiCacheKey);
  if (inFlightParsed) {
    logScan("[scans.parseReceipt] Waiting on in-flight Document AI parse");
    return await inFlightParsed;
  }

  const docAiPromise = (async (): Promise<ParsedReceipt | null> => {
    const client = getDocAiClient();
    const [response] = await client.processDocument({
      name: processorName,
      rawDocument: {
        content: base64,
        mimeType,
      },
    });

    if (response?.error?.message) {
      throw new Error(`DOCAI_ERROR:${response.error.message}`);
    }

    const parsed = parseReceiptWithDocAi(response?.document);
    if (parsed) {
      writeTimedCache(
        docAiParsedCache,
        docAiCacheKey,
        parsed,
        DOC_AI_RESULT_CACHE_TTL_MS,
        DOC_AI_RESULT_CACHE_MAX_ENTRIES,
      );
    }
    return parsed;
  })();

  docAiInFlight.set(docAiCacheKey, docAiPromise);
  try {
    return await docAiPromise;
  } finally {
    docAiInFlight.delete(docAiCacheKey);
  }
}

async function extractTextWithVision(
  base64: string,
): Promise<{ text: string; usedTextFallback: boolean }> {
  const client = getVisionClient();
  const [docResult] = await client.documentTextDetection({
    image: { content: base64 },
  });

  if (docResult?.error?.message) {
    throw new Error(`VISION_ERROR:${docResult.error.message}`);
  }

  let text =
    docResult?.fullTextAnnotation?.text ??
    docResult?.textAnnotations?.[0]?.description ??
    "";
  let usedTextFallback = false;

  if (!text.trim()) {
    usedTextFallback = true;
    const [fallbackResult] = await client.textDetection({
      image: { content: base64 },
    });

    if (fallbackResult?.error?.message) {
      throw new Error(`VISION_ERROR:${fallbackResult.error.message}`);
    }

    text =
      fallbackResult?.fullTextAnnotation?.text ??
      fallbackResult?.textAnnotations?.[0]?.description ??
      "";
  }

  return { text, usedTextFallback };
}

type VisionParseResult = {
  text: string;
  parsed: ParsedReceipt;
  usedTextFallback: boolean;
};

async function parseWithVision(
  base64: string,
  onMeta?: (meta: { usedTextFallback: boolean }) => void,
): Promise<VisionParseResult> {
  const extracted = await extractTextWithVision(base64);
  onMeta?.({ usedTextFallback: extracted.usedTextFallback });
  const text = extracted.text;
  if (!text.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "NO_ITEMS_OR_TOTAL" });
  }
  return {
    text,
    parsed: parseReceiptTextWithVision(text),
    usedTextFallback: extracted.usedTextFallback,
  };
}

async function assertAndGetScanAllowance(userId: string): Promise<{
  forcePro: boolean;
  monthKey: string;
  allowance: ScanAllowance;
}> {
  const proDisabled = await isProDisabledUser(userId);
  const forcePro = proDisabled ? false : await isForceProUser(userId);
  if (!forcePro) {
    await assertScanRateLimit(userId);
  }
  const monthKey = getMonthKey();
  if (!proDisabled && !isRevenueCatEnforcementEnabled()) {
    logScan(
      "[scans.parseReceipt] OWEZY_REVENUECAT_SECRET_API_KEY is not configured; using free scan allowance only.",
    );
  }
  const allowance = proDisabled
    ? {
        monthlyAllowance: FREE_SCANS_PER_MONTH,
        displayMonthlyAllowance: FREE_SCANS_PER_MONTH,
        hasPaidAccess: false,
        hasActiveSubscription: false,
        planKind: "free" as const,
      }
    : await resolveScanAllowance(userId, forcePro);
  const usage = await store.getMonthlyScanUsage(userId, monthKey);
  if (usage >= allowance.monthlyAllowance) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: allowance.hasPaidAccess ? "SCAN_CREDIT_LIMIT_REACHED" : "FREE_SCAN_LIMIT_REACHED",
    });
  }
  return { forcePro, monthKey, allowance };
}

async function getScanStatusForUser(
  userId: string,
  options?: { refreshRevenueCat?: boolean },
): Promise<ScanStatusResult> {
  if (options?.refreshRevenueCat) {
    clearRevenueCatSubscriberCache(userId);
  }

  const monthKey = getMonthKey();
  const proDisabled = await isProDisabledUser(userId);
  const forcePro = proDisabled ? false : await isForceProUser(userId);
  const allowance = proDisabled
    ? {
        monthlyAllowance: FREE_SCANS_PER_MONTH,
        displayMonthlyAllowance: FREE_SCANS_PER_MONTH,
        hasPaidAccess: false,
        hasActiveSubscription: false,
        planKind: "free" as const,
      }
    : await resolveScanAllowance(userId, forcePro);
  const scansUsed = await store.getMonthlyScanUsage(userId, monthKey);
  const remainingScans = Math.max(0, allowance.monthlyAllowance - scansUsed);
  const displayRemainingScans = Math.max(0, allowance.displayMonthlyAllowance - scansUsed);

  return {
    monthKey,
    freeScansPerMonth: FREE_SCANS_PER_MONTH,
    allowanceScans: allowance.monthlyAllowance,
    displayAllowanceScans: allowance.displayMonthlyAllowance,
    scansUsed,
    remainingScans,
    displayRemainingScans,
    hasPaidAccess: allowance.hasPaidAccess || forcePro,
    hasActiveSubscription: allowance.hasActiveSubscription || forcePro,
    planKind: allowance.planKind,
    hasUnlimitedOverride: forcePro,
    proDisabled,
  };
}

function assertParsedReceiptHasMeaningfulData(parsed: ParsedReceipt): void {
  const hasPricedItems = parsed.items.some((item) => item.price > 0);
  const hasMeaningfulTotals =
    parsed.total > 0 || parsed.subtotal > 0 || parsed.tax > 0 || parsed.tip > 0;
  if (!hasPricedItems && !hasMeaningfulTotals) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "NO_ITEMS_OR_TOTAL" });
  }
}

function assertAppleVisionLabeledAmountsConsistent(text: string, parsed: ParsedReceipt): void {
  const lines = mergeSplitAmountLines(
    text
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(Boolean),
  );
  const subtotalCandidates: number[] = [];
  const taxCandidates: number[] = [];
  const totalCandidates: { amount: number; index: number }[] = [];
  const tipCandidates: TipCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineAmount = getLineAmount(lines[i]);
    if (!lineAmount) continue;

    const lowerLabel = lineAmount.label.toLowerCase();
    if (isSubtotalLabel(lowerLabel)) {
      subtotalCandidates.push(roundCurrency(lineAmount.amount));
      continue;
    }
    if (isTaxLabel(lowerLabel)) {
      taxCandidates.push(roundCurrency(lineAmount.amount));
      continue;
    }
    if (isTipLabel(lowerLabel)) {
      tipCandidates.push({
        amount: roundCurrency(lineAmount.amount),
        label: lineAmount.label,
      });
      continue;
    }
    if (isTotalLabel(lowerLabel)) {
      totalCandidates.push({ amount: roundCurrency(lineAmount.amount), index: i });
    }
  }

  // Use generous tolerances: reconcileParsedTotals adjusts tax/subtotal by small amounts
  // to fix rounding gaps, so 1-2% tolerances caused false LOW_CONFIDENCE rejections.
  const totalTolerance = Math.max(0.5, roundCurrency(Math.max(0, parsed.total) * 0.05));
  const componentTolerance = Math.max(0.5, roundCurrency(Math.max(0, parsed.subtotal) * 0.05));
  const taxTolerance = Math.max(0.5, roundCurrency(Math.max(0, parsed.tax) * 0.05));

  if (totalCandidates.length > 0) {
    // Use same selection logic as the main parser: candidate closest to subtotal+tax+tip.
    const computedBase = roundCurrency(parsed.subtotal + parsed.tax + parsed.tip);
    const expectedTotal =
      totalCandidates.length === 1
        ? totalCandidates[0].amount
        : [...totalCandidates].sort((a, b) => {
            const da = Math.abs(a.amount - computedBase);
            const db = Math.abs(b.amount - computedBase);
            if (Math.abs(da - db) < 0.05) return a.index - b.index;
            return da - db;
          })[0].amount;
    if (Math.abs(roundCurrency(parsed.total) - expectedTotal) > totalTolerance) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "APPLE_VISION_LOW_CONFIDENCE",
      });
    }
  }

  if (subtotalCandidates.length === 1) {
    const expectedSubtotal = subtotalCandidates[0];
    if (Math.abs(roundCurrency(parsed.subtotal) - expectedSubtotal) > componentTolerance) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "APPLE_VISION_LOW_CONFIDENCE",
      });
    }
  }

  if (taxCandidates.length === 1) {
    const expectedTax = taxCandidates[0];
    if (Math.abs(roundCurrency(parsed.tax) - expectedTax) > taxTolerance) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "APPLE_VISION_LOW_CONFIDENCE",
      });
    }
  }

  const meaningfulTipCandidates = getMeaningfulTipCandidates(tipCandidates);
  if (meaningfulTipCandidates.length === 0) return;

  const autoLike = meaningfulTipCandidates.filter((candidate) => looksLikeAutoGratuityLabel(candidate.label));
  const nonAuto = meaningfulTipCandidates.filter((candidate) => !looksLikeAutoGratuityLabel(candidate.label));
  if (nonAuto.length > 0 || autoLike.length === 0) {
    const expectedTip = deriveTipFromCandidates(meaningfulTipCandidates);
    if (
      Math.abs(roundCurrency(parsed.tip) - expectedTip) >
      Math.max(0.5, roundCurrency(Math.max(0, expectedTip) * 0.05))
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "APPLE_VISION_LOW_CONFIDENCE",
      });
    }
  }

  if (autoLike.length > 0 && nonAuto.length > 0) {
    const expectedAuto = roundCurrency(Math.max(...autoLike.map((candidate) => candidate.amount)));
    const expectedAdditional = roundCurrency(Math.max(...nonAuto.map((candidate) => candidate.amount)));
    const actualAuto = roundCurrency(parsed.autoGratuity.autoGratuityAmount || 0);
    const actualAdditional = roundCurrency(parsed.autoGratuity.additionalTipAmount || 0);
    if (
      Math.abs(actualAuto - expectedAuto) > 0.5 ||
      Math.abs(actualAdditional - expectedAdditional) > 0.5
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "APPLE_VISION_LOW_CONFIDENCE",
      });
    }
  }
}

export const scansRouter = createTRPCRouter({
  scanStatus: protectedProcedure
    .query(async ({ ctx }) => getScanStatusForUser(ctx.userId)),
  refreshSubscriptionStatus: protectedProcedure
    .mutation(async ({ ctx }) => getScanStatusForUser(ctx.userId, { refreshRevenueCat: true })),
  parseReceiptText: protectedProcedure
    .input(scanTextInputSchema)
    .mutation(async ({ ctx, input }) => {
      const text = input.text.trim();
      const structuredLines: StructuredOcrLine[] = (input.lines || []).map((line) => ({
        text: line.text,
        confidence: typeof line.confidence === "number" ? line.confidence : null,
        boundingBox: line.boundingBox
          ? {
              x: line.boundingBox.x,
              y: line.boundingBox.y,
              width: line.boundingBox.width,
              height: line.boundingBox.height,
            }
          : null,
      }));
      const parseCacheKey = getParsedReceiptTextCacheKey(ctx.userId, text, structuredLines);

      const cachedParsed = readTimedCache(parsedReceiptTextCache, parseCacheKey);
      if (cachedParsed) {
        logScan("[scans.parseReceiptText] Returned cached parse result");
        return cachedParsed;
      }

      const inFlightParsed = parsedReceiptTextInFlight.get(parseCacheKey);
      if (inFlightParsed) {
        logScan("[scans.parseReceiptText] Waiting on in-flight parse for duplicate text");
        return await inFlightParsed;
      }

      const parsePromise = (async (): Promise<ParsedReceipt> => {
        try {
          const { monthKey, allowance } = await assertAndGetScanAllowance(ctx.userId);

          let parsed = parseReceiptTextWithVision(text, structuredLines);
          assertParsedReceiptHasMeaningfulData(parsed);
          if (input.source === "apple_vision") {
            // Only verify that labeled totals in the OCR text match what we parsed.
            // The structural complexity checks (line-rich + few items) have been removed
            // because they were designed to trigger cloud OCR fallback — which we don't want.
            assertAppleVisionLabeledAmountsConsistent(text, parsed);
          }

          // Best-effort: detect foreign currency and convert amounts to USD.
          const foreignCurrency = detectForeignCurrency(text);
          if (foreignCurrency) {
            const rate = await fetchUsdExchangeRate(foreignCurrency);
            if (rate) {
              logScan(`[scans.parseReceiptText] Converting ${foreignCurrency} → USD at rate ${rate}`);
              parsed = applyUsdConversion(parsed, rate, foreignCurrency);
            }
          }

          if (allowance.monthlyAllowance < Number.MAX_SAFE_INTEGER) {
            await store.incrementMonthlyScanUsage(ctx.userId, monthKey, 1);
          }

          const parsedWithMeta: ParsedReceipt = {
            ...parsed,
            _ocrMeta: {
              selectedSource: "apple_vision_text",
              visionParseAttempts: 0,
              visionTextFallbackCalls: 0,
              docAiAttempts: 0,
              estimatedOcrCostUsd: 0,
            },
          };
          console.info(
            `[ocr-metrics] user=${ctx.userId} source=apple_vision_text visionAttempts=0 visionTextFallbackCalls=0 docAiAttempts=0 estimatedOcrCostUsd=0 sourceHint=${input.source || "unknown"}`,
          );

          writeTimedCache(
            parsedReceiptTextCache,
            parseCacheKey,
            parsedWithMeta,
            PARSED_RECEIPT_CACHE_TTL_MS,
            PARSED_RECEIPT_CACHE_MAX_ENTRIES,
          );
          return parsedWithMeta;
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }
          logScanError("[scans.parseReceiptText] Failed", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "OCR_SCAN_FAILED",
          });
        }
      })();

      parsedReceiptTextInFlight.set(parseCacheKey, parsePromise);
      try {
        return await parsePromise;
      } finally {
        parsedReceiptTextInFlight.delete(parseCacheKey);
      }
    }),
  parseReceipt: protectedProcedure
    .input(scanInputSchema)
    .mutation(async ({ ctx, input }) => {
      const originalBase64 = input.imageBase64.replace(/^data:[^;]+;base64,/, "").trim();
      const requestedMimeType = input.mimeType || "image/jpeg";
      const scanRegion = normalizeScanRegion(input.scanRegion);
      const croppedInput = await cropImageBase64ToScanRegion(originalBase64, requestedMimeType, scanRegion);
      const base64 = croppedInput.base64;
      const mimeType = croppedInput.mimeType;
      const parseCacheKey = `${getParsedReceiptCacheKey(ctx.userId, base64, mimeType)}:${getScanRegionCacheKey(scanRegion)}`;

      if (croppedInput.wasCropped) {
        logScan(
          `[scans.parseReceipt] Cropped framed scan before OCR (${requestedMimeType} -> ${mimeType}, region=${getScanRegionCacheKey(scanRegion)})`,
        );
      }

      const cachedParsed = readTimedCache(parsedReceiptCache, parseCacheKey);
      if (cachedParsed) {
        logScan("[scans.parseReceipt] Returned cached parse result");
        return cachedParsed;
      }

      const inFlightParsed = parsedReceiptInFlight.get(parseCacheKey);
      if (inFlightParsed) {
        logScan("[scans.parseReceipt] Waiting on in-flight parse for duplicate image");
        return await inFlightParsed;
      }

      const parsePromise = (async (): Promise<ParsedReceipt> => {
        try {
          const { monthKey, allowance } = await assertAndGetScanAllowance(ctx.userId);

          let parsed: ParsedReceipt;
          let selectedSource: "vision" | "docai" = "vision";
          let visionParseAttempts = 0;
          let visionTextFallbackCalls = 0;
          let docAiAttempts = 0;
          const parseWithVisionTracked = async (): Promise<VisionParseResult> => {
            visionParseAttempts += 1;
            return await parseWithVision(base64, ({ usedTextFallback }) => {
              if (usedTextFallback) {
                visionTextFallbackCalls += 1;
              }
            });
          };
          const parseWithDocAiTracked = async (): Promise<ParsedReceipt | null> => {
            docAiAttempts += 1;
            return await parseWithDocAiIfConfigured(base64, mimeType);
          };
          if (OCR_ROUTING_MODE === "vision_only") {
            const visionResult = await parseWithVisionTracked();
            parsed = visionResult.parsed;
            logScan("[scans.parseReceipt] Parsed with Vision only mode");
            selectedSource = "vision";
          } else if (OCR_ROUTING_MODE === "vision_first_guarded") {
            let visionResult: VisionParseResult | null = null;
            let visionParsed: ParsedReceipt | null = null;
            let visionConsistency: ParseConsistency | null = null;
            try {
              visionResult = await parseWithVisionTracked();
              visionParsed = visionResult.parsed;
              visionConsistency = evaluateParseConsistency(visionParsed);
            } catch (visionError) {
              logScanError(
                "[scans.parseReceipt] Vision-first parse failed; trying Document AI fallback",
                visionError,
              );
            }

            let visionAccepted =
              visionParsed && visionConsistency
                ? isVisionParseAcceptable(visionParsed, visionConsistency)
                : false;
            if (visionAccepted && visionParsed && visionResult) {
              try {
                assertAppleVisionLabeledAmountsConsistent(visionResult.text, visionParsed);
                if (hasSuspiciousUnlabeledBottomAmounts(visionResult.text, visionParsed)) {
                  visionAccepted = false;
                  logScan(
                    "[scans.parseReceipt] Rejected Vision parse due to suspicious unlabeled bottom amount pattern",
                  );
                }
                const docAiFallbackReason = getVisionDocAiFallbackReason(
                  visionResult.text,
                  visionParsed,
                );
                if (docAiFallbackReason) {
                  visionAccepted = false;
                  logScan(
                    `[scans.parseReceipt] Rejected Vision parse to force Document AI cross-check (${docAiFallbackReason})`,
                  );
                }
              } catch (visionGuardError) {
                visionAccepted = false;
                logScanError(
                  "[scans.parseReceipt] Rejected Vision parse after text/amount consistency guard",
                  visionGuardError,
                );
              }
            }

            if (visionParsed && visionAccepted) {
              logScan(
                `[scans.parseReceipt] Parsed with Vision (quality gate pass, score=${visionConsistency!.score})`,
              );
              parsed = visionParsed;
              selectedSource = "vision";
            } else {
              try {
                const docAiParsed = await parseWithDocAiTracked();
                if (docAiParsed) {
                  if (visionParsed && visionConsistency) {
                    const docAiConsistency = evaluateParseConsistency(docAiParsed);
                    logScan(
                      `[scans.parseReceipt] Selected Document AI after Vision gate (vision score=${visionConsistency.score}, docai score=${docAiConsistency.score})`,
                    );
                    parsed = docAiParsed;
                    selectedSource = "docai";
                  } else {
                    logScan("[scans.parseReceipt] Parsed with Document AI (Vision unavailable)");
                    parsed = docAiParsed;
                    selectedSource = "docai";
                  }
                } else if (visionParsed) {
                  logScan("[scans.parseReceipt] Document AI not configured; using Vision parse");
                  parsed = visionParsed;
                  selectedSource = "vision";
                } else {
                  parsed = (await parseWithVisionTracked()).parsed;
                  logScan("[scans.parseReceipt] Parsed with Vision retry (Document AI unavailable)");
                  selectedSource = "vision";
                }
              } catch (docAiError) {
                logScanError(
                  "[scans.parseReceipt] Document AI fallback failed in vision-first mode",
                  docAiError,
                );
                if (visionParsed) {
                  logScan("[scans.parseReceipt] Falling back to Vision parse after Document AI error");
                  parsed = visionParsed;
                  selectedSource = "vision";
                } else {
                  parsed = (await parseWithVisionTracked()).parsed;
                  logScan("[scans.parseReceipt] Parsed with Vision retry after Document AI error");
                  selectedSource = "vision";
                }
              }
            }
          } else {
            try {
              const docAiParsed = await parseWithDocAiTracked();
              if (docAiParsed) {
                const docAiConsistency = evaluateParseConsistency(docAiParsed);
                if (docAiConsistency.isConsistent) {
                  logScan("[scans.parseReceipt] Parsed with Document AI");
                  parsed = docAiParsed;
                  selectedSource = "docai";
                } else {
                  logScan(
                    `[scans.parseReceipt] Document AI parse inconsistent (score=${docAiConsistency.score}, totalDelta=${docAiConsistency.totalDelta}, subtotalDelta=${docAiConsistency.subtotalDelta}). Trying Vision fallback.`,
                  );
                  let chosenParsed: ParsedReceipt = docAiParsed;
                  let chosenSource: "vision" | "docai" = "docai";
                  let chosenScore = docAiConsistency.score;

                  try {
                    const visionParsed = (await parseWithVisionTracked()).parsed;
                    const visionConsistency = evaluateParseConsistency(visionParsed);
                    if (visionConsistency.score + 0.001 < chosenScore) {
                      chosenParsed = visionParsed;
                      chosenSource = "vision";
                      chosenScore = visionConsistency.score;
                    }
                  } catch (visionFallbackError) {
                    logScanError(
                      "[scans.parseReceipt] Vision fallback after inconsistent Document AI parse failed",
                      visionFallbackError,
                    );
                  }

                  logScan(
                    `[scans.parseReceipt] Selected ${chosenSource === "docai" ? "Document AI" : "Vision fallback"} parse after consistency check (score=${chosenScore})`,
                  );
                  parsed = chosenParsed;
                  selectedSource = chosenSource;
                }
              } else {
                parsed = (await parseWithVisionTracked()).parsed;
                logScan("[scans.parseReceipt] Parsed with Vision fallback");
                selectedSource = "vision";
              }
            } catch (docAiError) {
              logScanError("[scans.parseReceipt] Document AI failed, falling back to Vision", docAiError);
              parsed = (await parseWithVisionTracked()).parsed;
              logScan("[scans.parseReceipt] Parsed with Vision fallback");
              selectedSource = "vision";
            }
          }

          assertParsedReceiptHasMeaningfulData(parsed);

          if (allowance.monthlyAllowance < Number.MAX_SAFE_INTEGER) {
            await store.incrementMonthlyScanUsage(ctx.userId, monthKey, 1);
          }

          const estimatedOcrCostUsd = roundCost(
            docAiAttempts * OCR_COST_DOCAI_PER_DOC +
            (visionParseAttempts + visionTextFallbackCalls) * OCR_COST_VISION_PER_CALL,
          );
          const parsedWithMeta: ParsedReceipt = {
            ...parsed,
            _ocrMeta: {
              selectedSource,
              visionParseAttempts,
              visionTextFallbackCalls,
              docAiAttempts,
              estimatedOcrCostUsd,
            },
          };
          console.info(
            `[ocr-metrics] user=${ctx.userId} source=${selectedSource} visionAttempts=${visionParseAttempts} visionTextFallbackCalls=${visionTextFallbackCalls} docAiAttempts=${docAiAttempts} estimatedOcrCostUsd=${estimatedOcrCostUsd}`,
          );

          writeTimedCache(
            parsedReceiptCache,
            parseCacheKey,
            parsedWithMeta,
            PARSED_RECEIPT_CACHE_TTL_MS,
            PARSED_RECEIPT_CACHE_MAX_ENTRIES,
          );
          return parsedWithMeta;
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }
          logScanError("[scans.parseReceipt] Failed", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "OCR_SCAN_FAILED",
          });
        }
      })();

      parsedReceiptInFlight.set(parseCacheKey, parsePromise);
      try {
        return await parsePromise;
      } finally {
        parsedReceiptInFlight.delete(parseCacheKey);
      }
    }),
});
