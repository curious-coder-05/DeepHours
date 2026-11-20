import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Sparkles, Target } from 'lucide-react';
import type { MockTest, Subject } from '../types';
import { triggerHaptic } from '../utils/haptics';
import type { MockLeakMap } from '../utils/mockLeaks';
import {
  NEET_MARKS_PER_WRONG_SWING,
} from '../utils/mockLeaks';
import {
  SCORE_LAB_MAX_CHEM_BIO_LIFT_PCT,
  SCORE_LAB_MAX_MARKS,
  SCORE_LAB_MAX_PHYSICS_BOOST_PCT,
  buildScoreLabBaseline,
  computeScoreLabProjection,
  createZeroScoreLabInputs,
  type ScoreLabInputs,
  type ScoreLabSidecarSeed,
} from '../utils/scoreLab';
import { BottomSheet } from './BottomSheet';

export interface ScoreLabSheetProps {
  open: boolean;
  onClose: () => void;
  mocks: readonly MockTest[];
  subjects: readonly Subject[];
  targetMockScore?: number;
  leakMap: MockLeakMap;
  focusMockId?: string;
  sidecarOverride?: ScoreLabSidecarSeed | null;
}

export const ScoreLabSheet: React.FC<ScoreLabSheetProps> = ({
  open,
  onClose,
  mocks,
  subjects,
  targetMockScore,
  leakMap,
  focusMockId,
  sidecarOverride,
}) => {
  const baseline = useMemo(
    () =>
      buildScoreLabBaseline(
        mocks,
        subjects,
        targetMockScore,
        leakMap,
        focusMockId,
        sidecarOverride
      ),
    [mocks, subjects, targetMockScore, leakMap, focusMockId, sidecarOverride]
  );

  const [inputs, setInputs] = useState<ScoreLabInputs>(() =>
    createZeroScoreLabInputs()
  );

  useEffect(() => {
    if (open) {
      setInputs(createZeroScoreLabInputs());
    }
  }, [open, focusMockId]);

  const projection = useMemo(
    () => computeScoreLabProjection(baseline, inputs),
    [baseline, inputs]
  );

  const isModified =
    inputs.cutNegativeErrors > 0 ||
    inputs.physicsBoostPct > 0 ||
    inputs.chemBioLiftPct > 0;

  // Semi-circular SVG gauge geometry (0..720 arc spanning 180deg from left to right)
  const svgW = 280;
  const svgH = 166;
  const cx = 140;
  const cy = 142;
  const radius = 108;
  const strokeW = 14;
  const semiCircumference = Math.PI * radius;
  const dashOffset = semiCircumference * (1 - projection.progressFraction);

  // Target notch angle on upper semicircle (PI -> 0)
  const targetAngle = Math.PI * (1 - projection.targetFraction);
  const notchInnerR = radius - 11;
  const notchOuterR = radius + 11;
  const nx1 = cx + Math.cos(targetAngle) * notchInnerR;
  const ny1 = cy - Math.sin(targetAngle) * notchInnerR;
  const nx2 = cx + Math.cos(targetAngle) * notchOuterR;
  const ny2 = cy - Math.sin(targetAngle) * notchOuterR;
  const labelR = radius + 23;
  const nlx = cx + Math.cos(targetAngle) * labelR;
  const nly = cy - Math.sin(targetAngle) * labelR;

  const arcColor = projection.targetCleared ? '#34D399' : '#F5C451';

  const cutPct =
    baseline.maxCutErrors > 0
      ? Math.round((inputs.cutNegativeErrors / baseline.maxCutErrors) * 100)
      : 0;
  const phyPct = Math.round(
    (inputs.physicsBoostPct / SCORE_LAB_MAX_PHYSICS_BOOST_PCT) * 100
  );
  const cbPct = Math.round(
    (inputs.chemBioLiftPct / SCORE_LAB_MAX_CHEM_BIO_LIFT_PCT) * 100
  );

  const handleReset = () => {
    triggerHaptic('tap');
    setInputs(createZeroScoreLabInputs());
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Score Lab · 650+ Simulator"
      subtitle={
        baseline.source === 'latest-mock'
          ? `Seeded from ${baseline.mockName} (${baseline.baselineScore}/720) · Target ${projection.targetScore}`
          : `NEET 720 baseline (${baseline.baselineScore}/720) · Target ${projection.targetScore}`
      }
      snap="tall"
    >
      <div className="dh-scorelab" data-testid="score-lab-sheet">
        {/* Razor-sharp SVG Semi-Circular Projected Score Gauge (0-720) */}
        <div
          className={`dh-scorelab-gauge-card ${projection.targetCleared ? 'is-cleared' : ''}`}
          data-testid="score-lab-gauge"
          data-cleared={projection.targetCleared ? '1' : '0'}
        >
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="dh-scorelab-svg"
            role="img"
            aria-label={`Projected NEET score ${projection.projectedScore} out of ${SCORE_LAB_MAX_MARKS}, target ${projection.targetScore}`}
          >
            {/* Background track */}
            <path
              d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
              fill="none"
              stroke="var(--sf-3)"
              strokeWidth={strokeW}
              strokeLinecap="round"
            />
            {/* Active projected arc */}
            <path
              d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
              fill="none"
              stroke={arcColor}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeDasharray={semiCircumference}
              strokeDashoffset={dashOffset}
              style={{
                transition: 'stroke-dashoffset 220ms cubic-bezier(0.16, 1, 0.3, 1), stroke 220ms ease',
              }}
            />
            {/* Golden Target Notch */}
            <line
              x1={nx1.toFixed(1)}
              y1={ny1.toFixed(1)}
              x2={nx2.toFixed(1)}
              y2={ny2.toFixed(1)}
              stroke="#F5C451"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <text
              x={nlx.toFixed(1)}
              y={nly.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#F5C451"
              fontSize="12"
              fontWeight="700"
              className="tnum"
            >
              {projection.targetScore}
            </text>
            {/* Scale bounds */}
            <text
              x={cx - radius}
              y={cy + 18}
              textAnchor="middle"
              fill="var(--tx-3)"
              fontSize="12"
              className="tnum"
            >
              0
            </text>
            <text
              x={cx + radius}
              y={cy + 18}
              textAnchor="middle"
              fill="var(--tx-3)"
              fontSize="12"
              className="tnum"
            >
              720
            </text>
          </svg>

          <div className="dh-scorelab-readout">
            <div className="dh-scorelab-score-row">
              <span
                className="dh-scorelab-score tnum"
                data-testid="score-lab-projected-value"
                style={{ color: projection.targetCleared ? '#34D399' : 'var(--tx)' }}
              >
                {projection.projectedScore}
              </span>
              <span className="dh-scorelab-denom tnum">/ 720</span>
            </div>

            <div className="dh-scorelab-badges">
              <span
                className={`dh-scorelab-delta tnum ${projection.netDelta > 0 ? 'is-positive' : ''}`}
                data-testid="score-lab-delta-pill"
              >
                {projection.netDelta >= 0 ? `+${projection.netDelta}` : projection.netDelta} marks
              </span>

              {projection.targetCleared ? (
                <span
                  className="dh-scorelab-status is-cleared"
                  data-testid="score-lab-status-pill"
                >
                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Target Cleared</span>
                </span>
              ) : (
                <span
                  className="dh-scorelab-status"
                  data-testid="score-lab-status-pill"
                >
                  <Target size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span className="tnum">{projection.marksToTarget} marks to {projection.targetScore}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Interactive Tactile Sliders */}
        <div className="dh-scorelab-sliders">
          {/* Slider 1: Cut Negative Errors */}
          <div className="dh-scorelab-slider-block">
            <div className="dh-scorelab-slider-head">
              <label htmlFor="scoreLabCutErrors" className="dh-scorelab-slider-label">
                Cut negative errors
              </label>
              <span className="dh-scorelab-slider-val tnum">
                {inputs.cutNegativeErrors} Q · +{projection.marksFromCutErrors} marks
              </span>
            </div>
            <input
              id="scoreLabCutErrors"
              data-testid="score-lab-slider-errors"
              type="range"
              min={0}
              max={baseline.maxCutErrors}
              step={1}
              value={inputs.cutNegativeErrors}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  cutNegativeErrors: Number(e.target.value),
                }))
              }
              className="dh-mixer-range"
              style={{ ['--dh-range-pct' as string]: `${cutPct}%` }}
            />
            <div className="dh-scorelab-slider-sub tnum">
              Recovers +{NEET_MARKS_PER_WRONG_SWING} net marks per avoided error
              {baseline.taggedLeakErrors > 0
                ? inputs.cutNegativeErrors <= baseline.taggedLeakErrors
                  ? ` · ${inputs.cutNegativeErrors} of ${baseline.taggedLeakErrors} tagged leak errors`
                  : ` · ${baseline.taggedLeakErrors} tagged leaks + ${inputs.cutNegativeErrors - baseline.taggedLeakErrors} extra wrong Qs`
                : baseline.wrongCount > 0
                  ? ` · ${baseline.wrongCount} wrong in latest mock`
                  : ''}
            </div>
          </div>

          {/* Slider 2: Physics Accuracy Boost */}
          <div className="dh-scorelab-slider-block">
            <div className="dh-scorelab-slider-head">
              <label htmlFor="scoreLabPhysicsBoost" className="dh-scorelab-slider-label">
                Physics accuracy boost
              </label>
              <span className="dh-scorelab-slider-val tnum">
                +{inputs.physicsBoostPct}% · +{projection.marksFromPhysics} marks
              </span>
            </div>
            <input
              id="scoreLabPhysicsBoost"
              data-testid="score-lab-slider-physics"
              type="range"
              min={0}
              max={SCORE_LAB_MAX_PHYSICS_BOOST_PCT}
              step={1}
              value={inputs.physicsBoostPct}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  physicsBoostPct: Number(e.target.value),
                }))
              }
              className="dh-mixer-range"
              style={{ ['--dh-range-pct' as string]: `${phyPct}%` }}
            />
            <div className="dh-scorelab-slider-sub tnum">
              Physics baseline {baseline.physicsScore}/{baseline.physicsMaxMarks} · 0% to +25% accuracy lift
            </div>
          </div>

          {/* Slider 3: Chemistry & Bio Recall Lift */}
          <div className="dh-scorelab-slider-block">
            <div className="dh-scorelab-slider-head">
              <label htmlFor="scoreLabChemBioLift" className="dh-scorelab-slider-label">
                Chemistry &amp; Bio recall lift
              </label>
              <span className="dh-scorelab-slider-val tnum">
                +{inputs.chemBioLiftPct}% · +{projection.marksFromChemBio} marks
              </span>
            </div>
            <input
              id="scoreLabChemBioLift"
              data-testid="score-lab-slider-chembio"
              type="range"
              min={0}
              max={SCORE_LAB_MAX_CHEM_BIO_LIFT_PCT}
              step={1}
              value={inputs.chemBioLiftPct}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  chemBioLiftPct: Number(e.target.value),
                }))
              }
              className="dh-mixer-range"
              style={{ ['--dh-range-pct' as string]: `${cbPct}%` }}
            />
            <div className="dh-scorelab-slider-sub tnum">
              Chem &amp; Bio baseline {baseline.chemBioScore}/{baseline.chemBioMaxMarks} · 0% to +20% NCERT recall lift
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="dh-scorelab-footer">
          <div className="dh-scorelab-baseline-note tnum">
            <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Baseline {baseline.baselineScore}/720</span>
          </div>
          <button
            type="button"
            data-testid="score-lab-reset-btn"
            className="dh-curtain-pill"
            disabled={!isModified}
            onClick={handleReset}
          >
            <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Reset to baseline</span>
          </button>
        </div>
      </div>
    </BottomSheet>
  );
};
