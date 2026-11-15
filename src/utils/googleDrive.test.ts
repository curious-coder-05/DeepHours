import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_DRIVE_SCOPE,
  SCOPES,
  VAULT_FOLDER_NAME,
  buildListQuery,
  decideVaultFolderMigration,
  formatDriveFileSize,
  getDriveMimeLabel,
  isDeepHoursBackupFile,
} from './googleDrive.ts';

describe('googleDrive Vault-scoped helpers', () => {
  it('restricts OAuth scopes strictly to drive.file only', () => {
    assert.equal(GOOGLE_DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');
    assert.deepEqual(Array.from(SCOPES), ['https://www.googleapis.com/auth/drive.file']);
    assert.equal(SCOPES.length, 1);
    assert.equal(VAULT_FOLDER_NAME, 'Deep Hours Vault');
  });

  it('requires folderId in buildListQuery and enforces trashed = false', () => {
    assert.throws(() => buildListQuery(''), /folderId is required/);
    assert.throws(() => buildListQuery('   '), /folderId is required/);

    const baseQ = buildListQuery('vault_dir_1');
    assert.equal(baseQ, "'vault_dir_1' in parents and trashed = false");

    const extraQ = buildListQuery("dir_'x'", "mimeType = 'application/json'");
    assert.ok(extraQ.includes("'dir_\\'x\\'' in parents and trashed = false"));
    assert.ok(extraQ.includes("and (mimeType = 'application/json')"));
  });

  it('decides folder migration paths cleanly from legacy Deep Hours Backups', () => {
    assert.equal(
      decideVaultFolderMigration({ vaultFolderCount: 1, legacyBackupFolderCount: 0 }),
      'use-vault'
    );
    assert.equal(
      decideVaultFolderMigration({ vaultFolderCount: 0, legacyBackupFolderCount: 1 }),
      'rename-legacy'
    );
    assert.equal(
      decideVaultFolderMigration({ vaultFolderCount: 1, legacyBackupFolderCount: 1 }),
      'merge-legacy-into-vault'
    );
    assert.equal(
      decideVaultFolderMigration({ vaultFolderCount: 0, legacyBackupFolderCount: 0 }),
      'create-vault'
    );
  });

  it('formats sizes, mime labels, and detects Deep Hours backups', () => {
    assert.equal(formatDriveFileSize(undefined), '—');
    assert.equal(formatDriveFileSize('512'), '512 B');
    assert.equal(formatDriveFileSize('2048'), '2.0 KB');
    assert.equal(formatDriveFileSize('3145728'), '3.0 MB');

    assert.equal(
      getDriveMimeLabel('application/vnd.google-apps.folder', 'Deep Hours Vault'),
      'Folder'
    );
    assert.equal(getDriveMimeLabel('application/json', 'vault-index.json'), 'JSON backup');
    assert.equal(getDriveMimeLabel('text/csv', 'backup-2026-11-15.csv'), 'CSV export');
    assert.equal(getDriveMimeLabel('image/webp', 'q_123.webp'), 'Image');
    assert.equal(getDriveMimeLabel('application/pdf', 'ncert.pdf'), 'File');

    assert.equal(
      isDeepHoursBackupFile({
        name: 'backup-2026-11-15-0930.json',
        mimeType: 'application/json',
      }),
      true
    );
    assert.equal(
      isDeepHoursBackupFile({
        name: 'backup-2026-11-15-0930.csv',
        mimeType: 'text/csv',
      }),
      true
    );
    assert.equal(
      isDeepHoursBackupFile({
        name: 'deep-hours-backup-2026-11-15.json',
        mimeType: 'application/json',
      }),
      true
    );
    assert.equal(
      isDeepHoursBackupFile({
        name: 'organic-chemistry.pdf',
        mimeType: 'application/pdf',
      }),
      false
    );
  });
});
