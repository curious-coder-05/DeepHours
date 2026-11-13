import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Calendar,
  CheckSquare,
  Clock,
  Command,
  Compass,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Timer,
  Users,
  X,
} from 'lucide-react';
import type { AppTab, PrepSubTab, PulseHabitState, StatsSubTab } from '../types';
import { getSubject } from '../utils/studyLogic';
import type { QuickActionKind } from './QuickActionsSheet';

export interface CommandPaletteProps {
  open: boolean;
  state: PulseHabitState;
  onClose: () => void;
  onSelectTab: (tab: AppTab) => void;
  onSelectPrepSubTab: (sub: PrepSubTab) => void;
  onSelectStatsSubTab: (sub: StatsSubTab) => void;
  onOpenSettings: () => void;
  onQuickAction: (action: QuickActionKind) => void;
  onStartChapterFocus: (
    subjectId: string,
    chapterId: string,
    chapterName: string
  ) => void;
  onOpenShortcutsHelp: () => void;
}

interface PaletteItem {
  id: string;
  group: 'Screens' | 'Quick actions' | 'Chapters';
  label: string;
  sublabel?: string;
  shortcut?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  state,
  onClose,
  onSelectTab,
  onSelectPrepSubTab,
  onSelectStatsSubTab,
  onOpenSettings,
  onQuickAction,
  onStartChapterFocus,
  onOpenShortcutsHelp,
}) => {
  const [query, setQuery] = useState<string>('');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
    }
  }, [open]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const screens: PaletteItem[] = [
      {
        id: 'nav-today',
        group: 'Screens',
        label: 'Go to Today',
        sublabel: 'Daily tasks, habits, quick start & revisions due',
        shortcut: '1',
        icon: <Calendar size={17} strokeWidth={1.75} />,
        onSelect: () => onSelectTab('today'),
      },
      {
        id: 'nav-prep',
        group: 'Screens',
        label: 'Go to Prep (Syllabus)',
        sublabel: 'Syllabus pace, chapters, mocks, mistakes & doubts',
        shortcut: '2',
        icon: <Compass size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectPrepSubTab('syllabus');
          onSelectTab('prep');
        },
      },
      {
        id: 'nav-focus',
        group: 'Screens',
        label: 'Go to Focus Timer',
        sublabel: 'Pomodoro, countdown, stopwatch, full mock & PiP',
        shortcut: '3',
        icon: <Timer size={17} strokeWidth={1.75} />,
        onSelect: () => onSelectTab('focus'),
      },
      {
        id: 'nav-stats',
        group: 'Screens',
        label: 'Go to Insights',
        sublabel: 'Overview, weekly review, day history & 10m timeline',
        shortcut: '4',
        icon: <BarChart3 size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectStatsSubTab('summary');
          onSelectTab('stats');
        },
      },
      {
        id: 'nav-groups',
        group: 'Screens',
        label: 'Go to Community',
        sublabel: 'Study groups, leaderboards & live focus strip',
        shortcut: '5',
        icon: <Users size={17} strokeWidth={1.75} />,
        onSelect: () => onSelectTab('groups'),
      },
      {
        id: 'nav-mocks',
        group: 'Screens',
        label: 'Go to Prep → Mocks',
        sublabel: 'NEET 720-mark mock score log & analytics',
        icon: <BookOpen size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectPrepSubTab('mocks');
          onSelectTab('prep');
        },
      },
      {
        id: 'nav-mistakes',
        group: 'Screens',
        label: 'Go to Prep → Mistakes',
        sublabel: 'Mistake notebook & root-cause analysis',
        icon: <BookOpen size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectPrepSubTab('mistakes');
          onSelectTab('prep');
        },
      },
      {
        id: 'nav-doubts',
        group: 'Screens',
        label: 'Go to Prep → Doubts',
        sublabel: 'Doubts & conceptual questions queue',
        icon: <BookOpen size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectPrepSubTab('doubts');
          onSelectTab('prep');
        },
      },
      {
        id: 'nav-history',
        group: 'Screens',
        label: 'Go to Insights → Day History',
        sublabel: 'Inspect what you did and did not do on any date',
        icon: <Clock size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectStatsSubTab('history');
          onSelectTab('stats');
        },
      },
      {
        id: 'nav-timeline',
        group: 'Screens',
        label: 'Go to Insights → 10m Timeline',
        sublabel: '10-minute focus block grid',
        icon: <Clock size={17} strokeWidth={1.75} />,
        onSelect: () => {
          onSelectStatsSubTab('timeline');
          onSelectTab('stats');
        },
      },
      {
        id: 'nav-settings',
        group: 'Screens',
        label: 'Open Settings',
        sublabel: 'Appearance, subjects, targets, cloud sync & backups',
        icon: <Settings size={17} strokeWidth={1.75} />,
        onSelect: () => onOpenSettings(),
      },
    ];

    const actions: PaletteItem[] = [
      {
        id: 'act-start-session',
        group: 'Quick actions',
        label: 'Start a focus session',
        sublabel: 'Jump to Focus timer to start studying',
        shortcut: 'Space',
        icon: <Play size={17} strokeWidth={1.75} />,
        onSelect: () => onQuickAction('startSession'),
      },
      {
        id: 'act-add-task',
        group: 'Quick actions',
        label: 'Add a daily task',
        sublabel: 'Focus the daily task input on Today',
        shortcut: 'N',
        icon: <CheckSquare size={17} strokeWidth={1.75} />,
        onSelect: () => onQuickAction('addTask'),
      },
      {
        id: 'act-log-session',
        group: 'Quick actions',
        label: 'Log manual study session',
        sublabel: 'Record offline study hours with start & end time',
        icon: <Plus size={17} strokeWidth={1.75} />,
        onSelect: () => onQuickAction('logSession'),
      },
      {
        id: 'act-add-habit',
        group: 'Quick actions',
        label: 'Create new habit',
        sublabel: 'Add a daily or weekly study habit',
        icon: <Sparkles size={17} strokeWidth={1.75} />,
        onSelect: () => onQuickAction('addHabit'),
      },
      {
        id: 'act-log-mock',
        group: 'Quick actions',
        label: 'Log mock test score',
        sublabel: 'Record a 720-mark NEET mock test',
        icon: <Plus size={17} strokeWidth={1.75} />,
        onSelect: () => onQuickAction('logMock'),
      },
      {
        id: 'act-add-dday',
        group: 'Quick actions',
        label: 'Add D-Day exam countdown',
        sublabel: 'Add or update a target exam date',
        icon: <Calendar size={17} strokeWidth={1.75} />,
        onSelect: () => onQuickAction('addDDay'),
      },
      {
        id: 'act-shortcuts',
        group: 'Quick actions',
        label: 'Keyboard shortcuts help',
        sublabel: 'View all desktop keyboard shortcuts',
        shortcut: '?',
        icon: <Command size={17} strokeWidth={1.75} />,
        onSelect: () => onOpenShortcutsHelp(),
      },
    ];

    const chapters: PaletteItem[] = (state.chapters || []).slice(0, 80).map((ch) => {
      const sub = getSubject(state, ch.subjectId);
      return {
        id: `ch-${ch.id}`,
        group: 'Chapters',
        label: `Focus: ${ch.name}`,
        sublabel: `${sub.e} ${sub.name} · ${
          ch.status === 'completed'
            ? 'Completed'
            : ch.status === 'inProgress'
              ? 'In progress'
              : 'Not started'
        }`,
        icon: <Play size={16} strokeWidth={1.75} />,
        onSelect: () => onStartChapterFocus(ch.subjectId, ch.id, ch.name),
      };
    });

    return [...screens, ...actions, ...chapters];
  }, [
    state,
    onSelectTab,
    onSelectPrepSubTab,
    onSelectStatsSubTab,
    onOpenSettings,
    onQuickAction,
    onStartChapterFocus,
    onOpenShortcutsHelp,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return allItems.filter((item) => item.group !== 'Chapters').slice(0, 14);
    }
    return allItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel && item.sublabel.toLowerCase().includes(q)) ||
          item.group.toLowerCase().includes(q)
      )
      .slice(0, 18);
  }, [allItems, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredItems.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex(
          (prev) => (prev - 1 + filteredItems.length) % filteredItems.length
        );
      }
      return;
    }
    if (e.key === 'Enter' && filteredItems[activeIndex]) {
      e.preventDefault();
      const target = filteredItems[activeIndex];
      onClose();
      target.onSelect();
    }
  };

  return (
    <div
      className="modal-bg open"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 540,
          width: '100%',
          padding: 0,
          overflow: 'hidden',
          borderRadius: 16,
          background: 'var(--sf-1)',
          border: '1px solid var(--line)',
        }}
      >
        <div
          className="row"
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--line)',
            gap: 10,
          }}
        >
          <Search size={18} strokeWidth={1.75} style={{ color: 'var(--tx-2)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to screen, syllabus chapter, or quick action…"
            aria-label="Command palette search"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 15,
              color: 'var(--tx)',
              minHeight: 32,
              padding: 0,
            }}
          />
          <button
            type="button"
            className="s"
            aria-label="Close command palette"
            onClick={onClose}
            style={{ padding: '4px 8px', minHeight: 32 }}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div
          style={{
            maxHeight: '62vh',
            overflowY: 'auto',
            padding: 8,
          }}
        >
          {filteredItems.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'var(--tx-2)',
                fontSize: 13,
              }}
            >
              No matching screens, actions, or chapters found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {filteredItems.map((item, idx) => {
                const isSelected = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onClose();
                      item.onSelect();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: isSelected ? 'var(--ac-soft)' : 'transparent',
                      border: isSelected
                        ? '1px solid var(--ac-line)'
                        : '1px solid transparent',
                      color: isSelected ? 'var(--ac-ink)' : 'var(--tx)',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          color: isSelected ? 'var(--ac-ink)' : 'var(--tx-2)',
                          flexShrink: 0,
                        }}
                      >
                        {item.icon}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--tx)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.label}
                        </div>
                        {item.sublabel && (
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--tx-2)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.sublabel}
                          </div>
                        )}
                      </div>
                    </div>

                    {item.shortcut && (
                      <kbd
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: 'var(--sf-2)',
                          border: '1px solid var(--line)',
                          fontSize: 12,
                          color: 'var(--tx-2)',
                          fontFamily: 'var(--font-mono)',
                          flexShrink: 0,
                        }}
                      >
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="split"
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--line)',
            background: 'var(--sf-2)',
            fontSize: 12,
            color: 'var(--tx-2)',
          }}
        >
          <span>Use ↑↓ arrows and Enter to select</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
};
