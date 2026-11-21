import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_MAX_PEAK,
  AMBIENT_TARGET_RMS,
  BROWN_SAMPLE_RATE,
  CLOCKWORK_SAMPLE_RATE,
  RAIN_SAMPLE_RATE,
  REVERB_DURATION_SEC,
  REVERB_PREDELAY_SEC,
  computeAmbientChannelGain,
  computePeak,
  computeRms,
  generateBrownBuffers,
  generateClockworkBuffer,
  generateRainBuffers,
  generateReverbImpulse,
} from './soundRecipes.ts';

function assertBufferHealthy(
  label: string,
  samples: Float32Array,
  expectedLength: number,
  opts: { minRms: number; maxRms: number }
): void {
  assert.equal(samples.length, expectedLength, `${label}: unexpected buffer length`);

  let nonFinite = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) nonFinite++;
  }
  assert.equal(nonFinite, 0, `${label}: contains NaN or Infinity`);

  const peak = computePeak(samples);
  assert.ok(
    peak > 0 && peak <= AMBIENT_MAX_PEAK + 1e-6,
    `${label}: peak ${peak} outside (0, ${AMBIENT_MAX_PEAK}]`
  );

  const rms = computeRms(samples);
  assert.ok(
    rms >= opts.minRms && rms <= opts.maxRms,
    `${label}: RMS ${rms.toFixed(4)} outside [${opts.minRms}, ${opts.maxRms}]`
  );

  const seamDelta = Math.abs(samples[0] - samples[samples.length - 1]);
  assert.ok(
    seamDelta < 1e-3,
    `${label}: loop seam discontinuity ${seamDelta} >= 1e-3`
  );
}

describe('soundRecipes — pure offline acoustic DSP synthesis & validation', () => {
  it('computes strictly monotonic perceptual ambient gain with exact 0 -> 0 silence', () => {
    assert.equal(computeAmbientChannelGain(0), 0);
    assert.equal(computeAmbientChannelGain(-15), 0);
    assert.equal(computeAmbientChannelGain(Number.NaN), 0);

    let prev = 0;
    for (const level of [1, 5, 15, 30, 50, 75, 100]) {
      const g = computeAmbientChannelGain(level);
      assert.ok(Number.isFinite(g) && g > prev, `gain at ${level} (${g}) should exceed ${prev}`);
      prev = g;
    }

    // 100% maps to -6 dB (10^(-6/20) ≈ 0.501187)
    assert.ok(
      Math.abs(computeAmbientChannelGain(100) - Math.pow(10, -6 / 20)) < 1e-6
    );
    // Clamps above 100
    assert.equal(computeAmbientChannelGain(140), computeAmbientChannelGain(100));
  });

  it('generates a finite decaying 0.85s stereo reverb impulse with 12ms pre-delay', () => {
    const sr = 22050;
    const ir = generateReverbImpulse(sr, REVERB_DURATION_SEC);
    const expectedLen = Math.round(sr * REVERB_DURATION_SEC);
    assert.equal(ir.left.length, expectedLen);
    assert.equal(ir.right.length, expectedLen);

    // Pre-delay window is strictly silent
    const preDelay = Math.round(sr * REVERB_PREDELAY_SEC);
    for (let i = 0; i < preDelay; i++) {
      assert.equal(ir.left[i], 0);
      assert.equal(ir.right[i], 0);
    }

    // Finite bounds and clear decay from early reflections to late tail
    for (let i = 0; i < expectedLen; i++) {
      assert.ok(Number.isFinite(ir.left[i]) && Math.abs(ir.left[i]) <= AMBIENT_MAX_PEAK);
      assert.ok(Number.isFinite(ir.right[i]) && Math.abs(ir.right[i]) <= AMBIENT_MAX_PEAK);
    }

    const earlyRms = computeRms(ir.left.subarray(preDelay, preDelay + Math.round(sr * 0.12)));
    const lateRms = computeRms(ir.left.subarray(expectedLen - Math.round(sr * 0.12)));
    assert.ok(earlyRms > 0.05, `early reverb RMS too low: ${earlyRms}`);
    assert.ok(lateRms < earlyRms * 0.2, `reverb tail did not decay cleanly: early=${earlyRms}, late=${lateRms}`);
  });

  it('generates seamless prime-length Brown / Room Tone loops (12s & 13s @ 8kHz)', () => {
    const brown = generateBrownBuffers(BROWN_SAMPLE_RATE);
    assertBufferHealthy('Brown 12s', brown.loop12, 12 * BROWN_SAMPLE_RATE, {
      minRms: AMBIENT_TARGET_RMS * 0.9,
      maxRms: AMBIENT_TARGET_RMS * 1.1,
    });
    assertBufferHealthy('Brown 13s', brown.loop13, 13 * BROWN_SAMPLE_RATE, {
      minRms: AMBIENT_TARGET_RMS * 0.9,
      maxRms: AMBIENT_TARGET_RMS * 1.1,
    });
  });

  it('generates seamless prime-length Rain on Glass layers (17s, 23s, 29s @ 22.05kHz)', () => {
    const rain = generateRainBuffers(RAIN_SAMPLE_RATE);
    assertBufferHealthy('Rain bed 17s', rain.bed17, 17 * RAIN_SAMPLE_RATE, {
      minRms: AMBIENT_TARGET_RMS * 0.9,
      maxRms: AMBIENT_TARGET_RMS * 1.1,
    });
    assertBufferHealthy('Rain drops 23s', rain.drops23, 23 * RAIN_SAMPLE_RATE, {
      minRms: AMBIENT_TARGET_RMS * 0.6,
      maxRms: AMBIENT_TARGET_RMS * 1.1,
    });
    assertBufferHealthy('Rain drops 29s', rain.drops29, 29 * RAIN_SAMPLE_RATE, {
      minRms: AMBIENT_TARGET_RMS * 0.5,
      maxRms: AMBIENT_TARGET_RMS * 1.1,
    });
  });

  it('generates a seamless 16s Damped Mechanical Clockwork loop (@ 22.05kHz)', () => {
    const clockwork = generateClockworkBuffer(CLOCKWORK_SAMPLE_RATE);
    // Impulsive 1 Hz watch escapement has a high natural crest factor, so its
    // RMS is naturally capped below -20 dBFS to preserve distortion-free peaks <= 0.95
    assertBufferHealthy('Clockwork 16s', clockwork.loop16, 16 * CLOCKWORK_SAMPLE_RATE, {
      minRms: 0.025,
      maxRms: AMBIENT_TARGET_RMS * 1.1,
    });
  });
});
