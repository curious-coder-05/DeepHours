/**
 * Pure v36 chart axis scaling, chapter numbering deduplication,
 * and unrated chapter confidence display helpers.
 */

export type AxisUnitMode = 'minutes' | 'hours' | 'number';

export interface CleanAxisScale {
  max: number;
  ticks: number[];
}

const MINUTE_STEPS = [15, 30, 60, 120, 180, 240, 300, 360, 480, 600, 720];
const HOUR_STEPS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12];

function buildTicks(step: number, count: number): number[] {
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    // Round to avoid floating-point noise like 1.5000000000000002
    const val = Math.round(step * i * 1000) / 1000;
    ticks.push(val);
  }
  return ticks;
}

/**
 * Computes a clean, evenly-spaced Y-axis scale and tick set so charts
 * never display awkward fractional values like "3h 18m" or "6h 36m".
 *
 * Examples:
 * - minutes: 360 (6h) -> [0, 120, 240, 360] (0m, 2h, 4h, 6h)
 * - minutes: 420 (7h) -> [0, 180, 360, 540] (0m, 3h, 6h, 9h)
 * - hours:   6        -> [0, 2, 4, 6]       (0h, 2h, 4h, 6h)
 * - hours:   7.5      -> [0, 3, 6, 9]       (0h, 3h, 6h, 9h)
 * - number:  680      -> [0, 250, 500, 750]
 */
export function computeCleanAxisScale(
  rawMax: number,
  mode: AxisUnitMode = 'number'
): CleanAxisScale {
  const safeMax = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 0;

  if (mode === 'minutes') {
    if (safeMax <= 0) {
      return { max: 60, ticks: [0, 30, 60] };
    }
    if (safeMax <= 45) {
      const steps = Math.max(2, Math.ceil(safeMax / 15));
      return { max: steps * 15, ticks: buildTicks(15, steps) };
    }
    if (safeMax <= 60) {
      return { max: 60, ticks: [0, 30, 60] };
    }
    for (const step of MINUTE_STEPS) {
      // Prefer 3 intervals (4 ticks: 0, 1x, 2x, 3x) when it cleanly fits rawMax
      if (step * 3 >= safeMax) {
        // Avoid overshooting by too much if 2 intervals suffice cleanly
        if (step >= 60 && step * 2 >= safeMax && safeMax > step * 1.5) {
          // Check if a smaller step with 3 intervals fits tightly (already checked in loop order)
          return { max: step * 2, ticks: buildTicks(step, 2) };
        }
        return { max: step * 3, ticks: buildTicks(step, 3) };
      }
    }
    const bigStep = Math.ceil(safeMax / 3 / 60) * 60;
    return { max: bigStep * 3, ticks: buildTicks(bigStep, 3) };
  }

  if (mode === 'hours') {
    if (safeMax <= 0) {
      return { max: 6, ticks: [0, 2, 4, 6] };
    }
    for (const step of HOUR_STEPS) {
      if (step * 3 >= safeMax) {
        if (step >= 1 && step * 2 >= safeMax && safeMax > step * 1.5) {
          return { max: step * 2, ticks: buildTicks(step, 2) };
        }
        return { max: step * 3, ticks: buildTicks(step, 3) };
      }
    }
    const bigStep = Math.ceil(safeMax / 3);
    return { max: bigStep * 3, ticks: buildTicks(bigStep, 3) };
  }

  // Generic numeric scale (e.g. mock test scores out of 720, counts)
  if (safeMax <= 0) {
    return { max: 10, ticks: [0, 5, 10] };
  }
  const targetIntervals = 3;
  const roughStep = safeMax / targetIntervals;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;

  const step = niceNormalized * magnitude;
  const count = Math.max(2, Math.ceil(safeMax / step));
  return {
    max: Math.round(step * count * 1000) / 1000,
    ticks: buildTicks(step, count),
  };
}

/**
 * Strips leading list-numbering prefixes such as "1. ", "02) ", or "1. 1. "
 * from syllabus chapter titles while preserving chemical/numeric names
 * like "2-Methylpropane" or "3D Geometry".
 */
export function stripLeadingListNumber(title: string): string {
  const trimmed = (title || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/^(?:\d+\s*[.)]\s+)+/, '').trim();
  return stripped || trimmed;
}

/**
 * Formats a ranked chapter title cleanly without double numbering
 * (e.g. rank 1 + "1. Units and Measurements" -> "1. Units and Measurements").
 */
export function formatRankedChapterLabel(rank: number, chapterName: string): string {
  const cleanName = stripLeadingListNumber(chapterName);
  const safeRank = Math.max(1, Math.floor(rank));
  return `${safeRank}. ${cleanName}`;
}

/**
 * Formats a chapter's confidence rating only when explicitly rated (1..5).
 * Returns null for unrated chapters (undefined, null, 0, or out-of-range)
 * so the UI never fabricates a phantom "3/5" rating.
 */
export function formatChapterConfidence(
  confidence?: number | null
): string | null {
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 1 ||
    confidence > 5
  ) {
    return null;
  }
  return `${Math.round(confidence)}/5`;
}
