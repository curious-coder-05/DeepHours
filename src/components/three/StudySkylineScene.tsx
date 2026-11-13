import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { StudySession, Subject } from '../../types';
import { buildStudyCityDays, type StudyCityDayData } from '../../utils/scene3dHelpers';
import { fmtHMShort } from '../../utils/studyLogic';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import {
  Scene3D,
  type Scene3DContext,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface SkylineDayCell {
  key: string;
  future: boolean;
  hrs: number;
  lvlClass: string;
}

export interface StudySkylineSceneProps {
  cells: SkylineDayCell[];
  sessions: StudySession[];
  subjects: Subject[];
  todayKey: string;
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  onInspectDay?: (dayKey: string) => void;
}

const MAX_TOWER_SEGMENTS = 84 * 5;
const MAX_PAD_INSTANCES = 84;

function createSkyGradientTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#090D16');
    grad.addColorStop(0.55, '#12192A');
    grad.addColorStop(1, '#1D2536');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLitWindowsTexture(
  THREE: typeof import('three'),
  maxAnisotropy: number
): { map: import('three').CanvasTexture; emissiveMap: import('three').CanvasTexture } {
  const size = 128;
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = size;
  baseCanvas.height = size;
  const bCtx = baseCanvas.getContext('2d');

  const emCanvas = document.createElement('canvas');
  emCanvas.width = size;
  emCanvas.height = size;
  const eCtx = emCanvas.getContext('2d');

  if (bCtx && eCtx) {
    bCtx.fillStyle = '#E5E9F0';
    bCtx.fillRect(0, 0, size, size);
    eCtx.fillStyle = '#06080D';
    eCtx.fillRect(0, 0, size, size);

    const cols = 4;
    const rows = 8;
    const padX = 7;
    const padY = 4;
    const cellW = size / cols;
    const cellH = size / rows;

    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const hash = (r * 31 + col * 17) % 11;
        const lit = hash > 2;
        const x = col * cellW + padX;
        const y = r * cellH + padY;
        const w = cellW - padX * 2;
        const h = cellH - padY * 2;
        if (lit) {
          bCtx.fillStyle = '#FFFFFF';
          bCtx.fillRect(x, y, w, h);
          eCtx.fillStyle = hash > 7 ? '#F8E3A3' : '#C8D6EA';
          eCtx.fillRect(x, y, w, h);
        } else {
          bCtx.fillStyle = '#7B8494';
          bCtx.fillRect(x, y, w, h);
        }
      }
    }
  }

  const map = new THREE.CanvasTexture(baseCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = Math.min(4, maxAnisotropy || 1);

  const emissiveMap = new THREE.CanvasTexture(emCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.anisotropy = Math.min(4, maxAnisotropy || 1);

  return { map, emissiveMap };
}

function createWeekLabelsTexture(
  THREE: typeof import('three'),
  rangeMode: '12w' | '30d',
  maxAnisotropy: number
): import('three').CanvasTexture {
  const w = 1024;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(236, 239, 244, 0.72)';
    ctx.font = '600 26px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (rangeMode === '12w') {
      for (let i = 0; i < 12; i++) {
        const cx = ((i + 0.5) / 12) * w;
        ctx.fillText(`W${i + 1}`, cx, h / 2);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const cx = ((i + 0.5) / 6) * w;
        ctx.fillText(`C${i + 1}`, cx, h / 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAnisotropy || 1);
  return tex;
}

function getDayCoordinates(
  day: StudyCityDayData,
  rangeMode: '12w' | '30d'
): { x: number; z: number } {
  if (rangeMode === '30d') {
    const x = (day.col - 2.5) * 0.96;
    const weekendOffset = day.isWeekend ? (day.row < 2 ? -0.18 : 0.18) : 0;
    const z = (day.row - 2.0) * 0.92 + weekendOffset;
    return { x, z };
  }
  const x = (day.col - 5.5) * 0.68;
  // Subtle weekend boulevard separation that works cleanly for Mon-start or Sun-start weeks
  const weekendGap = day.isWeekend ? (day.row < 3 ? -0.22 : 0.24) : 0;
  const z = (day.row - 3.0) * 0.68 + weekendGap;
  return { x, z };
}

export const StudySkylineScene: React.FC<StudySkylineSceneProps> = ({
  cells,
  sessions,
  subjects,
  todayKey,
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  onInspectDay,
}) => {
  const [rangeMode, setRangeMode] = useState<'12w' | '30d'>('12w');
  const [ambientPaused, setAmbientPaused] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);

  const cityDays = useMemo(
    () => buildStudyCityDays(cells, sessions, subjects, rangeMode, todayKey),
    [cells, sessions, subjects, rangeMode, todayKey]
  );

  const cityDaysRef = useRef(cityDays);
  cityDaysRef.current = cityDays;

  const rangeModeRef = useRef(rangeMode);
  rangeModeRef.current = rangeMode;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(() => {
    for (let i = cityDays.length - 1; i >= 0; i--) {
      if (!cityDays[i].future && cityDays[i].hrs > 0) return i;
    }
    for (let i = cityDays.length - 1; i >= 0; i--) {
      if (!cityDays[i].future) return i;
    }
    return null;
  });

  // Clamp selectedIdx when switching 12w <-> 30d
  useEffect(() => {
    if (selectedIdx === null || selectedIdx >= cityDays.length) {
      let fallback: number | null = null;
      for (let i = cityDays.length - 1; i >= 0; i--) {
        if (!cityDays[i].future && cityDays[i].hrs > 0) {
          fallback = i;
          break;
        }
      }
      if (fallback === null && cityDays.length > 0) {
        fallback = cityDays.length - 1;
      }
      setSelectedIdx(fallback);
    }
  }, [cityDays, selectedIdx]);

  const sceneCtxRef = useRef<Scene3DContext | null>(null);
  const resetOrbitRef = useRef<(() => void) | null>(null);
  const rebuildCityRef = useRef<
    ((idx: number | null, progressRatio: number | null) => void) | null
  >(null);
  const labelUpdateRef = useRef<((mode: '12w' | '30d') => void) | null>(null);

  const selectedDay =
    selectedIdx !== null && cityDays[selectedIdx] ? cityDays[selectedIdx] : null;

  useEffect(() => {
    labelUpdateRef.current?.(rangeMode);
  }, [rangeMode]);

  useEffect(() => {
    rebuildCityRef.current?.(selectedIdx, replaying ? 0 : null);
    sceneCtxRef.current?.requestRender();
  }, [cityDays, selectedIdx, rangeMode, replaying]);

  // Timelapse Replay Ticker (~4.5s across displayed days)
  const replayProgressRef = useRef<number | null>(null);
  useEffect(() => {
    if (!replaying) {
      replayProgressRef.current = null;
      setReplayIndex(null);
      rebuildCityRef.current?.(selectedIdx, null);
      sceneCtxRef.current?.requestRender();
      return;
    }

    const totalDays = Math.max(1, cityDays.length);
    const durationMs = 4500;
    const startTs = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      replayProgressRef.current = t;
      const curDayIdx = Math.min(totalDays - 1, Math.floor(t * totalDays));
      setReplayIndex(curDayIdx);
      rebuildCityRef.current?.(selectedIdx, t);
      sceneCtxRef.current?.requestRender();
      if (t < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        replayProgressRef.current = null;
        setReplaying(false);
        setReplayIndex(null);
        rebuildCityRef.current?.(selectedIdx, null);
        sceneCtxRef.current?.requestRender();
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [replaying, cityDays.length, selectedIdx]);

  const summaryStats = useMemo(() => {
    let active = 0;
    let totalHrs = 0;
    let best: StudyCityDayData | null = null;
    for (const d of cityDays) {
      if (!d.future && d.hrs > 0) {
        active += 1;
        totalHrs += d.hrs;
        if (d.isBestDay) best = d;
      }
    }
    return { active, totalHrs, best };
  }, [cityDays]);

  const replayTickerDay =
    replaying && replayIndex !== null && cityDays[replayIndex]
      ? cityDays[replayIndex]
      : null;

  return (
    <div className="space-y-2.5">
      {/* Toolbar: 12w | 30d + Replay timelapse + Pause + Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-44">
          <Segmented<'12w' | '30d'>
            value={rangeMode}
            onChange={(val) => {
              setReplaying(false);
              setRangeMode(val);
            }}
            ariaLabel="Study city date range"
            options={[
              { value: '12w', label: '12 weeks' },
              { value: '30d', label: '30 days' },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={replaying ? 'primary' : 'secondary'}
            size="sm"
            icon={<Sparkles size={13} />}
            onClick={() => setReplaying((v) => !v)}
          >
            {replaying ? 'Stop replay' : 'Replay'}
          </Button>
          <button
            type="button"
            onClick={() => setAmbientPaused((v) => !v)}
            aria-label={ambientPaused ? 'Resume 3D city orbit' : 'Pause 3D city orbit'}
            aria-pressed={ambientPaused}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[13px] font-medium text-[var(--tx-2)] hover:text-[var(--tx)]"
          >
            {ambientPaused ? <Play size={13} /> : <Pause size={13} />}
            <span>{ambientPaused ? 'Resume' : 'Pause'}</span>
          </button>
          <button
            type="button"
            onClick={() => resetOrbitRef.current?.()}
            aria-label="Reset 3D city camera angle"
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[13px] font-medium text-[var(--tx-2)] hover:text-[var(--tx)]"
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <span className="sr-only">
        3D study city spanning {rangeMode === '12w' ? '12 weeks' : '30 days'}:{' '}
        {summaryStats.active} active days totaling {summaryStats.totalHrs.toFixed(1)} hours.
        {summaryStats.best
          ? ` Peak day ${summaryStats.best.key} with ${summaryStats.best.hrs.toFixed(1)} hours.`
          : ''}
      </span>

      <div className="relative rounded-xl border border-[var(--line)] bg-[#090D16] overflow-hidden">
        <Scene3D
          testId="study-skyline-scene"
          ui3dSetting={ui3dSetting}
          ui3dQuality={ui3dQuality}
          active={!ambientPaused || replaying}
          continuous={!ambientPaused || replaying}
          height={320}
          fov={38}
          cameraPosition={[0, 7.8, 12.2]}
          setup={(ctx: Scene3DContext) => {
            const { THREE, scene, camera, renderer, canvas, resolution } = ctx;
            sceneCtxRef.current = ctx;

            const maxAniso =
              typeof renderer.capabilities?.getMaxAnisotropy === 'function'
                ? renderer.capabilities.getMaxAnisotropy()
                : 1;

            // 1. Procedural atmospheric sky backdrop + fog
            const skyTex = createSkyGradientTexture(THREE);
            scene.background = skyTex;
            scene.fog = new THREE.FogExp2(0x12192a, 0.022);

            // Warm key + cool sky fill + emerald/gold rim
            const hemi = new THREE.HemisphereLight(0xdbeafe, 0x111827, 1.4);
            scene.add(hemi);

            const dirLight = new THREE.DirectionalLight(0xfff4d6, 1.75);
            dirLight.position.set(7, 11, 8);
            scene.add(dirLight);

            const rimLight = new THREE.DirectionalLight(0x4ade80, 0.55);
            rimLight.position.set(-7, 4, -6);
            scene.add(rimLight);

            const worldGroup = new THREE.Group();
            scene.add(worldGroup);

            // 2. Grounded plinth + faint reflective city apron
            const apronGeo = new THREE.PlaneGeometry(28, 28);
            const apronMat = new THREE.MeshStandardMaterial({
              color: 0x0e131d,
              roughness: 0.24,
              metalness: 0.7,
              transparent: true,
              opacity: 0.85,
            });
            const apronMesh = new THREE.Mesh(apronGeo, apronMat);
            apronMesh.rotation.x = -Math.PI / 2;
            apronMesh.position.y = -0.28;
            worldGroup.add(apronMesh);

            const deckGeo = new THREE.BoxGeometry(9.4, 0.22, 6.0);
            const deckMat = new THREE.MeshStandardMaterial({
              color: 0x161c26,
              roughness: 0.55,
              metalness: 0.22,
            });
            const deckMesh = new THREE.Mesh(deckGeo, deckMat);
            deckMesh.position.y = -0.11;
            worldGroup.add(deckMesh);

            const rimGeo = new THREE.BoxGeometry(9.65, 0.08, 6.25);
            const rimMat = new THREE.MeshStandardMaterial({
              color: 0x2a3344,
              roughness: 0.35,
              metalness: 0.42,
            });
            const rimMesh = new THREE.Mesh(rimGeo, rimMat);
            rimMesh.position.y = -0.22;
            worldGroup.add(rimMesh);

            // Week / column labels strip on front plinth edge
            let weekLabelsTex = createWeekLabelsTexture(THREE, rangeModeRef.current, maxAniso);
            const labelPlaneGeo = new THREE.PlaneGeometry(8.2, 0.42);
            const labelPlaneMat = new THREE.MeshBasicMaterial({
              map: weekLabelsTex,
              transparent: true,
              depthWrite: false,
            });
            const labelPlane = new THREE.Mesh(labelPlaneGeo, labelPlaneMat);
            labelPlane.rotation.x = -Math.PI / 2.6;
            labelPlane.position.set(0, 0.04, 3.06);
            worldGroup.add(labelPlane);

            labelUpdateRef.current = (nextMode: '12w' | '30d') => {
              const nextTex = createWeekLabelsTexture(THREE, nextMode, maxAniso);
              labelPlaneMat.map = nextTex;
              labelPlaneMat.needsUpdate = true;
              weekLabelsTex.dispose();
              weekLabelsTex = nextTex;
            };

            // 3. Base footprint pads (InstancedMesh) so empty/future days remain clickable without lit windows
            const padGeo = new THREE.BoxGeometry(0.46, 0.06, 0.46);
            padGeo.translate(0, 0.03, 0);
            const padMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.6,
              metalness: 0.15,
            });
            const padInstanced = new THREE.InstancedMesh(padGeo, padMat, MAX_PAD_INSTANCES);
            padInstanced.frustumCulled = false;
            worldGroup.add(padInstanced);

            // 4. Stacked subject-colored tower segments with procedural lit windows
            const windowTextures = createLitWindowsTexture(THREE, maxAniso);
            const segGeo = new THREE.BoxGeometry(0.44, 1.0, 0.44);
            segGeo.translate(0, 0.5, 0);
            const segMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              map: windowTextures.map,
              emissive: new THREE.Color('#F5C451'),
              emissiveMap: windowTextures.emissiveMap,
              emissiveIntensity: 0.42,
              roughness: 0.28,
              metalness: 0.2,
            });
            const towerInstanced = new THREE.InstancedMesh(segGeo, segMat, MAX_TOWER_SEGMENTS);
            towerInstanced.frustumCulled = false;
            worldGroup.add(towerInstanced);

            // 5. Best-day vertical beacon + Today's crown halo
            const beaconGeo = new THREE.CylinderGeometry(0.035, 0.16, 4.4, 12);
            beaconGeo.translate(0, 2.2, 0);
            const beaconMat = new THREE.MeshBasicMaterial({
              color: 0xf5c451,
              transparent: true,
              opacity: 0.24,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
            beaconMesh.visible = false;
            worldGroup.add(beaconMesh);

            const todayCrownGeo = new THREE.TorusGeometry(0.32, 0.024, 8, 28);
            const todayCrownMat = new THREE.MeshBasicMaterial({
              color: 0x4ade80,
              transparent: true,
              opacity: 0.72,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const todayCrownMesh = new THREE.Mesh(todayCrownGeo, todayCrownMat);
            todayCrownMesh.rotation.x = Math.PI / 2;
            todayCrownMesh.visible = false;
            worldGroup.add(todayCrownMesh);

            let todayCrownBaseY = 0.4;
            const segmentToDayIdx = new Int32Array(MAX_TOWER_SEGMENTS);

            const dummyMat = new THREE.Matrix4();
            const dummyPos = new THREE.Vector3();
            const dummyQuat = new THREE.Quaternion();
            const dummyScale = new THREE.Vector3();
            const tempColor = new THREE.Color();
            const highlightGold = new THREE.Color('#F5C451');
            const futureColor = new THREE.Color('#1B212C');
            const idlePadColor = new THREE.Color('#273040');

            const rebuildCity = (
              activeIdx: number | null,
              progressRatio: number | null
            ) => {
              const days = cityDaysRef.current;
              const mode = rangeModeRef.current;
              const dayCount = Math.min(MAX_PAD_INSTANCES, days.length);
              padInstanced.count = dayCount;

              let segCursor = 0;
              let bestFound = false;
              let todayFound = false;

              for (let i = 0; i < dayCount; i++) {
                const d = days[i];
                const { x, z } = getDayCoordinates(d, mode);
                const padScale = mode === '30d' ? 1.32 : 1.0;

                // Timelapse growth multiplier
                let growth = 1.0;
                if (progressRatio !== null) {
                  const revealAt = i / Math.max(1, dayCount);
                  growth = Math.max(0, Math.min(1, (progressRatio - revealAt + 0.08) / 0.1));
                }

                dummyPos.set(x, 0, z);
                dummyScale.set(padScale, 1, padScale);
                dummyMat.compose(dummyPos, dummyQuat, dummyScale);
                padInstanced.setMatrixAt(i, dummyMat);

                if (d.future) {
                  tempColor.copy(futureColor);
                } else if (d.hrs > 0) {
                  tempColor.set(d.topSubject?.color || '#4ADE80').lerp(idlePadColor, 0.45);
                } else {
                  tempColor.copy(idlePadColor);
                }
                if (activeIdx === i) {
                  tempColor.lerp(highlightGold, 0.65);
                }
                padInstanced.setColorAt(i, tempColor);

                if (d.future || d.hrs <= 0 || growth <= 0.01) {
                  if (d.isToday && !d.future) {
                    todayFound = true;
                    todayCrownBaseY = 0.24;
                    todayCrownMesh.position.set(x, todayCrownBaseY, z);
                  }
                  continue;
                }

                const totalH = Math.min(3.5, 0.24 + d.hrs * 0.34) * growth;
                const segList = d.segments.slice(0, 4);
                const totalSegHrs = segList.reduce((acc, s) => acc + s.hrs, 0) || d.hrs;

                let yCursor = 0.06;
                for (let sIdx = 0; sIdx < segList.length; sIdx++) {
                  if (segCursor >= MAX_TOWER_SEGMENTS) break;
                  const seg = segList[sIdx];
                  const segH = Math.max(0.08, (seg.hrs / totalSegHrs) * totalH);
                  dummyPos.set(x, yCursor, z);
                  dummyScale.set(padScale, segH, padScale);
                  dummyMat.compose(dummyPos, dummyQuat, dummyScale);
                  towerInstanced.setMatrixAt(segCursor, dummyMat);

                  tempColor.set(seg.color || '#F5C451');
                  if (activeIdx === i) {
                    tempColor.lerp(highlightGold, 0.48);
                  }
                  towerInstanced.setColorAt(segCursor, tempColor);
                  segmentToDayIdx[segCursor] = i;
                  segCursor += 1;
                  yCursor += segH;
                }

                if (d.isBestDay) {
                  bestFound = true;
                  beaconMesh.position.set(x, yCursor * 0.4, z);
                }
                if (d.isToday) {
                  todayFound = true;
                  todayCrownBaseY = yCursor + 0.14;
                  todayCrownMesh.position.set(x, todayCrownBaseY, z);
                }
              }

              padInstanced.instanceMatrix.needsUpdate = true;
              if (padInstanced.instanceColor) padInstanced.instanceColor.needsUpdate = true;

              towerInstanced.count = segCursor;
              towerInstanced.instanceMatrix.needsUpdate = true;
              if (towerInstanced.instanceColor) towerInstanced.instanceColor.needsUpdate = true;

              beaconMesh.visible = bestFound && progressRatio === null;
              todayCrownMesh.visible = todayFound;
            };

            rebuildCityRef.current = rebuildCity;
            rebuildCity(selectedIdx, replayProgressRef.current);

            // Intro camera fly-in + drag orbit + 2-finger pinch zoom (pan-y safe!)
            let radius = 14.8;
            let targetRadius = 11.4;
            let azimuth = -0.82;
            let targetAzimuth = -0.34;
            let polar = 0.62;
            let targetPolar = 0.88;
            let introActive = !resolution.isSoftwareGl && resolution.resolvedQuality !== 'lite';

            if (!introActive) {
              radius = targetRadius;
              azimuth = targetAzimuth;
              polar = targetPolar;
            }

            const activePointers = new Map<number, { x: number; y: number }>();
            let prevPinchDist: number | null = null;
            let isDragging = false;
            let dragMoved = false;
            let pointerDownX = 0;
            let pointerDownY = 0;
            let activeHoverIdx: number | null = selectedIdx;

            const raycaster = new THREE.Raycaster();
            const pointerNdc = new THREE.Vector2();

            const pickDayAtEvent = (clientX: number, clientY: number): number | null => {
              const rect = canvas.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return null;
              pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
              pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointerNdc, camera);
              const towerHits = raycaster.intersectObject(towerInstanced, false);
              if (towerHits.length > 0 && typeof towerHits[0].instanceId === 'number') {
                return segmentToDayIdx[towerHits[0].instanceId];
              }
              const padHits = raycaster.intersectObject(padInstanced, false);
              if (padHits.length > 0 && typeof padHits[0].instanceId === 'number') {
                return padHits[0].instanceId;
              }
              return null;
            };

            const onPointerDown = (e: PointerEvent) => {
              introActive = false;
              activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (activePointers.size === 2) {
                const pts = Array.from(activePointers.values());
                prevPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                isDragging = false;
                return;
              }
              isDragging = true;
              dragMoved = false;
              pointerDownX = e.clientX;
              pointerDownY = e.clientY;
            };

            let lastRaycastTs = 0;
            const onPointerMove = (e: PointerEvent) => {
              if (activePointers.has(e.pointerId)) {
                activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
              }
              if (activePointers.size === 2) {
                e.preventDefault();
                const pts = Array.from(activePointers.values());
                const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (prevPinchDist !== null) {
                  const delta = prevPinchDist - dist;
                  targetRadius = Math.max(6.8, Math.min(18.0, targetRadius + delta * 0.025));
                  ctx.requestRender();
                }
                prevPinchDist = dist;
                return;
              }

              if (isDragging) {
                const dx = e.clientX - pointerDownX;
                const dy = e.clientY - pointerDownY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                  dragMoved = true;
                }
                pointerDownX = e.clientX;
                pointerDownY = e.clientY;
                targetAzimuth -= dx * 0.0075;
                targetPolar = Math.max(0.38, Math.min(1.28, targetPolar - dy * 0.0065));
                ctx.requestRender();
                return;
              }

              const now = performance.now();
              if (now - lastRaycastTs < 50) return;
              lastRaycastTs = now;
              const idx = pickDayAtEvent(e.clientX, e.clientY);
              if (idx !== null && idx !== activeHoverIdx) {
                activeHoverIdx = idx;
                setSelectedIdx(idx);
                rebuildCity(idx, replayProgressRef.current);
                ctx.requestRender();
              }
            };

            const onPointerUp = (e: PointerEvent) => {
              activePointers.delete(e.pointerId);
              if (activePointers.size < 2) {
                prevPinchDist = null;
              }
              if (isDragging && !dragMoved) {
                const idx = pickDayAtEvent(e.clientX, e.clientY);
                if (idx !== null) {
                  activeHoverIdx = idx;
                  setSelectedIdx(idx);
                  rebuildCity(idx, replayProgressRef.current);
                  ctx.requestRender();
                }
              }
              isDragging = false;
            };

            canvas.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp, { passive: true });
            window.addEventListener('pointercancel', onPointerUp, { passive: true });

            resetOrbitRef.current = () => {
              introActive = false;
              targetAzimuth = -0.34;
              targetPolar = 0.88;
              targetRadius = 11.4;
              ctx.requestRender();
            };

            return {
              onTick: (dt, elapsed) => {
                if (!isDragging && !introActive && !resolution.isSoftwareGl && !ambientPaused) {
                  targetAzimuth += dt * 0.07;
                }
                const dampRate = introActive ? 3.2 : 6.2;
                const damp = 1 - Math.exp(-dampRate * dt);
                azimuth += (targetAzimuth - azimuth) * damp;
                polar += (targetPolar - polar) * damp;
                radius += (targetRadius - radius) * damp;

                if (
                  introActive &&
                  Math.abs(targetAzimuth - azimuth) < 0.02 &&
                  Math.abs(targetRadius - radius) < 0.08
                ) {
                  introActive = false;
                }

                camera.position.x = radius * Math.sin(polar) * Math.sin(azimuth);
                camera.position.y = radius * Math.cos(polar);
                camera.position.z = radius * Math.sin(polar) * Math.cos(azimuth);
                camera.lookAt(0, 0.48, 0);

                if (todayCrownMesh.visible) {
                  todayCrownMesh.position.y = todayCrownBaseY + Math.sin(elapsed * 2.4) * 0.05;
                  todayCrownMat.opacity = 0.55 + Math.sin(elapsed * 2.4) * 0.2;
                }
                if (beaconMesh.visible) {
                  beaconMat.opacity = 0.18 + Math.sin(elapsed * 1.9) * 0.08;
                }

                if (
                  Math.abs(targetAzimuth - azimuth) > 0.002 ||
                  Math.abs(targetPolar - polar) > 0.002 ||
                  Math.abs(targetRadius - radius) > 0.01
                ) {
                  ctx.requestRender();
                }
              },
              onDispose: () => {
                sceneCtxRef.current = null;
                labelUpdateRef.current = null;
                canvas.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                skyTex.dispose();
                weekLabelsTex.dispose();
                windowTextures.map.dispose();
                windowTextures.emissiveMap.dispose();
              },
            };
          }}
        />

        {/* Replay Date Ticker Badge */}
        {replayTickerDay && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-3 left-3 rounded-lg border border-[var(--ac-bd)] bg-[color-mix(in_srgb,var(--sf-1)_88%,transparent)] px-3 py-1.5 text-[13px] font-semibold text-[var(--tx)]"
          >
            <span className="tnum text-[var(--ac-ink)]">{replayTickerDay.key}</span>
            <span className="tnum ml-2 text-[var(--tx-2)]">
              {replayTickerDay.hrs.toFixed(1)}h
            </span>
          </div>
        )}
      </div>

      {/* Accessible DOM Inspection Card */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5 text-[13px]"
      >
        {selectedDay ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: selectedDay.topSubject?.color
                    ? selectedDay.topSubject.color
                    : selectedDay.hrs > 0
                      ? 'var(--ok)'
                      : 'var(--tx-3)',
                }}
              />
              <strong className="tnum text-[var(--tx)]">{selectedDay.key}</strong>
              <span className="tnum text-[var(--tx-2)]">
                ·{' '}
                {selectedDay.future
                  ? 'Upcoming date'
                  : selectedDay.hrs > 0
                    ? `${fmtHMShort(Math.round(selectedDay.hrs * 3600000))} (${selectedDay.sessionsCount} ${
                        selectedDay.sessionsCount === 1 ? 'session' : 'sessions'
                      })`
                    : '0m studied'}
              </span>
              {selectedDay.topSubject && !selectedDay.future && (
                <span className="rounded-md border border-[var(--line)] bg-[var(--sf-1)] px-2 py-0.5 text-[13px] text-[var(--tx)]">
                  Top: {selectedDay.topSubject.emoji} {selectedDay.topSubject.name}
                </span>
              )}
              {selectedDay.isBestDay && (
                <span className="rounded-md border border-[var(--ac-bd)] bg-[var(--ac-soft)] px-2 py-0.5 text-[13px] font-semibold text-[var(--ac-ink)]">
                  Peak day
                </span>
              )}
            </div>
            {!selectedDay.future && onInspectDay && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Calendar size={14} />}
                onClick={() => onInspectDay(selectedDay.key)}
              >
                Open day
              </Button>
            )}
          </>
        ) : (
          <span className="text-[var(--tx-2)]">
            Drag to orbit, pinch to zoom, or tap any tower to inspect daily subjects and hours.
          </span>
        )}
      </div>
    </div>
  );
};
