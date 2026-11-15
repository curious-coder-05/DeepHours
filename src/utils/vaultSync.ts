import {
  DriveApiError,
  VAULT_MANIFEST_CACHE_KEY,
  clearDriveAccessToken,
  deleteDriveFile,
  downloadDriveFileBlob,
  downloadDriveFileText,
  ensureVaultFolder,
  getDriveAccessToken,
  getVaultFileMeta,
  listVaultFolderFiles,
  subscribeDriveTokenChange,
  updateVaultFileContent,
  uploadVaultFile,
  type DriveFileItem,
} from './googleDrive';
import {
  buildVaultManifest,
  mergeVaultManifest,
  parseVaultManifest,
  sanitizeVaultItem,
} from './vaultLogic';
import {
  applyVaultSyncMerge,
  getVaultBlobRecord,
  getVaultMeta,
  listVaultItems,
  listVaultTombstones,
  saveVaultBlobOnly,
  saveVaultItem,
  setVaultMeta,
} from './vaultStore';
import type {
  VaultItem,
  VaultManifest,
  VaultSyncSnapshot,
  VaultTombstone,
} from './vaultTypes';

const SYNC_DEBOUNCE_MS = 5000;
const BASE_BACKOFF_MS = 8000;
const MAX_BACKOFF_MS = 300_000; // 5 minutes
const MANIFEST_FILENAME = 'vault-index.json';

let currentSnapshot: VaultSyncSnapshot = {
  status: 'local',
  pendingCount: 0,
  errorMessage: null,
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightSync: Promise<void> | null = null;
let rerunRequested = false;
let consecutiveBackoffFailures = 0;

const listeners = new Set<(snap: VaultSyncSnapshot) => void>();

function emitSnapshot(patch: Partial<VaultSyncSnapshot>): void {
  currentSnapshot = { ...currentSnapshot, ...patch };
  for (const cb of listeners) {
    try {
      cb(currentSnapshot);
    } catch {
      // ignore listener errors
    }
  }
}

export function getVaultSyncSnapshot(): VaultSyncSnapshot {
  return currentSnapshot;
}

export function subscribeVaultSync(
  cb: (snap: VaultSyncSnapshot) => void
): () => void {
  listeners.add(cb);
  try {
    cb(currentSnapshot);
  } catch {
    // ignore
  }
  return () => {
    listeners.delete(cb);
  };
}

export async function refreshVaultSyncStatusFromStore(): Promise<VaultSyncSnapshot> {
  const [items, tombstones, meta] = await Promise.all([
    listVaultItems(),
    listVaultTombstones(),
    getVaultMeta(),
  ]);
  const pendingCount =
    items.filter((i) => !i.driveQId || i.syncState !== 'synced' || (i.hasSolutionImage && !i.driveSId))
      .length + tombstones.length;
  const token = getDriveAccessToken();
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

  let status = currentSnapshot.status;
  if (inFlightSync) {
    status = 'syncing';
  } else if (!token) {
    status = meta.hasConnectedBefore ? 'reconnect' : 'local';
  } else if (!isOnline) {
    status = 'local';
  } else if (currentSnapshot.status === 'error' && consecutiveBackoffFailures > 0) {
    status = 'error';
  } else if (pendingCount === 0 && meta.lastSyncAt) {
    status = 'synced';
  } else if (token) {
    status = 'synced';
  }

  emitSnapshot({
    status,
    pendingCount,
    lastSyncAt: meta.lastSyncAt,
  });
  return currentSnapshot;
}

function getFileExtensionForMime(mime: string): string {
  return (mime || '').toLowerCase() === 'image/jpeg' ? 'jpg' : 'webp';
}

async function findManifestInFolder(
  accessToken: string,
  folderId: string,
  cachedId?: string
): Promise<DriveFileItem | null> {
  if (cachedId) {
    try {
      const meta = await getVaultFileMeta(accessToken, cachedId);
      if (meta && !meta.trashed && meta.name === MANIFEST_FILENAME) {
        return meta;
      }
    } catch {
      // fall through to folder listing
    }
  }
  const matches = await listVaultFolderFiles(
    accessToken,
    folderId,
    `name = '${MANIFEST_FILENAME}'`
  );
  return matches[0] || null;
}

function writeCachedManifestId(id: string | undefined): void {
  try {
    if (typeof window === 'undefined') return;
    if (id) window.localStorage.setItem(VAULT_MANIFEST_CACHE_KEY, id);
    else window.localStorage.removeItem(VAULT_MANIFEST_CACHE_KEY);
  } catch {
    // ignore storage errors
  }
}

async function readRemoteManifest(
  accessToken: string,
  manifestFile: DriveFileItem | null
): Promise<VaultManifest | null> {
  if (!manifestFile) return null;
  const text = await downloadDriveFileText(accessToken, manifestFile.id);
  return parseVaultManifest(text);
}

async function runSyncOnce(): Promise<void> {
  const token = getDriveAccessToken();
  const meta = await getVaultMeta();
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (!isOnline) {
    await refreshVaultSyncStatusFromStore();
    emitSnapshot({ status: 'local', errorMessage: null });
    return;
  }

  if (!token) {
    await refreshVaultSyncStatusFromStore();
    emitSnapshot({
      status: meta.hasConnectedBefore ? 'reconnect' : 'local',
      errorMessage: null,
    });
    return;
  }

  const initialItems = await listVaultItems();
  const initialTombstones = await listVaultTombstones();
  const pendingTotal =
    initialItems.filter(
      (i) => !i.driveQId || i.syncState !== 'synced' || (i.hasSolutionImage && !i.driveSId)
    ).length + initialTombstones.length;

  emitSnapshot({
    status: 'syncing',
    pendingCount: pendingTotal,
    errorMessage: null,
  });

  try {
    const folder = await ensureVaultFolder(token);
    await setVaultMeta({
      folderId: folder.id,
      folderWebViewLink: folder.webViewLink,
      hasConnectedBefore: true,
    });

    const cachedManifestId =
      meta.manifestId ||
      (typeof window !== 'undefined'
        ? window.localStorage.getItem(VAULT_MANIFEST_CACHE_KEY) || undefined
        : undefined);

    let manifestFile = await findManifestInFolder(token, folder.id, cachedManifestId);
    if (manifestFile) {
      writeCachedManifestId(manifestFile.id);
    }

    let remoteManifest: VaultManifest | null = null;
    if (manifestFile) {
      remoteManifest = await readRemoteManifest(token, manifestFile);
    }

    // Merge local & remote metadata
    let localItems = await listVaultItems();
    let localTombstones = await listVaultTombstones();
    let merged = mergeVaultManifest(localItems, localTombstones, remoteManifest);

    // Upload pending q and s blobs (and re-upload if previously 404'd)
    const updatedMap = new Map<string, VaultItem>();
    for (const item of merged.mergedItems) {
      updatedMap.set(item.id, item);
    }

    let remainingCount =
      merged.itemsNeedingUpload.length +
      merged.itemsNeedingBlobDownload.length +
      merged.driveFileIdsToDelete.length;

    for (const item of merged.itemsNeedingUpload) {
      const currentItem = updatedMap.get(item.id) || item;
      let nextDriveQId = currentItem.driveQId;
      let nextDriveSId = currentItem.driveSId;

      if (!nextDriveQId) {
        const qRec = await getVaultBlobRecord(currentItem.id, 'q');
        if (qRec?.blob) {
          const ext = getFileExtensionForMime(qRec.mime);
          const uploadedQ = await uploadVaultFile(token, {
            name: `q_${currentItem.id}.${ext}`,
            body: qRec.blob,
            mimeType: qRec.mime || 'image/webp',
            folderId: folder.id,
            kind: 'q',
            itemId: currentItem.id,
          });
          nextDriveQId = uploadedQ.id;
        }
      }

      if (currentItem.hasSolutionImage && !nextDriveSId) {
        const sRec = await getVaultBlobRecord(currentItem.id, 's');
        if (sRec?.blob) {
          const ext = getFileExtensionForMime(sRec.mime);
          const uploadedS = await uploadVaultFile(token, {
            name: `s_${currentItem.id}.${ext}`,
            body: sRec.blob,
            mimeType: sRec.mime || 'image/webp',
            folderId: folder.id,
            kind: 's',
            itemId: currentItem.id,
          });
          nextDriveSId = uploadedS.id;
        }
      } else if (!currentItem.hasSolutionImage && nextDriveSId) {
        try {
          await deleteDriveFile(token, nextDriveSId);
        } catch {
          // ignore if already removed
        }
        nextDriveSId = undefined;
      }

      const syncedItem = sanitizeVaultItem({
        ...currentItem,
        driveQId: nextDriveQId,
        driveSId: nextDriveSId,
        syncState: 'synced',
      });
      updatedMap.set(syncedItem.id, syncedItem);
      remainingCount = Math.max(0, remainingCount - 1);
      emitSnapshot({ pendingCount: remainingCount });
    }

    // Download missing remote blobs (also recovering from 404 if needed)
    for (const remoteItem of merged.itemsNeedingBlobDownload) {
      const currentItem = updatedMap.get(remoteItem.id) || remoteItem;
      if (currentItem.driveQId) {
        try {
          const qBlob = await downloadDriveFileBlob(token, currentItem.driveQId);
          await saveVaultBlobOnly(currentItem.id, 'q', {
            blob: qBlob,
            width: currentItem.width || 1080,
            height: currentItem.height || 1080,
            mime: qBlob.type || currentItem.mime || 'image/webp',
          });
        } catch (err) {
          if (err instanceof DriveApiError && err.status === 404) {
            updatedMap.set(
              currentItem.id,
              sanitizeVaultItem({ ...currentItem, driveQId: undefined, syncState: 'pending' })
            );
          } else {
            throw err;
          }
        }
      }
      if (currentItem.hasSolutionImage && currentItem.driveSId) {
        try {
          const sBlob = await downloadDriveFileBlob(token, currentItem.driveSId);
          await saveVaultBlobOnly(currentItem.id, 's', {
            blob: sBlob,
            width: currentItem.width || 1080,
            height: currentItem.height || 1080,
            mime: sBlob.type || 'image/webp',
          });
        } catch (err) {
          if (err instanceof DriveApiError && err.status === 404) {
            const cur = updatedMap.get(currentItem.id) || currentItem;
            updatedMap.set(
              cur.id,
              sanitizeVaultItem({ ...cur, driveSId: undefined, syncState: 'pending' })
            );
          } else {
            throw err;
          }
        }
      }
      remainingCount = Math.max(0, remainingCount - 1);
      emitSnapshot({ pendingCount: remainingCount });
    }

    // Delete tombstoned Drive blobs
    const purgedTombstoneIds = new Set<string>();
    for (const fileId of merged.driveFileIdsToDelete) {
      try {
        await deleteDriveFile(token, fileId);
      } catch (err) {
        if (!(err instanceof DriveApiError && err.status === 404)) {
          throw err;
        }
      }
      remainingCount = Math.max(0, remainingCount - 1);
      emitSnapshot({ pendingCount: remainingCount });
    }
    for (const tomb of merged.mergedTombstones) {
      purgedTombstoneIds.add(tomb.id);
    }

    // Before writing vault-index.json, verify it was not modified concurrently by another device
    let finalItemsList = Array.from(updatedMap.values()).map((it) =>
      it.driveQId && (!it.hasSolutionImage || it.driveSId)
        ? sanitizeVaultItem({ ...it, syncState: 'synced' })
        : it
    );
    let finalTombstonesList: VaultTombstone[] = [];

    if (manifestFile?.id) {
      const latestMeta = await getVaultFileMeta(token, manifestFile.id);
      if (
        latestMeta &&
        manifestFile.modifiedTime &&
        latestMeta.modifiedTime &&
        latestMeta.modifiedTime !== manifestFile.modifiedTime
      ) {
        const newerRemote = await readRemoteManifest(token, latestMeta);
        if (newerRemote) {
          const remerged = mergeVaultManifest(finalItemsList, merged.mergedTombstones, newerRemote);
          finalItemsList = remerged.mergedItems;
          finalTombstonesList = remerged.mergedTombstones.filter(
            (t) => !purgedTombstoneIds.has(t.id)
          );
        }
        manifestFile = latestMeta;
      }
    }

    const nextManifest = buildVaultManifest(finalItemsList, finalTombstonesList, Date.now());
    const manifestJson = JSON.stringify(nextManifest);

    let savedManifestFile: DriveFileItem;
    if (manifestFile?.id) {
      try {
        savedManifestFile = await updateVaultFileContent(
          token,
          manifestFile.id,
          manifestJson,
          'application/json'
        );
      } catch (err) {
        if (err instanceof DriveApiError && err.status === 404) {
          writeCachedManifestId(undefined);
          savedManifestFile = await uploadVaultFile(token, {
            name: MANIFEST_FILENAME,
            body: manifestJson,
            mimeType: 'application/json',
            folderId: folder.id,
            kind: 'index',
            description: 'Deep Hours Vault metadata index',
          });
        } else {
          throw err;
        }
      }
    } else {
      savedManifestFile = await uploadVaultFile(token, {
        name: MANIFEST_FILENAME,
        body: manifestJson,
        mimeType: 'application/json',
        folderId: folder.id,
        kind: 'index',
        description: 'Deep Hours Vault metadata index',
      });
    }

    writeCachedManifestId(savedManifestFile.id);
    await applyVaultSyncMerge(finalItemsList, finalTombstonesList);

    const syncTs = Date.now();
    await setVaultMeta({
      folderId: folder.id,
      folderWebViewLink: folder.webViewLink,
      manifestId: savedManifestFile.id,
      lastManifestModified: savedManifestFile.modifiedTime,
      lastSyncAt: syncTs,
      hasConnectedBefore: true,
    });

    consecutiveBackoffFailures = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    emitSnapshot({
      status: 'synced',
      pendingCount: 0,
      lastSyncAt: syncTs,
      errorMessage: null,
      backoffUntil: undefined,
    });
  } catch (err) {
    if (err instanceof DriveApiError && err.status === 401) {
      clearDriveAccessToken();
      emitSnapshot({
        status: 'reconnect',
        errorMessage: 'Session expired. Sign in to resume Drive sync.',
      });
      return;
    }

    const isRateLimit =
      err instanceof DriveApiError && (err.status === 403 || err.status === 429);
    if (isRateLimit) {
      consecutiveBackoffFailures += 1;
      const delay = Math.min(
        MAX_BACKOFF_MS,
        BASE_BACKOFF_MS * Math.pow(2, consecutiveBackoffFailures - 1)
      );
      const until = Date.now() + delay;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void syncVaultNow();
      }, delay);
      emitSnapshot({
        status: 'error',
        backoffUntil: until,
        errorMessage: 'Drive rate limit reached — retrying automatically.',
      });
      return;
    }

    const msg =
      err instanceof Error ? err.message : 'Could not sync Vault to Google Drive.';
    emitSnapshot({
      status: 'error',
      errorMessage: msg,
    });
  }
}

export function syncVaultNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (inFlightSync) {
    rerunRequested = true;
    return inFlightSync;
  }

  const exec = (async () => {
    try {
      await runSyncOnce();
    } finally {
      inFlightSync = null;
      if (rerunRequested) {
        rerunRequested = false;
        void syncVaultNow();
      }
    }
  })();

  inFlightSync = exec;
  return exec;
}

export function scheduleVaultSync(): void {
  void refreshVaultSyncStatusFromStore();
  const token = getDriveAccessToken();
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!token || !isOnline) return;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncVaultNow();
  }, SYNC_DEBOUNCE_MS);
}

export interface RestoreVaultProgress {
  done: number;
  total: number;
  label: string;
}

export async function restoreVaultFromDrive(
  onProgress?: (progress: RestoreVaultProgress) => void
): Promise<{ restoredCount: number }> {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('Sign in with Google Drive first to restore Vault.');
  }

  emitSnapshot({
    status: 'syncing',
    restoreProgress: { done: 0, total: 1, label: 'Reading Drive Vault index…' },
  });

  try {
    const folder = await ensureVaultFolder(token);
    const folderFiles = await listVaultFolderFiles(token, folder.id);
    const manifestFile = folderFiles.find((f) => f.name === MANIFEST_FILENAME) || null;
    if (!manifestFile) {
      emitSnapshot({ status: 'synced', restoreProgress: null });
      return { restoredCount: 0 };
    }

    const manifestText = await downloadDriveFileText(token, manifestFile.id);
    const remote = parseVaultManifest(manifestText);
    if (!remote) {
      throw new Error('Drive vault-index.json is invalid or unreadable.');
    }

    const blobMapByItemSlot = new Map<string, DriveFileItem>();
    for (const f of folderFiles) {
      const kind = f.appProperties?.kind;
      const itemId = f.appProperties?.itemId;
      if (itemId && (kind === 'q' || kind === 's')) {
        blobMapByItemSlot.set(`${itemId}:${kind}`, f);
      }
    }

    const itemsToRestore = remote.items.filter((i) => !i.deletedAt);
    const total = Math.max(1, itemsToRestore.length);
    let done = 0;
    let restoredCount = 0;

    for (const rawItem of itemsToRestore) {
      const item = sanitizeVaultItem(rawItem);
      const qFileId = item.driveQId || blobMapByItemSlot.get(`${item.id}:q`)?.id;
      const sFileId = item.driveSId || blobMapByItemSlot.get(`${item.id}:s`)?.id;

      let qInput: { blob: Blob; width: number; height: number; mime: string } | undefined;
      if (qFileId) {
        try {
          const blob = await downloadDriveFileBlob(token, qFileId);
          qInput = {
            blob,
            width: item.width || 1080,
            height: item.height || 1080,
            mime: blob.type || item.mime || 'image/webp',
          };
        } catch (err) {
          if (!(err instanceof DriveApiError && err.status === 404)) {
            throw err;
          }
        }
      }

      let sInput: { blob: Blob; width: number; height: number; mime: string } | undefined;
      if (item.hasSolutionImage && sFileId) {
        try {
          const sBlob = await downloadDriveFileBlob(token, sFileId);
          sInput = {
            blob: sBlob,
            width: item.width || 1080,
            height: item.height || 1080,
            mime: sBlob.type || 'image/webp',
          };
        } catch (err) {
          if (!(err instanceof DriveApiError && err.status === 404)) {
            throw err;
          }
        }
      }

      await saveVaultItem(
        {
          ...item,
          driveQId: qFileId,
          driveSId: sFileId,
          syncState: qFileId ? 'synced' : 'pending',
        },
        qInput,
        sInput
      );

      restoredCount += 1;
      done += 1;
      const prog = {
        done,
        total,
        label: `Restored ${done} of ${total} questions…`,
      };
      emitSnapshot({ restoreProgress: prog });
      onProgress?.(prog);
    }

    const syncTs = Date.now();
    writeCachedManifestId(manifestFile.id);
    await setVaultMeta({
      folderId: folder.id,
      folderWebViewLink: folder.webViewLink,
      manifestId: manifestFile.id,
      lastManifestModified: manifestFile.modifiedTime,
      lastSyncAt: syncTs,
      hasConnectedBefore: true,
    });

    emitSnapshot({
      status: 'synced',
      pendingCount: 0,
      lastSyncAt: syncTs,
      restoreProgress: null,
      errorMessage: null,
    });
    return { restoredCount };
  } catch (err) {
    emitSnapshot({ restoreProgress: null });
    throw err;
  }
}

export async function deleteVaultFromDrive(): Promise<{ deletedCount: number }> {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('Sign in with Google Drive first to delete Drive Vault files.');
  }

  const folder = await ensureVaultFolder(token);
  const folderFiles = await listVaultFolderFiles(token, folder.id);
  const vaultFiles = folderFiles.filter((f) => {
    const kind = f.appProperties?.kind;
    if (kind === 'q' || kind === 's' || kind === 'index') return true;
    const lower = (f.name || '').toLowerCase();
    return (
      lower === MANIFEST_FILENAME ||
      lower.startsWith('q_') ||
      lower.startsWith('s_')
    );
  });

  let deletedCount = 0;
  for (const file of vaultFiles) {
    await deleteDriveFile(token, file.id);
    deletedCount += 1;
  }

  writeCachedManifestId(undefined);
  await setVaultMeta({
    manifestId: undefined,
    lastManifestModified: undefined,
  });

  const localItems = await listVaultItems();
  for (const item of localItems) {
    await saveVaultItem({
      ...item,
      driveQId: undefined,
      driveSId: undefined,
      syncState: 'pending',
    });
  }

  await refreshVaultSyncStatusFromStore();
  return { deletedCount };
}

// Keep Vault sync state aligned when auth token or online status changes
if (typeof window !== 'undefined') {
  subscribeDriveTokenChange((token) => {
    if (token) {
      void refreshVaultSyncStatusFromStore();
    } else {
      void refreshVaultSyncStatusFromStore();
    }
  });
  window.addEventListener('online', () => {
    void refreshVaultSyncStatusFromStore().then(() => {
      if (getDriveAccessToken()) {
        void syncVaultNow();
      }
    });
  });
  window.addEventListener('offline', () => {
    void refreshVaultSyncStatusFromStore();
  });
}
