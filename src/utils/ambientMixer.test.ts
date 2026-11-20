import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_MIXER_STORAGE_KEY,
  applyAmbientPreset,
  clampAmbientLevel,
  createDefaultAmbientMixerState,
  detectAmbientPreset,
  formatAmbientMixSummary,
  hasActiveAmbientAudio,
  loadAmbientMixerState,
  saveAmbientMixerState,
  setAmbientChannelLevel,
  toggleAmbientMute,
} from './ambientMixer.ts';

describe('ambientMixer — offline 3-channel sound mixer state, presets & persistence', () => {
  it('clamps channel levels cleanly into 0..100 integer range', () => {
    assert.equal(clampAmbientLevel(-12), 0);
    assert.equal(clampAmbientLevel(145), 100);
    assert.equal(clampAmbientLevel(42.6), 43);
    assert.equal(clampAmbientLevel(Number.NaN), 0);
  });

  it('starts quiet by default and restores Deep Rain on first unmute', () => {
    const initial = createDefaultAmbientMixerState();
    assert.equal(initial.preset, 'off');
    assert.equal(initial.muted, true);
    assert.equal(hasActiveAmbientAudio(initial), false);
    assert.equal(formatAmbientMixSummary(initial), 'Off');

    const unmuted = toggleAmbientMute(initial);
    assert.equal(unmuted.muted, false);
    assert.equal(unmuted.preset, 'deep-rain');
    assert.deepEqual(unmuted.channels, { brown: 45, rain: 75, tick: 0 });
    assert.equal(hasActiveAmbientAudio(unmuted), true);
    assert.equal(formatAmbientMixSummary(unmuted), 'Deep Rain');
  });

  it('applies presets, detects custom mixes, and formats concise summaries', () => {
    let st = createDefaultAmbientMixerState();
    st = applyAmbientPreset(st, 'library');
    assert.equal(st.preset, 'library');
    assert.equal(st.muted, false);
    assert.deepEqual(st.channels, { brown: 60, rain: 20, tick: 15 });
    assert.equal(formatAmbientMixSummary(st), 'Library');

    st = applyAmbientPreset(st, 'clockwork');
    assert.equal(st.preset, 'clockwork');
    assert.deepEqual(st.channels, { brown: 25, rain: 0, tick: 65 });
    assert.equal(formatAmbientMixSummary(st), 'Clockwork');

    // Adjusting a channel transitions cleanly to custom mix
    st = setAmbientChannelLevel(st, 'rain', 35);
    assert.equal(st.preset, 'custom');
    assert.equal(detectAmbientPreset(st.channels), 'custom');
    assert.equal(formatAmbientMixSummary(st), 'Brown 25% · Rain 35% · Tick 65%');

    // Muting preserves channel levels and shows Muted summary
    st = toggleAmbientMute(st);
    assert.equal(st.muted, true);
    assert.equal(hasActiveAmbientAudio(st), false);
    assert.equal(
      formatAmbientMixSummary(st),
      'Muted · Brown 25% · Rain 35% · Tick 65%'
    );

    // Off preset zeroes sliders while preserving lastActiveChannels for 1-tap resume
    st = applyAmbientPreset(st, 'off');
    assert.equal(st.preset, 'off');
    assert.equal(st.muted, true);
    assert.deepEqual(st.channels, { brown: 0, rain: 0, tick: 0 });
    const resumed = toggleAmbientMute(st);
    assert.equal(resumed.muted, false);
    assert.deepEqual(resumed.channels, { brown: 25, rain: 35, tick: 65 });
  });

  it('auto-mutes cleanly when all three channels are dragged to 0', () => {
    let st = applyAmbientPreset(createDefaultAmbientMixerState(), 'deep-rain');
    st = setAmbientChannelLevel(st, 'brown', 0);
    assert.equal(st.muted, false);
    st = setAmbientChannelLevel(st, 'rain', 0);
    assert.equal(st.muted, true);
    assert.equal(st.preset, 'off');
    assert.equal(hasActiveAmbientAudio(st), false);
  });

  it('persists and recovers safely from localStorage including corrupt JSON', () => {
    const map = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };

    const mix = setAmbientChannelLevel(
      applyAmbientPreset(createDefaultAmbientMixerState(), 'library'),
      'tick',
      40
    );
    saveAmbientMixerState(mix, fakeStorage);
    assert.ok(map.has(AMBIENT_MIXER_STORAGE_KEY));

    const loaded = loadAmbientMixerState(fakeStorage);
    assert.deepEqual(loaded.channels, { brown: 60, rain: 20, tick: 40 });
    assert.equal(loaded.muted, false);
    assert.equal(loaded.preset, 'custom');

    // Corrupt storage falls back cleanly
    map.set(AMBIENT_MIXER_STORAGE_KEY, '{broken-json');
    const fallback = loadAmbientMixerState(fakeStorage);
    assert.equal(fallback.preset, 'off');
    assert.equal(fallback.muted, true);
  });
});
