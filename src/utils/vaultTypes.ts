export type VaultKind = 'unsolved' | 'hard';
export type VaultSyncState = 'pending' | 'synced' | 'error';

export type VaultDriveStatus =
  | 'synced'
  | 'syncing'
  | 'local'
  | 'reconnect'
  | 'error';

export interface VaultItem {
  id: string;
  subjectId: string;
  chapterId?: string;
  kind: VaultKind;
  createdAt: number;
  updatedAt: number;
  mastered: boolean;
  masteredAt?: number;
  answerText?: string;
  solutionText?: string;
  note?: string;
  hasSolutionImage: boolean;
  qBytes: number;
  width: number;
  height: number;
  mime: string;
  revisionCount: number;
  lastRevisedAt?: number;
  deletedAt?: number;
  driveQId?: string;
  driveSId?: string;
  syncState: VaultSyncState;
}

export interface VaultBlobRecord {
  key: string; // `${itemId}:q` | `${itemId}:s`
  itemId: string;
  slot: 'q' | 's';
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  mime: string;
  updatedAt: number;
}

export interface VaultTombstone {
  id: string;
  deletedAt: number;
  driveQId?: string;
  driveSId?: string;
}

export interface VaultManifest {
  schema: 1;
  updatedAt: number;
  items: VaultItem[];
  tombstones: VaultTombstone[];
}

export interface VaultMetaRecord {
  folderId?: string;
  folderWebViewLink?: string;
  manifestId?: string;
  lastSyncAt?: number;
  lastManifestModified?: string;
  hasConnectedBefore?: boolean;
}

export interface VaultSyncSnapshot {
  status: VaultDriveStatus;
  pendingCount: number;
  lastSyncAt?: number;
  errorMessage?: string | null;
  backoffUntil?: number;
  restoreProgress?: { done: number; total: number; label?: string } | null;
}

export const VAULT_LIMITS = {
  answerMax: 200,
  solutionMax: 4000,
  noteMax: 200,
} as const;
