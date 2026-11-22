import {
  isDangerousKey,
  safeJsonParse,
  safeLocalStorageSet,
} from './security.ts';

export const VAULT_CURTAIN_STORAGE_KEY = 'dh_vault_curtain_v1';
export const VAULT_CURTAIN_CHANGE_EVENT = 'dh:vault-curtain-change';

export const CURTAIN_MIN_TOP_PCT = 20;
export const CURTAIN_MAX_TOP_PCT = 85;
export const CURTAIN_DEFAULT_TOP_PCT = 50;

export interface VaultCurtainConfig {
  enabled: boolean;
  /** Top edge position of the frosted curtain as % of image height (20..85). */
  topPct: number;
}

export type VaultCurtainMap = Record<string, VaultCurtainConfig>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function clampCurtainTopPct(value: number): number {
  if (!Number.isFinite(value)) return CURTAIN_DEFAULT_TOP_PCT;
  return Math.round(
    Math.max(CURTAIN_MIN_TOP_PCT, Math.min(CURTAIN_MAX_TOP_PCT, value))
  );
}

export function createDefaultCurtainConfig(): VaultCurtainConfig {
  return {
    enabled: false,
    topPct: CURTAIN_DEFAULT_TOP_PCT,
  };
}

export function createMaskBottomHalfConfig(): VaultCurtainConfig {
  return {
    enabled: true,
    topPct: CURTAIN_DEFAULT_TOP_PCT,
  };
}

export function normalizeCurtainConfig(raw: unknown): VaultCurtainConfig {
  if (!raw || typeof raw !== 'object') {
    return createDefaultCurtainConfig();
  }
  const obj = raw as Record<string, unknown>;
  return {
    enabled: Boolean(obj.enabled),
    topPct: clampCurtainTopPct(
      typeof obj.topPct === 'number' ? obj.topPct : Number(obj.topPct)
    ),
  };
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore private browsing / restricted storage errors
  }
  return null;
}

export function loadAllVaultCurtains(
  storage: StorageLike | null = getDefaultStorage()
): VaultCurtainMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(VAULT_CURTAIN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = safeJsonParse<unknown>(raw, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: VaultCurtainMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === 'string' && id.trim() && !isDangerousKey(id)) {
        out[id] = normalizeCurtainConfig(value);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getVaultCurtainConfig(
  itemId: string | null | undefined,
  storage: StorageLike | null = getDefaultStorage()
): VaultCurtainConfig {
  if (!itemId) return createDefaultCurtainConfig();
  const map = loadAllVaultCurtains(storage);
  return map[itemId] ? normalizeCurtainConfig(map[itemId]) : createDefaultCurtainConfig();
}

export function saveVaultCurtainConfig(
  itemId: string,
  config: VaultCurtainConfig,
  storage: StorageLike | null = getDefaultStorage()
): VaultCurtainConfig {
  const normalized = normalizeCurtainConfig(config);
  if (!itemId || !storage || isDangerousKey(itemId)) return normalized;
  const map = loadAllVaultCurtains(storage);
  map[itemId] = normalized;
  if (safeLocalStorageSet(VAULT_CURTAIN_STORAGE_KEY, JSON.stringify(map), storage).ok) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(VAULT_CURTAIN_CHANGE_EVENT, {
          detail: { itemId, config: normalized },
        })
      );
    }
  }
  return normalized;
}

export function removeVaultCurtainConfig(
  itemId: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!itemId || !storage || isDangerousKey(itemId)) return;
  const map = loadAllVaultCurtains(storage);
  if (itemId in map) {
    delete map[itemId];
    safeLocalStorageSet(VAULT_CURTAIN_STORAGE_KEY, JSON.stringify(map), storage);
  }
}

/**
 * Converts a pointer clientY coordinate inside an image container bounding box
 * into a clamped curtain top percentage (`20..85`).
 */
export function computeCurtainTopPctFromPointer(
  clientY: number,
  containerTop: number,
  containerHeight: number
): number {
  if (!Number.isFinite(containerHeight) || containerHeight <= 1) {
    return CURTAIN_DEFAULT_TOP_PCT;
  }
  const ratio = ((clientY - containerTop) / containerHeight) * 100;
  return clampCurtainTopPct(ratio);
}
