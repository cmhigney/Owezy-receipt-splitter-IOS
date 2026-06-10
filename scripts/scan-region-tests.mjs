#!/usr/bin/env node
/**
 * scan-region-tests.mjs
 *
 * Tests the receipt capture-frame -> OCR scan-region -> line-filter geometry.
 * This is the path that decides which Apple Vision text lines reach the parser
 * after the user frames a receipt in the camera guide. The complaint we are
 * guarding against: a guide tighter than the receipt used to crop out the top
 * items and the bottom totals, so the parse came back wrong.
 *
 * Run: node scripts/scan-region-tests.mjs   (exit 0 = all pass)
 *
 * The pure helpers below MIRROR utils/scanGeometry.ts and the region selection
 * in utils/ocr.ts. Keep them in sync with production (same convention as
 * scripts/parser-unit-tests.mjs). Bounding boxes use a top-left origin with
 * normalized [0,1] coordinates, matching the native Apple Vision module output.
 */

// ─── mirror of utils/scanGeometry.ts ─────────────────────────────────────────
const DEFAULT_SCAN_REGION_HORIZONTAL_MARGIN = 0.07;
const DEFAULT_SCAN_REGION_VERTICAL_MARGIN = 0.18;

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeScanRegion(region) {
  if (!region) return null;
  const x = clampUnit(region.x);
  const y = clampUnit(region.y);
  const width = clampUnit(region.width);
  const height = clampUnit(region.height);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

function expandScanRegion(
  region,
  horizontalMargin = DEFAULT_SCAN_REGION_HORIZONTAL_MARGIN,
  verticalMargin = DEFAULT_SCAN_REGION_VERTICAL_MARGIN,
) {
  if (!region) return null;
  const h = Math.max(0, horizontalMargin);
  const v = Math.max(0, verticalMargin);
  const left = clampUnit(region.x - h);
  const top = clampUnit(region.y - v);
  const right = clampUnit(region.x + region.width + h);
  const bottom = clampUnit(region.y + region.height + v);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return region;
  return { x: left, y: top, width, height };
}

function boxFallsInsideScanRegion(box, region) {
  if (!box) return true;
  const lineRight = box.x + box.width;
  const lineBottom = box.y + box.height;
  const regionRight = region.x + region.width;
  const regionBottom = region.y + region.height;
  const overlapWidth = Math.max(0, Math.min(lineRight, regionRight) - Math.max(box.x, region.x));
  const overlapHeight = Math.max(0, Math.min(lineBottom, regionBottom) - Math.max(box.y, region.y));
  const lineArea = Math.max(0.0001, box.width * box.height);
  const overlapArea = overlapWidth * overlapHeight;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const centerInside =
    centerX >= region.x && centerX <= regionRight && centerY >= region.y && centerY <= regionBottom;
  return centerInside || overlapArea / lineArea >= 0.55;
}

function mapPreviewFrameToImageRegion(p) {
  const { previewWidth, previewHeight, imageWidth, imageHeight, frameX, frameY, frameWidth, frameHeight } = p;
  if (![previewWidth, previewHeight, imageWidth, imageHeight, frameWidth, frameHeight].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }
  const previewAspect = previewWidth / previewHeight;
  const imageAspect = imageWidth / imageHeight;
  let displayedWidth = previewWidth;
  let displayedHeight = previewHeight;
  let offsetX = 0;
  let offsetY = 0;
  if (imageAspect > previewAspect) {
    displayedHeight = previewHeight;
    displayedWidth = displayedHeight * imageAspect;
    offsetX = (displayedWidth - previewWidth) / 2;
  } else {
    displayedWidth = previewWidth;
    displayedHeight = displayedWidth / imageAspect;
    offsetY = (displayedHeight - previewHeight) / 2;
  }
  return {
    x: clampUnit((frameX + offsetX) / displayedWidth),
    y: clampUnit((frameY + offsetY) / displayedHeight),
    width: clampUnit(frameWidth / displayedWidth),
    height: clampUnit(frameHeight / displayedHeight),
  };
}

// ─── mirror of the region selection in utils/ocr.ts ──────────────────────────
function normalizeLineText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function lineLooksFinanciallyImportant(text) {
  const lower = text.toLowerCase();
  if (/\bsubtotal\b|\bsub total\b|\btax\b|\btip\b|\bgratuity\b|\bservice charge\b|\btotal\b|\bamount due\b|\bbalance due\b/.test(lower)) {
    return true;
  }
  return /\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?\s*$/.test(text);
}

function filterPayloadToScanRegion(payload, region) {
  if (!payload || !region) return payload;
  const lines = payload.lines.filter((line) => boxFallsInsideScanRegion(line.boundingBox, region));
  return { ...payload, lines, filteredLineCount: lines.length, text: lines.map((l) => l.text).join('\n') };
}

function financiallyImportantLineKeys(lines) {
  const keys = new Set();
  for (const line of lines) {
    if (lineLooksFinanciallyImportant(line.text)) keys.add(normalizeLineText(line.text).toLowerCase());
  }
  return keys;
}

function chooseOnDeviceRegionPayload(full, region) {
  if (!full || !region) return full;
  const filtered = filterPayloadToScanRegion(full, region);
  if (!filtered) return full;
  const fullImportant = financiallyImportantLineKeys(full.lines);
  const filteredImportant = financiallyImportantLineKeys(filtered.lines);
  let lostImportantLines = 0;
  for (const key of fullImportant) {
    if (!filteredImportant.has(key)) lostImportantLines += 1;
  }
  const keptRatio = full.lines.length > 0 ? filtered.lines.length / full.lines.length : 1;
  const droppedTooMuch = full.lines.length >= 6 && keptRatio < 0.5;
  if (lostImportantLines > 0 || droppedTooMuch) return full;
  return filtered;
}

// ─── test scaffolding ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function section(name) {
  console.log(`\n── ${name} ──`);
}
function check(label, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`);
  }
}

// Build a payload from [text, yTop] rows. All rows share a narrow centered column
// (x 0.30..0.70) like a real receipt photographed on a table, with small heights.
function makePayload(rows) {
  const lines = rows.map(([text, yTop]) => ({
    text,
    confidence: 0.9,
    boundingBox: { x: 0.3, y: yTop, width: 0.4, height: 0.03 },
  }));
  return { text: lines.map((l) => l.text).join('\n'), lines, rawLineCount: lines.length, filteredLineCount: lines.length };
}
function hasLine(payload, substr) {
  return payload.lines.some((l) => l.text.includes(substr));
}

// A capture guide that is SHORTER than the receipt — the funky-box scenario.
// Frame occupies the middle ~64% of the image vertically; receipt spans 0.03..0.97.
const tightFrameRegion = normalizeScanRegion({ x: 0.2, y: 0.18, width: 0.6, height: 0.64 });
const inflatedRegion = expandScanRegion(tightFrameRegion);

section('A. Long itemized receipt overflows a tight capture guide');
{
  const receipt = makePayload([
    ['THE RUSTIC TABLE', 0.04],
    ['Caesar Salad 12.50', 0.10],
    ['Grilled Salmon 26.00', 0.16],
    ['Ribeye Steak 38.00', 0.22],
    ['Pasta Primavera 18.50', 0.30],
    ['House Red Wine 24.00', 0.40],
    ['Sparkling Water 4.50', 0.52],
    ['Tiramisu 11.00', 0.64],
    ['Subtotal 134.50', 0.74],
    ['Tax 9.42', 0.82],
    ['TOTAL 143.91', 0.92],
  ]);

  // OLD behaviour: hard-crop to the tight guide.
  const oldFiltered = filterPayloadToScanRegion(receipt, tightFrameRegion);
  check('OLD tight crop loses the restaurant name (top)', !hasLine(oldFiltered, 'RUSTIC'));
  check('OLD tight crop loses the TOTAL (bottom)', !hasLine(oldFiltered, 'TOTAL 143.91'));
  check('OLD tight crop drops items', oldFiltered.lines.length < receipt.lines.length);

  // NEW behaviour: inflate the region, and fall back to full text when framing
  // would crop out financially-important lines.
  const chosen = chooseOnDeviceRegionPayload(receipt, inflatedRegion);
  check('NEW keeps the TOTAL line', hasLine(chosen, 'TOTAL 143.91'));
  check('NEW keeps the Subtotal line', hasLine(chosen, 'Subtotal 134.50'));
  check('NEW keeps every item (no silent drop)', chosen.lines.length === receipt.lines.length);
}

section('B. Short cafe receipt fully inside the guide → clean crop kept');
{
  const receipt = makePayload([
    ['BLUE BOTTLE COFFEE', 0.34],
    ['Latte 5.25', 0.42],
    ['Croissant 4.00', 0.50],
    ['Tax 0.83', 0.58],
    ['Total 10.08', 0.66],
  ]);
  const chosen = chooseOnDeviceRegionPayload(receipt, inflatedRegion);
  check('All 5 receipt lines retained', chosen.lines.length === 5);
  check('Total retained', hasLine(chosen, 'Total 10.08'));
}

section('C. Background clutter outside the guide is still cropped away');
{
  // A small receipt centered in the guide, with non-financial clutter at the very
  // top/bottom of the photo (e.g. another receipt / table text). Here the inflated
  // region does NOT reach the photo edges, so clutter is correctly dropped while
  // every real receipt line is kept.
  const smallReceiptFrame = normalizeScanRegion({ x: 0.2, y: 0.28, width: 0.6, height: 0.34 });
  const smallReceiptRegion = expandScanRegion(smallReceiptFrame);
  const receipt = makePayload([
    ['DINER 24', 0.30],
    ['Burger 14.00', 0.38],
    ['Fries 5.00', 0.46],
    ['Soda 3.00', 0.54],
    ['Subtotal 22.00', 0.62],
    ['Total 22.00', 0.70],
  ]);
  receipt.lines.push(
    { text: 'visit ourwebsite dot com', confidence: 0.9, boundingBox: { x: 0.02, y: 0.985, width: 0.3, height: 0.02 } },
    { text: 'follow us on social', confidence: 0.9, boundingBox: { x: 0.66, y: 0.01, width: 0.3, height: 0.02 } },
  );
  receipt.rawLineCount = receipt.lines.length;
  receipt.filteredLineCount = receipt.lines.length;

  const chosen = chooseOnDeviceRegionPayload(receipt, smallReceiptRegion);
  check('Clutter line 1 removed', !hasLine(chosen, 'ourwebsite'));
  check('Clutter line 2 removed', !hasLine(chosen, 'follow us'));
  check('All real receipt lines kept', hasLine(chosen, 'Total 22.00') && hasLine(chosen, 'Burger 14.00'));
}

section('D. expandScanRegion rescues near-edge lines');
{
  const justAboveFrame = { x: 0.3, y: tightFrameRegion.y - 0.05, width: 0.4, height: 0.03 };
  check('Line just above tight frame is excluded by tight region', !boxFallsInsideScanRegion(justAboveFrame, tightFrameRegion));
  check('Same line is included by inflated region', boxFallsInsideScanRegion(justAboveFrame, inflatedRegion));
}

section('E. mapPreviewFrameToImageRegion maps a centered guide sensibly');
{
  // 1080x1920 image shown in a 390x600 preview (cover/aspect-fill), guide centered.
  const region = mapPreviewFrameToImageRegion({
    previewWidth: 390,
    previewHeight: 600,
    imageWidth: 1080,
    imageHeight: 1920,
    frameX: 60,
    frameY: 120,
    frameWidth: 270,
    frameHeight: 432,
  });
  check('Region is produced', region !== null);
  check('Region stays within the image', region.x >= 0 && region.y >= 0 && region.x + region.width <= 1 && region.y + region.height <= 1);
  check('Region is roughly horizontally centered', Math.abs(region.x + region.width / 2 - 0.5) < 0.02);
  check('Region width is a sensible fraction', region.width > 0.4 && region.width < 0.9);
}

section('F. Degenerate inputs do not throw');
{
  check('null region → passthrough payload', chooseOnDeviceRegionPayload(makePayload([['X 1.00', 0.5]]), null).lines.length === 1);
  check('expandScanRegion(null) is null', expandScanRegion(null) === null);
  check('mapPreviewFrameToImageRegion bad input → null', mapPreviewFrameToImageRegion({ previewWidth: 0, previewHeight: 0, imageWidth: 0, imageHeight: 0, frameX: 0, frameY: 0, frameWidth: 0, frameHeight: 0 }) === null);
}

console.log('\n────────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
