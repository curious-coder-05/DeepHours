import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURTAIN_DEFAULT_TOP_PCT,
  CURTAIN_MAX_TOP_PCT,
  CURTAIN_MIN_TOP_PCT,
  VAULT_CURTAIN_STORAGE_KEY,
  clampCurtainTopPct,
  computeCurtainTopPctFromPointer,
  createMaskBottomHalfConfig,
  getVaultCurtainConfig,
  loadAllVaultCurtains,
  removeVaultCurtainConfig,
  saveVaultCurtainConfig,
  type StorageLike,
} from './vaultCurtain';

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => {
      store.set(key, val);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

test('vaultCurtain: clamps split percentages strictly inside [20, 85]', () => {
  assert.equal(clampCurtainTopPct(5), CURTAIN_MIN_TOP_PCT);
  assert.equal(clampCurtainTopPct(-40), CURTAIN_MIN_TOP_PCT);
  assert.equal(clampCurtainTopPct(99), CURTAIN_MAX_TOP_PCT);
  assert.equal(clampCurtainTopPct(52.4), 52);
  assert.equal(clampCurtainTopPct(Number.NaN), CURTAIN_DEFAULT_TOP_PCT);
});

test('vaultCurtain: computes pointer drag split percentage accurately and handles degenerate heights', () => {
  assert.equal(computeCurtainTopPctFromPointer(250, 100, 300), 50);
  assert.equal(computeCurtainTopPctFromPointer(110, 100, 300), 20);
  assert.equal(computeCurtainTopPctFromPointer(395, 100, 300), 85);
  assert.equal(computeCurtainTopPctFromPointer(200, 100, 0), CURTAIN_DEFAULT_TOP_PCT);
});

test('vaultCurtain: persists and removes curtain config keyed by Vault item ID', () => {
  const mem = createMemoryStorage();
  assert.deepEqual(getVaultCurtainConfig('v_1', mem), {
    enabled: false,
    topPct: 50,
  });

  const saved = saveVaultCurtainConfig(
    'v_1',
    { enabled: true, topPct: 92 },
    mem
  );
  assert.deepEqual(saved, { enabled: true, topPct: 85 });

  const preset = createMaskBottomHalfConfig();
  saveVaultCurtainConfig('v_2', preset, mem);

  assert.deepEqual(getVaultCurtainConfig('v_1', mem), { enabled: true, topPct: 85 });
  assert.deepEqual(getVaultCurtainConfig('v_2', mem), { enabled: true, topPct: 50 });

  removeVaultCurtainConfig('v_1', mem);
  assert.deepEqual(getVaultCurtainConfig('v_1', mem), { enabled: false, topPct: 50 });
  assert.deepEqual(getVaultCurtainConfig('v_2', mem), { enabled: true, topPct: 50 });
});

test('vaultCurtain: recovers cleanly from malformed localStorage payloads', () => {
  const mem = createMemoryStorage();
  mem.setItem(VAULT_CURTAIN_STORAGE_KEY, '{not-valid-json');
  assert.deepEqual(loadAllVaultCurtains(mem), {});
  assert.deepEqual(getVaultCurtainConfig('v_1', mem), { enabled: false, topPct: 50 });
});
