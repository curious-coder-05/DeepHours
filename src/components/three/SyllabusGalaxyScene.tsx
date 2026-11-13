import React, { useMemo, useRef, useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import type { Chapter, Subject } from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Scene3D, type Scene3DContext, type Ui3dSetting } from './Scene3D';

export interface SyllabusGalaxySceneProps {
  subjects: Subject[];
  chapters: Chapter[];
  dueChapterIds: Set<string>;
  ui3dSetting?: Ui3dSetting;
  onSelectChapter: (chapter: Chapter) => void;
}

interface StarNode {
  chapter: Chapter;
  subject: Subject;
  subjectIdx: number;
  position: [number, number, number];
  baseScale: number;
  isDue: boolean;
}

export const SyllabusGalaxyScene: React.FC<SyllabusGalaxySceneProps> = ({
  subjects,
  chapters,
  dueChapterIds,
  ui3dSetting = 'auto',
  onSelectChapter,
}) => {
  const activeSubjects = useMemo(
    () => subjects.filter((s) => !s.arch),
    [subjects]
  );

  const starNodes = useMemo<StarNode[]>(() => {
    const nodes: StarNode[] = [];
    const subCount = Math.max(1, activeSubjects.length);

    activeSubjects.forEach((sub, sIdx) => {
      const clusterAngle = (sIdx / subCount) * Math.PI * 2;
      const clusterRadius = subCount === 1 ? 0 : 2.35;
      const cx = Math.cos(clusterAngle) * clusterRadius;
      const cz = Math.sin(clusterAngle) * clusterRadius * 0.68;
      const cy = Math.sin(clusterAngle * 2) * 0.28;

      const subChapters = chapters.filter((ch) => ch.subjectId === sub.id);
      subChapters.forEach((ch, cIdx) => {
        // Golden-angle spiral distribution around the subject cluster center
        const phi = cIdx * 2.3999632;
        const r = 0.32 + Math.sqrt(cIdx + 1) * 0.24;
        const yOff = (((cIdx * 31) % 10) - 4.5) * 0.085;
        const x = cx + Math.cos(phi) * r;
        const y = cy + yOff;
        const z = cz + Math.sin(phi) * r;
        const conf = Math.max(1, Math.min(5, Number(ch.confidence) || 3));
        const baseScale = 0.65 + conf * 0.14;
        nodes.push({
          chapter: ch,
          subject: sub,
          subjectIdx: sIdx,
          position: [x, y, z],
          baseScale,
          isDue: dueChapterIds.has(ch.id),
        });
      });
    });

    return nodes.slice(0, 600);
  }, [activeSubjects, chapters, dueChapterIds]);

  const starNodesRef = useRef(starNodes);
  starNodesRef.current = starNodes;

  const [selectedStarIdx, setSelectedStarIdx] = useState<number | null>(() =>
    starNodes.length > 0 ? 0 : null
  );

  if (ui3dSetting === 'off' || chapters.length === 0) {
    return null;
  }

  const selectedNode =
    selectedStarIdx !== null && starNodes[selectedStarIdx]
      ? starNodes[selectedStarIdx]
      : starNodes[0] || null;

  return (
    <Card className="space-y-3">
      <div className="split flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-[var(--ac)]" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--tx)]">
              Syllabus constellation
            </h3>
            <p className="text-[12px] text-[var(--tx-2)]">
              Each star is a chapter grouped by subject · Lit = completed, half-lit = in
              progress, pulsing = revision due
            </p>
          </div>
        </div>
        <span className="tnum text-[12px] text-[var(--tx-2)]">
          {starNodes.length} {starNodes.length === 1 ? 'chapter' : 'chapters'} mapped
        </span>
      </div>

      <div className="relative rounded-xl border border-[var(--line)] bg-[var(--sf-2)] overflow-hidden">
        <Scene3D
          testId="syllabus-galaxy-scene"
          ui3dSetting={ui3dSetting}
          active={true}
          continuous={true}
          height={216}
          fov={42}
          cameraPosition={[0, 2.5, 6.8]}
          setup={(ctx: Scene3DContext) => {
            const { THREE, scene, camera, canvas, resolution } = ctx;

            const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0b0d10, 0.95);
            scene.add(hemi);

            const dirLight = new THREE.DirectionalLight(0xfff4d6, 1.25);
            dirLight.position.set(4, 6, 5);
            scene.add(dirLight);

            const galaxyGroup = new THREE.Group();
            scene.add(galaxyGroup);

            // Subject cluster orbital ring guides (composite THREE.Group per subject)
            const subCount = Math.max(1, activeSubjects.length);
            activeSubjects.forEach((sub, sIdx) => {
              const clusterAngle = (sIdx / subCount) * Math.PI * 2;
              const clusterRadius = subCount === 1 ? 0 : 2.35;
              const cx = Math.cos(clusterAngle) * clusterRadius;
              const cz = Math.sin(clusterAngle) * clusterRadius * 0.68;
              const cy = Math.sin(clusterAngle * 2) * 0.28;

              const subClusterGroup = new THREE.Group();
              subClusterGroup.position.set(cx, cy, cz);

              const ringGeo = new THREE.TorusGeometry(0.95, 0.012, 8, 48);
              const ringMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(sub.color || '#F5C451'),
                transparent: true,
                opacity: 0.22,
              });
              const ringMesh = new THREE.Mesh(ringGeo, ringMat);
              ringMesh.rotation.x = Math.PI / 2;
              subClusterGroup.add(ringMesh);

              const hubGeo = new THREE.OctahedronGeometry(0.11, 0);
              const hubMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(sub.color || '#F5C451'),
                roughness: 0.3,
                metalness: 0.4,
              });
              const hubMesh = new THREE.Mesh(hubGeo, hubMat);
              subClusterGroup.add(hubMesh);

              galaxyGroup.add(subClusterGroup);
            });

            // Chapter stars InstancedMesh
            const maxStars = Math.max(
              1,
              Math.min(
                resolution.tier === 'lite' ? 200 : 600,
                starNodesRef.current.length
              )
            );
            const starGeo = new THREE.OctahedronGeometry(0.14, 1);
            const starMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.25,
              metalness: 0.2,
              flatShading: true,
            });
            const instancedStars = new THREE.InstancedMesh(starGeo, starMat, maxStars);

            const dummyMat = new THREE.Matrix4();
            const dummyPos = new THREE.Vector3();
            const dummyQuat = new THREE.Quaternion();
            const dummyScale = new THREE.Vector3();
            const cColor = new THREE.Color();
            const dimBg = new THREE.Color('#20252D');
            const lumenHighlight = new THREE.Color('#F5C451');

            const syncStarInstances = (elapsed: number, activeIdx: number | null) => {
              const nodes = starNodesRef.current;
              const count = Math.min(maxStars, nodes.length);
              for (let i = 0; i < count; i++) {
                const n = nodes[i];
                dummyPos.set(n.position[0], n.position[1], n.position[2]);

                let sc = n.baseScale;
                if (n.isDue) {
                  sc *= 1 + Math.sin(elapsed * 3.8 + i) * 0.22;
                }
                if (activeIdx === i) {
                  sc *= 1.35;
                }
                dummyScale.setScalar(sc);
                dummyMat.compose(dummyPos, dummyQuat, dummyScale);
                instancedStars.setMatrixAt(i, dummyMat);

                cColor.set(n.subject.color || '#F5C451');
                if (n.chapter.status === 'notStarted') {
                  cColor.lerp(dimBg, 0.68);
                } else if (n.chapter.status === 'inProgress') {
                  cColor.lerp(dimBg, 0.28);
                }
                if (activeIdx === i) {
                  cColor.lerp(lumenHighlight, 0.45);
                }
                instancedStars.setColorAt(i, cColor);
              }
              instancedStars.instanceMatrix.needsUpdate = true;
              if (instancedStars.instanceColor) {
                instancedStars.instanceColor.needsUpdate = true;
              }
              instancedStars.computeBoundingSphere();
            };

            syncStarInstances(0, selectedStarIdx);
            galaxyGroup.add(instancedStars);

            // Drag rotation & Raycaster selection
            let azimuth = 0.0;
            let targetAzimuth = 0.0;
            let isDragging = false;
            let dragMoved = false;
            let downX = 0;
            let currentSelectedIdx = selectedStarIdx;

            const raycaster = new THREE.Raycaster();
            const pointerNdc = new THREE.Vector2();

            const pickStar = (clientX: number, clientY: number): number | null => {
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
              isDragging = true;
              dragMoved = false;
              downX = e.clientX;
            };

            let lastHoverTs = 0;
            const onPointerMove = (e: PointerEvent) => {
              if (isDragging) {
                const dx = e.clientX - downX;
                if (Math.abs(dx) > 3) dragMoved = true;
                downX = e.clientX;
                targetAzimuth += dx * 0.007;
                return;
              }
              const now = performance.now();
              if (now - lastHoverTs < 50) return;
              lastHoverTs = now;
              const idx = pickStar(e.clientX, e.clientY);
              if (idx !== null && idx !== currentSelectedIdx) {
                currentSelectedIdx = idx;
                setSelectedStarIdx(idx);
              }
            };

            const onPointerUp = (e: PointerEvent) => {
              if (!dragMoved) {
                const idx = pickStar(e.clientX, e.clientY);
                if (idx !== null) {
                  currentSelectedIdx = idx;
                  setSelectedStarIdx(idx);
                }
              }
              isDragging = false;
            };

            canvas.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove, { passive: true });
            window.addEventListener('pointerup', onPointerUp, { passive: true });

            return {
              onTick: (dt, elapsed) => {
                if (!isDragging && !resolution.isSoftwareGl) {
                  targetAzimuth += dt * 0.09;
                }
                azimuth += (targetAzimuth - azimuth) * (1 - Math.exp(-5 * dt));
                galaxyGroup.rotation.y = azimuth;
                syncStarInstances(elapsed, currentSelectedIdx);
              },
              onDispose: () => {
                canvas.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
              },
            };
          }}
        />
      </div>

      {/* Accessible DOM Tooltip & Action Row for Selected Chapter Star */}
      {selectedNode && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5 text-[12.5px]"
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
            <span className="tnum rounded-md border border-[var(--line)] bg-[var(--sf-1)] px-2 py-0.5 text-[12px] text-[var(--tx-2)]">
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
