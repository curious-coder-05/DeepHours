import {
  buildVaultArchiveBundle,
  decodeVaultBlob,
  parseVaultArchiveJson,
  planVaultArchiveImport,
  type VaultArchiveBundle,
} from './vaultArchive';
import { sanitizeVaultItem } from './vaultLogic';
import type {
  VaultBlobRecord,
  VaultItem,
  VaultMetaRecord,
  VaultTombstone,
} from './vaultTypes';

const DB_NAME = 'deephours-vault';
const DB_VERSION = 1;
const STORE_ITEMS = 'items';
const STORE_BLOBS = 'blobs';
const STORE_TOMBSTONES = 'tombstones';
const STORE_META = 'meta';

let persistAttempted = false;
let persistPromise: Promise<boolean> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openVaultDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const itemsStore = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        itemsStore.createIndex('createdAt', 'createdAt', { unique: false });
        itemsStore.createIndex('subjectId', 'subjectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        const blobsStore = db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
        blobsStore.createIndex('itemId', 'itemId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) {
        db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open Vault database'));
  });
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Vault IndexedDB request failed'));
  });
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Vault transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Vault transaction aborted'));
  });
}

export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  if (persistPromise) {
    return persistPromise;
  }
  persistPromise = (async () => {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        const already = await navigator.storage.persisted();
        if (already) {
          persistAttempted = true;
          return true;
        }
      }
      if (persistAttempted) {
        return false;
      }
      persistAttempted = true;
      return Boolean(await navigator.storage.persist());
    } catch {
      persistAttempted = true;
      return false;
    } finally {
      persistPromise = null;
    }
  })();
  return persistPromise;
}

export function makeBlobKey(itemId: string, slot: 'q' | 's'): string {
  return `${itemId}:${slot}`;
}

export async function listVaultItems(): Promise<VaultItem[]> {
  void ensurePersistentStorage();
  if (!hasIndexedDb()) return [];
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_ITEMS, 'readonly');
    const all = (await idbReq(tx.objectStore(STORE_ITEMS).getAll())) as VaultItem[];
    return (all || [])
      .filter((x) => x && !x.deletedAt)
      .map((x) => sanitizeVaultItem(x))
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function listVaultTombstones(): Promise<VaultTombstone[]> {
  if (!hasIndexedDb()) return [];
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_TOMBSTONES, 'readonly');
    const all = (await idbReq(tx.objectStore(STORE_TOMBSTONES).getAll())) as VaultTombstone[];
    return all || [];
  } finally {
    db.close();
  }
}

export async function getVaultItem(id: string): Promise<VaultItem | null> {
  if (!hasIndexedDb()) return null;
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_ITEMS, 'readonly');
    const row = (await idbReq(tx.objectStore(STORE_ITEMS).get(id))) as VaultItem | undefined;
    return row ? sanitizeVaultItem(row) : null;
  } finally {
    db.close();
  }
}

export async function getVaultBlobRecord(
  itemId: string,
  slot: 'q' | 's'
): Promise<VaultBlobRecord | null> {
  if (!hasIndexedDb()) return null;
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const row = (await idbReq(
      tx.objectStore(STORE_BLOBS).get(makeBlobKey(itemId, slot))
    )) as VaultBlobRecord | undefined;
    return row || null;
  } finally {
    db.close();
  }
}

export async function getVaultBlob(
  itemId: string,
  slot: 'q' | 's'
): Promise<Blob | null> {
  const rec = await getVaultBlobRecord(itemId, slot);
  return rec?.blob || null;
}

export interface SaveVaultBlobInput {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}

export async function saveVaultItem(
  item: VaultItem,
  qImage?: SaveVaultBlobInput | null,
  sImage?: SaveVaultBlobInput | null | 'delete'
): Promise<VaultItem> {
  const clean = sanitizeVaultItem(item);
  const db = await openVaultDb();
  try {
    const tx = db.transaction([STORE_ITEMS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite');
    tx.objectStore(STORE_ITEMS).put(clean);
    tx.objectStore(STORE_TOMBSTONES).delete(clean.id);

    const blobStore = tx.objectStore(STORE_BLOBS);
    if (qImage) {
      const qRec: VaultBlobRecord = {
        key: makeBlobKey(clean.id, 'q'),
        itemId: clean.id,
        slot: 'q',
        blob: qImage.blob,
        bytes: qImage.blob.size,
        width: qImage.width,
        height: qImage.height,
        mime: qImage.mime || qImage.blob.type || 'image/webp',
        updatedAt: clean.updatedAt,
      };
      blobStore.put(qRec);
    }

    if (sImage === 'delete' || !clean.hasSolutionImage) {
      blobStore.delete(makeBlobKey(clean.id, 's'));
    } else if (sImage) {
      const sRec: VaultBlobRecord = {
        key: makeBlobKey(clean.id, 's'),
        itemId: clean.id,
        slot: 's',
        blob: sImage.blob,
        bytes: sImage.blob.size,
        width: sImage.width,
        height: sImage.height,
        mime: sImage.mime || sImage.blob.type || 'image/webp',
        updatedAt: clean.updatedAt,
      };
      blobStore.put(sRec);
    }

    await waitTx(tx);
  } finally {
    db.close();
  }

  void ensurePersistentStorage();
  return clean;
}

export async function saveVaultBlobOnly(
  itemId: string,
  slot: 'q' | 's',
  input: SaveVaultBlobInput
): Promise<void> {
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    const rec: VaultBlobRecord = {
      key: makeBlobKey(itemId, slot),
      itemId,
      slot,
      blob: input.blob,
      bytes: input.blob.size,
      width: input.width,
      height: input.height,
      mime: input.mime || input.blob.type || 'image/webp',
      updatedAt: Date.now(),
    };
    tx.objectStore(STORE_BLOBS).put(rec);
    await waitTx(tx);
  } finally {
    db.close();
  }
}

export async function deleteVaultItemLocal(
  id: string,
  options?: { recordTombstone?: boolean }
): Promise<VaultTombstone | null> {
  const recordTombstone = options?.recordTombstone !== false;
  const db = await openVaultDb();
  let tombstone: VaultTombstone | null = null;
  try {
    const readTx = db.transaction(STORE_ITEMS, 'readonly');
    const existing = (await idbReq(
      readTx.objectStore(STORE_ITEMS).get(id)
    )) as VaultItem | undefined;

    const tx = db.transaction([STORE_ITEMS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite');
    tx.objectStore(STORE_ITEMS).delete(id);
    tx.objectStore(STORE_BLOBS).delete(makeBlobKey(id, 'q'));
    tx.objectStore(STORE_BLOBS).delete(makeBlobKey(id, 's'));

    if (recordTombstone) {
      tombstone = {
        id,
        deletedAt: Date.now(),
        driveQId: existing?.driveQId,
        driveSId: existing?.driveSId,
      };
      tx.objectStore(STORE_TOMBSTONES).put(tombstone);
    } else {
      tx.objectStore(STORE_TOMBSTONES).delete(id);
    }
    await waitTx(tx);
  } finally {
    db.close();
  }
  return tombstone;
}

export async function purgeVaultTombstones(ids: readonly string[]): Promise<void> {
  if (!ids.length || !hasIndexedDb()) return;
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_TOMBSTONES, 'readwrite');
    const store = tx.objectStore(STORE_TOMBSTONES);
    for (const id of ids) {
      store.delete(id);
    }
    await waitTx(tx);
  } finally {
    db.close();
  }
}

export async function applyVaultSyncMerge(
  mergedItems: readonly VaultItem[],
  remainingTombstones: readonly VaultTombstone[]
): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openVaultDb();
  try {
    const existingIdsTx = db.transaction(STORE_ITEMS, 'readonly');
    const existingItems = (await idbReq(
      existingIdsTx.objectStore(STORE_ITEMS).getAll()
    )) as VaultItem[];

    const mergedMap = new Map<string, VaultItem>();
    for (const item of mergedItems) {
      mergedMap.set(item.id, sanitizeVaultItem(item));
    }

    const tx = db.transaction([STORE_ITEMS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite');
    const itemStore = tx.objectStore(STORE_ITEMS);
    const blobStore = tx.objectStore(STORE_BLOBS);
    const tombStore = tx.objectStore(STORE_TOMBSTONES);

    for (const old of existingItems || []) {
      const winner = mergedMap.get(old.id);
      if (!winner) {
        itemStore.delete(old.id);
        blobStore.delete(makeBlobKey(old.id, 'q'));
        blobStore.delete(makeBlobKey(old.id, 's'));
      } else if (!winner.hasSolutionImage) {
        blobStore.delete(makeBlobKey(old.id, 's'));
      }
    }

    for (const item of mergedMap.values()) {
      itemStore.put(item);
    }

    tombStore.clear();
    for (const tomb of remainingTombstones) {
      tombStore.put(tomb);
    }

    await waitTx(tx);
  } finally {
    db.close();
  }
}

export async function getVaultMeta(): Promise<VaultMetaRecord> {
  if (!hasIndexedDb()) return {};
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_META, 'readonly');
    const rec = (await idbReq(tx.objectStore(STORE_META).get('vault'))) as
      | ({ key: string } & VaultMetaRecord)
      | undefined;
    if (!rec) return {};
    const { key: _ignored, ...rest } = rec;
    return rest;
  } finally {
    db.close();
  }
}

export async function setVaultMeta(patch: Partial<VaultMetaRecord>): Promise<VaultMetaRecord> {
  if (!hasIndexedDb()) return patch;
  const cur = await getVaultMeta();
  const next: VaultMetaRecord = { ...cur, ...patch };
  const db = await openVaultDb();
  try {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key: 'vault', ...next });
    await waitTx(tx);
  } finally {
    db.close();
  }
  return next;
}

export async function clearAllVaultData(): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openVaultDb();
  try {
    const tx = db.transaction(
      [STORE_ITEMS, STORE_BLOBS, STORE_TOMBSTONES, STORE_META],
      'readwrite'
    );
    tx.objectStore(STORE_ITEMS).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.objectStore(STORE_TOMBSTONES).clear();
    tx.objectStore(STORE_META).clear();
    await waitTx(tx);
  } finally {
    db.close();
  }
}

export async function exportVaultArchiveBundle(): Promise<VaultArchiveBundle> {
  const items = await listVaultItems();
  const records = await Promise.all(
    items.map(async (item) => {
      const [qRec, sRec] = await Promise.all([
        getVaultBlobRecord(item.id, 'q'),
        item.hasSolutionImage ? getVaultBlobRecord(item.id, 's') : Promise.resolve(null),
      ]);
      return {
        item,
        qImage: qRec
          ? {
              blob: qRec.blob,
              width: qRec.width || item.width,
              height: qRec.height || item.height,
              mime: qRec.mime || item.mime || 'image/webp',
            }
          : null,
        sImage: sRec
          ? {
              blob: sRec.blob,
              width: sRec.width || item.width,
              height: sRec.height || item.height,
              mime: sRec.mime || 'image/webp',
            }
          : null,
      };
    })
  );

  return buildVaultArchiveBundle(records);
}

export async function importVaultArchiveBundle(rawJson: string): Promise<{
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  itemCount: number;
}> {
  const bundle = parseVaultArchiveJson(rawJson);
  const existingItems = await listVaultItems();
  const plan = planVaultArchiveImport(existingItems, bundle.entries);

  for (const entry of plan.toSave) {
    const qDecoded = decodeVaultBlob(entry.qImage);
    const sDecoded = entry.sImage ? decodeVaultBlob(entry.sImage) : null;
    await saveVaultItem(
      {
        ...entry.item,
        qBytes: qDecoded.blob.size,
        width: qDecoded.width || entry.item.width,
        height: qDecoded.height || entry.item.height,
        mime: qDecoded.mime,
        hasSolutionImage: Boolean(sDecoded),
        syncState: 'pending',
      },
      qDecoded,
      sDecoded || 'delete'
    );
  }

  return {
    addedCount: plan.addedCount,
    updatedCount: plan.updatedCount,
    skippedCount: plan.skippedCount,
    itemCount: bundle.itemCount,
  };
}
