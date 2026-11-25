import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  BookOpen,
  Calendar,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Flag,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Trash2,
} from 'lucide-react';
import type {
  CustomReminder,
  DeadlineTarget,
  PulseHabitState,
  ReminderCategory,
  Subject,
} from '../types';
import { Button, Select } from './ui';
import { BottomSheet } from './BottomSheet';
import {
  LEAD_DAY_OPTIONS,
  REMINDER_CATEGORY_LABELS,
  buildMonthGridCells,
  buildMonthlyCalendarIndex,
  computeDaysUntilDate,
  computeTargetProgress,
  formatDeadlineUrgency,
  formatFullDateLabel,
  formatLeadDaysSummary,
  formatMonthYearHeading,
  formatShortDateLabel,
  formatTime12h,
  parseDateKeyParts,
  shiftDateKey,
} from '../utils/targetsLogic';
import {
  buildCalendarEventsForAllUpcoming,
  buildExamCalendarInput,
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildReminderCalendarInput,
  buildRevisionCalendarInput,
  buildTargetCalendarInput,
  downloadIcsFile,
  type CalendarEventInput,
} from '../utils/calendarExport';
import { safeExternalHttpsUrl } from '../utils/security';

export interface TargetDraftInput {
  title: string;
  deadlineDate: string;
  subjectId?: string;
  notes?: string;
  itemTexts: string[];
}

export interface ReminderDraftInput {
  title: string;
  date: string;
  time?: string;
  leadDays: number[];
  category: ReminderCategory;
  notes?: string;
}

export interface CalendarPushSheetProps {
  event: CalendarEventInput | null;
  onClose: () => void;
  onDownloaded?: (message: string) => void;
}

export const CalendarPushSheet: React.FC<CalendarPushSheetProps> = ({
  event,
  onClose,
  onDownloaded,
}) => {
  const gcalUrl = useMemo(
    () => (event ? safeExternalHttpsUrl(buildGoogleCalendarUrl(event)) : null),
    [event]
  );

  const handleDownloadIcs = () => {
    if (!event) return;
    const ics = buildIcsCalendar([event]);
    downloadIcsFile(`deep-hours-${event.title.slice(0, 32)}-${event.date}.ics`, ics);
    onDownloaded?.('Calendar file (.ics) downloaded');
    onClose();
  };

  return (
    <BottomSheet
      open={Boolean(event)}
      onClose={onClose}
      title="Push to phone calendar"
      subtitle={
        event
          ? `${formatFullDateLabel(event.date)}${event.time ? ` · ${formatTime12h(event.time)}` : ' · All day'}`
          : undefined
      }
    >
      {event && (
        <div className="dh-targets-sheet-body">
          <div className="dh-targets-cal-preview">
            <div className="dh-targets-cal-preview-title">{event.title}</div>
            {event.leadDays && event.leadDays.length > 0 && (
              <div className="dh-targets-cal-preview-meta">
                <Bell size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>Embedded alerts: {formatLeadDaysSummary(event.leadDays)}</span>
              </div>
            )}
          </div>

          <div className="dh-targets-sheet-actions">
            <Button
              variant="primary"
              fullWidth
              icon={<Download size={16} strokeWidth={1.75} aria-hidden="true" />}
              onClick={handleDownloadIcs}
            >
              Download Calendar file (.ics)
            </Button>
            <div className="dh-targets-sheet-hint">
              Opens in Apple Calendar, Google Calendar, or Samsung Calendar with native offline
              notifications.
            </div>
            {gcalUrl && (
              <a
                href={gcalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="dh-btn dh-btn-secondary dh-targets-gcal-link"
                onClick={onClose}
              >
                <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>Open in Google Calendar</span>
              </a>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  );
};

export interface TargetComposerSheetProps {
  open: boolean;
  onClose: () => void;
  todayKey: string;
  defaultDeadlineDate?: string;
  subjects: Subject[];
  editingTarget?: DeadlineTarget | null;
  onSave: (draft: TargetDraftInput, existingId?: string) => void;
}

export const TargetComposerSheet: React.FC<TargetComposerSheetProps> = ({
  open,
  onClose,
  todayKey,
  defaultDeadlineDate,
  subjects,
  editingTarget,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [deadlineDate, setDeadlineDate] = useState(shiftDateKey(todayKey, 7));
  const [subjectId, setSubjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [itemInput, setItemInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setItemInput('');
    if (editingTarget) {
      setTitle(editingTarget.title);
      setDeadlineDate(editingTarget.deadlineDate);
      setSubjectId(editingTarget.subjectId || '');
      setNotes(editingTarget.notes || '');
      setItems(editingTarget.items.map((it) => it.text));
    } else {
      setTitle('');
      setDeadlineDate(defaultDeadlineDate || shiftDateKey(todayKey, 7));
      setSubjectId('');
      setNotes('');
      setItems([]);
    }
  }, [open, editingTarget, defaultDeadlineDate, todayKey]);

  const subjectOptions = useMemo(
    () => [
      { value: '', label: 'All subjects (general)' },
      ...subjects
        .filter((s) => !s.arch)
        .map((s) => ({
          value: s.id,
          label: s.name,
          swatchColor: s.color,
        })),
    ],
    [subjects]
  );

  const handleAddDraftItem = () => {
    const trimmed = itemInput.trim();
    if (!trimmed) return;
    setItems((prev) => [...prev, trimmed]);
    setItemInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Enter a target title first.');
      return;
    }
    if (!deadlineDate) {
      setError('Pick a deadline date.');
      return;
    }
    const pendingItem = itemInput.trim();
    const finalItems = pendingItem ? [...items, pendingItem] : items;
    onSave(
      {
        title: cleanTitle,
        deadlineDate,
        subjectId: subjectId || undefined,
        notes: notes.trim() || undefined,
        itemTexts: finalItems,
      },
      editingTarget?.id
    );
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={editingTarget ? 'Edit target sprint' : 'New target sprint'}
      subtitle="Set a deadline and list what needs to be done in any order"
    >
      <form className="dh-targets-form" onSubmit={handleSubmit}>
        <div className="dh-targets-field">
          <label htmlFor="dh-target-title" className="dh-targets-label">
            Target name
          </label>
          <input
            id="dh-target-title"
            data-sheet-autofocus
            type="text"
            className="dh-targets-input"
            placeholder="e.g. Finish Electrostatics & Capacitors"
            value={title}
            maxLength={140}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError('');
            }}
          />
        </div>

        <div className="dh-targets-row-2">
          <div className="dh-targets-field">
            <label htmlFor="dh-target-deadline" className="dh-targets-label">
              Deadline date
            </label>
            <input
              id="dh-target-deadline"
              type="date"
              className="dh-targets-input"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
            />
          </div>
          <div className="dh-targets-field">
            <label htmlFor="dh-target-subject" className="dh-targets-label">
              Subject (optional)
            </label>
            <Select
              id="dh-target-subject"
              title="Choose subject"
              value={subjectId}
              options={subjectOptions}
              onChange={setSubjectId}
            />
          </div>
        </div>

        {!editingTarget && (
          <div className="dh-targets-field">
            <label htmlFor="dh-target-item-add" className="dh-targets-label">
              Checklist items (complete in any order)
            </label>
            <div className="dh-targets-inline-add">
              <input
                id="dh-target-item-add"
                type="text"
                className="dh-targets-input"
                placeholder="Add item and press Enter"
                value={itemInput}
                maxLength={200}
                onChange={(e) => setItemInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDraftItem();
                  }
                }}
              />
              <button
                type="button"
                className="dh-ghost-pill dh-targets-add-btn"
                onClick={handleAddDraftItem}
                aria-label="Add checklist item"
              >
                <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>Add</span>
              </button>
            </div>
            {items.length > 0 && (
              <ul className="dh-targets-draft-list">
                {items.map((text, idx) => (
                  <li key={`${idx}-${text}`} className="dh-targets-draft-item">
                    <span>{text}</span>
                    <button
                      type="button"
                      className="dh-targets-icon-btn"
                      aria-label={`Remove ${text}`}
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="dh-targets-field">
          <label htmlFor="dh-target-notes" className="dh-targets-label">
            Notes (optional)
          </label>
          <textarea
            id="dh-target-notes"
            className="dh-targets-input dh-targets-textarea"
            rows={2}
            maxLength={800}
            placeholder="NCERT pages, PYQ set, or target goal"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="dh-targets-error" role="alert">
            {error}
          </div>
        )}

        <div className="dh-targets-form-footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {editingTarget ? 'Save changes' : 'Create target'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
};

export interface ReminderComposerSheetProps {
  open: boolean;
  onClose: () => void;
  todayKey: string;
  defaultDate?: string;
  editingReminder?: CustomReminder | null;
  onSave: (draft: ReminderDraftInput, existingId?: string) => void;
}

export const ReminderComposerSheet: React.FC<ReminderComposerSheetProps> = ({
  open,
  onClose,
  todayKey,
  defaultDate,
  editingReminder,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(shiftDateKey(todayKey, 3));
  const [time, setTime] = useState('');
  const [category, setCategory] = useState<ReminderCategory>('admin');
  const [leadDays, setLeadDays] = useState<number[]>([3, 1, 0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editingReminder) {
      setTitle(editingReminder.title);
      setDate(editingReminder.date);
      setTime(editingReminder.time || '');
      setCategory(editingReminder.category);
      setLeadDays(editingReminder.leadDays.length ? editingReminder.leadDays : [0]);
      setNotes(editingReminder.notes || '');
    } else {
      setTitle('');
      setDate(defaultDate || shiftDateKey(todayKey, 3));
      setTime('');
      setCategory('admin');
      setLeadDays([3, 1, 0]);
      setNotes('');
    }
  }, [open, editingReminder, defaultDate, todayKey]);

  const categoryOptions = useMemo(
    () => [
      { value: 'admin' as ReminderCategory, label: 'Admin / Form / Fee' },
      { value: 'exam' as ReminderCategory, label: 'Exam / Mock' },
      { value: 'study' as ReminderCategory, label: 'Study milestone' },
      { value: 'personal' as ReminderCategory, label: 'Personal' },
    ],
    []
  );

  const toggleLeadDay = (val: number) => {
    setLeadDays((prev) => {
      if (prev.includes(val)) {
        const next = prev.filter((x) => x !== val);
        return next.length > 0 ? next : [0];
      }
      return [...prev, val].sort((a, b) => b - a);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Enter a reminder title first.');
      return;
    }
    if (!date) {
      setError('Pick a reminder date.');
      return;
    }
    onSave(
      {
        title: cleanTitle,
        date,
        time: time.trim() || undefined,
        leadDays,
        category,
        notes: notes.trim() || undefined,
      },
      editingReminder?.id
    );
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={editingReminder ? 'Edit reminder' : 'Add reminder'}
      subtitle="Get lead alerts inside Deep Hours and in your phone calendar"
    >
      <form className="dh-targets-form" onSubmit={handleSubmit}>
        <div className="dh-targets-field">
          <label htmlFor="dh-rem-title" className="dh-targets-label">
            Reminder title
          </label>
          <input
            id="dh-rem-title"
            data-sheet-autofocus
            type="text"
            className="dh-targets-input"
            placeholder="e.g. NEET registration fee payment"
            value={title}
            maxLength={140}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError('');
            }}
          />
        </div>

        <div className="dh-targets-row-2">
          <div className="dh-targets-field">
            <label htmlFor="dh-rem-date" className="dh-targets-label">
              Date
            </label>
            <input
              id="dh-rem-date"
              type="date"
              className="dh-targets-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="dh-targets-field">
            <label htmlFor="dh-rem-time" className="dh-targets-label">
              Time (optional)
            </label>
            <input
              id="dh-rem-time"
              type="time"
              className="dh-targets-input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        <div className="dh-targets-field">
          <label htmlFor="dh-rem-category" className="dh-targets-label">
            Category
          </label>
          <Select
            id="dh-rem-category"
            title="Reminder category"
            value={category}
            options={categoryOptions}
            onChange={setCategory}
          />
        </div>

        <div className="dh-targets-field">
          <span className="dh-targets-label">Remind me</span>
          <div className="dh-targets-lead-grid" role="group" aria-label="Lead alert timing">
            {LEAD_DAY_OPTIONS.map((opt) => {
              const active = leadDays.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  className={`dh-targets-lead-btn ${active ? 'active' : ''}`}
                  onClick={() => toggleLeadDay(opt.value)}
                >
                  {active && <Check size={13} strokeWidth={2} aria-hidden="true" />}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dh-targets-field">
          <label htmlFor="dh-rem-notes" className="dh-targets-label">
            Notes (optional)
          </label>
          <textarea
            id="dh-rem-notes"
            className="dh-targets-input dh-targets-textarea"
            rows={2}
            maxLength={800}
            placeholder="Portal link, documents needed, or amount"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="dh-targets-error" role="alert">
            {error}
          </div>
        )}

        <div className="dh-targets-form-footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {editingReminder ? 'Save changes' : 'Save reminder'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
};

export interface TargetsCalendarViewProps {
  state: PulseHabitState;
  todayKey: string;
  composerRequest?: { kind: 'target' | 'reminder'; nonce: number } | null;
  onAddTarget: (draft: TargetDraftInput) => void;
  onUpdateTarget: (id: string, draft: TargetDraftInput) => void;
  onToggleTargetItem: (targetId: string, itemId: string) => void;
  onAddTargetItem: (targetId: string, text: string) => void;
  onDeleteTargetItem: (targetId: string, itemId: string) => void;
  onToggleArchiveTarget: (targetId: string) => void;
  onDeleteTarget: (targetId: string) => void;
  onAddReminder: (draft: ReminderDraftInput) => void;
  onUpdateReminder: (id: string, draft: ReminderDraftInput) => void;
  onToggleReminderDone: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  onShowToast?: (message: string) => void;
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const TargetsCalendarView: React.FC<TargetsCalendarViewProps> = ({
  state,
  todayKey,
  composerRequest,
  onAddTarget,
  onUpdateTarget,
  onToggleTargetItem,
  onAddTargetItem,
  onDeleteTargetItem,
  onToggleArchiveTarget,
  onDeleteTarget,
  onAddReminder,
  onUpdateReminder,
  onToggleReminderDone,
  onDeleteReminder,
  onShowToast,
}) => {
  const todayParts = useMemo(
    () => parseDateKeyParts(todayKey) || { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: new Date().getDate() },
    [todayKey]
  );

  const [calYear, setCalYear] = useState(todayParts.y);
  const [calMonth, setCalMonth] = useState(todayParts.m - 1);
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const [expandedTargets, setExpandedTargets] = useState<Record<string, boolean>>({});
  const [inlineItemInputs, setInlineItemInputs] = useState<Record<string, string>>({});
  const [showArchivedTargets, setShowArchivedTargets] = useState(false);
  const [showDoneReminders, setShowDoneReminders] = useState(false);

  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<DeadlineTarget | null>(null);
  const [targetDefaultDate, setTargetDefaultDate] = useState<string | undefined>(undefined);

  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<CustomReminder | null>(null);
  const [reminderDefaultDate, setReminderDefaultDate] = useState<string | undefined>(undefined);

  const [pushEvent, setPushEvent] = useState<CalendarEventInput | null>(null);

  useEffect(() => {
    if (!composerRequest) return;
    if (composerRequest.kind === 'target') {
      setEditingTarget(null);
      setTargetDefaultDate(undefined);
      setTargetSheetOpen(true);
    } else if (composerRequest.kind === 'reminder') {
      setEditingReminder(null);
      setReminderDefaultDate(undefined);
      setReminderSheetOpen(true);
    }
  }, [composerRequest]);

  const subjectById = useMemo(
    () => new Map<string, Subject>(state.subjects.map((s) => [s.id, s])),
    [state.subjects]
  );

  const { activeTargets, completedTargets } = useMemo(() => {
    const active: DeadlineTarget[] = [];
    const done: DeadlineTarget[] = [];
    for (const t of state.deadlineTargets || []) {
      const prog = computeTargetProgress(t);
      if (t.archived || prog.isComplete) {
        done.push(t);
      } else {
        active.push(t);
      }
    }
    active.sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));
    done.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    return { activeTargets: active, completedTargets: done };
  }, [state.deadlineTargets]);

  const { activeReminders, doneReminders } = useMemo(() => {
    const active: CustomReminder[] = [];
    const done: CustomReminder[] = [];
    for (const r of state.reminders || []) {
      if (r.done) done.push(r);
      else active.push(r);
    }
    active.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time || '23:59').localeCompare(b.time || '23:59') ||
        a.title.localeCompare(b.title)
    );
    done.sort((a, b) => b.date.localeCompare(a.date));
    return { activeReminders: active, doneReminders: done };
  }, [state.reminders]);

  const monthIndex = useMemo(
    () => buildMonthlyCalendarIndex(state, calYear, calMonth),
    [state, calYear, calMonth]
  );

  const gridCells = useMemo(() => buildMonthGridCells(calYear, calMonth), [calYear, calMonth]);

  const selectedBucket = useMemo(() => {
    if (monthIndex[selectedDate]) return monthIndex[selectedDate];
    const parts = parseDateKeyParts(selectedDate);
    if (!parts) return null;
    const altIndex = buildMonthlyCalendarIndex(state, parts.y, parts.m - 1);
    return altIndex[selectedDate] || null;
  }, [monthIndex, selectedDate, state]);

  const handleStepMonth = (delta: number) => {
    const nextDate = new Date(Date.UTC(calYear, calMonth + delta, 1));
    setCalYear(nextDate.getUTCFullYear());
    setCalMonth(nextDate.getUTCMonth());
  };

  const handleJumpToday = () => {
    setCalYear(todayParts.y);
    setCalMonth(todayParts.m - 1);
    setSelectedDate(todayKey);
  };

  const handleSyncAllIcs = () => {
    const events = buildCalendarEventsForAllUpcoming(state, todayKey);
    if (events.length === 0) {
      onShowToast?.('No upcoming targets, reminders, exams, or revisions to export');
      return;
    }
    const ics = buildIcsCalendar(events);
    downloadIcsFile(`deep-hours-schedule-${todayKey}.ics`, ics);
    onShowToast?.(`Exported ${events.length} upcoming ${events.length === 1 ? 'event' : 'events'} (.ics)`);
  };

  const isTargetExpanded = (targetId: string) => {
    if (expandedTargets[targetId] !== undefined) return expandedTargets[targetId];
    return activeTargets.length <= 2;
  };

  const toggleTargetExpanded = (targetId: string) => {
    setExpandedTargets((prev) => ({
      ...prev,
      [targetId]: !isTargetExpanded(targetId),
    }));
  };

  const handleInlineAddSubmit = (targetId: string) => {
    const raw = (inlineItemInputs[targetId] || '').trim();
    if (!raw) return;
    onAddTargetItem(targetId, raw);
    setInlineItemInputs((prev) => ({ ...prev, [targetId]: '' }));
  };

  const selectedAgendaEmpty =
    !selectedBucket ||
    (selectedBucket.targets.length === 0 &&
      selectedBucket.reminders.length === 0 &&
      selectedBucket.exams.length === 0 &&
      selectedBucket.revisions.length === 0 &&
      selectedBucket.leadAlerts.length === 0);

  return (
    <div className="dh-amoled-flow dh-targets-root">
      {/* SECTION 1: DEADLINE TARGET SPRINTS */}
      <section className="dh-amoled-section" aria-label="Deadline target sprints">
        <div className="dh-eyebrow-row">
          <div className="dh-targets-heading-group">
            <h2 className="dh-eyebrow">Target sprints</h2>
            <span className="dh-targets-count tnum">{activeTargets.length} active</span>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={15} strokeWidth={2} aria-hidden="true" />}
            onClick={() => {
              setEditingTarget(null);
              setTargetDefaultDate(undefined);
              setTargetSheetOpen(true);
            }}
          >
            New target
          </Button>
        </div>

        {activeTargets.length === 0 ? (
          <div className="dh-empty-inline">
            <span>
              Set a deadline date with a freeform checklist underneath — finish items in any order.
            </span>
          </div>
        ) : (
          <div className="dh-targets-sprint-list">
            {activeTargets.map((target) => {
              const progress = computeTargetProgress(target);
              const daysUntil = computeDaysUntilDate(target.deadlineDate, todayKey);
              const urgency = formatDeadlineUrgency(daysUntil);
              const sub = target.subjectId ? subjectById.get(target.subjectId) : undefined;
              const expanded = isTargetExpanded(target.id);
              const draftText = inlineItemInputs[target.id] || '';

              return (
                <article key={target.id} className="dh-target-card">
                  <div className="dh-target-card-head">
                    <button
                      type="button"
                      className="dh-target-card-toggle"
                      aria-expanded={expanded}
                      onClick={() => toggleTargetExpanded(target.id)}
                    >
                      <div className="dh-target-title-row">
                        {sub && (
                          <span
                            className="dh-sub-dot"
                            style={{ background: sub.color }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="dh-target-title">{target.title}</span>
                      </div>
                      <div className="dh-target-meta-row">
                        <span className="dh-target-dates tnum">
                          {formatShortDateLabel(target.startDate)} →{' '}
                          {formatShortDateLabel(target.deadlineDate)}
                        </span>
                        <span className={`dh-target-urgency dh-tone-${urgency.tone} tnum`}>
                          {urgency.label}
                        </span>
                        <span className="dh-target-ratio tnum">
                          {progress.doneCount}/{progress.totalCount}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="dh-targets-icon-btn"
                      aria-label={expanded ? 'Collapse checklist' : 'Expand checklist'}
                      onClick={() => toggleTargetExpanded(target.id)}
                    >
                      <ChevronDown
                        size={17}
                        strokeWidth={1.75}
                        className={`dh-chevron-rot ${expanded ? 'open' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  <div
                    className="dh-target-progress-track"
                    role="progressbar"
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${target.title} progress ${progress.percent}%`}
                  >
                    <div
                      className="dh-target-progress-fill"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>

                  {expanded && (
                    <div className="dh-target-expanded">
                      {target.notes && <p className="dh-target-notes">{target.notes}</p>}

                      {target.items.length > 0 && (
                        <ul className="dh-target-checklist">
                          {target.items.map((item) => (
                            <li
                              key={item.id}
                              className={`dh-target-check-row ${item.done ? 'done' : ''}`}
                            >
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={item.done}
                                className="dh-target-check-btn"
                                onClick={() => onToggleTargetItem(target.id, item.id)}
                              >
                                <span className={`dh-check-box ${item.done ? 'checked' : ''}`}>
                                  {item.done && (
                                    <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                                  )}
                                </span>
                                <span className="dh-target-check-text">{item.text}</span>
                              </button>
                              <button
                                type="button"
                                className="dh-targets-icon-btn dh-targets-icon-subtle"
                                aria-label={`Delete ${item.text}`}
                                onClick={() => onDeleteTargetItem(target.id, item.id)}
                              >
                                <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="dh-target-quick-add">
                        <input
                          type="text"
                          className="dh-target-quick-input"
                          placeholder="+ Add checklist item"
                          aria-label={`Add checklist item to ${target.title}`}
                          value={draftText}
                          maxLength={200}
                          onChange={(e) =>
                            setInlineItemInputs((prev) => ({
                              ...prev,
                              [target.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleInlineAddSubmit(target.id);
                            }
                          }}
                        />
                        {draftText.trim() && (
                          <button
                            type="button"
                            className="dh-ghost-pill"
                            onClick={() => handleInlineAddSubmit(target.id)}
                          >
                            Add
                          </button>
                        )}
                      </div>

                      <div className="dh-target-card-actions">
                        <button
                          type="button"
                          className="dh-ghost-pill"
                          onClick={() => setPushEvent(buildTargetCalendarInput(target, sub?.name))}
                        >
                          <CalendarPlus size={14} strokeWidth={1.75} aria-hidden="true" />
                          <span>Push to Calendar</span>
                        </button>
                        <div className="dh-target-card-actions-right">
                          <button
                            type="button"
                            className="dh-targets-icon-btn"
                            aria-label={`Edit ${target.title}`}
                            onClick={() => {
                              setEditingTarget(target);
                              setTargetSheetOpen(true);
                            }}
                          >
                            <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="dh-targets-icon-btn"
                            aria-label={`Archive ${target.title}`}
                            onClick={() => onToggleArchiveTarget(target.id)}
                          >
                            <Archive size={15} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="dh-targets-icon-btn dh-targets-icon-danger"
                            aria-label={`Delete ${target.title}`}
                            onClick={() => onDeleteTarget(target.id)}
                          >
                            <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {completedTargets.length > 0 && (
          <div className="dh-targets-collapsible">
            <button
              type="button"
              className="dh-eyebrow-link"
              aria-expanded={showArchivedTargets}
              onClick={() => setShowArchivedTargets((v) => !v)}
            >
              <span>Completed / Archived ({completedTargets.length})</span>
              <ChevronDown
                size={15}
                strokeWidth={1.75}
                className={`dh-chevron-rot ${showArchivedTargets ? 'open' : ''}`}
                aria-hidden="true"
              />
            </button>
            {showArchivedTargets && (
              <div className="dh-hairline-list">
                {completedTargets.map((target) => {
                  const progress = computeTargetProgress(target);
                  return (
                    <div key={target.id} className="dh-hairline-row dh-target-archived-row">
                      <div className="dh-target-archived-info">
                        <span className="dh-target-archived-title">{target.title}</span>
                        <span className="dh-target-archived-sub tnum">
                          Due {formatShortDateLabel(target.deadlineDate)} · {progress.doneCount}/
                          {progress.totalCount} done
                        </span>
                      </div>
                      <div className="dh-target-card-actions-right">
                        {target.archived && (
                          <button
                            type="button"
                            className="dh-targets-icon-btn"
                            aria-label={`Restore ${target.title}`}
                            onClick={() => onToggleArchiveTarget(target.id)}
                          >
                            <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="dh-targets-icon-btn dh-targets-icon-danger"
                          aria-label={`Delete ${target.title}`}
                          onClick={() => onDeleteTarget(target.id)}
                        >
                          <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SECTION 2: UNIFIED MONTHLY CALENDAR */}
      <section className="dh-amoled-section" aria-label="Unified study calendar">
        <div className="dh-eyebrow-row">
          <h2 className="dh-eyebrow">Calendar</h2>
          <button
            type="button"
            className="dh-ghost-pill"
            onClick={handleSyncAllIcs}
          >
            <Download size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Sync all (.ics)</span>
          </button>
        </div>

        <div className="dh-cal-shell">
          <div className="dh-cal-header">
            <div className="dh-cal-nav">
              <button
                type="button"
                className="dh-targets-icon-btn"
                aria-label="Previous month"
                onClick={() => handleStepMonth(-1)}
              >
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <span className="dh-cal-month-title">{formatMonthYearHeading(calYear, calMonth)}</span>
              <button
                type="button"
                className="dh-targets-icon-btn"
                aria-label="Next month"
                onClick={() => handleStepMonth(1)}
              >
                <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="dh-ghost-pill" onClick={handleJumpToday}>
              Today
            </button>
          </div>

          <div className="dh-cal-legend" aria-hidden="true">
            <span className="dh-cal-legend-item">
              <span className="dh-cal-dot dh-dot-target" />
              Target
            </span>
            <span className="dh-cal-legend-item">
              <span className="dh-cal-dot dh-dot-reminder" />
              Reminder
            </span>
            <span className="dh-cal-legend-item">
              <span className="dh-cal-dot dh-dot-exam" />
              Exam
            </span>
            <span className="dh-cal-legend-item">
              <span className="dh-cal-dot dh-dot-revision" />
              Revision
            </span>
          </div>

          <div className="dh-cal-weekdays" aria-hidden="true">
            {WEEKDAY_HEADERS.map((wd) => (
              <span key={wd} className="dh-cal-weekday">
                {wd}
              </span>
            ))}
          </div>

          <div className="dh-cal-grid" role="grid" aria-label={formatMonthYearHeading(calYear, calMonth)}>
            {gridCells.map((cell) => {
              const bucket = cell.inCurrentMonth ? monthIndex[cell.dateKey] : undefined;
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDate;
              const hasTarget = Boolean(bucket && bucket.targets.length > 0);
              const hasReminder = Boolean(
                bucket && (bucket.reminders.length > 0 || bucket.leadAlerts.length > 0)
              );
              const hasExam = Boolean(bucket && bucket.exams.length > 0);
              const hasRevision = Boolean(bucket && bucket.revisions.length > 0);

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${formatFullDateLabel(cell.dateKey)}${
                    hasTarget || hasReminder || hasExam || hasRevision ? ', has scheduled items' : ''
                  }`}
                  className={`dh-cal-cell ${cell.inCurrentMonth ? '' : 'outside'} ${
                    isToday ? 'today' : ''
                  } ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedDate(cell.dateKey);
                    if (!cell.inCurrentMonth) {
                      const parts = parseDateKeyParts(cell.dateKey);
                      if (parts) {
                        setCalYear(parts.y);
                        setCalMonth(parts.m - 1);
                      }
                    }
                  }}
                >
                  <span className="dh-cal-day-num tnum">{cell.dayNumber}</span>
                  <span className="dh-cal-dots" aria-hidden="true">
                    {hasTarget && <span className="dh-cal-dot dh-dot-target" />}
                    {hasReminder && <span className="dh-cal-dot dh-dot-reminder" />}
                    {hasExam && <span className="dh-cal-dot dh-dot-exam" />}
                    {hasRevision && <span className="dh-cal-dot dh-dot-revision" />}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected Day Agenda */}
          <div className="dh-cal-agenda">
            <div className="dh-cal-agenda-head">
              <div className="dh-cal-agenda-date">{formatFullDateLabel(selectedDate)}</div>
              <div className="dh-cal-agenda-quick">
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => {
                    setEditingTarget(null);
                    setTargetDefaultDate(selectedDate);
                    setTargetSheetOpen(true);
                  }}
                >
                  <Plus size={13} strokeWidth={2} aria-hidden="true" />
                  <span>Target</span>
                </button>
                <button
                  type="button"
                  className="dh-eyebrow-link"
                  onClick={() => {
                    setEditingReminder(null);
                    setReminderDefaultDate(selectedDate);
                    setReminderSheetOpen(true);
                  }}
                >
                  <Plus size={13} strokeWidth={2} aria-hidden="true" />
                  <span>Reminder</span>
                </button>
              </div>
            </div>

            {selectedAgendaEmpty ? (
              <div className="dh-cal-agenda-empty">Nothing scheduled on this date.</div>
            ) : (
              <div className="dh-hairline-list">
                {selectedBucket?.targets.map((target) => {
                  const prog = computeTargetProgress(target);
                  const sub = target.subjectId ? subjectById.get(target.subjectId) : undefined;
                  return (
                    <div key={`ag_tgt_${target.id}`} className="dh-hairline-row dh-cal-agenda-row">
                      <div className="dh-cal-agenda-left">
                        <span className="dh-cal-dot dh-dot-target" aria-hidden="true" />
                        <div className="dh-cal-agenda-copy">
                          <span className="dh-cal-agenda-title">{target.title}</span>
                          <span className="dh-cal-agenda-sub tnum">
                            Target deadline · {prog.doneCount}/{prog.totalCount} done
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="dh-ghost-pill"
                        onClick={() => setPushEvent(buildTargetCalendarInput(target, sub?.name))}
                      >
                        <Calendar size={13} strokeWidth={1.75} aria-hidden="true" />
                        <span>Calendar</span>
                      </button>
                    </div>
                  );
                })}

                {selectedBucket?.reminders.map((rem) => (
                  <div key={`ag_rem_${rem.id}`} className="dh-hairline-row dh-cal-agenda-row">
                    <div className="dh-cal-agenda-left">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={Boolean(rem.done)}
                        aria-label={`Mark ${rem.title} ${rem.done ? 'not done' : 'done'}`}
                        className="dh-cal-agenda-check"
                        onClick={() => onToggleReminderDone(rem.id)}
                      >
                        <span className={`dh-check-box ${rem.done ? 'checked' : ''}`}>
                          {rem.done && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
                        </span>
                      </button>
                      <div className="dh-cal-agenda-copy">
                        <span className={`dh-cal-agenda-title ${rem.done ? 'done' : ''}`}>
                          {rem.title}
                        </span>
                        <span className="dh-cal-agenda-sub">
                          {REMINDER_CATEGORY_LABELS[rem.category]}
                          {rem.time ? ` · ${formatTime12h(rem.time)}` : ''} ·{' '}
                          {formatLeadDaysSummary(rem.leadDays)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="dh-ghost-pill"
                      onClick={() => setPushEvent(buildReminderCalendarInput(rem))}
                    >
                      <Calendar size={13} strokeWidth={1.75} aria-hidden="true" />
                      <span>Calendar</span>
                    </button>
                  </div>
                ))}

                {selectedBucket?.leadAlerts.map(({ reminder, leadDaysBefore }) => (
                  <div
                    key={`ag_lead_${reminder.id}_${leadDaysBefore}`}
                    className="dh-hairline-row dh-cal-agenda-row"
                  >
                    <div className="dh-cal-agenda-left">
                      <Bell size={14} strokeWidth={1.75} className="dh-cal-lead-icon" aria-hidden="true" />
                      <div className="dh-cal-agenda-copy">
                        <span className="dh-cal-agenda-title">
                          Lead alert: {reminder.title}
                        </span>
                        <span className="dh-cal-agenda-sub tnum">
                          {leadDaysBefore}d before · due {formatShortDateLabel(reminder.date)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="dh-ghost-pill"
                      onClick={() => setPushEvent(buildReminderCalendarInput(reminder))}
                    >
                      <Calendar size={13} strokeWidth={1.75} aria-hidden="true" />
                      <span>Calendar</span>
                    </button>
                  </div>
                ))}

                {selectedBucket?.exams.map((exam) => (
                  <div key={`ag_exam_${exam.id}`} className="dh-hairline-row dh-cal-agenda-row">
                    <div className="dh-cal-agenda-left">
                      <Flag size={14} strokeWidth={1.75} className="dh-cal-exam-icon" aria-hidden="true" />
                      <div className="dh-cal-agenda-copy">
                        <span className="dh-cal-agenda-title">{exam.title}</span>
                        <span className="dh-cal-agenda-sub">Exam D-Day</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="dh-ghost-pill"
                      onClick={() => setPushEvent(buildExamCalendarInput(exam))}
                    >
                      <Calendar size={13} strokeWidth={1.75} aria-hidden="true" />
                      <span>Calendar</span>
                    </button>
                  </div>
                ))}

                {selectedBucket?.revisions.map((ch) => {
                  const sub = subjectById.get(ch.subjectId);
                  return (
                    <div key={`ag_rev_${ch.id}`} className="dh-hairline-row dh-cal-agenda-row">
                      <div className="dh-cal-agenda-left">
                        <BookOpen size={14} strokeWidth={1.75} className="dh-cal-rev-icon" aria-hidden="true" />
                        <div className="dh-cal-agenda-copy">
                          <span className="dh-cal-agenda-title">{ch.name}</span>
                          <span className="dh-cal-agenda-sub">
                            Spaced revision{sub ? ` · ${sub.name}` : ''}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="dh-ghost-pill"
                        onClick={() =>
                          setPushEvent(buildRevisionCalendarInput(ch, selectedDate, sub?.name))
                        }
                      >
                        <Calendar size={13} strokeWidth={1.75} aria-hidden="true" />
                        <span>Calendar</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 3: CUSTOM REMINDERS */}
      <section className="dh-amoled-section" aria-label="Custom reminders">
        <div className="dh-eyebrow-row">
          <div className="dh-targets-heading-group">
            <h2 className="dh-eyebrow">Reminders</h2>
            <span className="dh-targets-count tnum">{activeReminders.length} active</span>
          </div>
          <button
            type="button"
            className="dh-ghost-pill"
            onClick={() => {
              setEditingReminder(null);
              setReminderDefaultDate(undefined);
              setReminderSheetOpen(true);
            }}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            <span>Add reminder</span>
          </button>
        </div>

        {activeReminders.length === 0 ? (
          <div className="dh-empty-inline">
            <span>
              Track registration deadlines, fee dates, or study milestones with 7d/3d/1d lead
              alerts.
            </span>
          </div>
        ) : (
          <div className="dh-hairline-list">
            {activeReminders.map((rem) => {
              const daysUntil = computeDaysUntilDate(rem.date, todayKey);
              const urgency = formatDeadlineUrgency(daysUntil);
              return (
                <div key={rem.id} className="dh-hairline-row dh-reminder-row">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={false}
                    aria-label={`Mark ${rem.title} done`}
                    className="dh-cal-agenda-check"
                    onClick={() => onToggleReminderDone(rem.id)}
                  >
                    <span className="dh-check-box" />
                  </button>
                  <div className="dh-reminder-copy">
                    <div className="dh-reminder-title-line">
                      <span className="dh-reminder-title">{rem.title}</span>
                      <span className={`dh-target-urgency dh-tone-${urgency.tone} tnum`}>
                        {urgency.label}
                      </span>
                    </div>
                    <div className="dh-reminder-meta tnum">
                      <span>{formatShortDateLabel(rem.date, true)}</span>
                      {rem.time && (
                        <>
                          <Clock size={12} strokeWidth={1.75} aria-hidden="true" />
                          <span>{formatTime12h(rem.time)}</span>
                        </>
                      )}
                      <span>· {REMINDER_CATEGORY_LABELS[rem.category]}</span>
                      <span>· {formatLeadDaysSummary(rem.leadDays)}</span>
                    </div>
                    {rem.notes && <div className="dh-reminder-notes">{rem.notes}</div>}
                  </div>
                  <div className="dh-reminder-actions">
                    <button
                      type="button"
                      className="dh-targets-icon-btn"
                      aria-label={`Push ${rem.title} to Calendar`}
                      onClick={() => setPushEvent(buildReminderCalendarInput(rem))}
                    >
                      <CalendarPlus size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="dh-targets-icon-btn"
                      aria-label={`Edit ${rem.title}`}
                      onClick={() => {
                        setEditingReminder(rem);
                        setReminderSheetOpen(true);
                      }}
                    >
                      <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="dh-targets-icon-btn dh-targets-icon-danger"
                      aria-label={`Delete ${rem.title}`}
                      onClick={() => onDeleteReminder(rem.id)}
                    >
                      <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {doneReminders.length > 0 && (
          <div className="dh-targets-collapsible">
            <button
              type="button"
              className="dh-eyebrow-link"
              aria-expanded={showDoneReminders}
              onClick={() => setShowDoneReminders((v) => !v)}
            >
              <span>Completed reminders ({doneReminders.length})</span>
              <ChevronDown
                size={15}
                strokeWidth={1.75}
                className={`dh-chevron-rot ${showDoneReminders ? 'open' : ''}`}
                aria-hidden="true"
              />
            </button>
            {showDoneReminders && (
              <div className="dh-hairline-list">
                {doneReminders.map((rem) => (
                  <div key={rem.id} className="dh-hairline-row dh-reminder-row done">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={true}
                      aria-label={`Mark ${rem.title} not done`}
                      className="dh-cal-agenda-check"
                      onClick={() => onToggleReminderDone(rem.id)}
                    >
                      <span className="dh-check-box checked">
                        <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    </button>
                    <div className="dh-reminder-copy">
                      <span className="dh-reminder-title done">{rem.title}</span>
                      <span className="dh-reminder-meta tnum">
                        {formatShortDateLabel(rem.date, true)} ·{' '}
                        {REMINDER_CATEGORY_LABELS[rem.category]}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="dh-targets-icon-btn dh-targets-icon-danger"
                      aria-label={`Delete ${rem.title}`}
                      onClick={() => onDeleteReminder(rem.id)}
                    >
                      <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* COMPOSER & CALENDAR PUSH SHEETS */}
      <TargetComposerSheet
        open={targetSheetOpen}
        onClose={() => {
          setTargetSheetOpen(false);
          setEditingTarget(null);
        }}
        todayKey={todayKey}
        defaultDeadlineDate={targetDefaultDate}
        subjects={state.subjects}
        editingTarget={editingTarget}
        onSave={(draft, existingId) => {
          if (existingId) onUpdateTarget(existingId, draft);
          else onAddTarget(draft);
        }}
      />

      <ReminderComposerSheet
        open={reminderSheetOpen}
        onClose={() => {
          setReminderSheetOpen(false);
          setEditingReminder(null);
        }}
        todayKey={todayKey}
        defaultDate={reminderDefaultDate}
        editingReminder={editingReminder}
        onSave={(draft, existingId) => {
          if (existingId) onUpdateReminder(existingId, draft);
          else onAddReminder(draft);
        }}
      />

      <CalendarPushSheet
        event={pushEvent}
        onClose={() => setPushEvent(null)}
        onDownloaded={onShowToast}
      />
    </div>
  );
};

export { Target as TargetIcon };
