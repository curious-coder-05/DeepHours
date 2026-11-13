import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Pause, Play, Plus, RotateCcw, Sparkles } from 'lucide-react';
import type { Chapter, Subject } from '../../types';
import { buildSyllabusGalaxyLayout } from '../../utils/scene3dHelpers';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import {
  Scene3D,
  type Scene3DContext,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface SyllabusGalaxySceneProps {
  subjects: Subject[];
  chapters: Chapter[];
  dueChapterIds: Set<string>;
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  activeSubjectId?: string;
  onSelectSubjectFilter?: (subjectId: string) => void;
  onSelectChapter: (chapter: Chapter) => void;
  onOpenAddChapter?: () => void;
  onOpenBulkPaste?: () => void;
}

const MAX_STARS_HIGH = 600;
const MAX_LINKS_HIGH = 600;

function createStarGlowTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.25, 'rgba(255, 255, 255, 0.58)');
    g.addColorStop(0.6, 'rgba(255, 255, 255, 0.14)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNebulaPuffTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    g.addColorStop(0.45, 'rgba(255, 255, 255, 0.12)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const SyllabusGalaxyScene: React.FC<SyllabusGalaxySceneProps> = ({
  subjects,
  chapters,
  dueChapterIds,
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  activeSubjectId = 'all',
  onSelectSubjectFilter,
  onSelectChapter,
  onOpenAddChapter,
  onOpenBulkPaste,
}) => {
  const [ambientPaused, setAmbientPaused] = useState(false);

  const activeSubjects = useMemo(
    () => subjects.filter((s) => !s.arch),
    [subjects]
  );

  const layout = useMemo(
    () =>
      buildSyllabusGalaxyLayout(
        activeSubjects,
        chapters,
        dueChapterIds,
        MAX_STARS_HIGH
      ),
    [activeSubjects, chapters, dueChapterIds]
  );

  const starNodes = layout.nodes;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const activeSubjectIdRef = useRef(activeSubjectId);
  activeSubjectIdRef.current = activeSubjectId;

  const ambientPausedRef = useRef(ambientPaused);
  ambientPausedRef.current = ambientPaused;

  const [selectedStarIdx, setSelectedStarIdx] = useState<number | null>(() =>
    starNodes.length > 0 ? 0 : null
  );

  const sceneCtxRef = useRef<Scene3DContext | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const flyToArmRef = useRef<((subId: string) => void) | null>(null);
  const shootingStarTriggerRef = useRef<
    ((targetPos: [number, number, number], colorHex: string) => void) | null
  >(null);

  // Detect newly completed chapter to launch a shooting-star streak
  const prevCompletedIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const completedIds = new Set(
      chapters.filter((ch) => ch.status === 'completed').map((ch) => ch.id)
    );
    if (prevCompletedIdsRef.current !== null) {
      for (const id of completedIds) {
        if (!prevCompletedIdsRef.current.has(id)) {
          const node = starNodes.find((n) => n.chapter.id === id);
          if (node) {
            shootingStarTriggerRef.current?.(node.position, node.subject.color || '#F5C451');
            break;
          }
        }
      }
    }
    prevCompletedIdsRef.current = completedIds;
  }, [chapters, starNodes]);

  // Fly camera to subject arm & select matching node when chip filter changes
  useEffect(() => {
    flyToArmRef.current?.(activeSubjectId);
    sceneCtxRef.current?.requestRender();
    if (activeSubjectId === 'all' || starNodes.length === 0) return;
    const current =
      selectedStarIdx !== null ? starNodes[selectedStarIdx] : undefined;
    if (current && current.subject.id === activeSubjectId) return;
    const firstMatchIdx = starNodes.findIndex(
      (n) => n.subject.id === activeSubjectId
    );
    if (firstMatchIdx >= 0) {
      setSelectedStarIdx(firstMatchIdx);
    }
  }, [activeSubjectId, starNodes, selectedStarIdx]);

  useEffect(() => {
    sceneCtxRef.current?.requestRender();
  }, [layout, selectedStarIdx, ambientPaused]);

  if (ui3dSetting === 'off') {
    return null;
  }

  const selectedNode =
    selectedStarIdx !== null && starNodes[selectedStarIdx]
      ? starNodes[selectedStarIdx]
      : starNodes[0] || null;

  const completedCount = chapters.filter((c) => c.status === 'completed').length;

  return (
    <Card className="space-y-3">
      <div className="split flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-[var(--ac-ink)]" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--tx)]">
              Syllabus galaxy
            </h3>
            <p className="text-[13px] text-[var(--tx-2)]">
              Spiral arms per subject · Constellations light up as chapters complete · Pulsing = revision due
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="tnum mr-1 text-[13px] text-[var(--tx-2)]">
            {starNodes.length} {starNodes.length === 1 ? 'chapter' : 'chapters'}
          </span>
          <button
            type="button"
            onClick={() => setAmbientPaused((v) => !v)}
            aria-label={ambientPaused ? 'Resume galaxy orbit' : 'Pause galaxy orbit'}
            aria-pressed={ambientPaused}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[13px] font-medium text-[var(--tx-2)] hover:text-[var(--tx)]"
          >
            {ambientPaused ? <Play size={13} /> : <Pause size={13} />}
            <span>{ambientPaused ? 'Resume' : 'Pause'}</span>
          </button>
          <button
            type="button"
            onClick={() => resetCameraRef.current?.()}
            aria-label="Reset galaxy view"
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--sf-2)] px-2.5 py-1 text-[13px] font-medium text-[var(--tx-2)] hover:text-[var(--tx)]"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <span className="sr-only">
        Syllabus galaxy: {starNodes.length} chapters mapped across {activeSubjects.length} subjects,{' '}
        {completedCount} completed, {dueChapterIds.size} revisions due.
      </span>

      {onSelectSubjectFilter && activeSubjects.length > 1 && (
        <div
          className="dh-scroll-chips flex items-center gap-1.5 overflow-x-auto pb-0.5"
          role="group"
          aria-label="Focus galaxy arm by subject"
        >
          <Chip
            selected={activeSubjectId === 'all'}
            onClick={() => onSelectSubjectFilter('all')}
          >
            All subjects
          </Chip>
          {activeSubjects.map((s) => (
            <Chip
              key={s.id}
              selected={activeSubjectId === s.id}
              colorDot={s.color}
              onClick={() => onSelectSubjectFilter(s.id)}
            >
              {s.e} {s.name}
            </Chip>
          ))}
        </div>
      )}

      <div className="relative rounded-xl border border-[var(--line)] bg-[#090D16] overflow-hidden">
        <Scene3D
          testId="syllabus-galaxy-scene"
          ui3dSetting={ui3dSetting}
          ui3dQuality={ui3dQuality}
          active={!ambientPaused}
          continuous={!ambientPaused}
          height={280}
          fov={42}
          cameraPosition={[0, 3.1, 6.9]}
          setup={(ctx: Scene3DContext) => {
            const { THREE, scene, camera, canvas, resolution } = ctx;
            sceneCtxRef.current = ctx;

            const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0b0d10, 0.95);
            scene.add(hemi);

            const dirLight = new THREE.DirectionalLight(0xfff4d6, 1.2);
            dirLight.position.set(4, 6, 5);
            scene.add(dirLight);

            const galaxyGroup = new THREE.Group();
            scene.add(galaxyGroup);

            // 1. Ambient Nebula Glow Sprites + Subtle Core Starfield (visible even with 0 chapters)
            const starGlowTex = createStarGlowTexture(THREE);
            const nebulaTex = createNebulaPuffTexture(THREE);

            const nebulaColors = [0x4f46e5, 0xf5c451, 0x38bdf8, 0x34d399];
            nebulaColors.forEach((hex, idx) => {
              const spMat = new THREE.SpriteMaterial({
                map: nebulaTex,
                color: hex,
                transparent: true,
                opacity: 0.28,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              });
              const sp = new THREE.Sprite(spMat);
              const ang = (idx / nebulaColors.length) * Math.PI * 2;
              sp.position.set(Math.cos(ang) * 1.15, (idx % 2 === 0 ? 1 : -1) * 0.18, Math.sin(ang) * 0.95);
              sp.scale.set(4.8, 3.8, 1);
              galaxyGroup.add(sp);
            });

            const dustCount = resolution.resolvedQuality === 'lite' ? 120 : 280;
            const dustPos = new Float32Array(dustCount * 3);
            for (let i = 0; i < dustCount; i++) {
              const arm = (i % 4) * ((Math.PI * 2) / 4);
              const r = 0.4 + ((i * 53) % 100) * 0.036;
              const angle = arm + r * 0.78 + ((i * 19) % 13) * 0.04;
              dustPos[i * 3] = Math.cos(angle) * r;
              dustPos[i * 3 + 1] = (((i * 29) % 100) / 100 - 0.5) * 0.65;
              dustPos[i * 3 + 2] = Math.sin(angle) * r * 0.86;
            }
            const dustGeo = new THREE.BufferGeometry();
            dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
            const dustMat = new THREE.PointsMaterial({
              color: 0xdbeafe,
              size: 0.045,
              transparent: true,
              opacity: 0.5,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const dustPoints = new THREE.Points(dustGeo, dustMat);
            galaxyGroup.add(dustPoints);

            // 2. Constellation Lines (THREE.LineSegments connecting sequential chapters per spiral arm)
            const maxLinkVerts = MAX_LINKS_HIGH * 2;
            const linkPositions = new Float32Array(maxLinkVerts * 3);
            const linkColors = new Float32Array(maxLinkVerts * 3);
            const linkGeo = new THREE.BufferGeometry();
            const linkPosAttr = new THREE.BufferAttribute(linkPositions, 3);
            const linkColAttr = new THREE.BufferAttribute(linkColors, 3);
            linkGeo.setAttribute('position', linkPosAttr);
            linkGeo.setAttribute('color', linkColAttr);
            linkGeo.setDrawRange(0, 0);
            const linkMat = new THREE.LineBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 0.72,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const constellationLines = new THREE.LineSegments(linkGeo, linkMat);
            constellationLines.frustumCulled = false;
            galaxyGroup.add(constellationLines);

            // 3. Chapter Stars + Additive Billboard Glow Halos (InstancedMesh)
            const maxStars = resolution.resolvedQuality === 'lite' ? 220 : MAX_STARS_HIGH;
            const starGeo = new THREE.OctahedronGeometry(0.13, 1);
            const starMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.25,
              metalness: 0.25,
              flatShading: true,
            });
            const instancedStars = new THREE.InstancedMesh(starGeo, starMat, maxStars);
            instancedStars.count = 0;
            instancedStars.frustumCulled = false;
            galaxyGroup.add(instancedStars);

            const haloGeo = new THREE.PlaneGeometry(0.54, 0.54);
            const haloMat = new THREE.MeshBasicMaterial({
              map: starGlowTex,
              color: 0xffffff,
              transparent: true,
              opacity: 0.75,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            const instancedHalos = new THREE.InstancedMesh(haloGeo, haloMat, maxStars);
            instancedHalos.count = 0;
            instancedHalos.frustumCulled = false;
            galaxyGroup.add(instancedHalos);

            // 4. Shooting-star streak mesh for newly completed chapters
            const streakGeo = new THREE.CylinderGeometry(0.004, 0.028, 0.9, 6);
            streakGeo.rotateX(Math.PI / 2);
            const streakMat = new THREE.MeshBasicMaterial({
              color: 0xf5c451,
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const streakMesh = new THREE.Mesh(streakGeo, streakMat);
            streakMesh.visible = false;
            galaxyGroup.add(streakMesh);

            let shootingStar: {
              from: import('three').Vector3;
              to: import('three').Vector3;
              progress: number;
            } | null = null;

            shootingStarTriggerRef.current = (targetPos, colorHex) => {
              const toVec = new THREE.Vector3(targetPos[0], targetPos[1], targetPos[2]);
              const fromVec = new THREE.Vector3(
                targetPos[0] + (targetPos[0] >= 0 ? 2.4 : -2.4),
                targetPos[1] + 2.2,
                targetPos[2] - 2.1
              );
              streakMat.color.set(colorHex);
              shootingStar = { from: fromVec, to: toVec, progress: 0 };
              streakMesh.visible = true;
              ctx.requestRender();
            };

            const dummyMat = new THREE.Matrix4();
            const dummyPos = new THREE.Vector3();
            const dummyQuat = new THREE.Quaternion();
            const dummyScale = new THREE.Vector3();
            const cColor = new THREE.Color();
            const haloColor = new THREE.Color();
            const dimBg = new THREE.Color('#202632');
            const warmDueAmber = new THREE.Color('#FB923C');
            const lumenHighlight = new THREE.Color('#F5C451');

            const syncGalaxy = (elapsed: number, activeIdx: number | null) => {
              const curLayout = layoutRef.current;
              const nodes = curLayout.nodes;
              const links = curLayout.links;
              const subFilter = activeSubjectIdRef.current;
              const count = Math.min(maxStars, nodes.length);

              instancedStars.count = count;
              instancedHalos.count = count;

              // Inverse galaxy Y rotation so billboarded halos still face camera cleanly
              const invRotY = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                -galaxyGroup.rotation.y
              );
              const billboardQuat = invRotY.multiply(camera.quaternion);

              for (let i = 0; i < count; i++) {
                const n = nodes[i];
                const isSubjectMatch =
                  subFilter === 'all' || n.subject.id === subFilter;
                dummyPos.set(n.position[0], n.position[1], n.position[2]);

                let sc = n.baseScale * (isSubjectMatch ? 1 : 0.45);
                let haloSc = n.baseScale * (isSubjectMatch ? 1.15 : 0.35);

                if (n.chapter.status === 'completed') {
                  haloSc *= 1.45;
                } else if (n.chapter.status === 'notStarted') {
                  haloSc *= 0.45;
                }

                if (n.isDue && isSubjectMatch) {
                  const duePulse = 1 + Math.sin(elapsed * 4.2 + i) * 0.26;
                  sc *= duePulse;
                  haloSc *= duePulse * 1.25;
                }
                if (activeIdx === i) {
                  sc *= 1.38;
                  haloSc *= 1.5;
                }

                dummyScale.setScalar(sc);
                dummyMat.compose(dummyPos, dummyQuat.set(0, 0, 0, 1), dummyScale);
                instancedStars.setMatrixAt(i, dummyMat);

                dummyScale.setScalar(haloSc);
                dummyMat.compose(dummyPos, billboardQuat, dummyScale);
                instancedHalos.setMatrixAt(i, dummyMat);

                cColor.set(n.subject.color || '#F5C451');
                haloColor.copy(cColor);

                if (!isSubjectMatch) {
                  cColor.lerp(dimBg, 0.86);
                  haloColor.lerp(dimBg, 0.9);
                } else if (n.chapter.status === 'notStarted') {
                  cColor.lerp(dimBg, 0.68);
                  haloColor.lerp(dimBg, 0.8);
                } else if (n.chapter.status === 'inProgress') {
                  cColor.lerp(dimBg, 0.25);
                  haloColor.lerp(dimBg, 0.32);
                }
                if (n.isDue && isSubjectMatch) {
                  const pulseMix = 0.45 + 0.35 * Math.sin(elapsed * 4.2 + i);
                  cColor.lerp(warmDueAmber, pulseMix);
                  haloColor.lerp(warmDueAmber, pulseMix);
                }
                if (activeIdx === i && isSubjectMatch) {
                  cColor.lerp(lumenHighlight, 0.45);
                  haloColor.lerp(lumenHighlight, 0.45);
                }

                instancedStars.setColorAt(i, cColor);
                instancedHalos.setColorAt(i, haloColor);
              }

              instancedStars.instanceMatrix.needsUpdate = true;
              instancedHalos.instanceMatrix.needsUpdate = true;
              if (instancedStars.instanceColor) instancedStars.instanceColor.needsUpdate = true;
              if (instancedHalos.instanceColor) instancedHalos.instanceColor.needsUpdate = true;

              // Update constellation line segments
              const linkCount = Math.min(MAX_LINKS_HIGH, links.length);
              for (let i = 0; i < linkCount; i++) {
                const lk = links[i];
                const vIdx = i * 6;
                linkPositions[vIdx] = lk.from[0];
                linkPositions[vIdx + 1] = lk.from[1];
                linkPositions[vIdx + 2] = lk.from[2];
                linkPositions[vIdx + 3] = lk.to[0];
                linkPositions[vIdx + 4] = lk.to[1];
                linkPositions[vIdx + 5] = lk.to[2];

                const isSubMatch = subFilter === 'all' || lk.subjectId === subFilter;
                cColor.set(lk.color || '#F5C451');
                if (!isSubMatch) {
                  cColor.lerp(dimBg, 0.9);
                } else if (lk.bothCompleted) {
                  cColor.lerp(lumenHighlight, 0.25);
                } else if (lk.oneCompleted) {
                  cColor.lerp(dimBg, 0.48);
                } else {
                  cColor.lerp(dimBg, 0.8);
                }

                linkColors[vIdx] = cColor.r;
                linkColors[vIdx + 1] = cColor.g;
                linkColors[vIdx + 2] = cColor.b;
                linkColors[vIdx + 3] = cColor.r;
                linkColors[vIdx + 4] = cColor.g;
                linkColors[vIdx + 5] = cColor.b;
              }
              linkGeo.setDrawRange(0, linkCount * 2);
              linkPosAttr.needsUpdate = true;
              linkColAttr.needsUpdate = true;
            };

            // Camera orbit, two-finger pinch zoom, and smooth subject-arm fly-to
            let azimuth = 0;
            let targetAzimuth = 0;
            let radius = 7.4;
            let targetRadius = 7.4;
            let polar = 1.1;
            let targetPolar = 1.1;
            const lookTarget = new THREE.Vector3(0, 0, 0);
            const desiredLookTarget = new THREE.Vector3(0, 0, 0);

            flyToArmRef.current = (subId: string) => {
              if (subId === 'all') {
                desiredLookTarget.set(0, 0, 0);
                targetRadius = 7.4;
              } else {
                const center = layoutRef.current.armCenters.get(subId);
                if (center) {
                  desiredLookTarget.set(center[0] * 0.65, center[1], center[2] * 0.65);
                  targetRadius = 5.6;
                }
              }
            };

            resetCameraRef.current = () => {
              desiredLookTarget.set(0, 0, 0);
              targetRadius = 7.4;
              targetPolar = 1.1;
              targetAzimuth = 0;
              ctx.requestRender();
            };

            syncGalaxy(0, selectedStarIdx);

            const activePointers = new Map<number, { x: number; y: number }>();
            let prevPinchDist: number | null = null;
            let isDragging = false;
            let dragMoved = false;
            let downX = 0;
            let downY = 0;
            let currentSelectedIdx = selectedStarIdx;

            const raycaster = new THREE.Raycaster();
            const pointerNdc = new THREE.Vector2();

            const pickStar = (clientX: number, clientY: number): number | null => {
              if (instancedStars.count === 0) return null;
              const rect = canvas.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return null;
              pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
              pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointerNdc, camera);
              const hits = raycaster.intersectObject(instancedStars, false);
              if (hits.length > 0 && typeof hits[0].instanceId === 'number') {
                return hits[0].instanceId;
              }
              return null;
            };

            const onPointerDown = (e: PointerEvent) => {
              activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (activePointers.size === 2) {
                const pts = Array.from(activePointers.values());
                prevPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                isDragging = false;
                return;
              }
              isDragging = true;
              dragMoved = false;
              downX = e.clientX;
              downY = e.clientY;
            };

            let lastHoverTs = 0;
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
                  targetRadius = Math.max(4.0, Math.min(11.5, targetRadius + delta * 0.02));
                  ctx.requestRender();
                }
                prevPinchDist = dist;
                return;
              }

              if (isDragging) {
                const dx = e.clientX - downX;
                const dy = e.clientY - downY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
                downX = e.clientX;
                downY = e.clientY;
                targetAzimuth += dx * 0.007;
                targetPolar = Math.max(0.55, Math.min(1.45, targetPolar - dy * 0.005));
                ctx.requestRender();
                return;
              }

              const now = performance.now();
              if (now - lastHoverTs < 50) return;
              lastHoverTs = now;
              const idx = pickStar(e.clientX, e.clientY);
              if (idx !== null && idx !== currentSelectedIdx) {
                currentSelectedIdx = idx;
                setSelectedStarIdx(idx);
                ctx.requestRender();
              }
            };

            const onPointerUp = (e: PointerEvent) => {
              activePointers.delete(e.pointerId);
              if (activePointers.size < 2) {
                prevPinchDist = null;
              }
              if (isDragging && !dragMoved) {
                const idx = pickStar(e.clientX, e.clientY);
                if (idx !== null) {
                  currentSelectedIdx = idx;
                  setSelectedStarIdx(idx);
                  ctx.requestRender();
                }
              }
              isDragging = false;
            };

            canvas.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp, { passive: true });
            window.addEventListener('pointercancel', onPointerUp, { passive: true });

            return {
              onTick: (dt, elapsed) => {
                if (!isDragging && !resolution.isSoftwareGl && !ambientPausedRef.current) {
                  targetAzimuth += dt * 0.075;
                }
                const damp = 1 - Math.exp(-5 * dt);
                azimuth += (targetAzimuth - azimuth) * damp;
                polar += (targetPolar - polar) * damp;
                radius += (targetRadius - radius) * damp;
                lookTarget.lerp(desiredLookTarget, damp);

                galaxyGroup.rotation.y = azimuth;
                dustPoints.rotation.y = -elapsed * 0.03;

                camera.position.set(
                  lookTarget.x,
                  lookTarget.y + radius * Math.cos(polar),
                  lookTarget.z + radius * Math.sin(polar)
                );
                camera.lookAt(lookTarget);

                // Shooting-star animation
                if (shootingStar) {
                  shootingStar.progress += dt * 1.45;
                  const t = Math.min(1, shootingStar.progress);
                  streakMesh.position.lerpVectors(shootingStar.from, shootingStar.to, t);
                  streakMesh.lookAt(shootingStar.to);
                  streakMat.opacity = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
                  if (t >= 1) {
                    shootingStar = null;
                    streakMesh.visible = false;
                  } else {
                    ctx.requestRender();
                  }
                }

                syncGalaxy(elapsed, currentSelectedIdx);

                if (
                  lookTarget.distanceTo(desiredLookTarget) > 0.01 ||
                  Math.abs(targetRadius - radius) > 0.01 ||
                  Math.abs(targetAzimuth - azimuth) > 0.002
                ) {
                  ctx.requestRender();
                }
              },
              onDispose: () => {
                sceneCtxRef.current = null;
                flyToArmRef.current = null;
                shootingStarTriggerRef.current = null;
                canvas.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                starGlowTex.dispose();
                nebulaTex.dispose();
              },
            };
          }}
        />

        {/* Ambient Nebula Empty-State Overlay CTA when 0 chapters exist */}
        {chapters.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <div className="pointer-events-auto max-w-xs space-y-2.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sf-1)_88%,transparent)] p-4">
              <p className="text-[14px] font-semibold text-[var(--tx)]">
                Add chapters to ignite your syllabus galaxy
              </p>
              <p className="text-[13px] text-[var(--tx-2)]">
                Each chapter becomes a glowing star along its subject spiral arm.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {onOpenAddChapter && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus size={14} />}
                    onClick={onOpenAddChapter}
                  >
                    Add chapter
                  </Button>
                )}
                {onOpenBulkPaste && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<FileSpreadsheet size={14} />}
                    onClick={onOpenBulkPaste}
                  >
                    Bulk paste
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Accessible DOM Tooltip & Action Row for Selected Chapter Star */}
      {selectedNode && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5 text-[13px]"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: selectedNode.subject.color }}
            />
            <strong className="truncate text-[13.5px] text-[var(--tx)]">
              {selectedNode.chapter.name}
            </strong>
            <span className="text-[var(--tx-2)]">
              · {selectedNode.subject.e} {selectedNode.subject.name}
            </span>
            <span className="tnum rounded-md border border-[var(--line)] bg-[var(--sf-1)] px-2 py-0.5 text-[13px] text-[var(--tx-2)]">
              {selectedNode.chapter.status === 'completed'
                ? 'Completed'
                : selectedNode.chapter.status === 'inProgress'
                  ? 'In progress'
                  : 'Not started'}{' '}
              · Conf {selectedNode.chapter.confidence || 3}/5
              {selectedNode.isDue ? ' · Revision due' : ''}
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={13} />}
            onClick={() => onSelectChapter(selectedNode.chapter)}
          >
            Focus chapter
          </Button>
        </div>
      )}
    </Card>
  );
};
