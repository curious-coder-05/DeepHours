import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  Folder,
  HardDrive,
  LogOut,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type { PulseHabitState } from '../types';
import {
  DriveApiError,
  VAULT_FOLDER_NAME,
  clearDriveAccessToken,
  deleteDriveFile,
  disconnectDriveSession,
  downloadDriveFileText,
  ensureVaultFolder,
  formatDriveFileSize,
  getDriveAccessToken,
  getDriveMimeLabel,
  googleDriveSignIn,
  initDriveAuth,
  isDeepHoursBackupFile,
  listVaultFolderFiles,
  uploadVaultFile,
  type DriveFileItem,
} from '../utils/googleDrive';
import { computeVaultCounts } from '../utils/vaultLogic';
import { getVaultMeta, listVaultItems, setVaultMeta } from '../utils/vaultStore';
import {
  getVaultSyncSnapshot,
  refreshVaultSyncStatusFromStore,
  restoreVaultFromDrive,
  subscribeVaultSync,
  syncVaultNow,
} from '../utils/vaultSync';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Meter,
  Skeleton,
  Stat,
} from './ui';

export interface GoogleDrivePanelProps {
  state: PulseHabitState;
  todayKey: string;
  isOnline: boolean;
  onBuildCsvExport: () => string;
  onRestoreBackupJson: (jsonText: string, sourceLabel?: string) => boolean;
  onMarkExported: () => void;
  onNotify: (msg: string) => void;
}

type PendingAction =
  | { type: 'restore-backup'; file: DriveFileItem }
  | { type: 'delete-backup'; file: DriveFileItem }
  | { type: 'restore-vault' };

export const GoogleDrivePanel: React.FC<GoogleDrivePanelProps> = ({
  state,
  todayKey,
  isOnline,
  onBuildCsvExport,
  onRestoreBackupJson,
  onMarkExported,
  onNotify,
}) => {
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => getDriveAccessToken());
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getDriveAccessToken());
  const [hasConnectedBefore, setHasConnectedBefore] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderWebViewLink, setFolderWebViewLink] = useState<string | undefined>(undefined);
  const [backupFiles, setBackupFiles] = useState<DriveFileItem[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const [vaultCounts, setVaultCounts] = useState(() => ({ total: 0, totalBytes: 0 }));
  const [syncSnap, setSyncSnap] = useState(() => getVaultSyncSnapshot());

  const loadLocalVaultSummary = useCallback(async () => {
    try {
      const [items, meta] = await Promise.all([listVaultItems(), getVaultMeta()]);
      const summary = computeVaultCounts(items);
      setVaultCounts({ total: summary.total, totalBytes: summary.totalBytes });
      if (meta.hasConnectedBefore) {
        setHasConnectedBefore(true);
      }
      if (meta.folderWebViewLink) {
        setFolderWebViewLink(meta.folderWebViewLink);
      }
    } catch {
      // ignore read issues
    }
  }, []);

  useEffect(() => {
    void loadLocalVaultSummary();
    void refreshVaultSyncStatusFromStore();
    const unsubSync = subscribeVaultSync((snap) => {
      setSyncSnap(snap);
    });
    const unsubAuth = initDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      (user) => {
        setDriveUser(user);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => {
      unsubSync();
      unsubAuth();
    };
  }, [loadLocalVaultSummary]);

  const handleDriveApiError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof DriveApiError && err.status === 401) {
      clearDriveAccessToken();
      setAccessToken(null);
      setNeedsAuth(true);
      setErrorMsg('Your Google Drive session expired. Reconnect to continue.');
      return;
    }
    const msg = err instanceof Error ? err.message : fallback;
    setErrorMsg(msg);
  }, []);

  const refreshVaultFolderAndBackups = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride || accessToken || getDriveAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      if (!isOnline) {
        setErrorMsg('You are offline. Connect to the internet to sync with Google Drive.');
        return;
      }

      setLoadingBackups(true);
      setErrorMsg(null);
      try {
        const folder = await ensureVaultFolder(token);
        setFolderId(folder.id);
        setFolderWebViewLink(folder.webViewLink);
        await setVaultMeta({
          folderId: folder.id,
          folderWebViewLink: folder.webViewLink,
          hasConnectedBefore: true,
        });
        const files = await listVaultFolderFiles(token, folder.id);
        const backups = files.filter(
          (f) => isDeepHoursBackupFile(f) || f.name.startsWith('backup-')
        );
        setBackupFiles(backups);
        await loadLocalVaultSummary();
      } catch (err) {
        handleDriveApiError(err, 'Could not load Deep Hours Vault folder');
      } finally {
        setLoadingBackups(false);
      }
    },
    [accessToken, handleDriveApiError, isOnline, loadLocalVaultSummary]
  );

  useEffect(() => {
    if (accessToken && !needsAuth) {
      void refreshVaultFolderAndBackups(accessToken);
    }
  }, [accessToken, needsAuth, refreshVaultFolderAndBackups]);

  const handleLogin = async () => {
    if (!isOnline) {
      setErrorMsg('You are offline. Connect to the internet to sign in with Google.');
      return;
    }
    setIsLoggingIn(true);
    setErrorMsg(null);
    try {
      const result = await googleDriveSignIn();
      setDriveUser(result.user);
      setAccessToken(result.accessToken);
      setNeedsAuth(false);
      setHasConnectedBefore(true);
      await setVaultMeta({ hasConnectedBefore: true });
      await refreshVaultFolderAndBackups(result.accessToken);
      void syncVaultNow();
      onNotify('Connected to Google Drive');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Drive sign-in failed';
      setErrorMsg(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDisconnect = async () => {
    setBusyAction('disconnect');
    try {
      await disconnectDriveSession();
      setAccessToken(null);
      setNeedsAuth(true);
      setBackupFiles([]);
      setFolderId(null);
      setErrorMsg(null);
      await refreshVaultSyncStatusFromStore();
      onNotify('Disconnected Google Drive');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncNow = async () => {
    setBusyAction('sync-vault');
    setErrorMsg(null);
    try {
      await syncVaultNow();
      await loadLocalVaultSummary();
      await refreshVaultFolderAndBackups();
      onNotify('Vault synced to Google Drive');
    } catch (err) {
      handleDriveApiError(err, 'Vault sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleBackupNow = async () => {
    const token = accessToken || getDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    setBusyAction('backup-now');
    setErrorMsg(null);
    try {
      const targetFolderId = folderId || (await ensureVaultFolder(token)).id;
      setFolderId(targetFolderId);
      const now = new Date();
      const stamp = `${String(now.getHours()).padStart(2, '0')}${String(
        now.getMinutes()
      ).padStart(2, '0')}`;
      const jsonName = `backup-${todayKey}-${stamp}.json`;
      const csvName = `backup-${todayKey}-${stamp}.csv`;

      const snapshotJson = JSON.stringify({ ...state, exp: now.getTime() }, null, 2);
      const csvText = onBuildCsvExport();

      await Promise.all([
        uploadVaultFile(token, {
          name: jsonName,
          body: snapshotJson,
          mimeType: 'application/json',
          folderId: targetFolderId,
          kind: 'backup',
          description: `Deep Hours JSON backup (${todayKey})`,
        }),
        uploadVaultFile(token, {
          name: csvName,
          body: csvText,
          mimeType: 'text/csv',
          folderId: targetFolderId,
          kind: 'backup',
          description: `Deep Hours CSV export (${todayKey})`,
        }),
      ]);

      onMarkExported();
      onNotify(`Saved JSON & CSV backups to ${VAULT_FOLDER_NAME}`);
      await refreshVaultFolderAndBackups(token);
    } catch (err) {
      handleDriveApiError(err, 'Failed to write backup to Google Drive');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStartRestoreVault = () => {
    if (vaultCounts.total > 0) {
      setPendingAction({ type: 'restore-vault' });
    } else {
      void runRestoreVault();
    }
  };

  const runRestoreVault = async () => {
    setPendingAction(null);
    setBusyAction('restore-vault');
    setErrorMsg(null);
    try {
      const { restoredCount } = await restoreVaultFromDrive();
      await loadLocalVaultSummary();
      onNotify(
        restoredCount > 0
          ? `Restored ${restoredCount} Vault question${restoredCount === 1 ? '' : 's'} from Drive`
          : 'No Vault questions found on Google Drive'
      );
    } catch (err) {
      handleDriveApiError(err, 'Could not restore Vault from Google Drive');
    } finally {
      setBusyAction(null);
    }
  };

  const executeConfirmedAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.type === 'restore-vault') {
      await runRestoreVault();
      return;
    }

    const token = accessToken || getDriveAccessToken();
    if (!token) {
      setPendingAction(null);
      setNeedsAuth(true);
      return;
    }

    const action = pendingAction;
    setBusyAction(action.type);
    setErrorMsg(null);
    try {
      if (action.type === 'restore-backup') {
        const text = await downloadDriveFileText(token, action.file.id);
        const ok = onRestoreBackupJson(text, action.file.name);
        if (!ok) {
          setErrorMsg(`"${action.file.name}" is not a valid Deep Hours JSON backup.`);
        }
      } else if (action.type === 'delete-backup') {
        await deleteDriveFile(token, action.file.id);
        onNotify(`Deleted "${action.file.name}"`);
        await refreshVaultFolderAndBackups(token);
      }
      setPendingAction(null);
    } catch (err) {
      handleDriveApiError(err, 'Google Drive operation failed');
      setPendingAction(null);
    } finally {
      setBusyAction(null);
    }
  };

  const lastSyncLabel = useMemo(() => {
    if (!syncSnap.lastSyncAt) return 'Not synced yet';
    return new Date(syncSnap.lastSyncAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [syncSnap.lastSyncAt]);

  const jsonBackups = useMemo(
    () => backupFiles.filter((f) => f.name.toLowerCase().endsWith('.json') || f.mimeType === 'application/json'),
    [backupFiles]
  );

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <Card style={{ margin: 0, display: 'grid', gap: '14px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: needsAuth ? 'var(--sf-2)' : 'var(--ac-soft)',
                border: needsAuth ? '1px solid var(--line)' : '1px solid var(--ac-bd)',
                color: needsAuth ? 'var(--tx-2)' : 'var(--ac-ink)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <HardDrive size={20} strokeWidth={1.75} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>
                {needsAuth
                  ? hasConnectedBefore
                    ? 'Reconnect Google Drive'
                    : 'Connect Google Drive'
                  : driveUser?.displayName || driveUser?.email || 'Google Drive connected'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                {needsAuth
                  ? hasConnectedBefore
                    ? 'Sign in again to sync Vault questions and study backups.'
                    : 'Sync your question Vault and study backups to one private Drive folder.'
                  : driveUser?.email || VAULT_FOLDER_NAME}
              </div>
            </div>
          </div>

          <span className="dh-status-pill">
            {!isOnline
              ? 'Offline'
              : needsAuth
                ? hasConnectedBefore
                  ? 'Reconnect'
                  : 'Local only'
                : 'Connected'}
          </span>
        </div>

        {(errorMsg || syncSnap.errorMessage) && (
          <div
            role="alert"
            style={{
              padding: '12px',
              borderRadius: '12px',
              background: 'color-mix(in srgb, var(--err) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--err) 38%, transparent)',
              fontSize: '13px',
              color: 'var(--err-ink)',
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            {errorMsg || syncSnap.errorMessage}
          </div>
        )}

        {syncSnap.restoreProgress && (
          <div
            style={{
              padding: '12px',
              borderRadius: '12px',
              background: 'var(--sf-2)',
              border: '1px solid var(--line)',
              display: 'grid',
              gap: '8px',
            }}
          >
            <div className="split" style={{ fontSize: '13px', fontWeight: 600 }}>
              <span>{syncSnap.restoreProgress.label || 'Restoring Vault…'}</span>
              <span className="tabular-nums">
                {syncSnap.restoreProgress.done} / {syncSnap.restoreProgress.total}
              </span>
            </div>
            <Meter
              value={syncSnap.restoreProgress.done}
              max={syncSnap.restoreProgress.total}
              color="var(--ac)"
            />
          </div>
        )}

        {needsAuth ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div>
              {hasConnectedBefore ? (
                <Button
                  variant="primary"
                  size="lg"
                  disabled={isLoggingIn || !isOnline}
                  onClick={() => void handleLogin()}
                >
                  <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
                  {isLoggingIn ? 'Connecting…' : 'Reconnect Google Drive'}
                </Button>
              ) : (
                <button
                  type="button"
                  className="gsi-material-button"
                  disabled={isLoggingIn || !isOnline}
                  onClick={() => void handleLogin()}
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        style={{ display: 'block' }}
                        aria-hidden="true"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {isLoggingIn ? 'Connecting…' : 'Sign in with Google'}
                    </span>
                  </div>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Stat
                label="Local Vault items"
                value={String(vaultCounts.total)}
                sub={formatDriveFileSize(vaultCounts.totalBytes)}
              />
              <Stat label="Last sync" value={lastSyncLabel} />
            </div>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
              Deep Hours can only see files it created in this folder. OAuth access tokens stay in
              memory for your current session and are never stored on disk.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Stat
                label="Drive folder"
                value={VAULT_FOLDER_NAME}
              />
              <Stat
                label="Vault questions"
                value={String(vaultCounts.total)}
                sub={formatDriveFileSize(vaultCounts.totalBytes)}
                tone={vaultCounts.total > 0 ? 'accent' : 'default'}
              />
              <Stat
                label="Last sync"
                value={lastSyncLabel}
                tone={syncSnap.status === 'synced' ? 'ok' : 'default'}
              />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <Button
                variant="primary"
                disabled={busyAction !== null || syncSnap.status === 'syncing' || !isOnline}
                onClick={() => void handleSyncNow()}
              >
                <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
                {busyAction === 'sync-vault' || syncSnap.status === 'syncing'
                  ? 'Syncing…'
                  : 'Sync now'}
              </Button>
              <Button
                variant="secondary"
                disabled={busyAction !== null || !isOnline}
                onClick={() => void handleBackupNow()}
              >
                <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
                {busyAction === 'backup-now' ? 'Backing up…' : 'Back up now'}
              </Button>
              <Button
                variant="secondary"
                disabled={busyAction !== null || !isOnline}
                onClick={handleStartRestoreVault}
              >
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                Restore Vault from Drive
              </Button>
              {folderWebViewLink && (
                <a
                  href={folderWebViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dh-btn dh-btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                    padding: '0 14px',
                    borderRadius: '12px',
                    background: 'var(--sf-2)',
                    border: '1px solid var(--line)',
                    color: 'var(--tx)',
                    fontSize: '14px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  <Folder size={16} strokeWidth={1.75} aria-hidden="true" />
                  Open in Drive
                  <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                </a>
              )}
              <Button
                variant="ghost"
                disabled={busyAction !== null}
                onClick={() => void handleDisconnect()}
              >
                <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
                Disconnect
              </Button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingTop: '6px',
                borderTop: '1px solid var(--line)',
                fontSize: '13px',
                color: 'var(--tx-2)',
              }}
            >
              <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Deep Hours can only see files it created in this folder.</span>
            </div>
          </>
        )}
      </Card>

      {!needsAuth && (
        <Card style={{ margin: 0, display: 'grid', gap: '12px' }}>
          <div className="split" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Backups</h3>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--tx-2)' }}>
                JSON and CSV study snapshots saved inside {VAULT_FOLDER_NAME}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingBackups || !isOnline}
              onClick={() => void refreshVaultFolderAndBackups()}
            >
              <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
              Refresh
            </Button>
          </div>

          {loadingBackups ? (
            <div style={{ display: 'grid', gap: '10px' }}>
              <Skeleton height={68} />
              <Skeleton height={68} />
            </div>
          ) : backupFiles.length === 0 ? (
            <EmptyState
              compact
              icon={<HardDrive size={24} strokeWidth={1.75} />}
              title="No backups in Deep Hours Vault yet"
              description='Tap "Back up now" above to save a JSON and CSV snapshot of your study data.'
            />
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {backupFiles.map((file) => {
                const isJson =
                  file.name.toLowerCase().endsWith('.json') ||
                  file.mimeType === 'application/json';
                const modifiedText = file.modifiedTime
                  ? new Date(file.modifiedTime).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Unknown date';
                return (
                  <div
                    key={file.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '12px',
                      background: 'var(--sf-2)',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: isJson ? 'var(--ac-soft)' : 'var(--sf-3)',
                          border: isJson ? '1px solid var(--ac-bd)' : '1px solid var(--line)',
                          color: isJson ? 'var(--ac-ink)' : 'var(--tx-2)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isJson ? (
                          <FileJson size={18} strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                          <FileSpreadsheet size={18} strokeWidth={1.75} aria-hidden="true" />
                        )}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--tx)',
                            wordBreak: 'break-word',
                          }}
                        >
                          {file.name}
                        </div>
                        <div className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                          {getDriveMimeLabel(file.mimeType, file.name)} ·{' '}
                          {formatDriveFileSize(file.size)} · {modifiedText}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {isJson && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setPendingAction({ type: 'restore-backup', file })}
                        >
                          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
                          Restore backup
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setPendingAction({ type: 'delete-backup', file })}
                      >
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
              {jsonBackups.length === 0 && (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--tx-2)' }}>
                  Only CSV exports were found. Tap &ldquo;Back up now&rdquo; to also store a restorable JSON snapshot.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <Dialog
        open={Boolean(pendingAction)}
        onClose={() => {
          if (!busyAction) setPendingAction(null);
        }}
        title={
          pendingAction?.type === 'restore-backup'
            ? 'Restore study backup?'
            : pendingAction?.type === 'delete-backup'
              ? 'Delete Drive backup?'
              : 'Restore Vault from Drive?'
        }
      >
        {pendingAction?.type === 'restore-backup' && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
              Restore your local study data from{' '}
              <strong style={{ color: 'var(--tx)' }}>{pendingAction.file.name}</strong>? Your
              current study sessions, syllabus chapters, mocks, tasks, and habits will be replaced
              (with an Undo toast).
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" disabled={busyAction !== null} onClick={() => setPendingAction(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busyAction !== null} onClick={() => void executeConfirmedAction()}>
                {busyAction ? 'Restoring…' : 'Confirm restore'}
              </Button>
            </div>
          </div>
        )}

        {pendingAction?.type === 'delete-backup' && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
              Delete <strong style={{ color: 'var(--tx)' }}>{pendingAction.file.name}</strong> from{' '}
              {VAULT_FOLDER_NAME}? This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" disabled={busyAction !== null} onClick={() => setPendingAction(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={busyAction !== null} onClick={() => void executeConfirmedAction()}>
                {busyAction ? 'Deleting…' : 'Confirm delete'}
              </Button>
            </div>
          </div>
        )}

        {pendingAction?.type === 'restore-vault' && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
              You already have <strong className="tabular-nums" style={{ color: 'var(--tx)' }}>{vaultCounts.total}</strong>{' '}
              question{vaultCounts.total === 1 ? '' : 's'} saved on this device. Restoring will
              download and merge questions from your Google Drive Vault folder.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" disabled={busyAction !== null} onClick={() => setPendingAction(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busyAction !== null} onClick={() => void executeConfirmedAction()}>
                {busyAction ? 'Restoring…' : 'Restore Vault'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
