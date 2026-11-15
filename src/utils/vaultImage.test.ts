import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMAGE_FILE_BYTES,
  MAX_OUTPUT_HEIGHT,
  MAX_OUTPUT_WIDTH,
  MIN_CROP_SIZE_PX,
  applyLevelsAndGrayscaleToRgba,
  clampCropRect,
  computeLuminanceHistogramLevels,
  fitTargetDimensions,
  getRotatedDimensions,
  getSizeGuardSteps,
  resolveEncodedMimeFallback,
  validateImageFileCandidate,
} from './vaultImage.ts';

describe('vaultImage pure image pipeline helpers', () => {
  it('validates image MIME types, extensions, non-empty size, and 25 MB limit', () => {
    assert.equal(
      validateImageFileCandidate({ type: 'image/jpeg', size: 1024, name: 'q.jpg' }).ok,
      true
    );
    assert.equal(
      validateImageFileCandidate({ type: '', size: 4096, name: 'scan.webp' }).ok,
      true
    );
    const nonImg = validateImageFileCandidate({
      type: 'application/pdf',
      size: 2048,
      name: 'notes.pdf',
    });
    assert.equal(nonImg.ok, false);

    const tooBig = validateImageFileCandidate({
      type: 'image/png',
      size: MAX_IMAGE_FILE_BYTES + 1,
      name: 'huge.png',
    });
    assert.equal(tooBig.ok, false);

    const empty = validateImageFileCandidate({
      type: 'image/png',
      size: 0,
      name: 'empty.png',
    });
    assert.equal(empty.ok, false);
  });

  it('fits output dimensions within 1080x2400 while preserving aspect ratio', () => {
    assert.deepEqual(fitTargetDimensions(800, 600), { width: 800, height: 600 });
    assert.deepEqual(fitTargetDimensions(2160, 1080), {
      width: MAX_OUTPUT_WIDTH,
      height: 540,
    });
    assert.deepEqual(fitTargetDimensions(1080, 4800), {
      width: 540,
      height: MAX_OUTPUT_HEIGHT,
    });
  });

  it('clamps crop rectangles with 64px minimum size inside bounds and handles rotation dims', () => {
    const clampedMin = clampCropRect(
      { x: 10, y: 10, width: 20, height: 30 },
      500,
      400
    );
    assert.equal(clampedMin.width, MIN_CROP_SIZE_PX);
    assert.equal(clampedMin.height, MIN_CROP_SIZE_PX);

    const clampedEdge = clampCropRect(
      { x: 460, y: 380, width: 120, height: 100 },
      500,
      400
    );
    assert.equal(clampedEdge.x + clampedEdge.width, 500);
    assert.equal(clampedEdge.y + clampedEdge.height, 400);

    assert.deepEqual(getRotatedDimensions(1200, 800, 90), { width: 800, height: 1200 });
    assert.deepEqual(getRotatedDimensions(1200, 800, 180), { width: 1200, height: 800 });
    assert.deepEqual(getRotatedDimensions(1200, 800, 270), { width: 800, height: 1200 });
  });

  it('computes 2nd/98th percentile levels and stretches grayscale RGBA pixels', () => {
    const hist = new Uint32Array(256);
    hist[60] = 50;
    hist[180] = 50;
    const levels = computeLuminanceHistogramLevels(hist, 100);
    assert.equal(levels.low, 60);
    assert.equal(levels.high, 180);

    // 4 pixels: dark mid-gray (60, 70, 50), light mid-gray (180, 190, 170), plus duplicates
    const rgba = new Uint8ClampedArray([
      60, 70, 50, 255,
      180, 190, 170, 255,
      60, 70, 50, 255,
      180, 190, 170, 255,
    ]);
    applyLevelsAndGrayscaleToRgba(rgba, { grayscale: true, enhanceText: true });
    // Grayscale guarantees R === G === B
    assert.equal(rgba[0], rgba[1]);
    assert.equal(rgba[1], rgba[2]);
    assert.equal(rgba[4], rgba[5]);
    assert.equal(rgba[5], rgba[6]);
    // Dark pixel stretched near 0, bright stretched near 255
    assert.ok(rgba[0] <= 10);
    assert.ok(rgba[4] >= 245);
  });

  it('provides WebP -> JPEG encoding fallback and multi-step <=150KB size guard sequence', () => {
    assert.deepEqual(resolveEncodedMimeFallback('image/webp'), {
      mime: 'image/webp',
      usedJpegFallback: false,
    });
    assert.deepEqual(resolveEncodedMimeFallback('image/png'), {
      mime: 'image/jpeg',
      usedJpegFallback: true,
    });
    assert.deepEqual(resolveEncodedMimeFallback(''), {
      mime: 'image/jpeg',
      usedJpegFallback: true,
    });

    const steps = getSizeGuardSteps();
    assert.ok(steps.length >= 4);
    assert.equal(steps[0].quality, 0.65);
    assert.equal(steps[0].maxWidth, MAX_OUTPUT_WIDTH);
    assert.ok(steps[steps.length - 1].maxWidth < MAX_OUTPUT_WIDTH);
  });
});
