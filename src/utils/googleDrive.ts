import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from './cloudSync';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const SCOPES = [GOOGLE_DRIVE_SCOPE] as const;

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export const VAULT_FOLDER_NAME = 'Deep Hours Vault';
export const LEGACY_BACKUP_FOLDER_NAME = 'Deep Hours Backups';
export const DEEP_HOURS_DRIVE_FOLDER = VAULT_FOLDER_NAME;

export const VAULT_FOLDER_CACHE_KEY = 'dh_vault_folder_id';
export const VAULT_MANIFEST_CACHE_KEY = 'dh_vault_manifest_id';

export type VaultAppFileKind = 'q' | 's' | 'index' | 'backup';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

export interface EnsureVaultFolderResult {
  id: string;
  name: string;
  webViewLink?: string;
  migratedFromLegacy?: boolean;
}

export class DriveApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
  }
}

// Strictly in-memory OAuth token cache (never persisted to localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
const tokenListeners = new Set<(token: string | null, user: User | null) => void>();
let lastKnownUser: User | null = null;

function notifyTokenListeners(): void {
  for (const listener of tokenListeners) {
    try {
      listener(cachedAccessToken, lastKnownUser);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeDriveTokenChange(
  listener: (token: string | null, user: User | null) => void
): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

function createDriveProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export function initDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
): () => void {
  if (!auth) {
    onAuthFailure?.(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user: User | null) => {
    lastKnownUser = user;
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.(user);
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.(null);
    }
    notifyTokenListeners();
  });
}

export async function googleDriveSignIn(): Promise<{
  user: User;
  accessToken: string;
}> {
  if (!auth) {
    throw new Error('Authentication service is unavailable');
  }
  const provider = createDriveProvider();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain a Google Drive access token');
    }
    cachedAccessToken = credential.accessToken;
    lastKnownUser = result.user;
    notifyTokenListeners();
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function getDriveAuthUser(): User | null {
  return lastKnownUser;
}

export function clearDriveAccessToken(): void {
  cachedAccessToken = null;
  notifyTokenListeners();
}

export async function disconnectDriveSession(): Promise<void> {
  const tokenToRevoke = cachedAccessToken;
  cachedAccessToken = null;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(VAULT_FOLDER_CACHE_KEY);
      window.localStorage.removeItem(VAULT_MANIFEST_CACHE_KEY);
    }
  } catch {
    // ignore storage access issues
  }
  notifyTokenListeners();

  if (tokenToRevoke) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
    } catch {
      // Best-effort revocation only; local session is already cleared
    }
  }
}

function escapeDriveQueryLiteral(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Every file query inside Deep Hours must be scoped strictly to a specific folderId.
 */
export function buildListQuery(folderId: string, extra?: string): string {
  const cleanFolder = (folderId || '').trim();
  if (!cleanFolder) {
    throw new Error('folderId is required to list Drive files');
  }
  const base = `'${escapeDriveQueryLiteral(cleanFolder)}' in parents and trashed = false`;
  const cleanExtra = (extra || '').trim();
  if (cleanExtra) {
    return `${base} and (${cleanExtra})`;
  }
  return base;
}

export function decideVaultFolderMigration(counts: {
  vaultFolderCount: number;
  legacyBackupFolderCount: number;
}): 'use-vault' | 'rename-legacy' | 'merge-legacy-into-vault' | 'create-vault' {
  if (counts.vaultFolderCount > 0 && counts.legacyBackupFolderCount > 0) {
    return 'merge-legacy-into-vault';
  }
  if (counts.vaultFolderCount > 0) {
    return 'use-vault';
  }
  if (counts.legacyBackupFolderCount > 0) {
    return 'rename-legacy';
  }
  return 'create-vault';
}

export function isDeepHoursBackupFile(
  file: Pick<DriveFileItem, 'name' | 'mimeType' | 'appProperties'>
): boolean {
  if (file.appProperties?.kind === 'backup') {
    return true;
  }
  const lower = (file.name || '').toLowerCase();
  if (lower.startsWith('backup-') && (lower.endsWith('.json') || lower.endsWith('.csv'))) {
    return true;
  }
  return (
    (lower.endsWith('.json') || lower.endsWith('.csv')) &&
    lower.includes('deep-hours')
  );
}

export function formatDriveFileSize(sizeStr?: string | number): string {
  const bytes = Number(sizeStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDriveMimeLabel(mimeType: string, fileName?: string): string {
  const lowerName = (fileName || '').toLowerCase();
  if (mimeType === 'application/vnd.google-apps.folder') return 'Folder';
  if (mimeType === 'application/json' || lowerName.endsWith('.json')) return 'JSON backup';
  if (mimeType === 'text/csv' || lowerName.endsWith('.csv')) return 'CSV export';
  if (mimeType.startsWith('image/')) return 'Image';
  return 'File';
}

async function parseDriveResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Google Drive request failed (${res.status})`;
    try {
      const errBody = (await res.json()) as {
        error?: { message?: string };
      };
      if (errBody?.error?.message) {
        msg = errBody.error.message;
      }
    } catch {
      // ignore non-json error response
    }
    if (res.status === 401) {
      cachedAccessToken = null;
      notifyTokenListeners();
    }
    throw new DriveApiError(msg, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function readCachedFolderId(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(VAULT_FOLDER_CACHE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

function writeCachedFolderId(id: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VAULT_FOLDER_CACHE_KEY, id);
    }
  } catch {
    // ignore storage errors
  }
}

async function findFolderByExactName(
  accessToken: string,
  folderName: string
): Promise<DriveFileItem[]> {
  const q = [
    'trashed = false',
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escapeDriveQueryLiteral(folderName)}'`,
  ].join(' and ');

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,webViewLink,trashed)',
    pageSize: '10',
    spaces: 'drive',
  });

  const data = await parseDriveResponse<{ files?: DriveFileItem[] }>(
    await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  );
  return data.files || [];
}

export async function getVaultFileMeta(
  accessToken: string,
  fileId: string
): Promise<DriveFileItem | null> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed,appProperties`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 404) {
    return null;
  }
  return parseDriveResponse<DriveFileItem>(res);
}

export async function listVaultFolderFiles(
  accessToken: string,
  folderId: string,
  extra?: string
): Promise<DriveFileItem[]> {
  const q = buildListQuery(folderId, extra);
  const all: DriveFileItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q,
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,appProperties)',
      orderBy: 'modifiedTime desc',
      pageSize: '1000',
      spaces: 'drive',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await parseDriveResponse<{
      files?: DriveFileItem[];
      nextPageToken?: string;
    }>(res);
    if (data.files && data.files.length > 0) {
      all.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

async function moveFileBetweenFolders(
  accessToken: string,
  fileId: string,
  fromFolderId: string,
  toFolderId: string
): Promise<void> {
  const params = new URLSearchParams({
    addParents: toFolderId,
    removeParents: fromFolderId,
    fields: 'id,parents',
  });
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  await parseDriveResponse<DriveFileItem>(res);
}

export async function ensureVaultFolder(
  accessToken: string
): Promise<EnsureVaultFolderResult> {
  const cachedId = readCachedFolderId();
  if (cachedId) {
    try {
      const meta = await getVaultFileMeta(accessToken, cachedId);
      if (
        meta &&
        !meta.trashed &&
        meta.mimeType === 'application/vnd.google-apps.folder' &&
        meta.name === VAULT_FOLDER_NAME
      ) {
        return {
          id: meta.id,
          name: meta.name,
          webViewLink: meta.webViewLink,
        };
      }
    } catch (err) {
      if (err instanceof DriveApiError && err.status === 401) {
        throw err;
      }
      // Fall through to query Drive cleanly
    }
  }

  const [vaultMatches, legacyMatches] = await Promise.all([
    findFolderByExactName(accessToken, VAULT_FOLDER_NAME),
    findFolderByExactName(accessToken, LEGACY_BACKUP_FOLDER_NAME),
  ]);

  const decision = decideVaultFolderMigration({
    vaultFolderCount: vaultMatches.length,
    legacyBackupFolderCount: legacyMatches.length,
  });

  if (decision === 'use-vault') {
    const folder = vaultMatches[0];
    writeCachedFolderId(folder.id);
    return {
      id: folder.id,
      name: folder.name,
      webViewLink: folder.webViewLink,
    };
  }

  if (decision === 'rename-legacy') {
    const legacy = legacyMatches[0];
    const renamed = await parseDriveResponse<DriveFileItem>(
      await fetch(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(legacy.id)}?fields=id,name,webViewLink`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: VAULT_FOLDER_NAME,
            appProperties: { dh: '1', kind: 'vault-folder' },
          }),
        }
      )
    );
    writeCachedFolderId(renamed.id);
    return {
      id: renamed.id,
      name: renamed.name,
      webViewLink: renamed.webViewLink,
      migratedFromLegacy: true,
    };
  }

  if (decision === 'merge-legacy-into-vault') {
    const vaultFolder = vaultMatches[0];
    let migratedAny = false;
    for (const legacyFolder of legacyMatches) {
      const legacyFiles = await listVaultFolderFiles(accessToken, legacyFolder.id);
      let movedAll = true;
      for (const file of legacyFiles) {
        try {
          await moveFileBetweenFolders(
            accessToken,
            file.id,
            legacyFolder.id,
            vaultFolder.id
          );
          migratedAny = true;
        } catch {
          movedAll = false;
        }
      }
      if (movedAll) {
        const remaining = await listVaultFolderFiles(accessToken, legacyFolder.id);
        if (remaining.length === 0) {
          try {
            await deleteDriveFile(accessToken, legacyFolder.id);
          } catch {
            // Non-fatal if empty legacy folder cleanup is rejected
          }
        }
      }
    }
    writeCachedFolderId(vaultFolder.id);
    return {
      id: vaultFolder.id,
      name: vaultFolder.name,
      webViewLink: vaultFolder.webViewLink,
      migratedFromLegacy: migratedAny,
    };
  }

  const created = await parseDriveResponse<DriveFileItem>(
    await fetch(`${DRIVE_API_BASE}/files?fields=id,name,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: VAULT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { dh: '1', kind: 'vault-folder' },
      }),
    })
  );
  writeCachedFolderId(created.id);
  return {
    id: created.id,
    name: created.name,
    webViewLink: created.webViewLink,
  };
}

export async function uploadVaultFile(
  accessToken: string,
  params: {
    name: string;
    body: Blob | string;
    mimeType: string;
    folderId: string;
    kind: VaultAppFileKind;
    itemId?: string;
    description?: string;
  }
): Promise<DriveFileItem> {
  if (!params.folderId.trim()) {
    throw new Error('folderId is required when uploading to Deep Hours Vault');
  }
  const appProperties: Record<string, string> = {
    dh: '1',
    kind: params.kind,
  };
  if (params.itemId) {
    appProperties.itemId = params.itemId;
  }

  const metadata = {
    name: params.name,
    mimeType: params.mimeType,
    parents: [params.folderId],
    description: params.description || 'Deep Hours Vault item',
    appProperties,
  };

  const boundary = `deephours_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const headerPart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${params.mimeType}\r\n\r\n`;
  const footerPart = `\r\n--${boundary}--`;

  const payload =
    typeof params.body === 'string'
      ? new Blob([headerPart, params.body, footerPart])
      : new Blob([headerPart, params.body, footerPart]);

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,appProperties`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: payload,
    }
  );

  return parseDriveResponse<DriveFileItem>(res);
}

export async function updateVaultFileContent(
  accessToken: string,
  fileId: string,
  body: Blob | string,
  mimeType: string
): Promise<DriveFileItem> {
  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,appProperties`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
      },
      body,
    }
  );
  return parseDriveResponse<DriveFileItem>(res);
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 404) {
    return;
  }
  await parseDriveResponse<void>(res);
}

export async function downloadDriveFileText(
  accessToken: string,
  fileId: string
): Promise<string> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    await parseDriveResponse<never>(res);
  }
  return res.text();
}

export async function downloadDriveFileBlob(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    await parseDriveResponse<never>(res);
  }
  return res.blob();
}
