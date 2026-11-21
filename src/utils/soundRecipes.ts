/**
 * Pure Offline Web Audio Acoustic Recipes (v37)
 *
 * Zero DOM / AudioContext dependencies so every DSP formula, impulse response,
 * and prime-length procedural ambient buffer can be deterministically verified
 * in Node unit tests.
 */

export const AMBIENT_TARGET_RMS = 0.1; // -20 dBFS linear RMS
export const AMBIENT_MAX_PEAK = 0.95;

export const BROWN_SAMPLE_RATE = 8000;
export const RAIN_SAMPLE_RATE = 22050;
export const CLOCKWORK_SAMPLE_RATE = 22050;

export const REVERB_DURATION_SEC = 0.85;
export const REVERB_TAU_SEC = 0.22;
export const REVERB_PREDELAY_SEC = 0.012;

export const BROWN_LOOP_DURATIONS_SEC = [12, 13] as const;
export const RAIN_LOOP_DURATIONS_SEC = [17, 23, 29] as const;
export const CLOCKWORK_LOOP_DURATION_SEC = 16;

/**
 * Comfortable per-channel post-normalization multipliers so Brown, Rain, and
 * Clockwork sit in natural acoustic balance across phone speakers and earphones.
 * Clockwork is capped gently (~0.06–0.12 linear ceiling at 100%) so 1 Hz
 * escapement impulses never pierce or fatigue during long study sessions.
 */
export const AMBIENT_CHANNEL_TRIM = {
  brown: 0.95,
  rain: 0.85,
  tick: 0.22,
} as const;

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass';

export interface StereoImpulseResponse {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export interface BrownBufferSet {
  loop12: Float32Array;
  loop13: Float32Array;
  sampleRate: number;
}

export interface RainBufferSet {
  bed17: Float32Array;
  drops23: Float32Array;
  drops29: Float32Array;
  sampleRate: number;
}

export interface ClockworkBufferSet {
  loop16: Float32Array;
  sampleRate: number;
}

/**
 * Deterministic Mulberry32 PRNG returning uniform floats in [0, 1).
 */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perceptual ambient channel gain curve:
 * - 0 when v <= 0 (true silence)
 * - 10^((-30 + 24 * (clamp(v, 0, 100) / 100)^0.8) / 20) otherwise
 * Spans -30 dB near the bottom of the fader smoothly up to -6 dB at 100%.
 */
export function computeAmbientChannelGain(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, v));
  const db = -30 + 24 * Math.pow(clamped / 100, 0.8);
  return Math.pow(10, db / 20);
}

/**
 * Computes linear RMS over a mono sample buffer, ignoring non-finite glitches.
 */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (Number.isFinite(s)) {
      sumSq += s * s;
    }
  }
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Computes absolute peak amplitude over a mono sample buffer.
 */
export function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (Number.isFinite(a) && a > peak) {
      peak = a;
    }
  }
  return peak;
}

/**
 * Pure 2nd-order Audio EQ Cookbook Biquad filter (in-place or returning new buffer).
 */
export function applyBiquadFilter(
  input: Float32Array,
  sampleRate: number,
  type: BiquadType,
  frequency: number,
  Q = 0.7071
): Float32Array {
  const out = new Float32Array(input.length);
  const clampedFreq = Math.max(10, Math.min(sampleRate * 0.45, frequency));
  const w0 = (2 * Math.PI * clampedFreq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Math.max(0.1, Q));

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  if (type === 'lowpass') {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
  } else {
    // Constant 0 dB peak gain bandpass
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = Number.isFinite(input[i]) ? input[i] : 0;
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = out[i];
  }

  return out;
}

/**
 * Equal-power crossfade loop smoothing.
 * Accepts a raw signal of length `targetLength + fadeSamples` (or folds an
 * in-place signal of length `targetLength`) using sin/cos equal-power weights
 * so there is zero energy dip at the loop seam, followed by a sub-millisecond
 * cosine boundary closure ensuring `|out[0] - out[N - 1]| < 1e-3`.
 */
export function applyEqualPowerLoopCrossfade(
  raw: Float32Array,
  targetLength: number,
  fadeSamples: number
): Float32Array {
  const n = Math.max(2, Math.floor(targetLength));
  const out = new Float32Array(n);
  const f = Math.max(2, Math.min(Math.floor(fadeSamples), Math.floor(n / 4)));

  if (raw.length >= n + f) {
    // Fold extra tail [n .. n+f-1] into head [0 .. f-1] with equal-power weights
    for (let i = 0; i < n; i++) {
      out[i] = Number.isFinite(raw[i]) ? raw[i] : 0;
    }
    for (let i = 0; i < f; i++) {
      const u = i / f;
      const headWeight = Math.sin(u * Math.PI * 0.5);
      const tailWeight = Math.cos(u * Math.PI * 0.5);
      const tailSample = Number.isFinite(raw[n + i]) ? raw[n + i] : 0;
      out[i] = out[i] * headWeight + tailSample * tailWeight;
    }
  } else {
    // In-place tail-to-head fold when caller passed an exact-length buffer
    const copyLen = Math.min(n, raw.length);
    for (let i = 0; i < copyLen; i++) {
      out[i] = Number.isFinite(raw[i]) ? raw[i] : 0;
    }
    const tailCopy = new Float32Array(f);
    for (let i = 0; i < f; i++) {
      tailCopy[i] = out[n - f + i];
    }
    for (let i = 0; i < f; i++) {
      const u = i / f;
      const headWeight = Math.sin(u * Math.PI * 0.5);
      const tailWeight = Math.cos(u * Math.PI * 0.5);
      out[i] = out[i] * headWeight + tailCopy[i] * tailWeight;
    }
  }

  // Micro cosine boundary closure (~0.5-1ms) so even high-frequency rain beds
  // satisfy |out[0] - out[N - 1]| < 1e-3 with zero audible artifact.
  const seamSpan = Math.min(12, Math.floor(n / 16));
  const mid = 0.5 * (out[0] + out[n - 1]);
  for (let i = 0; i < seamSpan; i++) {
    const t = i / seamSpan; // 0 at edge -> 1 at interior
    const w = 0.5 * (1 - Math.cos(Math.PI * t));
    out[i] = mid + (out[i] - mid) * w;
    out[n - 1 - i] = mid + (out[n - 1 - i] - mid) * w;
  }

  return out;
}

/**
 * Normalizes a mono buffer to target RMS (-20 dBFS = 0.1 linear) while
 * enforcing a hard safety peak cap (<= 0.95) and guaranteeing zero NaN/Infinity.
 */
export function normalizeRmsWithPeakCap(
  samples: Float32Array,
  targetRms = AMBIENT_TARGET_RMS,
  maxPeak = AMBIENT_MAX_PEAK
): Float32Array {
  const out = new Float32Array(samples.length);
  if (samples.length === 0) return out;

  // Remove any tiny DC offset first so loop endpoints stay centered cleanly
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = Number.isFinite(samples[i]) ? samples[i] : 0;
    sum += s;
  }
  const mean = sum / samples.length;

  let sumSq = 0;
  let rawPeak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = (Number.isFinite(samples[i]) ? samples[i] : 0) - mean;
    out[i] = s;
    sumSq += s * s;
    const abs = Math.abs(s);
    if (abs > rawPeak) rawPeak = abs;
  }

  const rms = Math.sqrt(sumSq / samples.length);
  if (rms < 1e-12 || rawPeak < 1e-12) {
    return out;
  }

  const desiredGain = targetRms / rms;
  const maxSafeGain = maxPeak / rawPeak;
  const gain = Math.min(desiredGain, maxSafeGain);

  for (let i = 0; i < out.length; i++) {
    let val = out[i] * gain;
    if (!Number.isFinite(val)) val = 0;
    if (val > maxPeak) val = maxPeak;
    else if (val < -maxPeak) val = -maxPeak;
    out[i] = val;
  }

  return out;
}

/**
 * Generates a natural studio stereo reverb impulse response:
 * - 0.85s decaying stereo noise
 * - 12ms pre-delay
 * - Exponential decay tau = 0.22s
 * - Gentle progressive high-frequency air absorption damping
 */
export function generateReverbImpulse(
  sampleRate = 44100,
  durationSec = REVERB_DURATION_SEC,
  seed = 0x52455631
): StereoImpulseResponse {
  const sr = Math.max(8000, Math.round(sampleRate));
  const length = Math.max(64, Math.round(sr * durationSec));
  const preDelaySamples = Math.min(
    Math.floor(length / 4),
    Math.round(sr * REVERB_PREDELAY_SEC)
  );
  const fadeInSamples = Math.max(1, Math.round(sr * 0.002));
  const rng = createMulberry32(seed);

  const left = new Float32Array(length);
  const right = new Float32Array(length);

  let lpL = 0;
  let lpR = 0;
  const activeLength = Math.max(1, length - preDelaySamples);

  for (let i = preDelaySamples; i < length; i++) {
    const idx = i - preDelaySamples;
    const t = idx / sr;
    const progress = idx / activeLength; // 0 -> 1

    const onset = idx < fadeInSamples ? idx / fadeInSamples : 1;
    const env = onset * Math.exp(-t / REVERB_TAU_SEC);

    // Progressive high-frequency damping from ~8.5 kHz down to ~1.6 kHz
    const cutoffHz = 8500 * Math.pow(1600 / 8500, progress);
    const alpha = Math.min(1, (2 * Math.PI * cutoffHz) / (sr + 2 * Math.PI * cutoffHz));

    const whiteL = rng() * 2 - 1;
    const whiteR = rng() * 2 - 1;
    lpL += alpha * (whiteL - lpL);
    lpR += alpha * (whiteR - lpR);

    left[i] = lpL * env;
    right[i] = lpR * env;
  }

  // Normalize stereo IR safely so peak stays well within [-0.85, 0.85]
  const peak = Math.max(computePeak(left), computePeak(right), 1e-6);
  const scale = Math.min(1, 0.72 / peak);
  for (let i = 0; i < length; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }

  return { left, right, sampleRate: sr };
}

/**
 * Generates one seamless Brown / Room Tone mono loop at 8 kHz:
 * - Leaky integrator: y = 0.995 * y + 0.06 * white
 * - 30 Hz high-pass + 350 Hz low-pass
 * - 250ms equal-power loop crossfade
 * - Normalized to -20 dBFS (0.1 linear RMS) with peak <= 0.95
 */
function buildSingleBrownLoop(
  durationSec: number,
  sampleRate: number,
  seed: number
): Float32Array {
  const n = Math.round(durationSec * sampleRate);
  const fadeSamples = Math.round(0.25 * sampleRate);
  const warmup = Math.round(0.4 * sampleRate);
  const total = warmup + n + fadeSamples;
  const rng = createMulberry32(seed);

  const raw = new Float32Array(total);
  let y = 0;
  for (let i = 0; i < total; i++) {
    const white = rng() * 2 - 1;
    y = 0.995 * y + 0.06 * white;
    raw[i] = y;
  }

  const hp = applyBiquadFilter(raw, sampleRate, 'highpass', 30, 0.7071);
  const lp = applyBiquadFilter(hp, sampleRate, 'lowpass', 350, 0.7071);
  const trimmed = lp.subarray(warmup);
  const looped = applyEqualPowerLoopCrossfade(trimmed, n, fadeSamples);
  return normalizeRmsWithPeakCap(looped, AMBIENT_TARGET_RMS, AMBIENT_MAX_PEAK);
}

/**
 * Generates two prime-length (12s & 13s) Brown / Room Tone buffers at 8 kHz.
 */
export function generateBrownBuffers(
  sampleRate = BROWN_SAMPLE_RATE,
  seed = 0x42524e31
): BrownBufferSet {
  return {
    loop12: buildSingleBrownLoop(12, sampleRate, seed),
    loop13: buildSingleBrownLoop(13, sampleRate, seed ^ 0x9e3779b9),
    sampleRate,
  };
}

/**
 * Generates a 17s smooth pink-noise rain bed band-passed 700-5500 Hz.
 */
function buildRainBedLoop(
  durationSec: number,
  sampleRate: number,
  seed: number
): Float32Array {
  const n = Math.round(durationSec * sampleRate);
  const fadeSamples = Math.round(0.25 * sampleRate);
  const warmup = Math.round(0.2 * sampleRate);
  const total = warmup + n + fadeSamples;
  const rng = createMulberry32(seed);

  const raw = new Float32Array(total);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < total; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
    b6 = white * 0.115926;
    raw[i] = pink;
  }

  const hp = applyBiquadFilter(raw, sampleRate, 'highpass', 700, 0.7071);
  const bp = applyBiquadFilter(hp, sampleRate, 'lowpass', 5500, 0.7071);
  const trimmed = bp.subarray(warmup);
  const looped = applyEqualPowerLoopCrossfade(trimmed, n, fadeSamples);
  return normalizeRmsWithPeakCap(looped, AMBIENT_TARGET_RMS, AMBIENT_MAX_PEAK);
}

/**
 * Generates a procedural Rain-on-Glass droplet layer:
 * - ~92% water droplet chirps rising +35% from log-uniform 1.8-5.2 kHz over 10ms
 *   (tau: 3-8ms, amp: 0.03-0.10)
 * - ~8% softer low-frequency "plops" (600-1100 Hz band-passed bursts, tau: 14ms)
 * - Wrap-around placement + equal-power edge smoothing + -20 dBFS RMS normalization
 */
function buildRainDropletsLoop(
  durationSec: number,
  dropsPerSec: number,
  sampleRate: number,
  seed: number
): Float32Array {
  const n = Math.round(durationSec * sampleRate);
  const fadeSamples = Math.round(0.2 * sampleRate);
  const rng = createMulberry32(seed);
  const buf = new Float32Array(n);

  const dropCount = Math.max(1, Math.round(durationSec * dropsPerSec));
  const minLogChirp = Math.log(1800);
  const maxLogChirp = Math.log(5200);
  const minLogPlop = Math.log(600);
  const maxLogPlop = Math.log(1100);

  for (let d = 0; d < dropCount; d++) {
    const startIdx = Math.floor(rng() * n);
    const isPlop = rng() < 0.08;

    if (!isPlop) {
      // Short resonant water droplet chirp rising +35% over 10ms
      const f0 = Math.exp(minLogChirp + rng() * (maxLogChirp - minLogChirp));
      const tauSec = 0.003 + rng() * 0.005; // 3-8 ms
      const amp = 0.03 + rng() * 0.07; // 0.03-0.10
      const durSamples = Math.min(
        Math.round(sampleRate * Math.max(0.015, tauSec * 5.5)),
        Math.floor(n / 2)
      );
      const attackSamples = Math.max(1, Math.round(sampleRate * 0.0005));

      let phase = rng() * Math.PI * 2;
      for (let i = 0; i < durSamples; i++) {
        const t = i / sampleRate;
        const rise = Math.min(1, t / 0.01);
        const freq = f0 * (1 + 0.35 * rise);
        phase += (2 * Math.PI * freq) / sampleRate;

        const attack = i < attackSamples ? i / attackSamples : 1;
        const env = attack * Math.exp(-t / tauSec);
        const sample = Math.sin(phase) * env * amp;
        buf[(startIdx + i) % n] += sample;
      }
    } else {
      // Soft low-frequency "plop" (600-1100 Hz band-passed noise burst, tau: 14ms)
      const fCenter = Math.exp(minLogPlop + rng() * (maxLogPlop - minLogPlop));
      const tauSec = 0.014;
      const amp = 0.04 + rng() * 0.05;
      const durSamples = Math.min(
        Math.round(sampleRate * 0.085),
        Math.floor(n / 2)
      );
      const attackSamples = Math.max(1, Math.round(sampleRate * 0.0012));

      const rawBurst = new Float32Array(durSamples);
      for (let i = 0; i < durSamples; i++) {
        const t = i / sampleRate;
        const attack = i < attackSamples ? i / attackSamples : 1;
        const env = attack * Math.exp(-t / tauSec);
        rawBurst[i] = (rng() * 2 - 1) * env;
      }
      const filtered = applyBiquadFilter(rawBurst, sampleRate, 'bandpass', fCenter, 2.2);
      const peak = computePeak(filtered);
      const scale = peak > 1e-6 ? amp / peak : 0;
      for (let i = 0; i < durSamples; i++) {
        buf[(startIdx + i) % n] += filtered[i] * scale;
      }
    }
  }

  // Subtle floor air bed (-34 dB below droplets) keeps the droplet layer organic
  // while keeping seamless crossfade and RMS well-behaved
  const looped = applyEqualPowerLoopCrossfade(buf, n, fadeSamples);
  return normalizeRmsWithPeakCap(looped, AMBIENT_TARGET_RMS, AMBIENT_MAX_PEAK);
}

/**
 * Generates three prime-length Rain on Glass buffers at 22.05 kHz:
 * - 17s smooth pink-noise bed (700-5500 Hz)
 * - 23s dense droplets (~18 drops/sec)
 * - 29s sparse droplets (~9 drops/sec)
 */
export function generateRainBuffers(
  sampleRate = RAIN_SAMPLE_RATE,
  seed = 0x5241494e
): RainBufferSet {
  return {
    bed17: buildRainBedLoop(17, sampleRate, seed),
    drops23: buildRainDropletsLoop(23, 18, sampleRate, seed ^ 0x85ebca6b),
    drops29: buildRainDropletsLoop(29, 9, sampleRate, seed ^ 0xc2b2ae35),
    sampleRate,
  };
}

/**
 * Generates a 16s Damped Mechanical Clockwork loop at 22.05 kHz:
 * - 16 alternating 1 Hz tick/tock impulses with subtle organic micro-jitter
 *   (±1.2ms timing, ±1.5 dB level)
 * - Tick: damped sines at 1850 Hz (tau 6ms) + 2760 Hz (tau 11ms)
 *         + 180 Hz muted watch-case thump (tau 18ms, amp 0.30)
 *         + 2.5 kHz noise transient (tau 1.5ms, amp 0.25)
 * - Tock: 1480 Hz + 2210 Hz, 2 dB quieter, same warm case thump structure
 */
export function generateClockworkBuffer(
  sampleRate = CLOCKWORK_SAMPLE_RATE,
  seed = 0x434c4b31
): ClockworkBufferSet {
  const durationSec = CLOCKWORK_LOOP_DURATION_SEC;
  const n = Math.round(durationSec * sampleRate);
  const rng = createMulberry32(seed);
  const buf = new Float32Array(n);

  const pulseDurSamples = Math.round(sampleRate * 0.14); // 140ms captures full 18ms tau tail
  const attackSamples = Math.max(1, Math.round(sampleRate * 0.0005));
  const tockAtten = Math.pow(10, -2 / 20); // -2 dB quieter

  for (let beat = 0; beat < durationSec; beat++) {
    const isTick = beat % 2 === 0;
    const timingJitterSec = (rng() * 2 - 1) * 0.0012; // ±1.2 ms
    const levelJitterDb = (rng() * 2 - 1) * 1.5; // ±1.5 dB
    const levelGain = Math.pow(10, levelJitterDb / 20) * (isTick ? 1 : tockAtten);

    // Anchor at beat + 0.15s so sample 0 and sample N-1 sit cleanly in quiet tail
    const startSec = beat + 0.15 + timingJitterSec;
    const startIdx = Math.max(0, Math.round(startSec * sampleRate));

    const f1 = isTick ? 1850 : 1480;
    const f2 = isTick ? 2760 : 2210;

    // Pre-generate 2.5 kHz band-passed noise transient (tau: 1.5ms)
    const transientLen = Math.min(pulseDurSamples, Math.round(sampleRate * 0.018));
    const rawNoise = new Float32Array(transientLen);
    for (let i = 0; i < transientLen; i++) {
      const t = i / sampleRate;
      rawNoise[i] = (rng() * 2 - 1) * Math.exp(-t / 0.0015);
    }
    const bpNoise = applyBiquadFilter(rawNoise, sampleRate, 'bandpass', 2500, 1.8);
    const bpPeak = computePeak(bpNoise);
    const noiseNorm = bpPeak > 1e-6 ? 0.25 / bpPeak : 0;

    for (let i = 0; i < pulseDurSamples; i++) {
      const idx = startIdx + i;
      if (idx >= n) break;
      const t = i / sampleRate;
      const attack = i < attackSamples ? i / attackSamples : 1;

      const s1 = Math.sin(2 * Math.PI * f1 * t) * Math.exp(-t / 0.006) * 0.55;
      const s2 = Math.sin(2 * Math.PI * f2 * t) * Math.exp(-t / 0.011) * 0.32;
      const caseThump = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.018) * 0.3;
      const transient = i < transientLen ? bpNoise[i] * noiseNorm : 0;

      buf[idx] += attack * (s1 + s2 + caseThump + transient) * levelGain;
    }
  }

  // Smoothly close wrap edge & normalize safely within peak cap <= 0.95
  const looped = applyEqualPowerLoopCrossfade(buf, n, Math.round(0.05 * sampleRate));
  const normalized = normalizeRmsWithPeakCap(looped, AMBIENT_TARGET_RMS, AMBIENT_MAX_PEAK);

  return {
    loop16: normalized,
    sampleRate,
  };
}
