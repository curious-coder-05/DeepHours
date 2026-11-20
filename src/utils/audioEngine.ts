import type { SoundscapeMode } from '../types';
import {
  hasActiveAmbientAudio,
  type AmbientChannelKey,
  type AmbientMixerState,
} from './ambientMixer';

let audioCtx: AudioContext | null = null;
let mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
let silentOsc: OscillatorNode | null = null;
let silentKeepAliveGain: GainNode | null = null;
let noiseNode: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;

// v32: 3-channel offline synthesized Ambient Sound Mixer state
interface MixerGraph {
  ctx: AudioContext;
  masterGain: GainNode;
  channels: Record<
    AmbientChannelKey,
    {
      src: AudioBufferSourceNode;
      filter: BiquadFilterNode;
      gain: GainNode;
      extraNodes: AudioNode[];
    }
  >;
}

let mixerGraph: MixerGraph | null = null;
let mixerTeardownTimer: ReturnType<typeof setTimeout> | null = null;
let cachedBuffersSampleRate = 0;
let cachedBrownBuffer: AudioBuffer | null = null;
let cachedRainBuffer: AudioBuffer | null = null;
let cachedTickBuffer: AudioBuffer | null = null;

const CHANNEL_MAX_GAIN: Record<AmbientChannelKey, number> = {
  brown: 0.42,
  rain: 0.34,
  tick: 0.26,
};

export function ensureAudioEngine(): {
  ctx: AudioContext | null;
  mediaStreamDest: MediaStreamAudioDestinationNode | null;
  audioTracks: MediaStreamTrack[];
} {
  try {
    if (!audioCtx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    if (audioCtx && !mediaStreamDest) {
      mediaStreamDest = audioCtx.createMediaStreamDestination();
      // Continuous sub-audible 0.001 gain 60Hz sine oscillator routed into both
      // mediaStreamDest (for the <video> MediaStream) and audioCtx.destination
      // so Android Chrome grants foreground media execution status and never throttles the timer loop.
      silentOsc = audioCtx.createOscillator();
      silentOsc.type = 'sine';
      silentOsc.frequency.setValueAtTime(60, audioCtx.currentTime);

      silentKeepAliveGain = audioCtx.createGain();
      silentKeepAliveGain.gain.setValueAtTime(0.001, audioCtx.currentTime);

      silentOsc.connect(silentKeepAliveGain);
      silentKeepAliveGain.connect(mediaStreamDest);
      silentKeepAliveGain.connect(audioCtx.destination);
      silentOsc.start();
    }
  } catch {
    // ignore in restricted environments
  }
  const audioTracks = mediaStreamDest ? mediaStreamDest.stream.getAudioTracks() : [];
  return { ctx: audioCtx, mediaStreamDest, audioTracks };
}

export function getMediaStreamDestination(): MediaStreamAudioDestinationNode | null {
  return mediaStreamDest;
}

export function beep(
  type: 'ok' | 'no' | 'win' | 'chime' | 'fiveMin',
  soundEnabled = true
): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(
        type === 'win'
          ? [25, 45, 35]
          : type === 'chime'
            ? [40, 60, 80]
            : type === 'fiveMin'
              ? [35, 70, 35]
              : 12
      );
    } catch {
      // ignore
    }
  }
  if (!soundEnabled) return;
  try {
    const { ctx, mediaStreamDest: dest } = ensureAudioEngine();
    if (!ctx) return;
    const n = ctx.currentTime;
    if (type === 'fiveMin') {
      // Subtle soft wrap-up cue (A4 -> D5 gentle sine pulse) at 5 minutes remaining
      [440, 587.33].forEach((freq, idx) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, n + idx * 0.14);
        g.gain.setValueAtTime(0.085, n + idx * 0.14);
        g.gain.exponentialRampToValueAtTime(0.0008, n + idx * 0.14 + 0.55);
        o.connect(g);
        g.connect(ctx.destination);
        if (dest) g.connect(dest);
        o.start(n + idx * 0.14);
        o.stop(n + idx * 0.14 + 0.6);
      });
      return;
    }
    if (type === 'chime') {
      // Gentle two-note harmonic bell chime for Flow State Overtime transition
      [528, 792].forEach((freq, idx) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, n + idx * 0.18);
        g.gain.setValueAtTime(0.16, n + idx * 0.18);
        g.gain.exponentialRampToValueAtTime(0.0008, n + idx * 0.18 + 1.4);
        o.connect(g);
        g.connect(ctx.destination);
        if (dest) g.connect(dest);
        o.start(n + idx * 0.18);
        o.stop(n + idx * 0.18 + 1.45);
      });
      return;
    }
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    if (dest) g.connect(dest);
    o.frequency.setValueAtTime(type === 'no' ? 300 : type === 'win' ? 880 : 560, n);
    o.frequency.exponentialRampToValueAtTime(
      type === 'no' ? 220 : type === 'win' ? 1320 : 840,
      n + 0.12
    );
    g.gain.setValueAtTime(0.11, n);
    g.gain.exponentialRampToValueAtTime(0.001, n + 0.15);
    o.start(n);
    o.stop(n + 0.16);
  } catch {
    // ignore audio context errors
  }
}

export function updateSoundscape(
  mode: SoundscapeMode,
  isTimerRunning: boolean,
  volume = 0.35
): void {
  if (mode === 'off' || !isTimerRunning) {
    if (noiseNode) {
      try {
        noiseNode.stop();
        noiseNode.disconnect();
      } catch {
        // ignore
      }
      noiseNode = null;
    }
    return;
  }

  try {
    const { ctx, mediaStreamDest: dest } = ensureAudioEngine();
    if (!ctx) return;
    if (noiseNode) {
      try {
        noiseNode.stop();
        noiseNode.disconnect();
      } catch {
        // ignore
      }
      noiseNode = null;
    }

    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const out = buffer.getChannelData(0);

    if (mode === 'brown') {
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        out[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = out[i];
        out[i] *= 3.2;
      }
    } else if (mode === 'pink') {
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
        b6 = white * 0.115926;
      }
    } else if (mode === 'rain') {
      let b0 = 0,
        b1 = 0,
        b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.98 * b0 + white * 0.08;
        b1 = 0.92 * b1 + white * 0.15;
        const drop = Math.random() > 0.9985 ? Math.random() * 0.65 : 0;
        b2 = 0.75 * b2 + drop;
        out[i] = (b0 + b1 * 0.6 + b2) * 0.18;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = mode === 'rain' ? 'bandpass' : 'lowpass';
    filter.frequency.value = mode === 'brown' ? 420 : mode === 'pink' ? 1200 : 1450;
    if (mode === 'rain') filter.Q.value = 0.7;

    noiseGain = ctx.createGain();
    noiseGain.gain.value = Math.max(0.02, Math.min(1, volume));

    src.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    if (dest) noiseGain.connect(dest);

    src.start();
    noiseNode = src;
  } catch {
    // ignore
  }
}

export function setSoundscapeVolume(volume: number): void {
  if (noiseGain) {
    noiseGain.gain.value = Math.max(0.02, Math.min(1, volume));
  }
}

// ---------------------------------------------------------------------------
// v32: 3-Channel Offline Synthesized Ambient Sound Mixer
// Channels: Brown noise | Soft rain | Mech tick (1 Hz watch escapement)
// Zero MP3 assets, smooth setTargetAtTime gain ramping, clean node release.
// ---------------------------------------------------------------------------

function applyLoopCrossfade(data: Float32Array, fadeSamples: number): void {
  const n = data.length;
  const f = Math.min(fadeSamples, Math.floor(n / 8));
  for (let i = 0; i < f; i++) {
    const t = i / f;
    const tailIdx = n - f + i;
    const blended = data[i] * t + data[tailIdx] * (1 - t);
    data[i] = blended;
  }
}

function getOrCreateMixerBuffers(ctx: AudioContext): {
  brown: AudioBuffer;
  rain: AudioBuffer;
  tick: AudioBuffer;
} {
  const sr = ctx.sampleRate;
  if (
    cachedBuffersSampleRate === sr &&
    cachedBrownBuffer &&
    cachedRainBuffer &&
    cachedTickBuffer
  ) {
    return {
      brown: cachedBrownBuffer,
      rain: cachedRainBuffer,
      tick: cachedTickBuffer,
    };
  }

  // 1. Deep Brown Noise (4s seamless loop)
  const brownLen = sr * 4;
  const brownBuf = ctx.createBuffer(1, brownLen, sr);
  const brownOut = brownBuf.getChannelData(0);
  let lastBrown = 0;
  for (let i = 0; i < brownLen; i++) {
    const white = Math.random() * 2 - 1;
    lastBrown = (lastBrown + 0.02 * white) / 1.02;
    brownOut[i] = Math.max(-0.95, Math.min(0.95, lastBrown * 3.1));
  }
  applyLoopCrossfade(brownOut, Math.floor(sr * 0.12));

  // 2. Soft Rain (6s seamless pink-noise rainfall texture with gentle micro-droplets)
  const rainLen = sr * 6;
  const rainBuf = ctx.createBuffer(1, rainLen, sr);
  const rainOut = rainBuf.getChannelData(0);
  let p0 = 0,
    p1 = 0,
    p2 = 0,
    p3 = 0,
    p4 = 0,
    p5 = 0,
    p6 = 0,
    dropEnv = 0;
  for (let i = 0; i < rainLen; i++) {
    const white = Math.random() * 2 - 1;
    p0 = 0.99886 * p0 + white * 0.0555179;
    p1 = 0.99332 * p1 + white * 0.0750759;
    p2 = 0.969 * p2 + white * 0.153852;
    p3 = 0.8665 * p3 + white * 0.3104856;
    p4 = 0.55 * p4 + white * 0.5329522;
    p5 = -0.7616 * p5 - white * 0.016898;
    const pink = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + white * 0.5362) * 0.042;
    p6 = white * 0.115926;

    if (Math.random() > 0.9991) {
      dropEnv = Math.min(1, dropEnv + 0.3 + Math.random() * 0.45);
    }
    dropEnv *= 0.965;
    const droplet = dropEnv * (Math.random() * 2 - 1) * 0.16;
    rainOut[i] = Math.max(-0.95, Math.min(0.95, (pink + droplet) * 1.15));
  }
  applyLoopCrossfade(rainOut, Math.floor(sr * 0.18));

  // 3. Mechanical Watch Escapement Tick (2s seamless 1 Hz tick-tock impulse loop)
  // Two ultra-subtle damped acoustic escapement clicks at t=0.00s and t=1.00s
  const tickLen = sr * 2;
  const tickBuf = ctx.createBuffer(1, tickLen, sr);
  const tickOut = tickBuf.getChannelData(0);
  const clickSamples = Math.min(Math.floor(sr * 0.014), Math.floor(sr / 2));

  const writeEscapementPulse = (
    offset: number,
    f1: number,
    f2: number,
    amp: number
  ) => {
    for (let i = 0; i < clickSamples; i++) {
      const t = i / sr;
      // Fast attack (<0.6ms), crisp exponential decay (~2.8ms)
      const attack = Math.min(1, i / Math.max(1, sr * 0.00055));
      const decay = Math.exp(-t * 360);
      const body =
        Math.sin(2 * Math.PI * f1 * t) * 0.55 +
        Math.sin(2 * Math.PI * f2 * t) * 0.32 +
        (Math.random() * 2 - 1) * 0.24 * Math.exp(-t * 620);
      const idx = offset + i;
      if (idx < tickLen) {
        tickOut[idx] += attack * decay * body * amp;
      }
    }
  };

  // Subtle tick at 0.00s and slightly warmer tock at 1.00s
  writeEscapementPulse(Math.floor(sr * 0.01), 3150, 1780, 0.72);
  writeEscapementPulse(Math.floor(sr * 1.01), 2680, 1520, 0.62);

  cachedBuffersSampleRate = sr;
  cachedBrownBuffer = brownBuf;
  cachedRainBuffer = rainBuf;
  cachedTickBuffer = tickBuf;

  return { brown: brownBuf, rain: rainBuf, tick: tickBuf };
}

function disposeMixerGraphNow(): void {
  if (mixerTeardownTimer !== null) {
    clearTimeout(mixerTeardownTimer);
    mixerTeardownTimer = null;
  }
  if (!mixerGraph) return;
  const g = mixerGraph;
  mixerGraph = null;
  const keys: AmbientChannelKey[] = ['brown', 'rain', 'tick'];
  for (const key of keys) {
    const ch = g.channels[key];
    try {
      ch.src.stop();
    } catch {
      // already stopped
    }
    try {
      ch.src.disconnect();
      ch.filter.disconnect();
      ch.gain.disconnect();
    } catch {
      // ignore
    }
    for (const extra of ch.extraNodes) {
      try {
        if ('stop' in extra && typeof (extra as OscillatorNode).stop === 'function') {
          (extra as OscillatorNode).stop();
        }
        extra.disconnect();
      } catch {
        // ignore
      }
    }
  }
  try {
    g.masterGain.disconnect();
  } catch {
    // ignore
  }
}

function createMixerGraph(
  ctx: AudioContext,
  dest: MediaStreamAudioDestinationNode | null
): MixerGraph {
  const buffers = getOrCreateMixerBuffers(ctx);
  const now = ctx.currentTime;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.connect(ctx.destination);
  if (dest) masterGain.connect(dest);

  // Channel 1: Brown Noise -> Lowpass 340Hz
  const brownSrc = ctx.createBufferSource();
  brownSrc.buffer = buffers.brown;
  brownSrc.loop = true;
  const brownFilter = ctx.createBiquadFilter();
  brownFilter.type = 'lowpass';
  brownFilter.frequency.setValueAtTime(340, now);
  brownFilter.Q.setValueAtTime(0.65, now);
  const brownGain = ctx.createGain();
  brownGain.gain.setValueAtTime(0.0001, now);
  brownSrc.connect(brownFilter);
  brownFilter.connect(brownGain);
  brownGain.connect(masterGain);

  // Channel 2: Soft Rain -> Bandpass 1350Hz + gentle 0.18Hz LFO swell modulation
  const rainSrc = ctx.createBufferSource();
  rainSrc.buffer = buffers.rain;
  rainSrc.loop = true;
  const rainFilter = ctx.createBiquadFilter();
  rainFilter.type = 'bandpass';
  rainFilter.frequency.setValueAtTime(1350, now);
  rainFilter.Q.setValueAtTime(0.62, now);
  const rainSwellGain = ctx.createGain();
  rainSwellGain.gain.setValueAtTime(0.88, now);
  const rainLfo = ctx.createOscillator();
  rainLfo.type = 'sine';
  rainLfo.frequency.setValueAtTime(0.18, now);
  const rainLfoDepth = ctx.createGain();
  rainLfoDepth.gain.setValueAtTime(0.12, now);
  rainLfo.connect(rainLfoDepth);
  rainLfoDepth.connect(rainSwellGain.gain);
  const rainGain = ctx.createGain();
  rainGain.gain.setValueAtTime(0.0001, now);
  rainSrc.connect(rainFilter);
  rainFilter.connect(rainSwellGain);
  rainSwellGain.connect(rainGain);
  rainGain.connect(masterGain);

  // Channel 3: Mechanical Watch Escapement Tick -> Narrow Bandpass 2400Hz
  const tickSrc = ctx.createBufferSource();
  tickSrc.buffer = buffers.tick;
  tickSrc.loop = true;
  const tickFilter = ctx.createBiquadFilter();
  tickFilter.type = 'bandpass';
  tickFilter.frequency.setValueAtTime(2400, now);
  tickFilter.Q.setValueAtTime(1.35, now);
  const tickGain = ctx.createGain();
  tickGain.gain.setValueAtTime(0.0001, now);
  tickSrc.connect(tickFilter);
  tickFilter.connect(tickGain);
  tickGain.connect(masterGain);

  brownSrc.start(now);
  rainSrc.start(now);
  rainLfo.start(now);
  tickSrc.start(now);

  return {
    ctx,
    masterGain,
    channels: {
      brown: {
        src: brownSrc,
        filter: brownFilter,
        gain: brownGain,
        extraNodes: [],
      },
      rain: {
        src: rainSrc,
        filter: rainFilter,
        gain: rainGain,
        extraNodes: [rainSwellGain, rainLfo, rainLfoDepth],
      },
      tick: {
        src: tickSrc,
        filter: tickFilter,
        gain: tickGain,
        extraNodes: [],
      },
    },
  };
}

export function stopAmbientMixer(): void {
  if (!mixerGraph) return;
  try {
    const now = mixerGraph.ctx.currentTime;
    mixerGraph.masterGain.gain.cancelScheduledValues(now);
    mixerGraph.masterGain.gain.setTargetAtTime(0.0001, now, 0.045);
  } catch {
    // ignore
  }
  if (mixerTeardownTimer !== null) {
    clearTimeout(mixerTeardownTimer);
  }
  mixerTeardownTimer = setTimeout(() => {
    disposeMixerGraphNow();
  }, 240);
}

export function syncAmbientMixer(
  state: AmbientMixerState,
  active: boolean
): void {
  const shouldPlay = active && hasActiveAmbientAudio(state);
  if (!shouldPlay) {
    stopAmbientMixer();
    return;
  }

  try {
    // Stop legacy single-mode soundscape node if active to avoid overlapping audio
    if (noiseNode) {
      try {
        noiseNode.stop();
        noiseNode.disconnect();
      } catch {
        // ignore
      }
      noiseNode = null;
    }

    if (mixerTeardownTimer !== null) {
      clearTimeout(mixerTeardownTimer);
      mixerTeardownTimer = null;
    }

    const { ctx, mediaStreamDest: dest } = ensureAudioEngine();
    if (!ctx) return;

    if (!mixerGraph || mixerGraph.ctx !== ctx) {
      disposeMixerGraphNow();
      mixerGraph = createMixerGraph(ctx, dest);
    }

    const now = ctx.currentTime;
    mixerGraph.masterGain.gain.cancelScheduledValues(now);
    mixerGraph.masterGain.gain.setTargetAtTime(1.0, now, 0.06);

    const keys: AmbientChannelKey[] = ['brown', 'rain', 'tick'];
    for (const key of keys) {
      const level = Math.max(0, Math.min(100, state.channels[key] || 0));
      // Smooth perceptual curve (slightly softer at low slider percentages)
      const normalized = level / 100;
      const target =
        level === 0 ? 0.0001 : Math.pow(normalized, 1.35) * CHANNEL_MAX_GAIN[key];
      const gainNode = mixerGraph.channels[key].gain;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(target, now, 0.06);
    }
  } catch {
    // ignore restricted Web Audio environments
  }
}
