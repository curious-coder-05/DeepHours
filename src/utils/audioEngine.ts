import type { SoundscapeMode } from '../types';

let audioCtx: AudioContext | null = null;
let mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
let silentKeepAliveGain: GainNode | null = null;
let noiseNode: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;

export function ensureAudioEngine(): {
  ctx: AudioContext | null;
  mediaStreamDest: MediaStreamAudioDestinationNode | null;
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
      // Crucial for Android Chrome PiP: continuous 0.001 gain audio signal
      // so Android OS treats the <video> stream as an active media session with Play/Pause controls
      const osc = audioCtx.createOscillator();
      silentKeepAliveGain = audioCtx.createGain();
      silentKeepAliveGain.gain.value = 0.001;
      osc.frequency.value = 60;
      osc.connect(silentKeepAliveGain);
      silentKeepAliveGain.connect(mediaStreamDest);
      osc.start();
    }
  } catch {
    // ignore in restricted environments
  }
  return { ctx: audioCtx, mediaStreamDest };
}

export function getMediaStreamDestination(): MediaStreamAudioDestinationNode | null {
  return mediaStreamDest;
}

export function beep(type: 'ok' | 'no' | 'win' | 'chime', soundEnabled = true): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(
        type === 'win' ? [25, 45, 35] : type === 'chime' ? [40, 60, 80] : 12
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
