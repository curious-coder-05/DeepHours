import { safeJsonParse, safeLocalStorageSet } from './security.ts';
import { computeAmbientChannelGain } from './soundRecipes';

export { computeAmbientChannelGain };

export type AmbientChannelKey = 'brown' | 'rain' | 'tick';

export type AmbientPresetId =
  | 'off'
  | 'deep-rain'
  | 'library'
  | 'clockwork'
  | 'custom';

export type SelectableAmbientPresetId = Exclude<AmbientPresetId, 'custom'>;

export interface AmbientChannels {
  brown: number;
  rain: number;
  tick: number;
}

export interface AmbientMixerState {
  channels: AmbientChannels;
  muted: boolean;
  preset: AmbientPresetId;
  lastActiveChannels: AmbientChannels;
}

export const AMBIENT_MIXER_STORAGE_KEY = 'dh_ambient_mixer_v1';
export const AMBIENT_MIXER_EVENT = 'dh-ambient-mixer-change';

export interface AmbientPresetSpec {
  id: SelectableAmbientPresetId;
  label: string;
  channels: AmbientChannels;
}

export const AMBIENT_PRESETS: ReadonlyArray<AmbientPresetSpec> = [
  {
    id: 'off',
    label: 'Off',
    channels: { brown: 0, rain: 0, tick: 0 },
  },
  {
    id: 'deep-rain',
    label: 'Deep Rain',
    channels: { brown: 45, rain: 75, tick: 0 },
  },
  {
    id: 'library',
    label: 'Library',
    channels: { brown: 60, rain: 20, tick: 15 },
  },
  {
    id: 'clockwork',
    label: 'Clockwork',
    channels: { brown: 25, rain: 0, tick: 65 },
  },
];

export const AMBIENT_CHANNEL_META: ReadonlyArray<{
  key: AmbientChannelKey;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  {
    key: 'brown',
    label: 'Brown noise',
    shortLabel: 'Brown',
    hint: 'Warm room tone (prime loops)',
  },
  {
    key: 'rain',
    label: 'Soft rain',
    shortLabel: 'Rain',
    hint: 'Multi-layer rain on glass',
  },
  {
    key: 'tick',
    label: 'Mech tick',
    shortLabel: 'Tick',
    hint: 'Damped 1 Hz escapement',
  },
];

const DEFAULT_FALLBACK_CHANNELS: AmbientChannels = {
  brown: 45,
  rain: 75,
  tick: 0,
};

export function clampAmbientLevel(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function normalizeAmbientChannels(
  raw?: Partial<Record<AmbientChannelKey, unknown>> | null
): AmbientChannels {
  return {
    brown: clampAmbientLevel(raw?.brown ?? 0),
    rain: clampAmbientLevel(raw?.rain ?? 0),
    tick: clampAmbientLevel(raw?.tick ?? 0),
  };
}

export function channelsHaveSound(channels: AmbientChannels): boolean {
  return channels.brown > 0 || channels.rain > 0 || channels.tick > 0;
}

export function hasActiveAmbientAudio(state: AmbientMixerState): boolean {
  return !state.muted && channelsHaveSound(state.channels);
}

export function detectAmbientPreset(
  channels: AmbientChannels
): AmbientPresetId {
  if (!channelsHaveSound(channels)) return 'off';
  for (const preset of AMBIENT_PRESETS) {
    if (preset.id === 'off') continue;
    if (
      preset.channels.brown === channels.brown &&
      preset.channels.rain === channels.rain &&
      preset.channels.tick === channels.tick
    ) {
      return preset.id;
    }
  }
  return 'custom';
}

export function createDefaultAmbientMixerState(): AmbientMixerState {
  return {
    channels: { brown: 0, rain: 0, tick: 0 },
    muted: true,
    preset: 'off',
    lastActiveChannels: { ...DEFAULT_FALLBACK_CHANNELS },
  };
}

export function applyAmbientPreset(
  prev: AmbientMixerState,
  presetId: SelectableAmbientPresetId
): AmbientMixerState {
  const found = AMBIENT_PRESETS.find((p) => p.id === presetId);
  if (!found || presetId === 'off') {
    const preservedLast = channelsHaveSound(prev.channels)
      ? { ...prev.channels }
      : { ...prev.lastActiveChannels };
    return {
      channels: { brown: 0, rain: 0, tick: 0 },
      muted: true,
      preset: 'off',
      lastActiveChannels: channelsHaveSound(preservedLast)
        ? preservedLast
        : { ...DEFAULT_FALLBACK_CHANNELS },
    };
  }
  const nextChannels: AmbientChannels = { ...found.channels };
  return {
    channels: nextChannels,
    muted: false,
    preset: found.id,
    lastActiveChannels: { ...nextChannels },
  };
}

export function setAmbientChannelLevel(
  prev: AmbientMixerState,
  channel: AmbientChannelKey,
  level: number
): AmbientMixerState {
  const clamped = clampAmbientLevel(level);
  const nextChannels: AmbientChannels = {
    ...prev.channels,
    [channel]: clamped,
  };
  const anyOn = channelsHaveSound(nextChannels);
  const nextPreset = detectAmbientPreset(nextChannels);
  return {
    channels: nextChannels,
    muted: anyOn ? false : true,
    preset: nextPreset,
    lastActiveChannels: anyOn
      ? { ...nextChannels }
      : channelsHaveSound(prev.lastActiveChannels)
        ? { ...prev.lastActiveChannels }
        : { ...DEFAULT_FALLBACK_CHANNELS },
  };
}

export function toggleAmbientMute(prev: AmbientMixerState): AmbientMixerState {
  if (!prev.muted && channelsHaveSound(prev.channels)) {
    return {
      ...prev,
      muted: true,
      lastActiveChannels: { ...prev.channels },
    };
  }
  // Unmuting: restore current channels if audible, otherwise restore lastActiveChannels / Deep Rain
  const restored = channelsHaveSound(prev.channels)
    ? { ...prev.channels }
    : channelsHaveSound(prev.lastActiveChannels)
      ? { ...prev.lastActiveChannels }
      : { ...DEFAULT_FALLBACK_CHANNELS };
  return {
    channels: restored,
    muted: false,
    preset: detectAmbientPreset(restored),
    lastActiveChannels: { ...restored },
  };
}

export function getPresetLabel(preset: AmbientPresetId): string {
  const found = AMBIENT_PRESETS.find((p) => p.id === preset);
  return found ? found.label : 'Custom mix';
}

export function formatAmbientMixSummary(state: AmbientMixerState): string {
  const anyOn = channelsHaveSound(state.channels);
  if (!anyOn) {
    return 'Off';
  }
  const preset = detectAmbientPreset(state.channels);
  const descriptor =
    preset !== 'custom' && preset !== 'off'
      ? getPresetLabel(preset)
      : AMBIENT_CHANNEL_META.filter((m) => state.channels[m.key] > 0)
          .map((m) => `${m.shortLabel} ${state.channels[m.key]}%`)
          .join(' · ');

  if (state.muted) {
    return `Muted · ${descriptor}`;
  }
  return descriptor;
}

export function loadAmbientMixerState(
  storage?: Pick<Storage, 'getItem'>
): AmbientMixerState {
  try {
    const store =
      storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return createDefaultAmbientMixerState();
    const raw = store.getItem(AMBIENT_MIXER_STORAGE_KEY);
    if (!raw) return createDefaultAmbientMixerState();
    const parsed = safeJsonParse<Partial<AmbientMixerState> | null>(raw, null);
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultAmbientMixerState();
    }
    const channels = normalizeAmbientChannels(parsed.channels);
    const lastActive = normalizeAmbientChannels(parsed.lastActiveChannels);
    const hasSound = channelsHaveSound(channels);
    const muted = !hasSound ? true : Boolean(parsed.muted);
    return {
      channels,
      muted,
      preset: detectAmbientPreset(channels),
      lastActiveChannels: channelsHaveSound(lastActive)
        ? lastActive
        : hasSound
          ? { ...channels }
          : { ...DEFAULT_FALLBACK_CHANNELS },
    };
  } catch {
    return createDefaultAmbientMixerState();
  }
}

export function saveAmbientMixerState(
  state: AmbientMixerState,
  storage?: Pick<Storage, 'setItem'>
): void {
  try {
    const store =
      storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return;
    const payload: AmbientMixerState = {
      channels: normalizeAmbientChannels(state.channels),
      muted: !channelsHaveSound(state.channels) ? true : Boolean(state.muted),
      preset: detectAmbientPreset(state.channels),
      lastActiveChannels: channelsHaveSound(state.lastActiveChannels)
        ? normalizeAmbientChannels(state.lastActiveChannels)
        : { ...DEFAULT_FALLBACK_CHANNELS },
    };
    const res = safeLocalStorageSet(
      AMBIENT_MIXER_STORAGE_KEY,
      JSON.stringify(payload),
      {
        getItem: () => null,
        setItem: (k, v) => store.setItem(k, v),
      }
    );
    if (res.ok && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<AmbientMixerState>(AMBIENT_MIXER_EVENT, {
          detail: payload,
        })
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}
