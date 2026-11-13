import React, { useEffect, useRef, useState } from 'react';
import { Calendar, RotateCcw } from 'lucide-react';
import { fmtHMShort } from '../../utils/studyLogic';
import { Button } from '../ui/Button';
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
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  onInspectDay?: (dayKey: string) => void;
}

function getLevelHexColor(lvlClass: string, isFuture: boolean): number {
  if (isFuture) return 0x222834;
  switch (lvlClass) {
    case 'hm-l5':
      return 0xf5c451; // Peak Lumen gold for 8h+
    case 'hm-l4':
      return 0x4ade80; // Bright emerald
    case 'hm-l3':
      return 0x34d399;
    case 'hm-l2':
      return 0x22c55e;
    case 'hm-l1':
      return 0x15803d;
    default:
      return 0x323b4a;
  }
}

export const StudySkylineScene: React.FC<StudySkylineSceneProps> = ({
  cells,
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  onInspectDay,
}) => {
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(() => {
    // Default tooltip to most recent non-future active day
    for (let i = cells.length - 1; i >= 0; i--) {
      if (!cells[i].future && cells[i].hrs > 0) return i;
    }
    for (let i = cells.length - 1; i >= 0; i--) {
      if (!cells[i].future) return i;
    }
    return null;
  });

  const resetOrbitRef = useRef<(() => void) | null>(null);
  const updateInstancesRef = useRef<((idx: number | null) => void) | null>(null);
  const selectedCell =
    selectedIdx !== null && cells[selectedIdx] ? cells[selectedIdx] : null;

  useEffect(() => {
    updateInstancesRef.current?.(selectedIdx);
  }, [cells, selectedIdx]);

  return (
    <div className="space-y-2.5">
      <div className="relative rounded-xl border border-[var(--line)] bg-[var(--sf-2)] overflow-hidden">
        <Scene3D
          testId="study-skyline-scene"
          ui3dSetting={ui3dSetting}
          ui3dQuality={ui3dQuality}
          active={true}
          continuous={true}
          height={248}
          fov={38}
          cameraPosition={[0, 7.2, 11.5]}
          setup={(ctx: Scene3DContext) => {
            const { THREE, scene, camera, canvas, resolution } = ctx;

            // Warm key light + cool hemisphere fill
            const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.5);
            scene.add(hemi);

            const dirLight = new THREE.DirectionalLight(0xfff4d6, 1.85);
            dirLight.position.set(6, 10, 7);
            scene.add(dirLight);

            const rimLight = new THREE.DirectionalLight(0x4ade80, 0.65);
            rimLight.position.set(-6, 4, -6);
            scene.add(rimLight);

            const worldGroup = new THREE.Group();
            scene.add(worldGroup);

            // Grounded multi-part architectural plinth (THREE.Group)
            const plinthGroup = new THREE.Group();
            const deckGeo = new THREE.BoxGeometry(8.8, 0.22, 5.4);
            const deckMat = new THREE.MeshStandardMaterial({
              color: 0x1b2029,
              roughness: 0.65,
              metalness: 0.18,
            });
            const deckMesh = new THREE.Mesh(deckGeo, deckMat);
            deckMesh.position.y = -0.11;
            plinthGroup.add(deckMesh);

            const rimGeo = new THREE.BoxGeometry(9.05, 0.08, 5.65);
            const rimMat = new THREE.MeshStandardMaterial({
              color: 0x333c4d,
              roughness: 0.4,
              metalness: 0.35,
            });
            const rimMesh = new THREE.Mesh(rimGeo, rimMat);
            rimMesh.position.y = -0.22;
            plinthGroup.add(rimMesh);
            worldGroup.add(plinthGroup);

            // 84 Instanced Bars (12 weeks x 7 days)
            const count = Math.min(84, cellsRef.current.length || 84);
            // Pivot at bottom of bar by translating geometry up by 0.5
            const barGeo = new THREE.BoxGeometry(0.46, 1.0, 0.46);
            barGeo.translate(0, 0.5, 0);

            const barMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.28,
              metalness: 0.18,
            });

            const instancedBars = new THREE.InstancedMesh(barGeo, barMat, count);
            const dummyMat = new THREE.Matrix4();
            const dummyPos = new THREE.Vector3();
            const dummyQuat = new THREE.Quaternion();
            const dummyScale = new THREE.Vector3(1, 1, 1);
            const barColor = new THREE.Color();
            const highlightColor = new THREE.Color(0xf5c451);

            const updateInstances = (hoveredOrSelectedIdx: number | null) => {
              const curCells = cellsRef.current;
              for (let i = 0; i < count; i++) {
                const cell = curCells[i];
                const weekCol = Math.floor(i / 7); // 0..11
                const dayRow = i % 7; // 0..6
                const x = (weekCol - 5.5) * 0.66;
                const z = (dayRow - 3.0) * 0.66;
                const hrs = cell && !cell.future ? Math.max(0, cell.hrs) : 0;
                const h = cell?.future
                  ? 0.06
                  : hrs > 0
                    ? Math.min(3.2, 0.22 + hrs * 0.32)
                    : 0.1;

                dummyPos.set(x, 0, z);
                dummyScale.set(1, h, 1);
                dummyMat.compose(dummyPos, dummyQuat, dummyScale);
                instancedBars.setMatrixAt(i, dummyMat);

                barColor.setHex(
                  getLevelHexColor(cell?.lvlClass || 'hm-l0', Boolean(cell?.future))
                );
                if (hoveredOrSelectedIdx === i) {
                  barColor.lerp(highlightColor, 0.55);
                }
                instancedBars.setColorAt(i, barColor);
              }
              instancedBars.instanceMatrix.needsUpdate = true;
              if (instancedBars.instanceColor) {
                instancedBars.instanceColor.needsUpdate = true;
              }
              instancedBars.computeBoundingSphere();
            };

            updateInstancesRef.current = updateInstances;
            updateInstances(selectedIdx);
            worldGroup.add(instancedBars);

            // Orbit & Raycaster interaction state
            let azimuth = -0.32;
            let polar = 0.86; // Clamped between 0.42 and 1.28 rad so it never flips
            let targetAzimuth = -0.32;
            let targetPolar = 0.86;
            const radius = 11.2;
            let isDragging = false;
            let dragMoved = false;
            let pointerDownX = 0;
            let pointerDownY = 0;
            let activeHoverIdx: number | null = selectedIdx;

            const raycaster = new THREE.Raycaster();
            const pointerNdc = new THREE.Vector2();

            const pickBarAtEvent = (clientX: number, clientY: number) => {
              const rect = canvas.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return null;
              pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
              pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointerNdc, camera);
              const hits = raycaster.intersectObject(instancedBars, false);
              if (hits.length > 0 && typeof hits[0].instanceId === 'number') {
                return hits[0].instanceId;
              }
              return null;
            };

            const onPointerDown = (e: PointerEvent) => {
              isDragging = true;
              dragMoved = false;
              pointerDownX = e.clientX;
              pointerDownY = e.clientY;
            };

            let lastRaycastTs = 0;
            const onPointerMove = (e: PointerEvent) => {
              if (isDragging) {
                const dx = e.clientX - pointerDownX;
                const dy = e.clientY - pointerDownY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                  dragMoved = true;
                }
                pointerDownX = e.clientX;
                pointerDownY = e.clientY;
                targetAzimuth -= dx * 0.0075;
                targetPolar = Math.max(
                  0.42,
                  Math.min(1.28, targetPolar - dy * 0.0065)
                );
                return;
              }

              const now = performance.now();
              if (now - lastRaycastTs < 45) return;
              lastRaycastTs = now;

              const idx = pickBarAtEvent(e.clientX, e.clientY);
              if (idx !== null && idx !== activeHoverIdx) {
                activeHoverIdx = idx;
                setSelectedIdx(idx);
                updateInstances(idx);
              }
            };

            const onPointerUp = (e: PointerEvent) => {
              if (!dragMoved) {
                const idx = pickBarAtEvent(e.clientX, e.clientY);
                if (idx !== null) {
                  activeHoverIdx = idx;
                  setSelectedIdx(idx);
                  updateInstances(idx);
                }
              }
              isDragging = false;
            };

            canvas.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove, { passive: true });
            window.addEventListener('pointerup', onPointerUp, { passive: true });

            resetOrbitRef.current = () => {
              targetAzimuth = -0.32;
              targetPolar = 0.86;
            };

            return {
              onTick: (dt) => {
                // Gentle auto-rotation when user is not dragging
                if (!isDragging && !resolution.isSoftwareGl) {
                  targetAzimuth += dt * 0.08;
                }
                const damp = 1 - Math.exp(-6 * dt);
                azimuth += (targetAzimuth - azimuth) * damp;
                polar += (targetPolar - polar) * damp;

                camera.position.x = radius * Math.sin(polar) * Math.sin(azimuth);
                camera.position.y = radius * Math.cos(polar);
                camera.position.z = radius * Math.sin(polar) * Math.cos(azimuth);
                camera.lookAt(0, 0.35, 0);
              },
              onDispose: () => {
                canvas.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
              },
            };
          }}
        />

        {/* Subtle corner camera reset button */}
        <div className="pointer-events-none absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => resetOrbitRef.current?.()}
            aria-label="Reset 3D skyline camera angle"
            className="pointer-events-auto inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2.5 py-1 text-[13px] font-medium text-[var(--tx-2)] hover:text-[var(--tx)]"
          >
            <RotateCcw size={13} />
            Reset view
          </button>
        </div>
      </div>

      {/* Accessible DOM Tooltip Card for Selected / Hovered Bar */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3.5 py-2.5 text-[13px]"
      >
        {selectedCell ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background:
                    selectedCell.hrs >= 8
                      ? 'var(--ac)'
                      : selectedCell.hrs > 0
                        ? 'var(--ok)'
                        : 'var(--tx-3)',
                }}
              />
              <strong className="tnum text-[var(--tx)]">{selectedCell.key}</strong>
              <span className="tnum text-[var(--tx-2)]">
                ·{' '}
                {selectedCell.future
                  ? 'Upcoming date'
                  : selectedCell.hrs > 0
                    ? `${fmtHMShort(Math.round(selectedCell.hrs * 3600000))} studied (${selectedCell.hrs.toFixed(1)}h)`
                    : '0m studied'}
              </span>
            </div>
            {!selectedCell.future && onInspectDay && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Calendar size={14} />}
                onClick={() => onInspectDay(selectedCell.key)}
              >
                Open day record
              </Button>
            )}
          </>
        ) : (
          <span className="text-[var(--tx-2)]">
            Drag to orbit the 12-week skyline or tap any bar to inspect daily study hours.
          </span>
        )}
      </div>
    </div>
  );
};
