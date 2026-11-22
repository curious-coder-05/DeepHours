import {
  MAX_IMAGE_PIXEL_DIMENSION,
  MAX_IMAGE_TOTAL_PIXELS,
  validateImageFileSignature,
  validateImagePixelBounds,
  validateRasterImageMetadata,
  type AllowedRasterImageMime,
} from './security.ts';

export const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
export const TARGET_BLOB_BYTES = 150 * 1024;
export const MAX_OUTPUT_WIDTH = 1080;
export const MAX_OUTPUT_HEIGHT = 2400;
export const WORKING_MAX_LONG_SIDE = 2048;
export const MIN_CROP_SIZE_PX = 64;
export { MAX_IMAGE_PIXEL_DIMENSION, MAX_IMAGE_TOTAL_PIXELS };

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VaultImageOptions {
  grayscale: boolean;
  enhanceText: boolean;
}

export interface ProcessedVaultImage {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  mime: string;
}

export interface SizeGuardStep {
  quality: number;
  maxWidth: number;
}

export function getSizeGuardSteps(): SizeGuardStep[] {
  return [
    { quality: 0.65, maxWidth: MAX_OUTPUT_WIDTH },
    { quality: 0.55, maxWidth: MAX_OUTPUT_WIDTH },
    { quality: 0.5, maxWidth: MAX_OUTPUT_WIDTH },
    { quality: 0.5, maxWidth: 960 },
    { quality: 0.5, maxWidth: 840 },
  ];
}

export function validateImageFileCandidate(file: {
  type?: string;
  size: number;
  name?: string;
}): { ok: boolean; reason?: string } {
  return validateRasterImageMetadata(file, MAX_IMAGE_FILE_BYTES);
}

/**
 * Verifies metadata AND binary file signature (JPEG / PNG / WebP magic bytes),
 * rejecting SVG, HTML, text, and spoofed extensions/MIME headers.
 */
export async function validateImageFileWithMagicBytes(
  file: Blob & { name?: string; type?: string }
): Promise<{
  ok: boolean;
  detectedMime?: AllowedRasterImageMime;
  reason?: string;
}> {
  return validateImageFileSignature(file, MAX_IMAGE_FILE_BYTES);
}

export function computeWorkingDimensions(
  srcWidth: number,
  srcHeight: number,
  maxLongSide = WORKING_MAX_LONG_SIDE
): { width: number; height: number; scale: number } {
  const safeW = Math.max(1, Math.round(srcWidth));
  const safeH = Math.max(1, Math.round(srcHeight));
  const longSide = Math.max(safeW, safeH);
  if (longSide <= maxLongSide) {
    return { width: safeW, height: safeH, scale: 1 };
  }
  const scale = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    scale,
  };
}

export function fitTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  maxWidth = MAX_OUTPUT_WIDTH,
  maxHeight = MAX_OUTPUT_HEIGHT
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(srcWidth));
  const safeH = Math.max(1, Math.round(srcHeight));
  const scale = Math.min(1, maxWidth / safeW, maxHeight / safeH);
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

export function clampCropRect(
  rect: CropRect,
  boundsWidth: number,
  boundsHeight: number,
  minSize = MIN_CROP_SIZE_PX
): CropRect {
  const maxW = Math.max(1, Math.round(boundsWidth));
  const maxH = Math.max(1, Math.round(boundsHeight));
  const effMinW = Math.min(minSize, maxW);
  const effMinH = Math.min(minSize, maxH);

  let w = Math.max(effMinW, Math.min(maxW, Math.round(rect.width)));
  let h = Math.max(effMinH, Math.min(maxH, Math.round(rect.height)));
  let x = Math.max(0, Math.min(maxW - w, Math.round(rect.x)));
  let y = Math.max(0, Math.min(maxH - h, Math.round(rect.y)));

  if (x + w > maxW) w = maxW - x;
  if (y + h > maxH) h = maxH - y;

  return { x, y, width: w, height: h };
}

export function getRotatedDimensions(
  width: number,
  height: number,
  rotationDeg: number
): { width: number; height: number } {
  const norm = ((rotationDeg % 360) + 360) % 360;
  if (norm === 90 || norm === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function computeLuminanceHistogramLevels(
  histogram: ArrayLike<number>,
  totalPixels: number
): { low: number; high: number } {
  if (totalPixels <= 0) return { low: 0, high: 255 };
  const lowTarget = totalPixels * 0.02;
  const highTarget = totalPixels * 0.98;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  let foundLow = false;

  for (let i = 0; i < 256; i++) {
    cumulative += histogram[i] || 0;
    if (!foundLow && cumulative >= lowTarget) {
      low = i;
      foundLow = true;
    }
    if (cumulative >= highTarget) {
      high = i;
      break;
    }
  }

  if (high <= low + 4) {
    return { low: 0, high: 255 };
  }
  return { low, high };
}

export function applyLevelsAndGrayscaleToRgba(
  data: Uint8ClampedArray,
  options: VaultImageOptions
): void {
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount <= 0) return;

  let low = 0;
  let high = 255;
  if (options.enhanceText) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.min(
        255,
        Math.max(0, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]))
      );
      hist[lum] += 1;
    }
    const levels = computeLuminanceHistogramLevels(hist, pixelCount);
    low = levels.low;
    high = levels.high;
  }

  const span = Math.max(1, high - low);
  const scale = options.enhanceText && (low > 0 || high < 255) ? 255 / span : 1;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (options.grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray;
      g = gray;
      b = gray;
    }

    if (scale !== 1) {
      r = Math.max(0, Math.min(255, (r - low) * scale));
      g = Math.max(0, Math.min(255, (g - low) * scale));
      b = Math.max(0, Math.min(255, (b - low) * scale));
    }

    data[i] = Math.round(r);
    data[i + 1] = Math.round(g);
    data[i + 2] = Math.round(b);
  }
}

export function resolveEncodedMimeFallback(returnedBlobType: string): {
  mime: 'image/webp' | 'image/jpeg';
  usedJpegFallback: boolean;
} {
  if ((returnedBlobType || '').toLowerCase() === 'image/webp') {
    return { mime: 'image/webp', usedJpegFallback: false };
  }
  return { mime: 'image/jpeg', usedJpegFallback: true };
}

export async function decodeImageFile(file: File): Promise<ImageBitmap | HTMLImageElement> {
  const sigCheck = await validateImageFileWithMagicBytes(file);
  if (!sigCheck.ok) {
    throw new Error(sigCheck.reason || 'Unsupported image file.');
  }

  let decoded: ImageBitmap | HTMLImageElement | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      decoded = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fallback to HTMLImageElement below
    }
  }
  if (!decoded) {
    const url = URL.createObjectURL(file);
    try {
      decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not decode selected image'));
        el.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const dims = getDecodedImageSize(decoded);
  const bounds = validateImagePixelBounds(dims.width, dims.height);
  if (!bounds.ok) {
    closeDecodedImage(decoded);
    throw new Error(bounds.reason || 'Image resolution exceeds safety limits.');
  }
  return decoded;
}

export function getDecodedImageSize(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ('naturalWidth' in source) {
    return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  }
  return { width: source.width, height: source.height };
}

export function closeDecodedImage(source: ImageBitmap | HTMLImageElement | null | undefined): void {
  if (!source) return;
  if ('close' in source && typeof source.close === 'function') {
    try {
      source.close();
    } catch {
      // ignore bitmap already closed
    }
  }
}

export function drawRotatedSourceToCanvas(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  rotationDeg: number,
  targetCanvas?: HTMLCanvasElement
): HTMLCanvasElement {
  const norm = ((rotationDeg % 360) + 360) % 360;
  const outDim = getRotatedDimensions(srcWidth, srcHeight, norm);
  const canvas = targetCanvas || document.createElement('canvas');
  canvas.width = outDim.width;
  canvas.height = outDim.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.save();
  ctx.translate(outDim.width / 2, outDim.height / 2);
  ctx.rotate((norm * Math.PI) / 180);
  ctx.drawImage(source, -srcWidth / 2, -srcHeight / 2, srcWidth, srcHeight);
  ctx.restore();
  return canvas;
}

function canvasToBlobPromise(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to encode image'));
        else resolve(blob);
      },
      mime,
      quality
    );
  });
}

export async function processVaultImageFromSource(
  source: ImageBitmap | HTMLImageElement,
  cropRectInRotatedWorking: CropRect,
  workingDims: { width: number; height: number },
  rotationDeg: number,
  options: VaultImageOptions
): Promise<ProcessedVaultImage> {
  const origSize = getDecodedImageSize(source);
  const rotatedOrigDims = getRotatedDimensions(origSize.width, origSize.height, rotationDeg);

  // Map crop rectangle from working coordinates to full-resolution rotated original coordinates
  const scaleX = rotatedOrigDims.width / Math.max(1, workingDims.width);
  const scaleY = rotatedOrigDims.height / Math.max(1, workingDims.height);
  const fullCrop = clampCropRect(
    {
      x: cropRectInRotatedWorking.x * scaleX,
      y: cropRectInRotatedWorking.y * scaleY,
      width: cropRectInRotatedWorking.width * scaleX,
      height: cropRectInRotatedWorking.height * scaleY,
    },
    rotatedOrigDims.width,
    rotatedOrigDims.height,
    1
  );

  // First draw rotated original onto temp canvas only if rotated, otherwise crop directly
  let rotatedCanvas: HTMLCanvasElement | null = null;
  const norm = ((rotationDeg % 360) + 360) % 360;
  let cropSource: CanvasImageSource = source;
  if (norm !== 0) {
    rotatedCanvas = drawRotatedSourceToCanvas(
      source,
      origSize.width,
      origSize.height,
      norm
    );
    cropSource = rotatedCanvas;
  }

  const steps = getSizeGuardSteps();
  let lastResult: ProcessedVaultImage | null = null;

  for (const step of steps) {
    const fitted = fitTargetDimensions(
      fullCrop.width,
      fullCrop.height,
      step.maxWidth,
      MAX_OUTPUT_HEIGHT
    );

    const outCanvas = document.createElement('canvas');
    outCanvas.width = fitted.width;
    outCanvas.height = fitted.height;
    const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.drawImage(
      cropSource,
      fullCrop.x,
      fullCrop.y,
      fullCrop.width,
      fullCrop.height,
      0,
      0,
      fitted.width,
      fitted.height
    );

    if (options.grayscale || options.enhanceText) {
      const imgData = ctx.getImageData(0, 0, fitted.width, fitted.height);
      applyLevelsAndGrayscaleToRgba(imgData.data, options);
      ctx.putImageData(imgData, 0, 0);
    }

    let blob = await canvasToBlobPromise(outCanvas, 'image/webp', step.quality);
    const mimeCheck = resolveEncodedMimeFallback(blob.type);
    if (mimeCheck.usedJpegFallback) {
      blob = await canvasToBlobPromise(outCanvas, 'image/jpeg', 0.7);
    }

    lastResult = {
      blob,
      bytes: blob.size,
      width: fitted.width,
      height: fitted.height,
      mime: blob.type || mimeCheck.mime,
    };

    if (blob.size <= TARGET_BLOB_BYTES) {
      break;
    }
  }

  if (rotatedCanvas) {
    rotatedCanvas.width = 0;
    rotatedCanvas.height = 0;
  }

  if (!lastResult) {
    throw new Error('Could not process image');
  }
  return lastResult;
}
