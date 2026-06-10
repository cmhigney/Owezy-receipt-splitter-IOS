/**
 * Pure, dependency-free geometry helpers for the receipt scan capture frame and
 * the OCR scan region. Kept free of React Native / Expo imports so the logic can
 * be unit-tested in plain Node (see scripts/scan-region-tests.mjs) and shared by
 * both the camera screen and the OCR pipeline.
 */

export type ScanRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Receipts are tall and narrow, so they overflow the capture guide vertically far
// more often than horizontally. We inflate the OCR region generously on the top and
// bottom (and a little on the sides) so item lines and totals that sit just past the
// on-screen guide are still read instead of being silently cropped away.
export const DEFAULT_SCAN_REGION_HORIZONTAL_MARGIN = 0.07;
export const DEFAULT_SCAN_REGION_VERTICAL_MARGIN = 0.18;

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeScanRegion(region: ScanRegion | null | undefined): ScanRegion | null {
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

/**
 * Grow a scan region outward by the given margins (as fractions of the whole
 * image), clamped to the [0, 1] unit square. Returns the original region if the
 * margins would collapse it.
 */
export function expandScanRegion(
  region: ScanRegion | null,
  horizontalMargin: number = DEFAULT_SCAN_REGION_HORIZONTAL_MARGIN,
  verticalMargin: number = DEFAULT_SCAN_REGION_VERTICAL_MARGIN,
): ScanRegion | null {
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

/**
 * Whether an OCR line's bounding box should be considered "inside" a scan region.
 * A line counts when its center is inside the region, or when a majority of its
 * area overlaps the region. Lines without geometry are always kept.
 */
export function boxFallsInsideScanRegion(
  box: BoundingBox | null | undefined,
  region: ScanRegion,
): boolean {
  if (!box) return true;

  const lineLeft = box.x;
  const lineTop = box.y;
  const lineRight = box.x + box.width;
  const lineBottom = box.y + box.height;
  const regionLeft = region.x;
  const regionTop = region.y;
  const regionRight = region.x + region.width;
  const regionBottom = region.y + region.height;

  const overlapWidth = Math.max(0, Math.min(lineRight, regionRight) - Math.max(lineLeft, regionLeft));
  const overlapHeight = Math.max(0, Math.min(lineBottom, regionBottom) - Math.max(lineTop, regionTop));
  const lineArea = Math.max(0.0001, box.width * box.height);
  const overlapArea = overlapWidth * overlapHeight;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const centerInside =
    centerX >= regionLeft && centerX <= regionRight && centerY >= regionTop && centerY <= regionBottom;

  return centerInside || overlapArea / lineArea >= 0.55;
}

/**
 * Map an on-screen capture-guide frame to a normalized region of the captured
 * image, accounting for the camera preview using "cover" (aspect-fill) scaling.
 */
export function mapPreviewFrameToImageRegion(params: {
  previewWidth: number;
  previewHeight: number;
  imageWidth: number;
  imageHeight: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
}): ScanRegion | null {
  const {
    previewWidth,
    previewHeight,
    imageWidth,
    imageHeight,
    frameX,
    frameY,
    frameWidth,
    frameHeight,
  } = params;

  if (
    ![previewWidth, previewHeight, imageWidth, imageHeight, frameWidth, frameHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
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
