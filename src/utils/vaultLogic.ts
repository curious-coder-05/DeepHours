import type { Chapter, Subject } from '../types';
import {
  VAULT_LIMITS,
  type VaultItem,
  type VaultKind,
  type VaultManifest,
  type VaultTombstone,
} from './vaultTypes';

export function clampVaultText(value: string | undefined, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

export function clampVaultSolutionText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Preserve intentional line breaks inside solution text while stripping trailing whitespace
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, VAULT_LIMITS.solutionMax);
}

const SAFE_VAULT_MIMES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/avif',
]);

function normalizeFiniteTs(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function normalizeOptionalTs(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return undefined;
  return Math.floor(val);
}

function normalizeVaultMime(val: unknown): string {
  if (typeof val !== 'string') return 'image/webp';
  const lower = val.trim().toLowerCase();
  const mapped = lower === 'image/jpg' ? 'image/jpeg' : lower;
  return SAFE_VAULT_MIMES.has(mapped) ? mapped : 'image/webp';
}

export function sanitizeVaultItem(raw: VaultItem): VaultItem {
  const nowFallback = Date.now();
  const createdAt = normalizeFiniteTs(raw.createdAt, nowFallback);
  const updatedAt = normalizeFiniteTs(raw.updatedAt, createdAt);
  const chapterId =
    typeof raw.chapterId === 'string' && raw.chapterId.trim()
      ? raw.chapterId.trim().slice(0, 120)
      : undefined;
  const mastered = Boolean(raw.mastered);
  const masteredAt = mastered ? normalizeOptionalTs(raw.masteredAt) : undefined;
  const lastRevisedAt = normalizeOptionalTs(raw.lastRevisedAt);
  const deletedAt = normalizeOptionalTs(raw.deletedAt);
  const driveQId =
    typeof raw.driveQId === 'string' && raw.driveQId.trim()
      ? raw.driveQId.trim().slice(0, 200)
      : undefined;
  const driveSId =
    typeof raw.driveSId === 'string' && raw.driveSId.trim()
      ? raw.driveSId.trim().slice(0, 200)
      : undefined;

  return {
    id: typeof raw.id === 'string' ? raw.id.trim().slice(0, 120) : '',
    subjectId: typeof raw.subjectId === 'string' ? raw.subjectId.trim().slice(0, 120) : '',
    ...(chapterId !== undefined ? { chapterId } : {}),
    kind: raw.kind === 'hard' ? 'hard' : 'unsolved',
    createdAt,
    updatedAt,
    mastered,
    ...(masteredAt !== undefined ? { masteredAt } : {}),
    answerText: clampVaultText(raw.answerText, VAULT_LIMITS.answerMax),
    solutionText: clampVaultSolutionText(raw.solutionText),
    note: clampVaultText(raw.note, VAULT_LIMITS.noteMax),
    hasSolutionImage: Boolean(raw.hasSolutionImage),
    qBytes: Math.max(0, Math.round(Number(raw.qBytes) || 0)),
    width: Math.max(0, Math.round(Number(raw.width) || 0)),
    height: Math.max(0, Math.round(Number(raw.height) || 0)),
    mime: normalizeVaultMime(raw.mime),
    revisionCount: Math.max(0, Math.round(Number(raw.revisionCount) || 0)),
    ...(lastRevisedAt !== undefined ? { lastRevisedAt } : {}),
    ...(deletedAt !== undefined ? { deletedAt } : {}),
    ...(driveQId !== undefined ? { driveQId } : {}),
    ...(driveSId !== undefined ? { driveSId } : {}),
    syncState:
      raw.syncState === 'synced' || raw.syncState === 'error' ? raw.syncState : 'pending',
  };
}

export interface VaultCountsSummary {
  total: number;
  active: number;
  mastered: number;
  unsolved: number;
  hard: number;
  totalBytes: number;
  bySubject: Record<string, { total: number; active: number }>;
  byChapter: Record<string, { total: number; active: number }>;
}

export function computeVaultCounts(items: readonly VaultItem[]): VaultCountsSummary {
  const bySubject: Record<string, { total: number; active: number }> = {};
  const byChapter: Record<string, { total: number; active: number }> = {};
  let active = 0;
  let mastered = 0;
  let unsolved = 0;
  let hard = 0;
  let totalBytes = 0;

  for (const item of items) {
    if (item.deletedAt) continue;
    totalBytes += Math.max(0, item.qBytes || 0);
    if (item.mastered) mastered += 1;
    else active += 1;
    if (item.kind === 'hard') hard += 1;
    else unsolved += 1;

    const subBucket = (bySubject[item.subjectId] ||= { total: 0, active: 0 });
    subBucket.total += 1;
    if (!item.mastered) subBucket.active += 1;

    const chapKey = item.chapterId || '__unassigned__';
    const chapBucket = (byChapter[chapKey] ||= { total: 0, active: 0 });
    chapBucket.total += 1;
    if (!item.mastered) chapBucket.active += 1;
  }

  return {
    total: active + mastered,
    active,
    mastered,
    unsolved,
    hard,
    totalBytes,
    bySubject,
    byChapter,
  };
}

export interface VaultFilterOptions {
  subjectId: string; // 'all' or subject id
  chapterId: string; // 'all' or chapter id or '__unassigned__'
  status: 'active' | 'mastered' | 'all';
  kind: 'all' | VaultKind;
  query?: string;
  subjects?: readonly Subject[];
  chapters?: readonly Chapter[];
}

export function buildVaultSearchText(
  item: VaultItem,
  subjects?: readonly Subject[],
  chapters?: readonly Chapter[]
): string {
  const subjectName = subjects
    ? resolveVaultSubjectLabel(subjects, item.subjectId).name
    : item.subjectId;
  const chapterName = item.chapterId
    ? chapters
      ? resolveVaultChapterName(chapters, item.chapterId)
      : item.chapterId
    : 'unassigned general';
  const kindTag = item.kind === 'hard' ? 'hard trap' : 'unsolved';
  const statusTag = item.mastered ? 'mastered' : 'active';

  return [subjectName, chapterName, kindTag, statusTag, item.note || '']
    .join(' ')
    .toLowerCase();
}

export function filterVaultItems(
  items: readonly VaultItem[],
  filters: VaultFilterOptions
): VaultItem[] {
  const tokens = (filters.query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return items
    .filter((item) => {
      if (item.deletedAt) return false;
      if (filters.subjectId !== 'all' && item.subjectId !== filters.subjectId) {
        return false;
      }
      if (filters.chapterId !== 'all') {
        if (filters.chapterId === '__unassigned__') {
          if (item.chapterId) return false;
        } else if (item.chapterId !== filters.chapterId) {
          return false;
        }
      }
      if (filters.status === 'active' && item.mastered) return false;
      if (filters.status === 'mastered' && !item.mastered) return false;
      if (filters.kind !== 'all' && item.kind !== filters.kind) return false;

      if (tokens.length > 0) {
        const haystack = buildVaultSearchText(item, filters.subjects, filters.chapters);
        for (const token of tokens) {
          if (!haystack.includes(token)) return false;
        }
      }

      return true;
    })
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

export interface VaultChapterFolder {
  key: string;
  subjectId: string;
  subjectName: string;
  subjectEmoji: string;
  subjectColor: string;
  chapterId?: string;
  chapterName: string;
  isUncategorized: boolean;
  totalCount: number;
  activeCount: number;
  masteredCount: number;
  hardCount: number;
  unsolvedCount: number;
  latestActivityAt: number;
  items: VaultItem[];
}

export interface VaultSubjectFoldersResult {
  populatedFolders: VaultChapterFolder[];
  emptyFolders: VaultChapterFolder[];
}

export function buildVaultSubjectFolders(
  items: readonly VaultItem[],
  subjects: readonly Subject[],
  chapters: readonly Chapter[],
  subjectFilter: string
): VaultSubjectFoldersResult {
  const activeSubjects = subjects.filter((s) => !s.arch);
  const targetSubjectIds =
    subjectFilter === 'all'
      ? new Set(activeSubjects.map((s) => s.id))
      : new Set([subjectFilter]);

  const folderMap = new Map<string, VaultChapterFolder>();

  const makeKey = (subId: string, chapId?: string) =>
    `${subId}::${chapId ? chapId : '__unassigned__'}`;

  // Seed all syllabus chapters belonging to the selected subject(s)
  for (const ch of chapters) {
    if (subjectFilter !== 'all' && ch.subjectId !== subjectFilter) continue;
    if (subjectFilter === 'all' && !targetSubjectIds.has(ch.subjectId)) continue;
    const sub = resolveVaultSubjectLabel(subjects, ch.subjectId);
    const key = makeKey(ch.subjectId, ch.id);
    if (!folderMap.has(key)) {
      folderMap.set(key, {
        key,
        subjectId: ch.subjectId,
        subjectName: sub.name,
        subjectEmoji: sub.emoji,
        subjectColor: sub.color,
        chapterId: ch.id,
        chapterName: ch.name,
        isUncategorized: false,
        totalCount: 0,
        activeCount: 0,
        masteredCount: 0,
        hardCount: 0,
        unsolvedCount: 0,
        latestActivityAt: 0,
        items: [],
      });
    }
  }

  // Bucket every non-deleted Vault item matching the selected subject filter
  for (const rawItem of items) {
    if (rawItem.deletedAt) continue;
    if (subjectFilter !== 'all' && rawItem.subjectId !== subjectFilter) continue;

    const item = sanitizeVaultItem(rawItem);
    const key = makeKey(item.subjectId, item.chapterId);
    let folder = folderMap.get(key);
    if (!folder) {
      const sub = resolveVaultSubjectLabel(subjects, item.subjectId);
      const isUncat = !item.chapterId;
      const chapterName = isUncat
        ? subjectFilter === 'all'
          ? `${sub.name} · General / Uncategorized`
          : 'General / Uncategorized'
        : resolveVaultChapterName(chapters, item.chapterId);
      folder = {
        key,
        subjectId: item.subjectId,
        subjectName: sub.name,
        subjectEmoji: sub.emoji,
        subjectColor: sub.color,
        chapterId: item.chapterId,
        chapterName,
        isUncategorized: isUncat,
        totalCount: 0,
        activeCount: 0,
        masteredCount: 0,
        hardCount: 0,
        unsolvedCount: 0,
        latestActivityAt: 0,
        items: [],
      };
      folderMap.set(key, folder);
    }

    folder.items.push(item);
    folder.totalCount += 1;
    if (item.mastered) folder.masteredCount += 1;
    else folder.activeCount += 1;
    if (item.kind === 'hard') folder.hardCount += 1;
    else folder.unsolvedCount += 1;
    const itemTs = Math.max(item.updatedAt || 0, item.createdAt || 0);
    if (itemTs > folder.latestActivityAt) folder.latestActivityAt = itemTs;
  }

  const populatedFolders: VaultChapterFolder[] = [];
  const emptyFolders: VaultChapterFolder[] = [];

  for (const folder of folderMap.values()) {
    if (folder.totalCount > 0) {
      folder.items.sort((a, b) => b.createdAt - a.createdAt);
      populatedFolders.push(folder);
    } else if (!folder.isUncategorized) {
      emptyFolders.push(folder);
    }
  }

  populatedFolders.sort((a, b) => {
    const aHasActive = a.activeCount > 0 ? 1 : 0;
    const bHasActive = b.activeCount > 0 ? 1 : 0;
    if (bHasActive !== aHasActive) return bHasActive - aHasActive;
    if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
    if (b.latestActivityAt !== a.latestActivityAt) return b.latestActivityAt - a.latestActivityAt;
    return a.chapterName.localeCompare(b.chapterName);
  });

  return { populatedFolders, emptyFolders };
}

export type VaultChapterStatusFilter = 'active' | 'mastered' | 'all';
export type VaultChapterTagFilter = 'all' | 'hard' | 'trap' | 'unsolved';
export type VaultChapterSortOrder = 'newest' | 'oldest' | 'hardest';

export interface VaultChapterDeckQuery {
  subjectId: string;
  chapterId?: string; // undefined => General / Uncategorized
  status: VaultChapterStatusFilter;
  tag: VaultChapterTagFilter;
  sort: VaultChapterSortOrder;
  searchQuery?: string;
  subjects?: readonly Subject[];
  chapters?: readonly Chapter[];
}

export function filterAndSortChapterQuestions(
  items: readonly VaultItem[],
  options: VaultChapterDeckQuery
): VaultItem[] {
  const tokens = (options.searchQuery || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const filtered = items.filter((item) => {
    if (item.deletedAt) return false;
    if (item.subjectId !== options.subjectId) return false;
    if (options.chapterId) {
      if (item.chapterId !== options.chapterId) return false;
    } else if (item.chapterId) {
      return false;
    }

    if (options.status === 'active' && item.mastered) return false;
    if (options.status === 'mastered' && !item.mastered) return false;

    if (options.tag === 'hard' && item.kind !== 'hard') return false;
    if (options.tag === 'unsolved' && item.kind !== 'unsolved') return false;
    if (options.tag === 'trap') {
      const hasTrapNote = (item.note || '').toLowerCase().includes('trap');
      if (item.kind !== 'hard' && !hasTrapNote) return false;
    }

    if (tokens.length > 0) {
      const haystack = buildVaultSearchText(item, options.subjects, options.chapters);
      for (const token of tokens) {
        if (!haystack.includes(token)) return false;
      }
    }

    return true;
  });

  return filtered.slice().sort((a, b) => {
    if (options.sort === 'oldest') {
      return a.createdAt - b.createdAt;
    }
    if (options.sort === 'hardest') {
      const aKindWeight = a.kind === 'hard' ? 0 : 1;
      const bKindWeight = b.kind === 'hard' ? 0 : 1;
      if (aKindWeight !== bKindWeight) return aKindWeight - bKindWeight;
      const aMasteredWeight = a.mastered ? 1 : 0;
      const bMasteredWeight = b.mastered ? 1 : 0;
      if (aMasteredWeight !== bMasteredWeight) return aMasteredWeight - bMasteredWeight;
      return b.createdAt - a.createdAt;
    }
    return b.createdAt - a.createdAt;
  });
}

export interface VaultChapterGroup {
  key: string;
  chapterId?: string;
  chapterName: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  activeCount: number;
  items: VaultItem[];
}

export function resolveVaultSubjectLabel(
  subjects: readonly Subject[],
  subjectId: string
): { name: string; emoji: string; color: string } {
  const found = subjects.find((s) => s.id === subjectId);
  if (found) {
    return { name: found.name, emoji: found.e, color: found.color };
  }
  return { name: 'Unassigned', emoji: '📘', color: 'var(--tx-3)' };
}

export function resolveVaultChapterName(
  chapters: readonly Chapter[],
  chapterId?: string
): string {
  if (!chapterId) return 'Unassigned';
  const found = chapters.find((c) => c.id === chapterId);
  return found ? found.name : 'No chapter';
}

export function groupVaultItemsByChapter(
  items: readonly VaultItem[],
  subjects: readonly Subject[],
  chapters: readonly Chapter[]
): VaultChapterGroup[] {
  const groupMap = new Map<string, VaultChapterGroup>();

  for (const item of items) {
    const key = item.chapterId
      ? `${item.subjectId}::${item.chapterId}`
      : `${item.subjectId}::__unassigned__`;
    let grp = groupMap.get(key);
    if (!grp) {
      const sub = resolveVaultSubjectLabel(subjects, item.subjectId);
      const chapterName = item.chapterId
        ? resolveVaultChapterName(chapters, item.chapterId)
        : `${sub.name} · General`;
      grp = {
        key,
        chapterId: item.chapterId,
        chapterName,
        subjectId: item.subjectId,
        subjectName: sub.name,
        subjectColor: sub.color,
        activeCount: 0,
        items: [],
      };
      groupMap.set(key, grp);
    }
    grp.items.push(item);
    if (!item.mastered) grp.activeCount += 1;
  }

  return Array.from(groupMap.values()).sort((a, b) => {
    if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
    return a.chapterName.localeCompare(b.chapterName);
  });
}

export function orderRevisionDeck(
  items: readonly VaultItem[],
  shuffled = false,
  rng: () => number = Math.random
): VaultItem[] {
  const unmastered = items
    .filter((item) => !item.mastered && !item.deletedAt)
    .slice()
    .sort((a, b) => {
      const aNever = !a.lastRevisedAt;
      const bNever = !b.lastRevisedAt;
      if (aNever !== bNever) return aNever ? -1 : 1;
      const aTime = a.lastRevisedAt ?? a.createdAt;
      const bTime = b.lastRevisedAt ?? b.createdAt;
      if (aTime !== bTime) return aTime - bTime;
      return a.createdAt - b.createdAt;
    });

  if (!shuffled || unmastered.length <= 1) return unmastered;

  const copy = unmastered.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export interface VaultRevealState {
  answerOpen: boolean;
  solutionOpen: boolean;
}

export type VaultRevealAction =
  | { type: 'toggle_answer' }
  | { type: 'toggle_solution' }
  | { type: 'reset' };

export const INITIAL_REVEAL_STATE: VaultRevealState = {
  answerOpen: false,
  solutionOpen: false,
};

export function revealReducer(
  state: VaultRevealState,
  action: VaultRevealAction
): VaultRevealState {
  switch (action.type) {
    case 'toggle_answer':
      return { ...state, answerOpen: !state.answerOpen };
    case 'toggle_solution':
      return { ...state, solutionOpen: !state.solutionOpen };
    case 'reset':
      return { answerOpen: false, solutionOpen: false };
    default:
      return state;
  }
}

export function formatRelativeVaultDate(ts: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function buildVaultManifest(
  items: readonly VaultItem[],
  tombstones: readonly VaultTombstone[],
  now = Date.now()
): VaultManifest {
  const activeItems = items
    .filter((i) => !i.deletedAt)
    .map((i) => sanitizeVaultItem({ ...i, syncState: 'synced' }));
  const tombstoneMap = new Map<string, VaultTombstone>();
  for (const t of tombstones) {
    const prev = tombstoneMap.get(t.id);
    if (!prev || t.deletedAt > prev.deletedAt) {
      tombstoneMap.set(t.id, {
        id: t.id,
        deletedAt: t.deletedAt,
        driveQId: t.driveQId || prev?.driveQId,
        driveSId: t.driveSId || prev?.driveSId,
      });
    }
  }
  return {
    schema: 1,
    updatedAt: now,
    items: activeItems,
    tombstones: Array.from(tombstoneMap.values()),
  };
}

export function parseVaultManifest(rawText: string): VaultManifest | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<VaultManifest>;
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== 1) {
      return null;
    }
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter((x): x is VaultItem => Boolean(x && typeof x.id === 'string'))
          .map((x) => sanitizeVaultItem(x))
      : [];
    const tombstones = Array.isArray(parsed.tombstones)
      ? parsed.tombstones
          .filter(
            (t): t is VaultTombstone =>
              Boolean(t && typeof t.id === 'string' && typeof t.deletedAt === 'number')
          )
          .map((t) => ({
            id: t.id,
            deletedAt: t.deletedAt,
            driveQId: t.driveQId,
            driveSId: t.driveSId,
          }))
      : [];
    return {
      schema: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      items,
      tombstones,
    };
  } catch {
    return null;
  }
}

export interface VaultMergeResult {
  mergedItems: VaultItem[];
  mergedTombstones: VaultTombstone[];
  itemsNeedingUpload: VaultItem[];
  itemsNeedingBlobDownload: VaultItem[];
  driveFileIdsToDelete: string[];
}

/**
 * Per-item last-writer-wins by updatedAt; tombstones beat edits with updatedAt <= deletedAt.
 */
export function mergeVaultManifest(
  localItems: readonly VaultItem[],
  localTombstones: readonly VaultTombstone[],
  remoteManifest: VaultManifest | null
): VaultMergeResult {
  const tombstoneMap = new Map<string, VaultTombstone>();
  const registerTombstone = (t: VaultTombstone) => {
    const prev = tombstoneMap.get(t.id);
    if (!prev || t.deletedAt > prev.deletedAt) {
      tombstoneMap.set(t.id, {
        id: t.id,
        deletedAt: t.deletedAt,
        driveQId: t.driveQId || prev?.driveQId,
        driveSId: t.driveSId || prev?.driveSId,
      });
    } else if (prev) {
      prev.driveQId = prev.driveQId || t.driveQId;
      prev.driveSId = prev.driveSId || t.driveSId;
    }
  };

  for (const t of localTombstones) registerTombstone(t);
  for (const t of remoteManifest?.tombstones || []) registerTombstone(t);

  const localMap = new Map<string, VaultItem>();
  for (const item of localItems) {
    if (item.deletedAt) {
      registerTombstone({
        id: item.id,
        deletedAt: item.deletedAt,
        driveQId: item.driveQId,
        driveSId: item.driveSId,
      });
    } else {
      localMap.set(item.id, sanitizeVaultItem(item));
    }
  }

  const remoteMap = new Map<string, VaultItem>();
  for (const item of remoteManifest?.items || []) {
    if (item.deletedAt) {
      registerTombstone({
        id: item.id,
        deletedAt: item.deletedAt,
        driveQId: item.driveQId,
        driveSId: item.driveSId,
      });
    } else {
      remoteMap.set(item.id, sanitizeVaultItem(item));
    }
  }

  const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const mergedItems: VaultItem[] = [];
  const itemsNeedingUpload: VaultItem[] = [];
  const itemsNeedingBlobDownload: VaultItem[] = [];
  const driveFileIdsToDelete = new Set<string>();

  for (const id of allIds) {
    const loc = localMap.get(id);
    const rem = remoteMap.get(id);
    const tomb = tombstoneMap.get(id);

    const latestEditTs = Math.max(loc?.updatedAt ?? 0, rem?.updatedAt ?? 0);
    if (tomb && tomb.deletedAt >= latestEditTs) {
      if (loc?.driveQId) driveFileIdsToDelete.add(loc.driveQId);
      if (loc?.driveSId) driveFileIdsToDelete.add(loc.driveSId);
      if (rem?.driveQId) driveFileIdsToDelete.add(rem.driveQId);
      if (rem?.driveSId) driveFileIdsToDelete.add(rem.driveSId);
      if (tomb.driveQId) driveFileIdsToDelete.add(tomb.driveQId);
      if (tomb.driveSId) driveFileIdsToDelete.add(tomb.driveSId);
      continue;
    }

    let winner: VaultItem;
    let cameFromRemote = false;
    if (loc && rem) {
      if (rem.updatedAt > loc.updatedAt) {
        winner = {
          ...rem,
          driveQId: rem.driveQId || loc.driveQId,
          driveSId: rem.driveSId || loc.driveSId,
        };
        cameFromRemote = true;
      } else {
        winner = {
          ...loc,
          driveQId: loc.driveQId || rem.driveQId,
          driveSId: loc.driveSId || rem.driveSId,
        };
      }
    } else if (rem) {
      winner = rem;
      cameFromRemote = true;
    } else {
      winner = loc!;
    }

    if (cameFromRemote && winner.driveQId && !loc) {
      itemsNeedingBlobDownload.push(winner);
    } else if (
      !winner.driveQId ||
      winner.syncState === 'pending' ||
      winner.syncState === 'error' ||
      (winner.hasSolutionImage && !winner.driveSId)
    ) {
      itemsNeedingUpload.push(winner);
    }

    mergedItems.push(winner);
  }

  for (const tomb of tombstoneMap.values()) {
    if (tomb.driveQId) driveFileIdsToDelete.add(tomb.driveQId);
    if (tomb.driveSId) driveFileIdsToDelete.add(tomb.driveSId);
  }

  return {
    mergedItems: mergedItems.sort((a, b) => b.createdAt - a.createdAt),
    mergedTombstones: Array.from(tombstoneMap.values()),
    itemsNeedingUpload,
    itemsNeedingBlobDownload,
    driveFileIdsToDelete: Array.from(driveFileIdsToDelete),
  };
}
