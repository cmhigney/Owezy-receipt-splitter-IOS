import { requireOptionalNativeModule } from 'expo-modules-core';
import { NativeModules, Platform } from 'react-native';
import { ReceiptItem, AutoGratuityInfo } from '@/types';
import { generateId } from '@/utils/splitting';
import { trpcClient } from '@/lib/trpc';
import { getOptionalRuntimeValue, getRuntimeFlag } from '@/lib/runtimeConfig';

export type OCRResult = {
  restaurantName: string;
  items: ReceiptItem[];
  tax: number;
  tip: number;
  total: number;
  hasFees?: boolean;
  autoGratuity: AutoGratuityInfo;
};
export type OCRScanRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ParseReceiptImageOptions = {
  scanRegion?: OCRScanRegion;
};

const DEBUG_LOGS = typeof __DEV__ !== 'undefined' && __DEV__;
const CLIENT_PARSE_CACHE_TTL_MS = 15 * 60 * 1000;
const CLIENT_PARSE_CACHE_MAX_ENTRIES = 100;
const IOS_ON_DEVICE_OCR_ENABLED =
  Platform.OS === 'ios' && getRuntimeFlag('EXPO_PUBLIC_IOS_ON_DEVICE_OCR_ENABLED', 'iosOnDeviceOcrEnabled');
const IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS =
  !getOptionalRuntimeValue(
    'EXPO_PUBLIC_IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS',
    'iosOnDeviceOcrFallbackOnlyOnNoItems',
  ) || getRuntimeFlag(
    'EXPO_PUBLIC_IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS',
    'iosOnDeviceOcrFallbackOnlyOnNoItems',
  );
const IOS_ON_DEVICE_OCR_MIN_CONFIDENCE = Math.min(
  1,
  Math.max(
    0,
    Number(
      getOptionalRuntimeValue(
        'EXPO_PUBLIC_IOS_ON_DEVICE_OCR_MIN_CONFIDENCE',
        'iosOnDeviceOcrMinConfidence',
      ) ?? 0.22,
    ) || 0.22,
  ),
);
const OCR_PARSE_TIMEOUT_MS = Math.max(
  5000,
  Number(
    getOptionalRuntimeValue('EXPO_PUBLIC_OCR_PARSE_TIMEOUT_MS', 'ocrParseTimeoutMs') ?? 12000,
  ) || 12000,
);
type TimedClientCacheEntry = {
  result: OCRResult;
  expiresAtMs: number;
};
type AppleVisionLine = {
  text: string;
  confidence: number | null;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};
type NormalizedOnDeviceOcrPayload = {
  text: string;
  lines: AppleVisionLine[];
  rawLineCount: number;
  filteredLineCount: number;
  averageConfidence: number | null;
};
type AppleVisionExtractionResult =
  | {
      status: 'ok';
      payload: NormalizedOnDeviceOcrPayload;
    }
  | {
      status: 'empty' | 'unavailable';
      payload: null;
    };
type AppleVisionOCRModuleType = {
  recognizeText: (imageUri: string) => Promise<unknown>;
  isAvailable?: () => boolean | Promise<boolean>;
};
const clientParseCache = new Map<string, TimedClientCacheEntry>();
const parseInFlightByImageKey = new Map<string, Promise<OCRResult>>();
type BackendParsedItem = { name: string; price: number; quantity: number };
type BackendParsedReceipt = {
  restaurantName?: string;
  items: BackendParsedItem[];
  tax?: number;
  tip?: number;
  total?: number;
  autoGratuity?: Partial<AutoGratuityInfo> | null;
  _ocrMeta?: {
    selectedSource?: string;
    estimatedOcrCostUsd?: number;
  } | null;
  _normalized?: {
    receiptType?: string;
    documentValidity?: string;
    reviewRequired?: boolean;
    reviewReasons?: string[];
    fraudFlags?: string[];
    isOpenTab?: boolean;
    isMerchantCopy?: boolean;
    isSplitCheck?: boolean;
    checkNumber?: string;
    totalChecks?: number;
    taxIncluded?: boolean;
    feeTotalForMath?: number;
    mandatoryChargeTotalForMath?: number;
    optionalTipAmount?: number;
    actualTaxTotal?: number;
    calculationCheckPassed?: boolean;
    calculationDelta?: number;
    parserVersion?: string;
    fees?: { type: string; label: string; amount: number }[];
    discounts?: { type: string; label: string; amount: number }[];
    mandatoryCharges?: { type: string; label: string; amount: number }[];
    taxesDetail?: { type: string; label: string; amount: number }[];
  } | null;
};

function debugLog(...args: unknown[]) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

function createTraceId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function hashStringFnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cloneOcrResult(input: OCRResult): OCRResult {
  return {
    restaurantName: input.restaurantName,
    items: input.items.map((item) => ({
      ...item,
      assignedTo: [...item.assignedTo],
    })),
    tax: input.tax,
    tip: input.tip,
    total: input.total,
    hasFees: input.hasFees,
    autoGratuity: { ...input.autoGratuity },
  };
}

function readClientParseCache(key: string): OCRResult | null {
  const entry = clientParseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    clientParseCache.delete(key);
    return null;
  }
  return cloneOcrResult(entry.result);
}

function writeClientParseCache(key: string, result: OCRResult) {
  while (clientParseCache.size >= CLIENT_PARSE_CACHE_MAX_ENTRIES) {
    const firstKey = clientParseCache.keys().next().value;
    if (!firstKey) break;
    clientParseCache.delete(firstKey);
  }
  clientParseCache.set(key, {
    result: cloneOcrResult(result),
    expiresAtMs: Date.now() + CLIENT_PARSE_CACHE_TTL_MS,
  });
}

function detectMimeTypeFromUri(uri: string): string {
  const cleaned = uri.split('?')[0].split('#')[0].toLowerCase();
  if (cleaned.endsWith('.png')) return 'image/png';
  if (cleaned.endsWith('.webp')) return 'image/webp';
  if (cleaned.endsWith('.heic')) return 'image/heic';
  if (cleaned.endsWith('.heif')) return 'image/heif';
  if (cleaned.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

async function imageUriToBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  const { File: ExpoFile } = await import('expo-file-system');
  const file = new ExpoFile(uri);
  return file.base64();
}

function normalizeLineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeScanRegion(region: OCRScanRegion | undefined): OCRScanRegion | null {
  if (!region) return null;
  const x = clampUnit(region.x);
  const y = clampUnit(region.y);
  const width = clampUnit(region.width);
  const height = clampUnit(region.height);
  if (width <= 0 || height <= 0) return null;
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

function normalizeBoundingBox(value: unknown): AppleVisionLine['boundingBox'] {
  if (!value || typeof value !== 'object') return null;
  const x = Number((value as { x?: unknown }).x);
  const y = Number((value as { y?: unknown }).y);
  const width = Number((value as { width?: unknown }).width);
  const height = Number((value as { height?: unknown }).height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x,
    y,
    width,
    height,
  };
}

function normalizeStructuredAppleVisionLine(entry: unknown): AppleVisionLine | null {
  if (typeof entry === 'string') {
    const text = normalizeLineText(entry);
    if (!text) return null;
    return {
      text,
      confidence: null,
      boundingBox: null,
    };
  }
  if (!entry || typeof entry !== 'object') return null;

  const text = normalizeLineText(String((entry as { text?: unknown }).text || ''));
  if (!text) return null;

  const rawConfidence = Number((entry as { confidence?: unknown }).confidence);
  return {
    text,
    confidence: Number.isFinite(rawConfidence) ? rawConfidence : null,
    boundingBox: normalizeBoundingBox((entry as { boundingBox?: unknown }).boundingBox),
  };
}

function sortAppleVisionLines(lines: AppleVisionLine[]): AppleVisionLine[] {
  const boxedLines = lines.filter(
    (line): line is AppleVisionLine & { boundingBox: NonNullable<AppleVisionLine['boundingBox']> } =>
      Boolean(line.boundingBox),
  );
  let verticalCount = 0;
  let horizontalCount = 0;
  for (const line of boxedLines) {
    const { width, height } = line.boundingBox;
    if (height >= width * 1.2) {
      verticalCount += 1;
    } else if (width >= height * 1.2) {
      horizontalCount += 1;
    }
  }
  const treatAsVertical =
    verticalCount > horizontalCount && verticalCount >= Math.max(2, Math.floor(boxedLines.length * 0.45));

  return [...lines].sort((left, right) => {
    const leftBox = left.boundingBox;
    const rightBox = right.boundingBox;
    if (!leftBox && !rightBox) return left.text.localeCompare(right.text);
    if (!leftBox) return 1;
    if (!rightBox) return -1;

    if (treatAsVertical) {
      const columnTolerance = Math.max(leftBox.width, rightBox.width, 0.012) * 0.5;
      const horizontalDelta = leftBox.x - rightBox.x;
      if (Math.abs(horizontalDelta) <= columnTolerance) {
        return rightBox.y - leftBox.y;
      }
      return horizontalDelta;
    }

    const rowTolerance = Math.max(leftBox.height, rightBox.height, 0.012) * 0.5;
    const verticalDelta = leftBox.y - rightBox.y;
    if (Math.abs(verticalDelta) <= rowTolerance) {
      return leftBox.x - rightBox.x;
    }
    return verticalDelta;
  });
}

function dedupeAppleVisionLines(lines: AppleVisionLine[]): AppleVisionLine[] {
  const deduped: AppleVisionLine[] = [];
  for (const line of lines) {
    const normalizedText = normalizeLineText(line.text).toLowerCase();
    const duplicateIndex = deduped.findIndex((existing) => {
      if (normalizeLineText(existing.text).toLowerCase() !== normalizedText) return false;
      if (!line.boundingBox || !existing.boundingBox) return false;

      const existingLeft = existing.boundingBox.x;
      const existingTop = existing.boundingBox.y;
      const existingRight = existing.boundingBox.x + existing.boundingBox.width;
      const existingBottom = existing.boundingBox.y + existing.boundingBox.height;

      const nextLeft = line.boundingBox.x;
      const nextTop = line.boundingBox.y;
      const nextRight = line.boundingBox.x + line.boundingBox.width;
      const nextBottom = line.boundingBox.y + line.boundingBox.height;

      const overlapWidth = Math.max(0, Math.min(existingRight, nextRight) - Math.max(existingLeft, nextLeft));
      const overlapHeight = Math.max(0, Math.min(existingBottom, nextBottom) - Math.max(existingTop, nextTop));
      const minWidth = Math.max(0.0001, Math.min(existing.boundingBox.width, line.boundingBox.width));
      const minHeight = Math.max(0.0001, Math.min(existing.boundingBox.height, line.boundingBox.height));

      return overlapWidth / minWidth >= 0.8 && overlapHeight / minHeight >= 0.8;
    });
    if (duplicateIndex < 0) {
      deduped.push(line);
      continue;
    }

    const existing = deduped[duplicateIndex];
    const existingConfidence = existing.confidence ?? -1;
    const nextConfidence = line.confidence ?? -1;
    if (nextConfidence > existingConfidence) {
      deduped[duplicateIndex] = line;
    }
  }
  return deduped;
}

function lineFallsInsideScanRegion(line: AppleVisionLine, scanRegion: OCRScanRegion): boolean {
  const box = line.boundingBox;
  if (!box) return true;

  const lineLeft = box.x;
  const lineTop = box.y;
  const lineRight = box.x + box.width;
  const lineBottom = box.y + box.height;
  const regionLeft = scanRegion.x;
  const regionTop = scanRegion.y;
  const regionRight = scanRegion.x + scanRegion.width;
  const regionBottom = scanRegion.y + scanRegion.height;

  const overlapWidth = Math.max(0, Math.min(lineRight, regionRight) - Math.max(lineLeft, regionLeft));
  const overlapHeight = Math.max(0, Math.min(lineBottom, regionBottom) - Math.max(lineTop, regionTop));
  const lineArea = Math.max(0.0001, box.width * box.height);
  const overlapArea = overlapWidth * overlapHeight;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const centerInside =
    centerX >= regionLeft &&
    centerX <= regionRight &&
    centerY >= regionTop &&
    centerY <= regionBottom;

  return centerInside || overlapArea / lineArea >= 0.55;
}

function filterPayloadToScanRegion(
  payload: NormalizedOnDeviceOcrPayload | null,
  scanRegion: OCRScanRegion | null,
) : NormalizedOnDeviceOcrPayload | null {
  if (!payload || !scanRegion) return payload;
  const filteredLines = payload.lines.filter((line) => lineFallsInsideScanRegion(line, scanRegion));
  const confidenceValues = filteredLines
    .map((line) => line.confidence)
    .filter((value): value is number => typeof value === 'number');

  return {
    text: filteredLines.map((entry) => entry.text).join('\n').trim(),
    lines: filteredLines,
    rawLineCount: payload.rawLineCount,
    filteredLineCount: filteredLines.length,
    averageConfidence:
      confidenceValues.length > 0
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : null,
  };
}

function lineLooksFinanciallyImportant(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    /\bsubtotal\b|\bsub total\b|\btax\b|\btip\b|\bgratuity\b|\bservice charge\b|\btotal\b|\bamount due\b|\bbalance due\b/.test(
      lower,
    )
  ) {
    return true;
  }

  return /\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?\s*$/.test(text);
}

function countAmountLikeAppleVisionLines(lines: AppleVisionLine[]): number {
  return lines.filter((line) => /\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?\s*$/.test(line.text)).length;
}

function countReceiptPricedLines(lines: AppleVisionLine[]): number {
  return lines.filter((line) =>
    /[a-z].*\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})\s*$/i.test(normalizeLineText(line.text)),
  ).length;
}

function countStrictReceiptAmountLines(lines: AppleVisionLine[]): number {
  return lines.filter((line) =>
    /\$?\d{1,6}(?:,\d{3})*\.\d{2}\b/.test(normalizeLineText(line.text)),
  ).length;
}

function countAlphaRichLines(lines: AppleVisionLine[]): number {
  return lines.filter((line) => /[a-z]{3,}/i.test(normalizeLineText(line.text))).length;
}

function countReceiptKeywordMatches(text: string): number {
  const lower = text.toLowerCase();
  const patterns = [
    /\bsubtotal\b/,
    /\bsub total\b/,
    /\btax\b/,
    /\btip\b/,
    /\bgratuity\b/,
    /\bservice charge\b/,
    /\btotal\b/,
    /\bamount due\b/,
    /\bbalance due\b/,
    /\bchange\b/,
    /\bcash\b/,
    /\bcredit\b/,
    /\bdebit\b/,
    /\bvisa\b/,
    /\bmastercard\b/,
    /\bamex\b/,
    /\btable\b/,
    /\bserver\b/,
    /\bguest\b/,
    /\breceipt\b/,
    /\bcheck\b/,
  ];

  return patterns.reduce((count, pattern) => count + (pattern.test(lower) ? 1 : 0), 0);
}

function shouldFastRejectAsNonReceipt(payload: NormalizedOnDeviceOcrPayload): boolean {
  if (!payload.text.trim()) return true;

  const keywordCount = countReceiptKeywordMatches(payload.text);
  const amountLineCount = countAmountLikeAppleVisionLines(payload.lines);
  const strictAmountLineCount = countStrictReceiptAmountLines(payload.lines);
  const pricedLineCount = countReceiptPricedLines(payload.lines);
  const alphaRichLineCount = countAlphaRichLines(payload.lines);
  const condensedLength = payload.text.replace(/\s+/g, '').length;

  if (!condensedLength || (condensedLength < 16 && keywordCount === 0 && strictAmountLineCount === 0)) {
    return true;
  }

  if (keywordCount >= 2) {
    return false;
  }

  if (keywordCount >= 1 && (strictAmountLineCount >= 1 || pricedLineCount >= 1 || payload.filteredLineCount >= 4)) {
    return false;
  }

  if (pricedLineCount >= 1 && strictAmountLineCount >= 1) {
    return false;
  }

  if (strictAmountLineCount >= 2 && alphaRichLineCount >= 2) {
    return false;
  }

  if (amountLineCount >= 3 && alphaRichLineCount >= 3) {
    return false;
  }

  if (payload.filteredLineCount <= 2 && amountLineCount === 0) {
    return true;
  }

  if (payload.filteredLineCount >= 4) {
    return keywordCount === 0 && strictAmountLineCount === 0 && pricedLineCount === 0;
  }

  return false;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function shouldFallbackFromOnDeviceParse(
  payload: NormalizedOnDeviceOcrPayload,
  result: BackendParsedReceipt,
): boolean {
  const itemCount = Array.isArray(result.items) ? result.items.length : 0;
  const fallbackItemCount = (result.items || []).filter(
    (item) => normalizeLineText(String(item?.name || '')).toLowerCase() === 'receipt items',
  ).length;
  if (fallbackItemCount === 0 || itemCount > 2) {
    return false;
  }

  const amountLineCount = countAmountLikeAppleVisionLines(payload.lines);
  const lineRichReceipt = payload.filteredLineCount >= 14 || amountLineCount >= 5;
  const stronglyLineRichReceipt = payload.filteredLineCount >= 20 || amountLineCount >= 7;

  if (stronglyLineRichReceipt) {
    return true;
  }

  return lineRichReceipt && amountLineCount >= itemCount + 3;
}

function normalizeOnDeviceTextPayload(raw: unknown): NormalizedOnDeviceOcrPayload {
  if (typeof raw === 'string') {
    const text = raw.trim();
    const lineCount = text ? text.split(/\r?\n/).filter((line) => line.trim()).length : 0;
    return {
      text,
      lines: text
        .split(/\r?\n/)
        .map((entry) => normalizeStructuredAppleVisionLine(entry))
        .filter((entry): entry is AppleVisionLine => Boolean(entry)),
      rawLineCount: lineCount,
      filteredLineCount: lineCount,
      averageConfidence: null,
    };
  }
  if (Array.isArray(raw)) {
    const lines = raw
      .map(normalizeStructuredAppleVisionLine)
      .filter((entry): entry is AppleVisionLine => Boolean(entry));
    const text = lines.map((entry) => entry.text).join('\n').trim();
    return {
      text,
      lines,
      rawLineCount: lines.length,
      filteredLineCount: lines.length,
      averageConfidence: null,
    };
  }
  if (raw && typeof raw === 'object') {
    const maybeLines = (raw as { lines?: unknown }).lines;
    if (Array.isArray(maybeLines)) {
      const normalizedLines = dedupeAppleVisionLines(
        sortAppleVisionLines(
          maybeLines
            .map(normalizeStructuredAppleVisionLine)
            .filter((entry): entry is AppleVisionLine => Boolean(entry)),
        ),
      );

      if (normalizedLines.length > 0) {
        const filteredByConfidence = normalizedLines.filter((line) => {
          if (lineLooksFinanciallyImportant(line.text)) return true;
          if (line.confidence === null) return true;
          return line.confidence >= IOS_ON_DEVICE_OCR_MIN_CONFIDENCE;
        });

        const selectedLines =
          filteredByConfidence.length >= Math.max(3, Math.ceil(normalizedLines.length * 0.4))
            ? filteredByConfidence
            : normalizedLines;
        const confidenceValues = selectedLines
          .map((line) => line.confidence)
          .filter((value): value is number => typeof value === 'number');
        const averageConfidence =
          confidenceValues.length > 0
            ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
            : null;

        return {
          text: selectedLines.map((entry) => entry.text).join('\n').trim(),
          lines: selectedLines,
          rawLineCount: normalizedLines.length,
          filteredLineCount: selectedLines.length,
          averageConfidence,
        };
      }
    }
    const maybeText = (raw as { text?: unknown }).text;
    if (typeof maybeText === 'string') {
      const text = maybeText.trim();
      return {
        text,
        lines: text
          .split(/\r?\n/)
          .map((entry) => normalizeStructuredAppleVisionLine(entry))
          .filter((entry): entry is AppleVisionLine => Boolean(entry)),
        rawLineCount: text ? text.split(/\r?\n/).filter((line) => line.trim()).length : 0,
        filteredLineCount: text ? text.split(/\r?\n/).filter((line) => line.trim()).length : 0,
        averageConfidence:
          typeof (raw as { averageConfidence?: unknown }).averageConfidence === 'number'
            ? Number((raw as { averageConfidence?: unknown }).averageConfidence)
            : null,
      };
    }
  }
  return {
    text: '',
    lines: [],
    rawLineCount: 0,
    filteredLineCount: 0,
    averageConfidence: null,
  };
}

function getAppleVisionOCRNativeModule(traceId: string): AppleVisionOCRModuleType | null {
  const rnNativeModule = (NativeModules as Record<string, unknown>)?.AppleVisionOCR as
    | AppleVisionOCRModuleType
    | undefined;
  if (rnNativeModule && typeof rnNativeModule.recognizeText === 'function') {
    return rnNativeModule;
  }

  const expoNativeModule = requireOptionalNativeModule<AppleVisionOCRModuleType>('AppleVisionOCR');
  if (expoNativeModule && typeof expoNativeModule.recognizeText === 'function') {
    return expoNativeModule;
  }

  debugLog(`[OCR][${traceId}] AppleVisionOCR expo module not registered`);

  return null;
}

async function tryExtractAppleVisionText(
  imageUri: string,
  traceId: string,
): Promise<AppleVisionExtractionResult> {
  if (!IOS_ON_DEVICE_OCR_ENABLED) {
    return { status: 'unavailable', payload: null };
  }
  const nativeModule = getAppleVisionOCRNativeModule(traceId);
  if (!nativeModule) {
    debugLog(`[OCR][${traceId}] AppleVisionOCR native module not available`);
    return { status: 'unavailable', payload: null };
  }

  try {
    if (typeof nativeModule.isAvailable === 'function') {
      const available = await Promise.resolve(nativeModule.isAvailable());
      if (!available) {
        debugLog(`[OCR][${traceId}] AppleVisionOCR reported unavailable`);
        return { status: 'unavailable', payload: null };
      }
    }

    const raw = await nativeModule.recognizeText(imageUri);
    const payload = normalizeOnDeviceTextPayload(raw);
    if (!payload.text) {
      debugLog(`[OCR][${traceId}] AppleVisionOCR returned empty text`);
      return { status: 'empty', payload: null };
    }
    debugLog(`[OCR][${traceId}] AppleVisionOCR text extracted`, {
      charCount: payload.text.length,
      lineCount: payload.filteredLineCount,
      rawLineCount: payload.rawLineCount,
      averageConfidence: payload.averageConfidence,
      // Full text logged in dev only — copy from console to receipt-tests/apple-vision-text/<name>.txt
      rawText: payload.text,
    });
    return { status: 'ok', payload };
  } catch (error) {
    debugLog(`[OCR][${traceId}] AppleVisionOCR extraction failed`, {
      message: String((error as any)?.message || error || ''),
    });
    return { status: 'unavailable', payload: null };
  }
}

function mapBackendParsedReceiptToOcrResult(result: BackendParsedReceipt): OCRResult {
  const items: ReceiptItem[] = result.items.map((item) => {
    const qty = item.quantity || 1;
    const name = qty > 1 ? `${item.name} (${qty})` : item.name;
    return {
      id: generateId(),
      name,
      price: Math.round(item.price * 100) / 100,
      assignedTo: [],
    };
  });

  const taxAmount = Math.round((result.tax || 0) * 100) / 100;
  const tipAmount = Math.round((result.tip || 0) * 100) / 100;
  const totalAmount = Math.round((result.total || 0) * 100) / 100;

  if (items.length === 0 && totalAmount === 0) {
    throw new Error('NO_ITEMS_OR_TOTAL');
  }

  return {
    restaurantName: result.restaurantName || 'Unknown Restaurant',
    items,
    tax: taxAmount,
    tip: tipAmount,
    total: totalAmount,
    hasFees: (result._normalized?.feeTotalForMath ?? 0) > 0,
    autoGratuity: {
      detected: Boolean(result.autoGratuity?.detected),
      partySizeMin:
        typeof result.autoGratuity?.partySizeMin === 'number'
          ? result.autoGratuity.partySizeMin
          : null,
      policyText:
        typeof result.autoGratuity?.policyText === 'string' && result.autoGratuity.policyText.trim().length > 0
          ? result.autoGratuity.policyText.trim()
          : null,
      includedInTotal: Boolean(result.autoGratuity?.includedInTotal),
      autoGratuityAmount:
        typeof result.autoGratuity?.autoGratuityAmount === 'number'
          ? Math.round(result.autoGratuity.autoGratuityAmount * 100) / 100
          : null,
      additionalTipAmount:
        typeof result.autoGratuity?.additionalTipAmount === 'number'
          ? Math.round(result.autoGratuity.additionalTipAmount * 100) / 100
          : null,
    },
  };
}

function shouldFallbackToCloudImageParse(error: unknown): boolean {
  const message = String((error as any)?.message || '');
  const code = String((error as any)?.data?.code || (error as any)?.shape?.data?.code || '');

  // Apple Vision got literally nothing — cloud is the only option.
  if (message.includes('NO_ITEMS_OR_TOTAL')) {
    return true;
  }
  // LOW_CONFIDENCE and other soft failures respect the fallback flag.
  // When IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS=1 (default), Apple Vision
  // results are always used as-is; cloud OCR is never called for quality reasons.
  if (!IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS && message.includes('APPLE_VISION_LOW_CONFIDENCE')) {
    return true;
  }
  if (!IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS && (message.includes('OCR_SCAN_FAILED') || code === 'INTERNAL_SERVER_ERROR')) {
    return true;
  }
  return false;
}

export async function parseReceiptImage(
  imageUri: string,
  options: ParseReceiptImageOptions = {},
): Promise<OCRResult> {
  const traceId = createTraceId('ocr');
  const startedAtMs = Date.now();
  const scanRegion = normalizeScanRegion(options.scanRegion);
  debugLog(`[OCR][${traceId}] Starting parse`, { imageUri, scanRegion });

  const mimeType = detectMimeTypeFromUri(imageUri);
  const scanRegionKey = scanRegion
    ? `${scanRegion.x.toFixed(4)}:${scanRegion.y.toFixed(4)}:${scanRegion.width.toFixed(4)}:${scanRegion.height.toFixed(4)}`
    : 'full';
  const imageKey = `${mimeType}:${hashStringFnv1a32(imageUri)}:${scanRegionKey}`;

  const cachedResult = readClientParseCache(imageKey);
  if (cachedResult) {
    debugLog(`[OCR][${traceId}] Using cached parse result`, {
      imageKey,
      elapsedMs: Date.now() - startedAtMs,
    });
    return cachedResult;
  }

  const inFlight = parseInFlightByImageKey.get(imageKey);
  if (inFlight) {
    debugLog(`[OCR][${traceId}] Waiting on in-flight parse request`, {
      imageKey,
      elapsedMs: Date.now() - startedAtMs,
    });
    return await inFlight;
  }

  const parsePromise = (async (): Promise<OCRResult> => {
    try {
      debugLog(`[OCR][${traceId}] Sending parse request`, {
        mimeType,
        imageKey,
      });
      let backendResult: BackendParsedReceipt;
      let usedOnDevicePath = false;
      let base64: string | null = null;
      const getBase64 = async (): Promise<string> => {
        if (base64) {
          return base64;
        }

        base64 = await imageUriToBase64(imageUri);
        debugLog(`[OCR][${traceId}] Image encoded`, {
          mimeType,
          base64Length: base64.length,
          imageKey,
          elapsedMs: Date.now() - startedAtMs,
        });
        return base64;
      };
      const onDeviceAttempt = await tryExtractAppleVisionText(imageUri, traceId);
      let onDevicePayload = filterPayloadToScanRegion(onDeviceAttempt.payload, scanRegion);

      if (onDeviceAttempt.status === 'empty') {
        if (scanRegion) {
          debugLog(`[OCR][${traceId}] Apple Vision found no readable framed text; falling back to cropped cloud OCR`, {
            elapsedMs: Date.now() - startedAtMs,
          });
          onDevicePayload = null;
        } else {
          debugLog(`[OCR][${traceId}] Apple Vision found no readable receipt text; stopping before cloud OCR`, {
            elapsedMs: Date.now() - startedAtMs,
          });
          throw new Error('NOT_A_RECEIPT');
        }
      }

      if (onDevicePayload) {
        if (shouldFastRejectAsNonReceipt(onDevicePayload)) {
          if (scanRegion) {
            debugLog(`[OCR][${traceId}] Framed Apple Vision OCR looked suspicious; falling back to cropped cloud OCR`, {
              filteredLineCount: onDevicePayload.filteredLineCount,
              amountLineCount: countAmountLikeAppleVisionLines(onDevicePayload.lines),
              pricedLineCount: countReceiptPricedLines(onDevicePayload.lines),
              keywordMatches: countReceiptKeywordMatches(onDevicePayload.text),
              elapsedMs: Date.now() - startedAtMs,
            });
            onDevicePayload = null;
          } else {
            debugLog(`[OCR][${traceId}] On-device OCR does not look like a receipt; stopping early`, {
              filteredLineCount: onDevicePayload.filteredLineCount,
              amountLineCount: countAmountLikeAppleVisionLines(onDevicePayload.lines),
              pricedLineCount: countReceiptPricedLines(onDevicePayload.lines),
              keywordMatches: countReceiptKeywordMatches(onDevicePayload.text),
              elapsedMs: Date.now() - startedAtMs,
            });
            throw new Error('NOT_A_RECEIPT');
          }
        }
      }

      if (onDevicePayload) {
        try {
          backendResult = await withTimeout(
            trpcClient.scans.parseReceiptText.mutate({
              text: onDevicePayload.text,
              source: 'apple_vision',
              lines: onDevicePayload.lines,
            }),
            OCR_PARSE_TIMEOUT_MS,
            'OCR_TIMEOUT',
          );
          usedOnDevicePath = true;
          // Only fall back to cloud image parse when the flag explicitly allows it.
          // Default (IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS=1) keeps Apple Vision
          // results and never calls the expensive cloud OCR path for quality reasons.
          if (!IOS_ON_DEVICE_OCR_FALLBACK_ONLY_ON_NO_ITEMS && shouldFallbackFromOnDeviceParse(onDevicePayload, backendResult)) {
            debugLog(`[OCR][${traceId}] On-device OCR parse looked under-structured, falling back to image parse`, {
              itemCount: backendResult.items.length,
              fallbackItems: backendResult.items
                .filter((item) => normalizeLineText(String(item?.name || '')).toLowerCase() === 'receipt items')
                .length,
              filteredLineCount: onDevicePayload.filteredLineCount,
              amountLineCount: countAmountLikeAppleVisionLines(onDevicePayload.lines),
            });
            backendResult = await withTimeout(
              trpcClient.scans.parseReceipt.mutate({
                imageBase64: await getBase64(),
                mimeType,
                scanRegion: scanRegion ?? undefined,
              }),
              OCR_PARSE_TIMEOUT_MS,
              'OCR_TIMEOUT',
            );
            usedOnDevicePath = false;
          }
        } catch (onDeviceParseError) {
          if (!shouldFallbackToCloudImageParse(onDeviceParseError)) {
            throw onDeviceParseError;
          }
          debugLog(`[OCR][${traceId}] On-device OCR parse failed, falling back to image parse`, {
            message: String((onDeviceParseError as any)?.message || ''),
            averageConfidence: onDevicePayload.averageConfidence,
            rawLineCount: onDevicePayload.rawLineCount,
            filteredLineCount: onDevicePayload.filteredLineCount,
            scanRegion,
          });
          backendResult = await withTimeout(
            trpcClient.scans.parseReceipt.mutate({
              imageBase64: await getBase64(),
              mimeType,
              scanRegion: scanRegion ?? undefined,
            }),
            OCR_PARSE_TIMEOUT_MS,
            'OCR_TIMEOUT',
          );
        }
      } else {
        backendResult = await withTimeout(
          trpcClient.scans.parseReceipt.mutate({
            imageBase64: await getBase64(),
            mimeType,
            scanRegion: scanRegion ?? undefined,
          }),
          OCR_PARSE_TIMEOUT_MS,
          'OCR_TIMEOUT',
        );
      }

      const parsedResult = mapBackendParsedReceiptToOcrResult(backendResult);
      const sourceMeta = backendResult._ocrMeta?.selectedSource || (usedOnDevicePath ? 'apple_vision_text' : 'cloud_ocr');
      debugLog(`[OCR][${traceId}] Parse response summary`, {
        restaurantName: parsedResult.restaurantName,
        itemCount: parsedResult.items.length,
        sampleItems: parsedResult.items.slice(0, 3).map((item) => `${item.name}: ${item.price}`),
        tax: parsedResult.tax,
        tip: parsedResult.tip,
        total: parsedResult.total,
        autoGratuityDetected: Boolean(parsedResult.autoGratuity?.detected),
        autoGratuityPartySizeMin:
          typeof parsedResult.autoGratuity?.partySizeMin === 'number' ? parsedResult.autoGratuity.partySizeMin : null,
        autoGratuityAmount:
          typeof parsedResult.autoGratuity?.autoGratuityAmount === 'number'
            ? Math.round(parsedResult.autoGratuity.autoGratuityAmount * 100) / 100
            : null,
        additionalTipAmount:
          typeof parsedResult.autoGratuity?.additionalTipAmount === 'number'
            ? Math.round(parsedResult.autoGratuity.additionalTipAmount * 100) / 100
            : null,
        source: sourceMeta,
        estimatedOcrCostUsd: backendResult._ocrMeta?.estimatedOcrCostUsd ?? null,
        elapsedMs: Date.now() - startedAtMs,
      });

      writeClientParseCache(imageKey, parsedResult);
      return parsedResult;
    } catch (error: any) {
      const message = String(error?.message || '');
      const code = String(error?.data?.code || error?.shape?.data?.code || '');
      const elapsedMs = Date.now() - startedAtMs;

      debugLog(`[OCR][${traceId}] Parse failed`, {
        message,
        code,
        elapsedMs,
      });

      if (message.includes('FREE_SCAN_LIMIT_REACHED')) {
        throw new Error('FREE_SCAN_LIMIT_REACHED');
      }
      if (message.includes('SCAN_CREDIT_LIMIT_REACHED')) {
        throw new Error('SCAN_CREDIT_LIMIT_REACHED');
      }
      if (message.includes('NOT_A_RECEIPT')) {
        throw new Error('NOT_A_RECEIPT');
      }
      if (message.includes('NO_ITEMS_OR_TOTAL')) {
        throw new Error('NO_ITEMS_OR_TOTAL');
      }
      if (message.includes('OCR_TIMEOUT')) {
        throw new Error('SCAN_TIMEOUT');
      }
      if (
        code === 'UNAUTHORIZED' ||
        message.includes('UNAUTHORIZED') ||
        message.includes('Not authenticated') ||
        message.includes('401')
      ) {
        throw new Error('AUTH_REQUIRED');
      }
      if (message.includes('Network request failed') || message.includes('Failed to fetch')) {
        throw new Error('BACKEND_UNREACHABLE');
      }
      throw new Error('OCR_SCAN_FAILED');
    }
  })();

  parseInFlightByImageKey.set(imageKey, parsePromise);
  try {
    return await parsePromise;
  } finally {
    parseInFlightByImageKey.delete(imageKey);
  }
}
