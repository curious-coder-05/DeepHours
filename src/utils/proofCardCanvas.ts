import type { PulseHabitState } from '../types';
import {
  fmtDuration,
  fmtHMShort,
  getDayProgress,
  getDayTotalStudyMs,
  getSubject,
  parseD,
} from './studyLogic';
import { computeMinDayStreak } from './insights';
import {
  ALL_SUBJECTS_COLOR,
  ALL_SUBJECTS_LABEL,
  isAllSubjectsMockId,
} from './focusSessionHelpers';

export const PROOF_CARD_WIDTH = 1080;
export const PROOF_CARD_HEIGHT = 1350;

export interface ProofSubjectSlice {
  id: string;
  label: string;
  color: string;
  ms: number;
  pct: number;
}

export interface SessionProofPayload {
  kind: 'session';
  durationMs: number;
  subjectLabel: string;
  subjectColor: string;
  chapterName?: string;
  topicHeading?: string;
  focusPurity?: number;
  streakDays: number;
  dateLabel: string;
  dayKey: string;
  modeLabel?: string;
  subtitle?: string;
}

export interface DailyProofPayload {
  kind: 'daily';
  totalMs: number;
  goalMs: number;
  sessionsCount: number;
  avgPurity: number | null;
  habitsDone: number;
  habitsTotal: number;
  tasksDone: number;
  tasksTotal: number;
  streakDays: number;
  dateLabel: string;
  dayKey: string;
  slices: ProofSubjectSlice[];
  topTopics?: string[];
}

export type ProofCardPayload = SessionProofPayload | DailyProofPayload;

const GENERIC_HEADINGS = new Set([
  'full mock',
  'exam hall',
  'exam hall · neet mock',
  'deep study session',
  'deep study',
]);

export function formatProofDateLabel(dayKey: string): string {
  const d = parseD(dayKey);
  try {
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dayKey;
  }
}

/**
 * Pure privacy redaction pass used both before Canvas rendering and in unit tests.
 * When `hideDetails` is true, strips personal chapter names and custom topic headings
 * while preserving duration, subject/mode label, purity, streak, and date.
 */
export function redactProofPayload<T extends ProofCardPayload>(
  payload: T,
  hideDetails: boolean
): T {
  if (!hideDetails) return payload;
  if (payload.kind === 'session') {
    const cleanHeading = (payload.topicHeading || '').trim();
    const keepGeneric = GENERIC_HEADINGS.has(cleanHeading.toLowerCase());
    return {
      ...payload,
      chapterName: undefined,
      topicHeading: keepGeneric ? cleanHeading : undefined,
    };
  }
  return {
    ...payload,
    topTopics: [],
  };
}

export function buildProofCardFilename(payload: ProofCardPayload): string {
  const safeDay = String(payload.dayKey || 'today').replace(/[^0-9-]/g, '') || 'today';
  const suffix = payload.kind === 'session' ? 'session' : 'daily';
  return `deep-hours-${suffix}-${safeDay}.png`;
}

export function buildDailyProofPayload(
  state: PulseHabitState,
  dayKey: string,
  todayKey: string
): DailyProofPayload {
  const sessions = (state.sessions || []).filter((s) => s.dayKey === dayKey);
  const totalMs = getDayTotalStudyMs(state, dayKey);
  const goalMs = Math.max(15, state.set.targets?.minDayMinutes ?? 360) * 60_000;

  const purityValues = sessions
    .map((s) => Number(s.purity))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgPurity =
    purityValues.length > 0
      ? Math.round(
          purityValues.reduce((acc, v) => acc + v, 0) / purityValues.length
        )
      : null;

  const bySubject = new Map<string, { label: string; color: string; ms: number }>();
  const topicSet: string[] = [];

  for (const s of sessions) {
    const ms = Math.max(0, Number(s.activeMs) || 0);
    if (ms <= 0) continue;
    const isAll = isAllSubjectsMockId(s.subjectId);
    const key = isAll ? 'sub_All_Subjects' : s.subjectId;
    const sub = isAll ? null : getSubject(state, s.subjectId);
    const label = isAll ? ALL_SUBJECTS_LABEL : sub?.name || 'Study';
    const color = isAll ? ALL_SUBJECTS_COLOR : sub?.color || ALL_SUBJECTS_COLOR;

    const prev = bySubject.get(key);
    if (prev) {
      prev.ms += ms;
    } else {
      bySubject.set(key, { label, color, ms });
    }

    const heading = (s.heading || '').trim();
    if (
      heading &&
      !GENERIC_HEADINGS.has(heading.toLowerCase()) &&
      !topicSet.includes(heading) &&
      topicSet.length < 3
    ) {
      topicSet.push(heading);
    }
  }

  const slices: ProofSubjectSlice[] = Array.from(bySubject.entries())
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([id, item]) => ({
      id,
      label: item.label,
      color: item.color,
      ms: item.ms,
      pct: totalMs > 0 ? Math.max(1, Math.round((item.ms / totalMs) * 100)) : 0,
    }));

  const prog = getDayProgress(state, dayKey);
  const streakInfo = computeMinDayStreak(state, todayKey);

  return {
    kind: 'daily',
    totalMs,
    goalMs,
    sessionsCount: sessions.length,
    avgPurity,
    habitsDone: prog.habitsDone,
    habitsTotal: prog.habitsTotal,
    tasksDone: prog.tasksDone,
    tasksTotal: prog.tasksTotal,
    streakDays: streakInfo.streak,
    dateLabel: formatProofDateLabel(dayKey),
    dayKey,
    slices,
    topTopics: topicSet,
  };
}

// ---------------------------------------------------------------------------
// Native HTML5 Canvas 2D Renderer (1080 x 1350 · 4:5 Portrait · Zero Deps)
// ---------------------------------------------------------------------------

const SANS_STACK =
  '"Geist Variable", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO_STACK =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number
): void {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + letterSpacing;
  }
}

function drawFlameIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string
): void {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 24;
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.bezierCurveTo(4.8, -6.4, 8.2, -2.1, 8.2, 3.1);
  ctx.bezierCurveTo(8.2, 7.8, 4.5, 11, 0, 11);
  ctx.bezierCurveTo(-4.5, 11, -8.2, 7.8, -8.2, 3.1);
  ctx.bezierCurveTo(-8.2, -0.8, -6.2, -3.5, -4.1, -5.5);
  ctx.bezierCurveTo(-4.3, -2.5, -2.5, -1.2, -1.5, -1.6);
  ctx.bezierCurveTo(-2.7, -4.7, -1.8, -8.5, 0, -11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function formatHeroDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  return fmtHMShort(ms);
}

export function renderProofCardToCanvas(
  canvas: HTMLCanvasElement,
  rawPayload: ProofCardPayload,
  options?: { hideDetails?: boolean }
): void {
  const payload = redactProofPayload(rawPayload, Boolean(options?.hideDetails));
  canvas.width = PROOF_CARD_WIDTH;
  canvas.height = PROOF_CARD_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = PROOF_CARD_WIDTH;
  const H = PROOF_CARD_HEIGHT;

  // 1. True AMOLED #000000 outer canvas
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // 2. Main Frosted Dark Glass Card Frame
  const cardX = 64;
  const cardY = 68;
  const cardW = W - 128;
  const cardH = H - 136;
  const cardR = 44;

  // Base dark surface
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.fillStyle = '#0B0E14';
  ctx.fill();

  // Subtle internal ambient tint centered behind the hero ring (restrained, clipped inside card)
  ctx.save();
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.clip();

  const accentColor =
    payload.kind === 'session'
      ? payload.subjectColor || '#F5C451'
      : payload.slices[0]?.color || '#F5C451';

  const glow = ctx.createRadialGradient(W / 2, 460, 40, W / 2, 460, 420);
  glow.addColorStop(0, 'rgba(245, 196, 81, 0.08)');
  glow.addColorStop(0.55, 'rgba(255, 255, 255, 0.02)');
  glow.addColorStop(1, 'rgba(11, 14, 20, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cardX, cardY, cardW, cardH);

  // Subtle frosted top-edge sheen
  const topSheen = ctx.createLinearGradient(cardX, cardY, cardX, cardY + 220);
  topSheen.addColorStop(0, 'rgba(255, 255, 255, 0.045)');
  topSheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = topSheen;
  ctx.fillRect(cardX, cardY, cardW, 220);
  ctx.restore();

  // Crisp 1.5px translucent glass border
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
  ctx.stroke();

  // 3. Header Row (Left badge + Right date)
  const headerY = cardY + 66;
  const padX = cardX + 56;

  // Left pill badge
  const badgeText =
    payload.kind === 'session' ? 'Session proof' : 'Daily study proof';
  ctx.font = `600 24px ${SANS_STACK}`;
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgeW = badgeTextW + 58;
  const badgeH = 48;
  drawRoundedRect(ctx, padX, headerY - 24, badgeW, badgeH, 24);
  ctx.fillStyle = 'rgba(245, 196, 81, 0.12)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(245, 196, 81, 0.34)';
  ctx.stroke();

  // Lumen dot inside badge
  ctx.beginPath();
  ctx.arc(padX + 24, headerY, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#F5C451';
  ctx.fill();

  ctx.fillStyle = '#F5C451';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, padX + 42, headerY + 1);

  // Date right-aligned
  ctx.font = `500 26px ${SANS_STACK}`;
  ctx.fillStyle = '#9BA4B5';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(payload.dateLabel, cardX + cardW - 56, headerY + 1);

  // 4. Center Hero Ring + Oversized Duration
  const ringCx = W / 2;
  const ringCy = 468;
  const ringR = 224;
  const ringStroke = 26;

  // Outer track
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
  ctx.lineWidth = ringStroke;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.075)';
  ctx.stroke();

  const startAngle = -Math.PI / 2;

  if (payload.kind === 'session') {
    const purityFrac =
      payload.focusPurity !== undefined
        ? Math.max(0.12, Math.min(1, payload.focusPurity / 100))
        : 0.92;
    ctx.beginPath();
    ctx.arc(
      ringCx,
      ringCy,
      ringR,
      startAngle,
      startAngle + Math.PI * 2 * purityFrac
    );
    ctx.lineWidth = ringStroke;
    ctx.lineCap = 'round';
    ctx.strokeStyle = accentColor;
    ctx.stroke();

    // Subtle inner hairline ring
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringR - 28, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.stroke();
  } else {
    // Daily multi-segment subject split ring
    const goalDenom =
      payload.goalMs > 0
        ? Math.max(payload.goalMs, payload.totalMs)
        : Math.max(1, payload.totalMs);
    const totalFillFrac =
      payload.totalMs > 0
        ? Math.min(1, Math.max(0.06, payload.totalMs / goalDenom))
        : 0;

    if (payload.slices.length > 0 && totalFillFrac > 0) {
      const gapAngle = payload.slices.length > 1 ? 0.045 : 0;
      const totalSweep = Math.PI * 2 * totalFillFrac;
      const usableSweep = Math.max(
        0.1,
        totalSweep - gapAngle * payload.slices.length
      );
      let cursorAngle = startAngle;

      for (const slice of payload.slices.slice(0, 6)) {
        const share = payload.totalMs > 0 ? slice.ms / payload.totalMs : 0;
        const segAngle = Math.max(0.04, usableSweep * share);
        ctx.beginPath();
        ctx.arc(
          ringCx,
          ringCy,
          ringR,
          cursorAngle,
          cursorAngle + segAngle
        );
        ctx.lineWidth = ringStroke;
        ctx.lineCap = 'round';
        ctx.strokeStyle = slice.color || '#F5C451';
        ctx.stroke();
        cursorAngle += segAngle + gapAngle;
      }
    } else {
      // Empty day calm tick
      ctx.beginPath();
      ctx.arc(ringCx, ringCy, ringR, startAngle, startAngle + 0.14);
      ctx.lineWidth = ringStroke;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(245, 196, 81, 0.4)';
      ctx.stroke();
    }
  }

  // Hero duration inside ring
  const heroValue =
    payload.kind === 'session'
      ? formatHeroDuration(payload.durationMs)
      : formatHeroDuration(payload.totalMs);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `700 ${heroValue.length > 6 ? 86 : 104}px ${SANS_STACK}`;
  ctx.fillText(heroValue, ringCx, ringCy - 14);

  // Secondary label inside ring
  const ringSub =
    payload.kind === 'session'
      ? payload.subjectLabel
      : payload.goalMs > 0
        ? `${Math.min(999, Math.round((payload.totalMs / payload.goalMs) * 100))}% of ${fmtDuration(payload.goalMs)} goal`
        : `${payload.sessionsCount} ${payload.sessionsCount === 1 ? 'session' : 'sessions'} logged`;

  ctx.font = `600 28px ${SANS_STACK}`;
  ctx.fillStyle = payload.kind === 'session' ? accentColor : '#F5C451';
  ctx.fillText(truncateText(ctx, ringSub, 340), ringCx, ringCy + 58);

  if (payload.kind === 'session' && payload.subtitle) {
    ctx.font = `500 22px ${SANS_STACK}`;
    ctx.fillStyle = '#8F98A8';
    ctx.fillText(truncateText(ctx, payload.subtitle, 330), ringCx, ringCy + 96);
  }

  // 5. Middle Detail Strip (Chapter/Topic or Subject Split Chips)
  const midY = 746;
  const innerW = cardW - 112;

  if (payload.kind === 'session') {
    const detailParts = [payload.chapterName, payload.topicHeading].filter(
      (s): s is string => Boolean(s && s.trim())
    );
    const uniqueParts = Array.from(new Set(detailParts));
    const detailLine = uniqueParts.join(' · ');

    if (detailLine) {
      drawRoundedRect(ctx, padX, midY, innerW, 88, 22);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.stroke();

      ctx.font = `500 26px ${SANS_STACK}`;
      ctx.fillStyle = '#E5EAF2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateText(ctx, detailLine, innerW - 64), W / 2, midY + 45);
    } else {
      // Clean subject pill when details are hidden or absent
      drawRoundedRect(ctx, padX, midY + 6, innerW, 74, 22);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.stroke();

      ctx.font = `500 24px ${SANS_STACK}`;
      ctx.fillStyle = '#9BA4B5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        payload.modeLabel
          ? `${payload.subjectLabel} · ${payload.modeLabel}`
          : payload.subjectLabel,
        W / 2,
        midY + 44
      );
    }
  } else {
    // Daily subject breakdown bar + compact legend (up to 4 subjects)
    const shownSlices = payload.slices.slice(0, 4);
    if (shownSlices.length > 0) {
      // Horizontal proportional split bar
      const barH = 14;
      const barY = midY + 4;
      drawRoundedRect(ctx, padX, barY, innerW, barH, 7);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fill();

      ctx.save();
      drawRoundedRect(ctx, padX, barY, innerW, barH, 7);
      ctx.clip();
      let segX = padX;
      for (const sl of payload.slices) {
        const segW = payload.totalMs > 0 ? (sl.ms / payload.totalMs) * innerW : 0;
        if (segW > 0) {
          ctx.fillStyle = sl.color || '#F5C451';
          ctx.fillRect(segX, barY, Math.max(4, segW - 2), barH);
          segX += segW;
        }
      }
      ctx.restore();

      // Legend items centered below split bar
      const chipGap = 16;
      const chipCount = shownSlices.length;
      const chipW = (innerW - chipGap * (chipCount - 1)) / chipCount;
      const chipY = midY + 34;

      shownSlices.forEach((sl, idx) => {
        const cx = padX + idx * (chipW + chipGap);
        drawRoundedRect(ctx, cx, chipY, chipW, 54, 16);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.fill();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.075)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx + 22, chipY + 27, 6, 0, Math.PI * 2);
        ctx.fillStyle = sl.color || '#F5C451';
        ctx.fill();

        ctx.font = `600 20px ${SANS_STACK}`;
        ctx.fillStyle = '#E5EAF2';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const txt = `${sl.label} · ${fmtHMShort(sl.ms)}`;
        ctx.fillText(truncateText(ctx, txt, chipW - 44), cx + 36, chipY + 28);
      });
    } else {
      drawRoundedRect(ctx, padX, midY + 12, innerW, 68, 20);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.stroke();
      ctx.font = `500 24px ${SANS_STACK}`;
      ctx.fillStyle = '#8F98A8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Ready for deep work', W / 2, midY + 47);
    }
  }

  // 6. Metric Trio Row
  const tilesY = 884;
  const tileGap = 20;
  const tileW = (innerW - tileGap * 2) / 3;
  const tileH = 178;

  type TileSpec = {
    label: string;
    value: string;
    sub: string;
    valueColor?: string;
    flame?: boolean;
  };

  const tiles: TileSpec[] =
    payload.kind === 'session'
      ? [
          {
            label: 'Focus purity',
            value:
              payload.focusPurity !== undefined
                ? `${payload.focusPurity}%`
                : '100%',
            sub:
              (payload.focusPurity ?? 100) >= 90
                ? 'Locked in'
                : 'Steady focus',
            valueColor:
              (payload.focusPurity ?? 100) >= 85 ? '#34D399' : '#F8FAFC',
          },
          {
            label: 'Study streak',
            value: `${payload.streakDays}d`,
            sub: payload.streakDays > 0 ? 'Active streak' : 'Day one',
            valueColor: '#F5C451',
            flame: true,
          },
          {
            label: 'Session',
            value: payload.modeLabel || 'Focused',
            sub: payload.dayKey,
            valueColor: '#F8FAFC',
          },
        ]
      : [
          {
            label: 'Sessions',
            value: String(payload.sessionsCount),
            sub:
              payload.avgPurity !== null
                ? `${payload.avgPurity}% avg purity`
                : 'Logged today',
            valueColor: '#F8FAFC',
          },
          {
            label: 'Study streak',
            value: `${payload.streakDays}d`,
            sub: payload.streakDays > 0 ? 'Minimum-day run' : 'Building streak',
            valueColor: '#F5C451',
            flame: true,
          },
          {
            label: 'Tasks & habits',
            value:
              payload.habitsTotal + payload.tasksTotal > 0
                ? `${payload.habitsDone + payload.tasksDone}/${payload.habitsTotal + payload.tasksTotal}`
                : '—',
            sub:
              payload.habitsTotal + payload.tasksTotal > 0
                ? `${Math.round(
                    ((payload.habitsDone + payload.tasksDone) /
                      Math.max(1, payload.habitsTotal + payload.tasksTotal)) *
                      100
                  )}% completed`
                : 'No checklist items',
            valueColor: '#34D399',
          },
        ];

  tiles.forEach((tile, i) => {
    const tx = padX + i * (tileW + tileGap);
    drawRoundedRect(ctx, tx, tilesY, tileW, tileH, 26);
    ctx.fillStyle = '#12161F';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `500 22px ${SANS_STACK}`;
    ctx.fillStyle = '#8F98A8';
    ctx.fillText(tile.label, tx + 26, tilesY + 40);

    ctx.font = `700 ${tile.value.length > 8 ? 34 : 44}px ${SANS_STACK}`;
    ctx.fillStyle = tile.valueColor || '#F8FAFC';

    if (tile.flame) {
      drawFlameIcon(ctx, tx + 40, tilesY + 96, 30, '#F5C451');
      ctx.fillText(
        truncateText(ctx, tile.value, tileW - 84),
        tx + 62,
        tilesY + 98
      );
    } else {
      ctx.fillText(
        truncateText(ctx, tile.value, tileW - 52),
        tx + 26,
        tilesY + 98
      );
    }

    ctx.font = `500 20px ${SANS_STACK}`;
    ctx.fillStyle = '#6E7787';
    ctx.fillText(
      truncateText(ctx, tile.sub, tileW - 52),
      tx + 26,
      tilesY + 144
    );
  });

  // 7. Footer Signature
  const footerLineY = cardY + cardH - 116;
  ctx.beginPath();
  ctx.moveTo(padX, footerLineY);
  ctx.lineTo(cardX + cardW - 56, footerLineY);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.stroke();

  const footerTextY = footerLineY + 58;

  // Brand dot + spaced signature
  ctx.beginPath();
  ctx.arc(padX + 10, footerTextY, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#F5C451';
  ctx.fill();

  ctx.font = `700 24px ${SANS_STACK}`;
  ctx.fillStyle = '#D3DAE6';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  drawSpacedText(ctx, 'DEEP HOURS', padX + 32, footerTextY + 1, 5);

  ctx.font = `500 22px ${MONO_STACK}`;
  ctx.fillStyle = '#758092';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(payload.dayKey, cardX + cardW - 56, footerTextY + 1);
}

export async function renderProofCardBlob(
  payload: ProofCardPayload,
  options?: { hideDetails?: boolean }
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderProofCardToCanvas(canvas, payload, options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not generate proof card PNG'));
        }
      },
      'image/png',
      1
    );
  });
}
