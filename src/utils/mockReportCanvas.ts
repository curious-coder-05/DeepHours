import type { ComputedMockReport, MockReportTier } from './mockReport';

export const MOCK_REPORT_CANVAS_WIDTH = 1080;
export const MOCK_REPORT_CANVAS_HEIGHT = 1350;

export interface MockReportCanvasTile {
  label: string;
  value: string;
  suffix: string;
  accentColor?: string;
}

export interface MockReportCanvasPayload {
  title: string;
  dateLabel: string;
  dayKey: string;
  overallScoreText: string;
  maxMarksText: string;
  bioScoreText: string;
  phyScoreText: string;
  chemScoreText: string;
  percentileText: string;
  tier: MockReportTier;
  disclaimer: string;
  tiles: readonly [
    MockReportCanvasTile,
    MockReportCanvasTile,
    MockReportCanvasTile,
    MockReportCanvasTile,
    MockReportCanvasTile,
    MockReportCanvasTile,
  ];
}

export function buildMockReportCanvasPayload(
  report: ComputedMockReport
): MockReportCanvasPayload {
  return {
    title: report.mockName || 'NEET Mock Test',
    dateLabel: report.formattedDate || report.dayKey,
    dayKey: report.dayKey,
    overallScoreText: String(report.overallScore),
    maxMarksText: `/${report.maxMarks}`,
    bioScoreText: `${report.bioScore}`,
    phyScoreText: `${report.phyScore}`,
    chemScoreText: `${report.chemScore}`,
    percentileText: `${report.percentileFormatted}%`,
    tier: report.tier,
    disclaimer: 'Estimated percentile based on historical NEET UG score curves.',
    tiles: [
      {
        label: 'MOCK RANK',
        value: `#${report.personalRank.rank}`,
        suffix: `/${Math.max(1, report.personalRank.totalMocks)}`,
      },
      {
        label: 'QS ATTEMPTED',
        value: String(report.attempted),
        suffix: `/${report.totalQuestions}`,
      },
      {
        label: 'ACCURACY',
        value: `${report.accuracyPct.toFixed(2)}%`,
        suffix: '',
      },
      {
        label: 'POSITIVE SCORE',
        value: String(report.positiveScore),
        suffix: `/${report.maxMarks}`,
      },
      {
        label: 'MARKS LOST',
        value: String(report.marksLost),
        suffix: `/${report.maxMarks}`,
        accentColor: report.marksLost > 0 ? '#FB7185' : '#F8FAFC',
      },
      {
        label: 'TIME TAKEN',
        value: String(report.timeTakenMin),
        suffix: 'min',
      },
    ],
  };
}

export function buildMockReportFilename(
  mockName: string,
  dayKey: string
): string {
  const safeSlug = (mockName || 'mock')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'neet-mock';
  const safeDay = String(dayKey || 'report').replace(/[^0-9-]/g, '') || 'report';
  return `deep-hours-report-${safeSlug}-${safeDay}.png`;
}

const SANS_STACK =
  '"Geist Variable", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO_STACK =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

interface TierPalette {
  gradStart: string;
  gradMid: string;
  gradEnd: string;
  glowOuter: string;
  glowMid: string;
  border: string;
  numeral: string;
  sparkle: string;
  watermark: string;
}

const TIER_PALETTES: Record<MockReportTier, TierPalette> = {
  emerald: {
    gradStart: '#091311',
    gradMid: '#0E2722',
    gradEnd: '#185144',
    glowOuter: 'rgba(52, 211, 153, 0.44)',
    glowMid: 'rgba(16, 185, 129, 0.16)',
    border: 'rgba(52, 211, 153, 0.30)',
    numeral: '#6EE7B7',
    sparkle: '#A7F3D0',
    watermark: 'rgba(110, 231, 183, 0.16)',
  },
  gold: {
    gradStart: '#130F07',
    gradMid: '#261C0A',
    gradEnd: '#4D3610',
    glowOuter: 'rgba(251, 191, 36, 0.38)',
    glowMid: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(251, 191, 36, 0.30)',
    numeral: '#FDE68A',
    sparkle: '#FCD34D',
    watermark: 'rgba(253, 230, 138, 0.16)',
  },
  crimson: {
    gradStart: '#160A0D',
    gradMid: '#2D1119',
    gradEnd: '#571929',
    glowOuter: 'rgba(251, 113, 133, 0.40)',
    glowMid: 'rgba(225, 29, 72, 0.16)',
    border: 'rgba(251, 113, 133, 0.30)',
    numeral: '#FDA4AF',
    sparkle: '#FECDD3',
    watermark: 'rgba(253, 164, 175, 0.16)',
  },
};

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
  spacing: number
): void {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

function drawSealStamp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.22);

  // Outer translucent lavender-slate badge fill & ring
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(167, 139, 250, 0.14)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(196, 181, 253, 0.34)';
  ctx.stroke();

  // Inner dashed ring
  ctx.beginPath();
  ctx.arc(0, 0, radius - 8, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(196, 181, 253, 0.28)';
  ctx.stroke();
  ctx.setLineDash([]);

  // Center stacked micro-text
  ctx.fillStyle = '#C4B5FD';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 10px ${SANS_STACK}`;
  ctx.fillText('DEEP HOURS', 0, -9);
  ctx.font = `600 9px ${SANS_STACK}`;
  ctx.fillStyle = 'rgba(196, 181, 253, 0.85)';
  ctx.fillText('NEET MOCK', 0, 8);
  ctx.restore();
}

/**
 * Renders the pixel-accurate 1080x1350 AMOLED Bento NEET UG Mock Report Card
 * directly onto an HTML5 2D canvas (zero external dependencies).
 */
export function renderMockReportToCanvas(
  canvas: HTMLCanvasElement,
  report: ComputedMockReport
): void {
  const payload = buildMockReportCanvasPayload(report);
  const W = MOCK_REPORT_CANVAS_WIDTH;
  const H = MOCK_REPORT_CANVAS_HEIGHT;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. True AMOLED #000000 canvas
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  const padX = 56;
  const contentW = W - padX * 2; // 968

  // 2. Top Header
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 38px ${SANS_STACK}`;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(truncateText(ctx, payload.title, contentW - 220), padX, 102);

  ctx.font = `500 22px ${SANS_STACK}`;
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText(payload.dateLabel, padX, 138);

  // Subtle right badge
  ctx.textAlign = 'right';
  ctx.font = `700 18px ${SANS_STACK}`;
  ctx.fillStyle = '#F5C451';
  ctx.fillText('NEET UG SCORECARD', W - padX, 100);
  ctx.font = `500 18px ${MONO_STACK}`;
  ctx.fillStyle = '#71717A';
  ctx.fillText(`TARGET ${report.targetScore}/720`, W - padX, 134);

  // 3. Row 1 — Dual Hero Cards (2 columns side-by-side)
  const heroY = 176;
  const heroGap = 24;
  const heroW = (contentW - heroGap) / 2; // 472
  const heroH = 374;
  const heroR = 28;

  // --- Hero Left: Overall Score Card ---
  const leftX = padX;
  const leftGrad = ctx.createLinearGradient(leftX, heroY, leftX, heroY + heroH);
  leftGrad.addColorStop(0, '#12141A');
  leftGrad.addColorStop(1, '#0B0C10');
  drawRoundedRect(ctx, leftX, heroY, heroW, heroH, heroR);
  ctx.fillStyle = leftGrad;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.stroke();

  // Top-left label
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `600 22px ${SANS_STACK}`;
  ctx.fillStyle = '#E4E4E7';
  ctx.fillText('Overall Score', leftX + 34, heroY + 34);

  // Circular badge seal top-right
  drawSealStamp(ctx, leftX + heroW - 68, heroY + 68, 42);

  // Primary Score Row: 6px rounded vertical accent bar + giant score + /720
  const barX = leftX + 34;
  const barY = heroY + 114;
  const barW = 7;
  const barH = 82;
  const barGrad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
  barGrad.addColorStop(0, '#BAE6FD');
  barGrad.addColorStop(1, '#60A5FA');
  drawRoundedRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = barGrad;
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 92px ${SANS_STACK}`;
  ctx.fillStyle = '#BAE6FD';
  const scoreX = barX + 24;
  const scoreBaselineY = heroY + 190;
  ctx.fillText(payload.overallScoreText, scoreX, scoreBaselineY);
  const scoreW = ctx.measureText(payload.overallScoreText).width;

  ctx.font = `600 32px ${SANS_STACK}`;
  ctx.fillStyle = '#71717A';
  ctx.fillText(payload.maxMarksText, scoreX + scoreW + 8, scoreBaselineY - 4);

  // Subject Score Breakdown Row (3 equal columns)
  const subRowY = heroY + 258;
  const subInnerW = heroW - 68;
  const subColW = subInnerW / 3;
  const subjectsSpec = [
    { label: 'Bio Score', value: payload.bioScoreText, max: '/360', color: '#34D399' },
    { label: 'Phy Score', value: payload.phyScoreText, max: '/180', color: '#60A5FA' },
    { label: 'Chem Score', value: payload.chemScoreText, max: '/180', color: '#FBBF24' },
  ];

  // Subtle hairline separator above subject breakdown
  ctx.beginPath();
  ctx.moveTo(leftX + 34, subRowY - 22);
  ctx.lineTo(leftX + heroW - 34, subRowY - 22);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.stroke();

  subjectsSpec.forEach((sub, idx) => {
    const sx = leftX + 34 + idx * subColW;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `500 18px ${SANS_STACK}`;
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText(sub.label, sx, subRowY);

    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 30px ${SANS_STACK}`;
    ctx.fillStyle = sub.color;
    ctx.fillText(sub.value, sx, subRowY + 64);
    const vw = ctx.measureText(sub.value).width;

    ctx.font = `600 18px ${SANS_STACK}`;
    ctx.fillStyle = '#71717A';
    ctx.fillText(sub.max, sx + vw + 2, subRowY + 63);
  });

  // --- Hero Right: Glowing Potential Percentile Card ---
  const rightX = leftX + heroW + heroGap;
  const pal = TIER_PALETTES[payload.tier];

  ctx.save();
  drawRoundedRect(ctx, rightX, heroY, heroW, heroH, heroR);
  ctx.clip();

  // Base linear gradient (135deg)
  const rBase = ctx.createLinearGradient(
    rightX,
    heroY,
    rightX + heroW,
    heroY + heroH
  );
  rBase.addColorStop(0, pal.gradStart);
  rBase.addColorStop(0.52, pal.gradMid);
  rBase.addColorStop(1, pal.gradEnd);
  ctx.fillStyle = rBase;
  ctx.fillRect(rightX, heroY, heroW, heroH);

  // Radial ambient glow anchored at 86% 18%
  const rGlow = ctx.createRadialGradient(
    rightX + heroW * 0.86,
    heroY + heroH * 0.18,
    10,
    rightX + heroW * 0.86,
    heroY + heroH * 0.18,
    heroW * 0.72
  );
  rGlow.addColorStop(0, pal.glowOuter);
  rGlow.addColorStop(0.42, pal.glowMid);
  rGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = rGlow;
  ctx.fillRect(rightX, heroY, heroW, heroH);

  // Oversized faint % watermark top-right
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = `800 172px ${SANS_STACK}`;
  ctx.fillStyle = pal.watermark;
  ctx.fillText('%', rightX + heroW - 14, heroY - 12);
  ctx.restore();

  // Border on Hero Right
  drawRoundedRect(ctx, rightX, heroY, heroW, heroH, heroR);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.border;
  ctx.stroke();

  // Hero Right Text Stack
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 24px ${SANS_STACK}`;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText('Deep Hours', rightX + 34, heroY + 34);

  ctx.font = `600 21px ${SANS_STACK}`;
  ctx.fillStyle = pal.sparkle;
  ctx.fillText('✦ Potential Percentile', rightX + 34, heroY + 74);

  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 84px ${SANS_STACK}`;
  ctx.fillStyle = pal.numeral;
  ctx.fillText(payload.percentileText, rightX + 34, heroY + 216);

  // Disclaimer wrapped cleanly at bottom
  ctx.textBaseline = 'top';
  ctx.font = `500 18px ${SANS_STACK}`;
  ctx.fillStyle = 'rgba(241, 245, 249, 0.74)';
  ctx.fillText(
    'Estimated percentile based on historical',
    rightX + 34,
    heroY + 278
  );
  ctx.fillText('NEET UG score curves.', rightX + 34, heroY + 306);

  // 4. Row 2 — 6-Tile Bento Stat Grid (2 columns × 3 rows for crisp 4:5 readability)
  const gridY = heroY + heroH + 28; // 578
  const tileGapX = 24;
  const tileGapY = 22;
  const tileW = (contentW - tileGapX) / 2; // 472
  const tileH = 186;
  const tileR = 24;

  payload.tiles.forEach((tile, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const tx = padX + col * (tileW + tileGapX);
    const ty = gridY + row * (tileH + tileGapY);

    const tGrad = ctx.createLinearGradient(tx, ty, tx, ty + tileH);
    tGrad.addColorStop(0, '#111318');
    tGrad.addColorStop(1, '#0B0C0F');
    drawRoundedRect(ctx, tx, ty, tileW, tileH, tileR);
    ctx.fillStyle = tGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    // Top uppercase label
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 19px ${SANS_STACK}`;
    ctx.fillStyle = '#9CA3AF';
    drawSpacedText(ctx, tile.label, tx + 32, ty + 32, 1.4);

    // Bottom metric value + muted suffix
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 54px ${SANS_STACK}`;
    ctx.fillStyle = tile.accentColor || '#F8FAFC';
    ctx.fillText(tile.value, tx + 32, ty + 144);
    const valW = ctx.measureText(tile.value).width;

    if (tile.suffix) {
      ctx.font = `600 26px ${SANS_STACK}`;
      ctx.fillStyle = '#71717A';
      ctx.fillText(tile.suffix, tx + 32 + valW + 6, ty + 142);
    }
  });

  // 5. Footer Signature
  const footerLineY = 1236;
  ctx.beginPath();
  ctx.moveTo(padX, footerLineY);
  ctx.lineTo(W - padX, footerLineY);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.stroke();

  const footerTextY = footerLineY + 52;
  ctx.beginPath();
  ctx.arc(padX + 10, footerTextY, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#F5C451';
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 22px ${SANS_STACK}`;
  ctx.fillStyle = '#D3DAE6';
  drawSpacedText(ctx, 'DEEP HOURS', padX + 30, footerTextY + 1, 4.5);

  ctx.textAlign = 'right';
  ctx.font = `500 20px ${MONO_STACK}`;
  ctx.fillStyle = '#758092';
  ctx.fillText(payload.dayKey, W - padX, footerTextY + 1);
}

export async function renderMockReportBlob(
  report: ComputedMockReport
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderMockReportToCanvas(canvas, report);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not generate mock report PNG'));
        }
      },
      'image/png',
      1
    );
  });
}
