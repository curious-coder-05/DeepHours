import type { SoundscapeMode } from '../types';
import {
  hasActiveAmbientAudio,
  type AmbientChannelKey,
  type AmbientMixerState,
} from './ambientMixer';
import {
  AMBIENT_CHANNEL_TRIM,
  BROWN_SAMPLE_RATE,
  CLOCKWORK_SAMPLE_RATE,
  RAIN_SAMPLE_RATE,
  REVERB_DURATION_SEC,
  computeAmbientChannelGain,
  generateBrownBuffers,
  generateClockworkBuffer,
  generateRainBuffers,
  generateReverbImpulse,
} from './soundRecipes';

export type StudioSoundCue =
  | 'tap'
  | 'toggleOn'
  | 'toggleOff'
  | 'error'
  | 'timerStart'
  | 'timerPause'
  | 'timerResume'
  | 'stopAndLog'
  | 'sessionComplete'
  | 'flowOvertime'
  | 'fiveMin'
  | 'examOvertime'
  | 'examFinish';

export interface PlaySoundCueOptions {
  sectionId?: string;
  forceAudition?: boolean;
}

export const SOUND_LAB_CUES: ReadonlyArray<{
  cue: StudioSoundCue;
  label: string;
}> = [
  { cue: 'timerStart', label: 'Start' },
  { cue: 'timerPause', label: 'Pause' },
  { cue: 'sessionComplete', label: 'Complete' },
  { cue: 'examOvertime', label: 'Exam Thud' },
  { cue: 'tap', label: 'Tap' },
];

// ---------------------------------------------------------------------------
// Shared AudioContext, Master Bus, Reverb Send & PiP Keepalive
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
let silentOsc: OscillatorNode | null = null;
let silentKeepAliveGain: GainNode | null = null;

// Master bus nodes
let masterGainNode: GainNode | null = null;
let cueBusNode: GainNode | null = null;
let cueHighShelfNode: BiquadFilterNode | null = null;
let cueCompressorNode: DynamicsCompressorNode | null = null;
let reverbSendBusNode: GainNode | null = null;
let reverbConvolverNode: ConvolverNode | null = null;
let ambientBusNode: GainNode | null = null;
let ambientDuckGainNode: GainNode | null = null;
let cachedNoiseBurstBuffer: AudioBuffer | null = null;
let cachedNoiseBurstSampleRate = 0;

// Legacy single-mode soundscape node (preserved for updateSoundscape compatibility)
let noiseNode: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;

// Rate-limiter for Exam Hall section overtime thuds (once per 20s per section)
const EXAM_OVERTIME_COOLDOWN_MS = 20_000;
const lastExamOvertimeBySection = new Map<string, number>();

export function resetExamOvertimeRateLimit(): void {
  lastExamOvertimeBySection.clear();
}

// ---------------------------------------------------------------------------
// v37: Studio-Grade Prime-Length Ambient Sound Mixer Graph
// ---------------------------------------------------------------------------

interface CachedStudioAmbientBuffers {
  brown12: AudioBuffer;
  brown13: AudioBuffer;
  rainBed17: AudioBuffer;
  rainDrops23: AudioBuffer;
  rainDrops29: AudioBuffer;
  clockwork16: AudioBuffer;
}

interface MixerGraph {
  ctx: AudioContext;
  mixerMasterGain: GainNode;
  channelGains: Record<AmbientChannelKey, GainNode>;
  sources: AudioBufferSourceNode[];
  lfos: OscillatorNode[];
  nodes: AudioNode[];
}

let mixerGraph: MixerGraph | null = null;
let mixerTeardownTimer: ReturnType<typeof setTimeout> | null = null;
let cachedAmbientCtx: AudioContext | null = null;
let cachedAmbientBuffers: CachedStudioAmbientBuffers | null = null;

const AMBIENT_DUCK_LINEAR = Math.pow(10, -4 / 20); // -4 dB smooth ducking during cues
const AMBIENT_FADE_IN_TAU = 0.2; // ~600ms to 95%
const AMBIENT_FADE_OUT_TAU = 0.28; // ~900ms to silence
const AMBIENT_TEARDOWN_DELAY_MS = 960;

function createMonoAudioBuffer(
  ctx: AudioContext,
  data: Float32Array,
  sampleRate: number
): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

function createStereoPannerSafe(ctx: AudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);
    return panner;
  }
  const passthrough = ctx.createGain();
  passthrough.gain.setValueAtTime(1, ctx.currentTime);
  return passthrough;
}

function getShortNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoiseBurstBuffer && cachedNoiseBurstSampleRate === ctx.sampleRate) {
    return cachedNoiseBurstBuffer;
  }
  const len = Math.max(256, Math.round(ctx.sampleRate * 0.25));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const out = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    out[i] = Math.random() * 2 - 1;
  }
  cachedNoiseBurstBuffer = buf;
  cachedNoiseBurstSampleRate = ctx.sampleRate;
  return buf;
}

function ensureMasterBus(ctx: AudioContext, dest: MediaStreamAudioDestinationNode | null): void {
  if (masterGainNode && cueBusNode && ambientBusNode && ambientDuckGainNode) {
    return;
  }
  const now = ctx.currentTime;

  // Master Gain -> ctx.destination + PiP mediaStreamDest
  masterGainNode = ctx.createGain();
  masterGainNode.gain.setValueAtTime(1.0, now);
  masterGainNode.connect(ctx.destination);
  if (dest) masterGainNode.connect(dest);

  // Cue Bus -> High-Shelf (-3 dB @ 6 kHz) -> DynamicsCompressor -> Master Gain
  cueBusNode = ctx.createGain();
  cueBusNode.gain.setValueAtTime(1.0, now);

  cueHighShelfNode = ctx.createBiquadFilter();
  cueHighShelfNode.type = 'highshelf';
  cueHighShelfNode.frequency.setValueAtTime(6000, now);
  cueHighShelfNode.gain.setValueAtTime(-3, now);

  cueCompressorNode = ctx.createDynamicsCompressor();
  cueCompressorNode.threshold.setValueAtTime(-20, now);
  cueCompressorNode.knee.setValueAtTime(10, now);
  cueCompressorNode.ratio.setValueAtTime(3, now);
  cueCompressorNode.attack.setValueAtTime(0.004, now);
  cueCompressorNode.release.setValueAtTime(0.16, now);

  cueBusNode.connect(cueHighShelfNode);
  cueHighShelfNode.connect(cueCompressorNode);
  cueCompressorNode.connect(masterGainNode);

  // Procedural Stereo Reverb Send (0.85s IR with 12ms pre-delay & HF damping)
  reverbSendBusNode = ctx.createGain();
  reverbSendBusNode.gain.setValueAtTime(1.0, now);
  try {
    const ir = generateReverbImpulse(ctx.sampleRate, REVERB_DURATION_SEC);
    const irBuffer = ctx.createBuffer(2, ir.left.length, ir.sampleRate);
    irBuffer.getChannelData(0).set(ir.left);
    irBuffer.getChannelData(1).set(ir.right);
    reverbConvolverNode = ctx.createConvolver();
    reverbConvolverNode.buffer = irBuffer;
    reverbSendBusNode.connect(reverbConvolverNode);
    reverbConvolverNode.connect(cueHighShelfNode);
  } catch {
    // Graceful dry fallback if ConvolverNode is unavailable
    reverbConvolverNode = null;
  }

  // Ambient Bus -> Ducking Gain -> Master Gain (bypasses cue compressor)
  ambientBusNode = ctx.createGain();
  ambientBusNode.gain.setValueAtTime(1.0, now);
  ambientDuckGainNode = ctx.createGain();
  ambientDuckGainNode.gain.setValueAtTime(1.0, now);
  ambientBusNode.connect(ambientDuckGainNode);
  ambientDuckGainNode.connect(masterGainNode);
}

/**
 * Smoothly ducks active ambient playback by -4 dB whenever a UI or timer cue
 * fires, releasing gracefully over 0.35s back to the user's ambient level.
 */
function duckAmbientForCue(ctx: AudioContext, holdSec: number): void {
  if (!ambientDuckGainNode || !mixerGraph) return;
  try {
    const now = ctx.currentTime;
    const g = ambientDuckGainNode.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(AMBIENT_DUCK_LINEAR, now, 0.02);
    g.setTargetAtTime(1.0, now + Math.max(0.08, holdSec), 0.35);
  } catch {
    // ignore scheduling errors
  }
}

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
      // CRITICAL PiP KEEPALIVE (UNTOUCHED):
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
    if (audioCtx) {
      ensureMasterBus(audioCtx, mediaStreamDest);
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

// ---------------------------------------------------------------------------
// Core Harmonic Bell Synthesizer & Hardware-Grade Studio Cues
// ---------------------------------------------------------------------------

function routeCueNode(
  ctx: AudioContext,
  node: AudioNode,
  reverbSendAmount = 0
): void {
  if (cueBusNode) {
    node.connect(cueBusNode);
  } else {
    node.connect(ctx.destination);
    if (mediaStreamDest) node.connect(mediaStreamDest);
  }
  if (reverbSendAmount > 0 && reverbSendBusNode && reverbConvolverNode) {
    const send = ctx.createGain();
    send.gain.setValueAtTime(reverbSendAmount, ctx.currentTime);
    node.connect(send);
    send.connect(reverbSendBusNode);
  }
}

/**
 * Core Harmonic Bell Synthesizer:
 * - 6ms linear attack (zero oscillator click artifacts)
 * - Smooth setTargetAtTime(0, t + 0.006, T / 6.9) exponential decay
 * - Subtle organic humanization (±3 cents pitch, ±1 dB gain) per trigger
 */
function triggerBell(
  ctx: AudioContext,
  startTime: number,
  f: number,
  partials: number[],
  amps: number[],
  T: number | number[],
  peak: number,
  reverbSend = 0.16
): void {
  const pitchJitter = Math.pow(2, (Math.random() * 6 - 3) / 1200); // ±3 cents
  const gainJitter = Math.pow(10, (Math.random() * 2 - 1) / 20); // ±1 dB

  const voiceSum = ctx.createGain();
  voiceSum.gain.setValueAtTime(1.0, startTime);
  routeCueNode(ctx, voiceSum, reverbSend);

  let maxDuration = 0.2;
  for (let i = 0; i < partials.length; i++) {
    const ratio = partials[i];
    const amp = (amps[i] ?? 1) * peak * gainJitter;
    const decaySec = Array.isArray(T) ? (T[i] ?? T[T.length - 1] ?? 0.6) : T;
    if (amp <= 1e-5) continue;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * ratio * pitchJitter, startTime);

    env.gain.setValueAtTime(0.00001, startTime);
    env.gain.linearRampToValueAtTime(amp, startTime + 0.006);
    env.gain.setTargetAtTime(0, startTime + 0.006, Math.max(0.005, decaySec / 6.9));

    osc.connect(env);
    env.connect(voiceSum);

    const stopAt = startTime + decaySec + 0.14;
    if (decaySec + 0.14 > maxDuration) maxDuration = decaySec + 0.14;
    osc.start(startTime);
    osc.stop(stopAt);
  }

  // Disconnect voice bus cleanly after tail fades out
  const ms = Math.ceil((startTime - ctx.currentTime + maxDuration + 0.2) * 1000);
  if (ms > 0) {
    setTimeout(() => {
      try {
        voiceSum.disconnect();
      } catch {
        // ignore
      }
    }, ms);
  }
}

function triggerSoftThud(
  ctx: AudioContext,
  startTime: number,
  freqHz: number,
  tauSec: number,
  peak: number,
  reverbSend = 0.08
): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freqHz, startTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(36, freqHz * 0.86), startTime + Math.min(0.14, tauSec));

  env.gain.setValueAtTime(0.00001, startTime);
  env.gain.linearRampToValueAtTime(peak, startTime + 0.006);
  env.gain.setTargetAtTime(0, startTime + 0.006, Math.max(0.01, tauSec));

  osc.connect(env);
  routeCueNode(ctx, env, reverbSend);
  osc.start(startTime);
  osc.stop(startTime + tauSec * 6.5 + 0.08);
}

function triggerFilteredNoiseTransient(
  ctx: AudioContext,
  startTime: number,
  durationSec: number,
  filterType: BiquadFilterType,
  freqHz: number,
  Q: number,
  gainPeak: number
): void {
  const src = ctx.createBufferSource();
  src.buffer = getShortNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freqHz, startTime);
  filter.Q.setValueAtTime(Q, startTime);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.00001, startTime);
  env.gain.linearRampToValueAtTime(gainPeak, startTime + 0.0015);
  env.gain.setTargetAtTime(0, startTime + 0.0015, Math.max(0.002, durationSec / 3.5));

  src.connect(filter);
  filter.connect(env);
  routeCueNode(ctx, env, 0);

  src.start(startTime);
  src.stop(startTime + durationSec + 0.04);
}

function triggerHapticPattern(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore unsupported environments
  }
}

/**
 * Triggers a studio-grade hardware acoustic cue through the Master Bus
 * (with high-shelf polish, dynamics glue, procedural reverb send, and -4 dB
 * ambient ducking). Always respects the user's global `soundEnabled` toggle.
 */
export function playSoundCue(
  cue: StudioSoundCue,
  soundEnabled = true,
  options?: PlaySoundCueOptions
): void {
  // Rate-limit Exam Hall section overtime to once per 20s per section
  if (cue === 'examOvertime' && !options?.forceAudition) {
    const key = options?.sectionId || '__default_section__';
    const nowMs = Date.now();
    const prevMs = lastExamOvertimeBySection.get(key) ?? 0;
    if (nowMs - prevMs < EXAM_OVERTIME_COOLDOWN_MS) {
      return;
    }
    lastExamOvertimeBySection.set(key, nowMs);
  }

  // Tactile haptics paired with cue semantics
  if (cue === 'examOvertime') {
    triggerHapticPattern([40, 60, 40, 60, 80]);
  } else if (cue === 'sessionComplete' || cue === 'examFinish') {
    triggerHapticPattern([25, 45, 35]);
  } else if (cue === 'flowOvertime') {
    triggerHapticPattern([40, 60, 80]);
  } else if (cue === 'fiveMin') {
    triggerHapticPattern([35, 70, 35]);
  } else if (cue === 'error') {
    triggerHapticPattern([20, 40, 20]);
  } else {
    triggerHapticPattern(12);
  }

  if (!soundEnabled) return;

  try {
    const { ctx } = ensureAudioEngine();
    if (!ctx) return;
    const t = ctx.currentTime + 0.004;

    switch (cue) {
      case 'tap': {
        // UI Tap / Check ("Soft Thock"): 300 -> 210 Hz sine over 55ms + 10ms 2kHz BPF noise
        duckAmbientForCue(ctx, 0.08);
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(210, t + 0.055);
        env.gain.setValueAtTime(0.00001, t);
        env.gain.linearRampToValueAtTime(0.1, t + 0.002);
        env.gain.setTargetAtTime(0, t + 0.002, 0.018);
        osc.connect(env);
        routeCueNode(ctx, env, 0.06);
        osc.start(t);
        osc.stop(t + 0.14);

        triggerFilteredNoiseTransient(ctx, t, 0.01, 'bandpass', 2000, 1.1, 0.035);
        break;
      }

      case 'toggleOn':
      case 'toggleOff': {
        // Subtle F5 (698.46 Hz) -> C6 (1046.50 Hz) pearl tones, 55ms apart, reversed for off
        duckAmbientForCue(ctx, 0.14);
        const freqs = cue === 'toggleOn' ? [698.46, 1046.5] : [1046.5, 698.46];
        freqs.forEach((freq, idx) => {
          triggerBell(ctx, t + idx * 0.055, freq, [1, 2.0], [1, 0.2], [0.22, 0.1], 0.06, 0.16);
        });
        break;
      }

      case 'error': {
        // Error / Guard Cue: two low 150 Hz muted knocks, 70ms apart, 600 Hz LPF, peak 0.12
        duckAmbientForCue(ctx, 0.18);
        [0, 0.07].forEach((offset) => {
          const osc = ctx.createOscillator();
          const lpf = ctx.createBiquadFilter();
          const env = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(150, t + offset);
          osc.frequency.exponentialRampToValueAtTime(118, t + offset + 0.055);
          lpf.type = 'lowpass';
          lpf.frequency.setValueAtTime(600, t + offset);
          env.gain.setValueAtTime(0.00001, t + offset);
          env.gain.linearRampToValueAtTime(0.12, t + offset + 0.003);
          env.gain.setTargetAtTime(0, t + offset + 0.003, 0.022);
          osc.connect(lpf);
          lpf.connect(env);
          routeCueNode(ctx, env, 0.08);
          osc.start(t + offset);
          osc.stop(t + offset + 0.16);
        });
        break;
      }

      case 'timerStart': {
        // 82.4 Hz sub-swell (0 -> 0.07 over 90ms, decaying 0.9s) + warm A4 & E5 bells, reverb 0.20
        duckAmbientForCue(ctx, 0.45);
        const sub = ctx.createOscillator();
        const subEnv = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(82.4, t);
        subEnv.gain.setValueAtTime(0.00001, t);
        subEnv.gain.linearRampToValueAtTime(0.07, t + 0.09);
        subEnv.gain.setTargetAtTime(0, t + 0.09, 0.9 / 6.9);
        sub.connect(subEnv);
        routeCueNode(ctx, subEnv, 0.08);
        sub.start(t);
        sub.stop(t + 1.15);

        triggerBell(ctx, t, 440, [1, 2.0, 3.01], [1, 0.35, 0.12], [1.3, 0.7, 0.35], 0.09, 0.2);
        triggerBell(
          ctx,
          t + 0.09,
          659.25,
          [1, 2.0, 3.01],
          [1, 0.35, 0.12],
          [1.0, 0.55, 0.28],
          0.055,
          0.2
        );
        break;
      }

      case 'timerPause': {
        // Single calm E4 bell (partials [1, 2.0], T: 0.55, peak 0.07)
        duckAmbientForCue(ctx, 0.25);
        triggerBell(ctx, t, 329.63, [1, 2.0], [1, 0.3], [0.55, 0.3], 0.07, 0.16);
        break;
      }

      case 'timerResume': {
        // A4 (0.06) + E5 at +70ms (0.035)
        duckAmbientForCue(ctx, 0.3);
        triggerBell(ctx, t, 440, [1, 2.0], [1, 0.3], [0.75, 0.4], 0.06, 0.18);
        triggerBell(ctx, t + 0.07, 659.25, [1, 2.0], [1, 0.25], [0.65, 0.35], 0.035, 0.18);
        break;
      }

      case 'stopAndLog': {
        // Grounded A3 + D4 bells (T: 1.0, peak 0.08) + soft 65 Hz thud (tau: 0.12s)
        duckAmbientForCue(ctx, 0.45);
        triggerBell(ctx, t, 220, [1, 2.0, 3.0], [1, 0.32, 0.1], [1.0, 0.55, 0.28], 0.08, 0.18);
        triggerBell(
          ctx,
          t + 0.06,
          293.66,
          [1, 2.0, 3.0],
          [1, 0.3, 0.1],
          [1.0, 0.55, 0.28],
          0.08,
          0.18
        );
        triggerSoftThud(ctx, t, 65, 0.12, 0.11, 0.08);
        break;
      }

      case 'sessionComplete': {
        // Warm marimba arpeggio C5 - E5 - G5 (0 / 150 / 300ms) over detuned C4 ±3 cents triangle pad
        duckAmbientForCue(ctx, 0.9);
        const notes: Array<{ freq: number; offset: number; peak: number }> = [
          { freq: 523.25, offset: 0, peak: 0.15 },
          { freq: 659.25, offset: 0.15, peak: 0.15 },
          { freq: 783.99, offset: 0.3, peak: 0.17 },
        ];
        for (const n of notes) {
          triggerBell(
            ctx,
            t + n.offset,
            n.freq,
            [1, 3.93, 9.2],
            [1, 0.28, 0.08],
            [0.9, 0.25, 0.08],
            n.peak,
            0.22
          );
        }

        // Soft detuned C4 ±3 cents triangle pad (900 Hz LPF, 0.15s fade-in, tau 0.5s, peak 0.035)
        const padLpf = ctx.createBiquadFilter();
        padLpf.type = 'lowpass';
        padLpf.frequency.setValueAtTime(900, t);
        const padEnv = ctx.createGain();
        padEnv.gain.setValueAtTime(0.00001, t);
        padEnv.gain.linearRampToValueAtTime(0.035, t + 0.15);
        padEnv.gain.setTargetAtTime(0, t + 0.38, 0.5);
        padLpf.connect(padEnv);
        routeCueNode(ctx, padEnv, 0.22);

        const c4 = 261.63;
        [-3, 3].forEach((cents) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(c4 * Math.pow(2, cents / 1200), t);
          osc.connect(padLpf);
          osc.start(t);
          osc.stop(t + 2.6);
        });
        break;
      }

      case 'flowOvertime': {
        // Warm singing-bowl G4 (392 Hz) + +1.3 Hz shimmer sine at 0.6 amplitude, peak 0.08
        duckAmbientForCue(ctx, 1.1);
        triggerBell(
          ctx,
          t,
          392,
          [1, 2.71, 5.15],
          [1, 0.45, 0.2],
          [3.2, 2.0, 1.1],
          0.08,
          0.2
        );
        const shimmer = ctx.createOscillator();
        const shimmerEnv = ctx.createGain();
        shimmer.type = 'sine';
        shimmer.frequency.setValueAtTime(393.3, t);
        shimmerEnv.gain.setValueAtTime(0.00001, t);
        shimmerEnv.gain.linearRampToValueAtTime(0.08 * 0.6, t + 0.006);
        shimmerEnv.gain.setTargetAtTime(0, t + 0.006, 3.2 / 6.9);
        shimmer.connect(shimmerEnv);
        routeCueNode(ctx, shimmerEnv, 0.2);
        shimmer.start(t);
        shimmer.stop(t + 3.4);
        break;
      }

      case 'fiveMin': {
        // A4 then D5 harmonic bells (140ms apart, T: 0.6, peak 0.06)
        duckAmbientForCue(ctx, 0.45);
        triggerBell(ctx, t, 440, [1, 2.0, 3.01], [1, 0.3, 0.1], [0.6, 0.32, 0.16], 0.06, 0.18);
        triggerBell(
          ctx,
          t + 0.14,
          587.33,
          [1, 2.0, 3.01],
          [1, 0.3, 0.1],
          [0.6, 0.32, 0.16],
          0.06,
          0.18
        );
        break;
      }

      case 'examOvertime': {
        // Three warm, unmistakable low felt thuds at 0, 0.26s, 0.52s:
        // 98 -> 78 Hz sine over 110ms (peak 0.24, tau 70ms) + 20ms 700 Hz LPF felt transient (0.06)
        duckAmbientForCue(ctx, 0.9);
        [0, 0.26, 0.52].forEach((offset) => {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(98, t + offset);
          osc.frequency.exponentialRampToValueAtTime(78, t + offset + 0.11);
          env.gain.setValueAtTime(0.00001, t + offset);
          env.gain.linearRampToValueAtTime(0.24, t + offset + 0.006);
          env.gain.setTargetAtTime(0, t + offset + 0.006, 0.07);
          osc.connect(env);
          routeCueNode(ctx, env, 0.16);
          osc.start(t + offset);
          osc.stop(t + offset + 0.48);

          triggerFilteredNoiseTransient(ctx, t + offset, 0.02, 'lowpass', 700, 0.8, 0.06);
        });
        break;
      }

      case 'examFinish': {
        // E5, C5, A4, E4 measured bells (0.28s apart, T: 1.4, peak 0.12) + 55 Hz grounded thud
        duckAmbientForCue(ctx, 1.3);
        [659.25, 523.25, 440, 329.63].forEach((freq, idx) => {
          triggerBell(
            ctx,
            t + idx * 0.28,
            freq,
            [1, 2.0, 3.01],
            [1, 0.34, 0.12],
            [1.4, 0.78, 0.38],
            0.12,
            0.2
          );
        });
        triggerSoftThud(ctx, t + 0.84, 55, 0.16, 0.14, 0.12);
        break;
      }
    }
  } catch {
    // ignore restricted Web Audio environments
  }
}

/**
 * Preserved legacy signature — routes cleanly to v37 studio hardware cues.
 */
export function beep(
  type: 'ok' | 'no' | 'win' | 'chime' | 'fiveMin',
  soundEnabled = true
): void {
  const map: Record<'ok' | 'no' | 'win' | 'chime' | 'fiveMin', StudioSoundCue> = {
    ok: 'tap',
    no: 'error',
    win: 'sessionComplete',
    chime: 'flowOvertime',
    fiveMin: 'fiveMin',
  };
  playSoundCue(map[type], soundEnabled);
}

// ---------------------------------------------------------------------------
// Preserved Legacy Single-Mode Soundscape API (backward compatible)
// ---------------------------------------------------------------------------

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

    const buffers = getOrCreateStudioAmbientBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = mode === 'rain' ? buffers.rainBed17 : buffers.brown12;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = mode === 'rain' ? 'bandpass' : 'lowpass';
    filter.frequency.value = mode === 'brown' ? 380 : mode === 'pink' ? 1200 : 1450;
    if (mode === 'rain') filter.Q.value = 0.7;

    noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(Math.max(0.02, Math.min(1, volume)), ctx.currentTime);

    src.connect(filter);
    filter.connect(noiseGain);
    if (ambientBusNode) {
      noiseGain.connect(ambientBusNode);
    } else {
      noiseGain.connect(ctx.destination);
      if (dest) noiseGain.connect(dest);
    }

    src.start();
    noiseNode = src;
  } catch {
    // ignore
  }
}

export function setSoundscapeVolume(volume: number): void {
  if (noiseGain && audioCtx) {
    noiseGain.gain.setTargetAtTime(Math.max(0.02, Math.min(1, volume)), audioCtx.currentTime, 0.05);
  }
}

// ---------------------------------------------------------------------------
// v37: Prime-Length Multi-Layer Ambient Sound Mixer
// ---------------------------------------------------------------------------

function getOrCreateStudioAmbientBuffers(ctx: AudioContext): CachedStudioAmbientBuffers {
  if (cachedAmbientCtx === ctx && cachedAmbientBuffers) {
    return cachedAmbientBuffers;
  }

  const brown = generateBrownBuffers(BROWN_SAMPLE_RATE);
  const rain = generateRainBuffers(RAIN_SAMPLE_RATE);
  const clockwork = generateClockworkBuffer(CLOCKWORK_SAMPLE_RATE);

  cachedAmbientBuffers = {
    brown12: createMonoAudioBuffer(ctx, brown.loop12, brown.sampleRate),
    brown13: createMonoAudioBuffer(ctx, brown.loop13, brown.sampleRate),
    rainBed17: createMonoAudioBuffer(ctx, rain.bed17, rain.sampleRate),
    rainDrops23: createMonoAudioBuffer(ctx, rain.drops23, rain.sampleRate),
    rainDrops29: createMonoAudioBuffer(ctx, rain.drops29, rain.sampleRate),
    clockwork16: createMonoAudioBuffer(ctx, clockwork.loop16, clockwork.sampleRate),
  };
  cachedAmbientCtx = ctx;
  return cachedAmbientBuffers;
}

function disposeMixerGraphNow(): void {
  if (mixerTeardownTimer !== null) {
    clearTimeout(mixerTeardownTimer);
    mixerTeardownTimer = null;
  }
  if (!mixerGraph) return;
  const g = mixerGraph;
  mixerGraph = null;

  for (const src of g.sources) {
    try {
      src.stop();
    } catch {
      // already stopped
    }
    try {
      src.disconnect();
    } catch {
      // ignore
    }
  }
  for (const lfo of g.lfos) {
    try {
      lfo.stop();
    } catch {
      // already stopped
    }
    try {
      lfo.disconnect();
    } catch {
      // ignore
    }
  }
  for (const node of g.nodes) {
    try {
      node.disconnect();
    } catch {
      // ignore
    }
  }
  try {
    g.mixerMasterGain.disconnect();
  } catch {
    // ignore
  }
}

function createMixerGraph(
  ctx: AudioContext,
  dest: MediaStreamAudioDestinationNode | null
): MixerGraph {
  const buffers = getOrCreateStudioAmbientBuffers(ctx);
  const now = ctx.currentTime;

  const sources: AudioBufferSourceNode[] = [];
  const lfos: OscillatorNode[] = [];
  const nodes: AudioNode[] = [];

  const mixerMasterGain = ctx.createGain();
  mixerMasterGain.gain.setValueAtTime(0.0001, now);
  if (ambientBusNode) {
    mixerMasterGain.connect(ambientBusNode);
  } else {
    mixerMasterGain.connect(ctx.destination);
    if (dest) mixerMasterGain.connect(dest);
  }

  // ── 1. Brown / Room Tone: 12s & 13s prime loops panned ±0.25 ──
  // Routed through LPF drifting 380 Hz ±40 Hz @ 0.03 Hz + ±1.5 dB gain breathing @ 0.05 Hz
  const brownGain = ctx.createGain();
  brownGain.gain.setValueAtTime(0.0001, now);

  const brownFilter = ctx.createBiquadFilter();
  brownFilter.type = 'lowpass';
  brownFilter.frequency.setValueAtTime(380, now);
  brownFilter.Q.setValueAtTime(0.65, now);

  const brownFilterLfo = ctx.createOscillator();
  brownFilterLfo.type = 'sine';
  brownFilterLfo.frequency.setValueAtTime(0.03, now);
  const brownFilterDepth = ctx.createGain();
  brownFilterDepth.gain.setValueAtTime(40, now);
  brownFilterLfo.connect(brownFilterDepth);
  brownFilterDepth.connect(brownFilter.frequency);

  const brownBreathGain = ctx.createGain();
  brownBreathGain.gain.setValueAtTime(1.0, now);
  const brownBreathLfo = ctx.createOscillator();
  brownBreathLfo.type = 'sine';
  brownBreathLfo.frequency.setValueAtTime(0.05, now);
  const brownBreathDepth = ctx.createGain();
  // ±1.5 dB ≈ ±18% linear modulation depth
  brownBreathDepth.gain.setValueAtTime(0.18, now);
  brownBreathLfo.connect(brownBreathDepth);
  brownBreathDepth.connect(brownBreathGain.gain);

  const brownSum = ctx.createGain();
  brownSum.gain.setValueAtTime(0.72, now);

  const brownLayers: Array<{ buf: AudioBuffer; pan: number }> = [
    { buf: buffers.brown12, pan: -0.25 },
    { buf: buffers.brown13, pan: 0.25 },
  ];
  for (const layer of brownLayers) {
    const src = ctx.createBufferSource();
    src.buffer = layer.buf;
    src.loop = true;
    const panner = createStereoPannerSafe(ctx, layer.pan);
    src.connect(panner);
    panner.connect(brownSum);
    src.start(now);
    sources.push(src);
    nodes.push(panner);
  }

  brownSum.connect(brownFilter);
  brownFilter.connect(brownBreathGain);
  brownBreathGain.connect(brownGain);
  brownGain.connect(mixerMasterGain);
  brownFilterLfo.start(now);
  brownBreathLfo.start(now);
  lfos.push(brownFilterLfo, brownBreathLfo);
  nodes.push(brownSum, brownFilter, brownFilterDepth, brownBreathGain, brownBreathDepth, brownGain);

  // ── 2. Rain on Glass: 17s (-0.35), 23s (+0.35), 29s (0) with slow ±2 dB breeze drifts ──
  const rainGain = ctx.createGain();
  rainGain.gain.setValueAtTime(0.0001, now);
  rainGain.connect(mixerMasterGain);

  const rainLayers: Array<{ buf: AudioBuffer; pan: number; lfoHz: number; mix: number }> = [
    { buf: buffers.rainBed17, pan: -0.35, lfoHz: 0.04, mix: 0.56 },
    { buf: buffers.rainDrops23, pan: 0.35, lfoHz: 0.055, mix: 0.36 },
    { buf: buffers.rainDrops29, pan: 0, lfoHz: 0.07, mix: 0.32 },
  ];
  for (const layer of rainLayers) {
    const src = ctx.createBufferSource();
    src.buffer = layer.buf;
    src.loop = true;

    const breezeGain = ctx.createGain();
    breezeGain.gain.setValueAtTime(layer.mix, now);

    const breezeLfo = ctx.createOscillator();
    breezeLfo.type = 'sine';
    breezeLfo.frequency.setValueAtTime(layer.lfoHz, now);
    const breezeDepth = ctx.createGain();
    // ±2 dB ≈ ±23% of layer mix level
    breezeDepth.gain.setValueAtTime(layer.mix * 0.23, now);
    breezeLfo.connect(breezeDepth);
    breezeDepth.connect(breezeGain.gain);

    const panner = createStereoPannerSafe(ctx, layer.pan);
    src.connect(breezeGain);
    breezeGain.connect(panner);
    panner.connect(rainGain);

    src.start(now);
    breezeLfo.start(now);
    sources.push(src);
    lfos.push(breezeLfo);
    nodes.push(breezeGain, breezeDepth, panner);
  }
  nodes.push(rainGain);

  // ── 3. Damped Mechanical Clockwork: 16s loop through 6 kHz LPF ──
  const tickSrc = ctx.createBufferSource();
  tickSrc.buffer = buffers.clockwork16;
  tickSrc.loop = true;

  const tickFilter = ctx.createBiquadFilter();
  tickFilter.type = 'lowpass';
  tickFilter.frequency.setValueAtTime(6000, now);
  tickFilter.Q.setValueAtTime(0.7, now);

  const tickGain = ctx.createGain();
  tickGain.gain.setValueAtTime(0.0001, now);

  tickSrc.connect(tickFilter);
  tickFilter.connect(tickGain);
  tickGain.connect(mixerMasterGain);
  tickSrc.start(now);

  sources.push(tickSrc);
  nodes.push(tickFilter, tickGain);

  return {
    ctx,
    mixerMasterGain,
    channelGains: {
      brown: brownGain,
      rain: rainGain,
      tick: tickGain,
    },
    sources,
    lfos,
    nodes,
  };
}

export function stopAmbientMixer(): void {
  if (!mixerGraph) return;
  try {
    const now = mixerGraph.ctx.currentTime;
    mixerGraph.mixerMasterGain.gain.cancelScheduledValues(now);
    mixerGraph.mixerMasterGain.gain.setTargetAtTime(0.0001, now, AMBIENT_FADE_OUT_TAU);
  } catch {
    // ignore
  }
  if (mixerTeardownTimer !== null) {
    clearTimeout(mixerTeardownTimer);
  }
  mixerTeardownTimer = setTimeout(() => {
    disposeMixerGraphNow();
  }, AMBIENT_TEARDOWN_DELAY_MS);
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

    const isFreshGraph = !mixerGraph || mixerGraph.ctx !== ctx;
    let graph: MixerGraph;
    if (isFreshGraph) {
      disposeMixerGraphNow();
      graph = createMixerGraph(ctx, dest);
      mixerGraph = graph;
    } else {
      graph = mixerGraph as MixerGraph;
    }

    const now = ctx.currentTime;
    graph.mixerMasterGain.gain.cancelScheduledValues(now);
    graph.mixerMasterGain.gain.setTargetAtTime(
      1.0,
      now,
      isFreshGraph ? AMBIENT_FADE_IN_TAU : 0.08
    );

    const keys: AmbientChannelKey[] = ['brown', 'rain', 'tick'];
    for (const key of keys) {
      const level = Math.max(0, Math.min(100, state.channels[key] || 0));
      const perceptual = computeAmbientChannelGain(level);
      const target =
        perceptual <= 0 ? 0.0001 : Math.max(0.0001, perceptual * AMBIENT_CHANNEL_TRIM[key]);
      const gainNode = graph.channelGains[key];
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(target, now, 0.06);
    }
  } catch {
    // ignore restricted Web Audio environments
  }
}
