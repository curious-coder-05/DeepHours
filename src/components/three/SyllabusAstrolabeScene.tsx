import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import type { Chapter, Subject } from '../../types';
import { buildSyllabusAstrolabeLayout } from '../../utils/scene3dHelpers';
import { Button } from '../ui/Button';
import {
  Scene3D,
  type Scene3DContext,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface SyllabusAstrolabeSceneProps {
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

const MAX_NODES_HIGH = 600;
const CHAMPAGNE_RING_PALETTE = ['#D4AF37', '#EAB308', '#C8A96A', '#B48A5A'] as const;

// ---------------------------------------------------------------------------
// Central Molten-Gold Geodesic Sun Core Shader
// Obsidian center surging via crisp Fresnel into molten gold & solar amber
// ---------------------------------------------------------------------------

const CORE_SUN_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = normalize(position);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CORE_SUN_FRAGMENT = `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float ndv = max(dot(n, v), 0.0);

    // Rich obsidian core surging into molten gold along the Fresnel limb
    float fresnel = pow(1.0 - ndv, 2.4);
    float hotEdge = pow(1.0 - ndv, 4.8);

    // Subtle organic solar shimmer along the silhouette
    float shimmer =
      0.86 +
      0.14 * sin(vLocalPos.x * 5.2 + uTime * 0.9) * cos(vLocalPos.y * 4.6 - uTime * 0.7);

    vec3 obsidian = vec3(0.03, 0.02, 0.01);
    vec3 moltenGold = vec3(1.0, 0.84, 0.38);
    vec3 solarAmber = vec3(0.96, 0.62, 0.04);

    vec3 rimColor = mix(solarAmber, moltenGold, smoothstep(0.32, 0.92, fresnel));
    vec3 col = mix(obsidian, rimColor, clamp(fresnel * 1.18 * shimmer, 0.0, 1.0));
    col += vec3(1.0, 0.95, 0.76) * hotEdge * 0.72 * shimmer;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function createCoreCoronaTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 12, half, half, half);
    g.addColorStop(0.0, 'rgba(253, 230, 138, 0.82)');
    g.addColorStop(0.3, 'rgba(253, 230, 138, 0.56)');
    g.addColorStop(0.55, 'rgba(245, 158, 11, 0.24)');
    g.addColorStop(0.8, 'rgba(217, 119, 6, 0.06)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCrystalHaloTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 2, half, half, half);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 0.98)');
    g.addColorStop(0.24, 'rgba(255, 255, 255, 0.62)');
    g.addColorStop(0.54, 'rgba(255, 255, 255, 0.18)');
    g.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSoftDustSpriteTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 1, half, half, half);
    g.addColorStop(0.0, 'rgba(255, 248, 220, 0.95)');
    g.addColorStop(0.38, 'rgba(251, 191, 36, 0.45)');
    g.addColorStop(1.0, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildDegreeTickGeometry(
  THREE: typeof import('three'),
  radius: number,
  tickCount: number,
  majorEvery: number
): import('three').BufferGeometry {
  const positions = new Float32Array(tickCount * 2 * 3);
  for (let i = 0; i < tickCount; i++) {
    const angle = (i / tickCount) * Math.PI * 2;
    const isMajor = i % majorEvery === 0;
    const innerR = radius - (isMajor ? 0.13 : 0.06);
    const outerR = radius + (isMajor ? 0.035 : 0.015);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const idx = i * 6;
    positions[idx] = cos * innerR;
    positions[idx + 1] = 0;
    positions[idx + 2] = sin * innerR;
    positions[idx + 3] = cos * outerR;
    positions[idx + 4] = 0;
    positions[idx + 5] = sin * outerR;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

export const SyllabusAstrolabeScene: React.FC<SyllabusAstrolabeSceneProps> = ({
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
      buildSyllabusAstrolabeLayout(
        activeSubjects,
        chapters,
        dueChapterIds,
        MAX_NODES_HIGH
      ),
    [activeSubjects, chapters, dueChapterIds]
  );

  const astrolabeNodes = layout.nodes;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const activeSubjectIdRef = useRef(activeSubjectId);
  activeSubjectIdRef.current = activeSubjectId;

  const ambientPausedRef = useRef(ambientPaused);
  ambientPausedRef.current = ambientPaused;

  const [selectedNodeIdx, setSelectedNodeIdx] = useState<number | null>(() =>
    astrolabeNodes.length > 0 ? 0 : null
  );
  const selectedNodeIdxRef = useRef<number | null>(selectedNodeIdx);
  selectedNodeIdxRef.current = selectedNodeIdx;

  const sceneCtxRef = useRef<Scene3DContext | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const focusSubjectRef = useRef<((subId: string) => void) | null>(null);
  const rebuildRingsRef = useRef<(() => void) | null>(null);

  const ringSignature = useMemo(
    () =>
      layout.rings
        .map((r) => `${r.subject.id}:${r.radius.toFixed(2)}:${r.color}`)
        .join('|'),
    [layout.rings]
  );

  useEffect(() => {
    rebuildRingsRef.current?.();
    sceneCtxRef.current?.requestRender();
  }, [ringSignature]);

  useEffect(() => {
    focusSubjectRef.current?.(activeSubjectId);
    sceneCtxRef.current?.requestRender();

    if (astrolabeNodes.length === 0) {
      if (selectedNodeIdx !== null) setSelectedNodeIdx(null);
      return;
    }

    if (activeSubjectId === 'all') {
      if (selectedNodeIdx === null || !astrolabeNodes[selectedNodeIdx]) {
        setSelectedNodeIdx(0);
      }
      return;
    }

    const current =
      selectedNodeIdx !== null ? astrolabeNodes[selectedNodeIdx] : undefined;
    if (current && current.subject.id === activeSubjectId) return;
    const firstMatchIdx = astrolabeNodes.findIndex(
      (n) => n.subject.id === activeSubjectId
    );
    if (firstMatchIdx >= 0) {
      setSelectedNodeIdx(firstMatchIdx);
    }
  }, [activeSubjectId, astrolabeNodes, selectedNodeIdx]);

  useEffect(() => {
    sceneCtxRef.current?.requestRender();
  }, [layout, selectedNodeIdx, ambientPaused]);

  if (ui3dSetting === 'off') {
    return null;
  }

  const selectedNode =
    selectedNodeIdx !== null && astrolabeNodes[selectedNodeIdx]
      ? astrolabeNodes[selectedNodeIdx]
      : astrolabeNodes[0] || null;

  const completedCount = chapters.filter((c) => c.status === 'completed').length;
  const selectedConfidence = Math.max(
    1,
    Math.min(5, Number(selectedNode?.chapter.confidence) || 3)
  );

  const selectedStatusMeta = selectedNode
    ? selectedNode.visualState === 'alert'
      ? {
          label: selectedNode.isDue ? 'Revision due' : 'Low confidence',
          dotColor: '#FB7185',
          badgeBg: 'rgba(225, 29, 72, 0.16)',
          badgeBorder: 'rgba(251, 113, 133, 0.42)',
          badgeText: '#FDA4AF',
        }
      : selectedNode.visualState === 'completed'
        ? {
            label: 'Completed',
            dotColor: '#FCD34D',
            badgeBg: 'rgba(245, 196, 81, 0.16)',
            badgeBorder: 'rgba(252, 211, 77, 0.42)',
            badgeText: '#FDE68A',
          }
        : selectedNode.visualState === 'inProgress'
          ? {
              label: 'In progress',
              dotColor: '#F59E0B',
              badgeBg: 'rgba(245, 158, 11, 0.16)',
              badgeBorder: 'rgba(251, 191, 36, 0.36)',
              badgeText: '#FCD34D',
            }
          : {
              label: 'Not started',
              dotColor: '#64748B',
              badgeBg: 'rgba(148, 163, 184, 0.12)',
              badgeBorder: 'rgba(148, 163, 184, 0.24)',
              badgeText: '#CBD5E1',
            }
    : null;

  return (
    <section
      className="dh-astrolabe-stage"
      data-testid="syllabus-astrolabe-card"
      aria-label="Syllabus astrolabe"
    >
      <span className="sr-only">
        Syllabus astrolabe: {astrolabeNodes.length} chapters mapped across{' '}
        {activeSubjects.length} orbital subject rings, {completedCount} mastered,{' '}
        {dueChapterIds.size} revisions due.
      </span>

      {/* Full-Bleed Pure AMOLED WebGL Layer */}
      <div className="dh-astrolabe-canvas-layer">
        <Scene3D
          testId="syllabus-astrolabe-scene"
          ui3dSetting={ui3dSetting}
          ui3dQuality={ui3dQuality}
          active={!ambientPaused}
          continuous={!ambientPaused}
          height="100%"
          className="h-full w-full"
          fov={42}
          cameraPosition={[0, 3.6, 10.5]}
          setup={(ctx: Scene3DContext) => {
            const { THREE, scene, camera, renderer, canvas, resolution } = ctx;
            sceneCtxRef.current = ctx;

            let isDisposed = false;
            let envRenderTarget: import('three').WebGLRenderTarget | null = null;

            // Lazy studio reflections via RoomEnvironment so metallic gold, coral & obsidian facets gleam
            import('three/addons/environments/RoomEnvironment.js')
              .then(({ RoomEnvironment }) => {
                if (isDisposed) return;
                const pmrem = new THREE.PMREMGenerator(renderer);
                const envScene = new RoomEnvironment();
                envRenderTarget = pmrem.fromScene(envScene, 0.04);
                scene.environment = envRenderTarget.texture;
                envScene.dispose();
                pmrem.dispose();
                ctx.requestRender();
              })
              .catch(() => {
                // Gracefully rely on direct studio light rig if RoomEnvironment fails
              });

            // Sculptural studio lighting rig (warm key + crisp fill + subtle crimson counter-rim)
            const hemi = new THREE.HemisphereLight(0xffeec9, 0x09080c, 0.95);
            scene.add(hemi);

            const keyLight = new THREE.DirectionalLight(0xfff1cc, 1.85);
            keyLight.position.set(5.2, 7.0, 5.8);
            scene.add(keyLight);

            const fillLight = new THREE.DirectionalLight(0xfde68a, 0.72);
            fillLight.position.set(-4.8, 2.2, 4.0);
            scene.add(fillLight);

            const backRimLight = new THREE.DirectionalLight(0xfb7185, 0.55);
            backRimLight.position.set(-4.5, -3.0, -5.2);
            scene.add(backRimLight);

            const astrolabeGroup = new THREE.Group();
            scene.add(astrolabeGroup);

            const coreCoronaTex = createCoreCoronaTexture(THREE);
            const crystalHaloTex = createCrystalHaloTexture(THREE);
            const dustSpriteTex = createSoftDustSpriteTexture(THREE);

            // 1. Central Molten-Gold Geodesic Sun Core
            const coreAssembly = new THREE.Group();
            astrolabeGroup.add(coreAssembly);

            const coreSunUniforms = {
              uTime: { value: 0 },
            };
            const coreSphereGeo = new THREE.SphereGeometry(
              1.12,
              resolution.resolvedQuality === 'lite' ? 28 : 40,
              resolution.resolvedQuality === 'lite' ? 28 : 40
            );
            const coreSphereMat = new THREE.ShaderMaterial({
              uniforms: coreSunUniforms,
              vertexShader: CORE_SUN_VERTEX,
              fragmentShader: CORE_SUN_FRAGMENT,
            });
            const coreSphere = new THREE.Mesh(coreSphereGeo, coreSphereMat);
            coreAssembly.add(coreSphere);

            // Slowly rotating golden geodesic wireframe shell wrapping the sun core
            const wireSrcGeo = new THREE.IcosahedronGeometry(1.22, 1);
            const coreWireGeo = new THREE.EdgesGeometry(wireSrcGeo);
            wireSrcGeo.dispose();
            const coreWireMat = new THREE.LineBasicMaterial({
              color: 0xfbbf24,
              transparent: true,
              opacity: 0.42,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const coreWireframe = new THREE.LineSegments(coreWireGeo, coreWireMat);
            coreAssembly.add(coreWireframe);

            // 256x256 radial golden corona sprite blooming cleanly behind the opaque core sphere
            const coreCoronaMat = new THREE.SpriteMaterial({
              map: coreCoronaTex,
              transparent: true,
              opacity: 0.86,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const coreCoronaSprite = new THREE.Sprite(coreCoronaMat);
            coreCoronaSprite.scale.set(5.2, 5.2, 1);
            coreAssembly.add(coreCoronaSprite);

            // Outer celestial equatorial calibration dial with 72 champagne-gold degree ticks
            const degreeRadius = Math.max(3.15, layoutRef.current.maxRadius + 0.34);
            const degreeTickGeo = buildDegreeTickGeometry(THREE, degreeRadius, 72, 6);
            const degreeTickMat = new THREE.LineBasicMaterial({
              color: 0xd4af37,
              transparent: true,
              opacity: 0.3,
              depthWrite: false,
            });
            const degreeTicks = new THREE.LineSegments(degreeTickGeo, degreeTickMat);
            astrolabeGroup.add(degreeTicks);

            const outerDialRingGeo = new THREE.TorusGeometry(degreeRadius + 0.04, 0.006, 8, 96);
            outerDialRingGeo.rotateX(Math.PI / 2);
            const outerDialRingMat = new THREE.MeshBasicMaterial({
              color: 0xd4af37,
              transparent: true,
              opacity: 0.18,
              depthWrite: false,
            });
            const outerDialRing = new THREE.Mesh(outerDialRingGeo, outerDialRingMat);
            astrolabeGroup.add(outerDialRing);

            // 2. Cohesive Champagne-Gold Precision Subject Orbital Rings
            const ringsContainer = new THREE.Group();
            astrolabeGroup.add(ringsContainer);

            interface BuiltRingEntry {
              subjectId: string;
              group: import('three').Group;
              trackMat: import('three').MeshStandardMaterial;
              hairlineMat: import('three').MeshBasicMaterial;
              baseColor: import('three').Color;
              baseOpacity: number;
              radius: number;
              tiltX: number;
              tiltZ: number;
            }
            let builtRings: BuiltRingEntry[] = [];

            const disposeBuiltRings = () => {
              for (const r of builtRings) {
                r.group.traverse((obj) => {
                  const m = obj as import('three').Mesh;
                  if (m.geometry) m.geometry.dispose();
                  if (Array.isArray(m.material)) {
                    m.material.forEach((mm) => mm.dispose());
                  } else if (m.material) {
                    m.material.dispose();
                  }
                });
                ringsContainer.remove(r.group);
              }
              builtRings = [];
            };

            const buildRings = () => {
              disposeBuiltRings();
              const curRings = layoutRef.current.rings;
              const ringSpecs =
                curRings.length > 0
                  ? curRings
                  : [
                      {
                        subject: { id: 'preview_1', name: 'Preview', e: '✦', color: '#D4AF37', arch: 0, todos: [] },
                        subjectIdx: 0,
                        radius: 2.18,
                        tiltX: 0.28,
                        tiltZ: 0.14,
                        phaseOffset: 0,
                        color: '#D4AF37',
                        chapterCount: 0,
                        completedCount: 0,
                        dueCount: 0,
                      },
                      {
                        subject: { id: 'preview_2', name: 'Preview', e: '✦', color: '#C8A96A', arch: 0, todos: [] },
                        subjectIdx: 1,
                        radius: 2.74,
                        tiltX: -0.36,
                        tiltZ: 0.34,
                        phaseOffset: 0.85,
                        color: '#C8A96A',
                        chapterCount: 0,
                        completedCount: 0,
                        dueCount: 0,
                      },
                      {
                        subject: { id: 'preview_3', name: 'Preview', e: '✦', color: '#B48A5A', arch: 0, todos: [] },
                        subjectIdx: 2,
                        radius: 3.3,
                        tiltX: 0.48,
                        tiltZ: -0.26,
                        phaseOffset: 1.7,
                        color: '#B48A5A',
                        chapterCount: 0,
                        completedCount: 0,
                        dueCount: 0,
                      },
                    ];

              ringSpecs.forEach((spec, rIndex) => {
                const rg = new THREE.Group();
                rg.rotation.set(spec.tiltX, 0, spec.tiltZ);

                const champagneHex =
                  CHAMPAGNE_RING_PALETTE[spec.subjectIdx % CHAMPAGNE_RING_PALETTE.length];
                // Cohesive watchmaker champagne gold with subtle 14% subject hue inflection
                const baseColor = new THREE.Color(champagneHex).lerp(
                  new THREE.Color(spec.color || champagneHex),
                  0.14
                );
                const baseOpacity = Math.max(0.28, 0.42 - rIndex * 0.035);

                const trackGeo = new THREE.TorusGeometry(spec.radius, 0.012, 10, 96);
                trackGeo.rotateX(Math.PI / 2);
                const trackMat = new THREE.MeshStandardMaterial({
                  color: baseColor.clone(),
                  emissive: baseColor.clone().multiplyScalar(0.32),
                  roughness: 0.24,
                  metalness: 0.84,
                  transparent: true,
                  opacity: baseOpacity,
                });
                const trackMesh = new THREE.Mesh(trackGeo, trackMat);
                rg.add(trackMesh);

                // Ultra-fine engraved companion hairline ring
                const hairlineGeo = new THREE.TorusGeometry(
                  Math.max(1.5, spec.radius - 0.06),
                  0.004,
                  6,
                  84
                );
                hairlineGeo.rotateX(Math.PI / 2);
                const hairlineMat = new THREE.MeshBasicMaterial({
                  color: baseColor.clone(),
                  transparent: true,
                  opacity: baseOpacity * 0.42,
                  depthWrite: false,
                });
                const hairlineMesh = new THREE.Mesh(hairlineGeo, hairlineMat);
                rg.add(hairlineMesh);

                ringsContainer.add(rg);
                builtRings.push({
                  subjectId: spec.subject.id,
                  group: rg,
                  trackMat,
                  hairlineMat,
                  baseColor,
                  baseOpacity,
                  radius: spec.radius,
                  tiltX: spec.tiltX,
                  tiltZ: spec.tiltZ,
                });
              });
            };

            buildRings();
            rebuildRingsRef.current = buildRings;

            // 3. Bold Glowing Faceted Octahedron Chapter Crystals (4 PBR State Batches + Dimmed Ghost Batch)
            const maxNodes = resolution.resolvedQuality === 'lite' ? 240 : MAX_NODES_HIGH;
            const crystalGeo = new THREE.OctahedronGeometry(0.2, 0);

            const completedMat = new THREE.MeshStandardMaterial({
              color: 0xfcd34d,
              emissive: 0xf59e0b,
              emissiveIntensity: 0.92,
              roughness: 0.16,
              metalness: 0.72,
              flatShading: true,
            });
            const alertMat = new THREE.MeshStandardMaterial({
              color: 0xfb7185,
              emissive: 0xe11d48,
              emissiveIntensity: 1.05,
              roughness: 0.2,
              metalness: 0.56,
              flatShading: true,
            });
            const inProgressMat = new THREE.MeshStandardMaterial({
              color: 0xfbbf24,
              emissive: 0xd97706,
              emissiveIntensity: 0.62,
              roughness: 0.22,
              metalness: 0.68,
              flatShading: true,
            });
            const notStartedMat = new THREE.MeshStandardMaterial({
              color: 0x1c1917,
              emissive: 0x3b2f21,
              emissiveIntensity: 0.24,
              roughness: 0.16,
              metalness: 0.88,
              flatShading: true,
            });
            const dimmedCrystalMat = new THREE.MeshStandardMaterial({
              color: 0x26211e,
              emissive: 0x000000,
              roughness: 0.45,
              metalness: 0.4,
              flatShading: true,
              transparent: true,
              opacity: 0.14,
              depthWrite: false,
            });

            const completedMesh = new THREE.InstancedMesh(crystalGeo, completedMat, maxNodes);
            const alertMesh = new THREE.InstancedMesh(crystalGeo, alertMat, maxNodes);
            const inProgressMesh = new THREE.InstancedMesh(crystalGeo, inProgressMat, maxNodes);
            const notStartedMesh = new THREE.InstancedMesh(crystalGeo, notStartedMat, maxNodes);
            const dimmedMesh = new THREE.InstancedMesh(crystalGeo, dimmedCrystalMat, maxNodes);

            for (const im of [
              completedMesh,
              alertMesh,
              inProgressMesh,
              notStartedMesh,
              dimmedMesh,
            ]) {
              im.count = 0;
              im.frustumCulled = false;
              astrolabeGroup.add(im);
            }

            // Soft additive radial glow halos behind each crystal
            const haloGeo = new THREE.PlaneGeometry(0.92, 0.92);
            const haloMat = new THREE.MeshBasicMaterial({
              map: crystalHaloTex,
              color: 0xffffff,
              transparent: true,
              opacity: 0.92,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            const instancedHalos = new THREE.InstancedMesh(haloGeo, haloMat, maxNodes);
            instancedHalos.count = 0;
            instancedHalos.frustumCulled = false;
            astrolabeGroup.add(instancedHalos);

            // Generous invisible collision spheres for reliable mobile raycast taps
            const hitProxyGeo = new THREE.SphereGeometry(0.36, 8, 8);
            const hitProxyMat = new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0,
              depthWrite: false,
            });
            const instancedHitProxies = new THREE.InstancedMesh(
              hitProxyGeo,
              hitProxyMat,
              maxNodes
            );
            instancedHitProxies.count = 0;
            instancedHitProxies.frustumCulled = false;
            astrolabeGroup.add(instancedHitProxies);

            // 4. Selected Crystal Target Reticle (Dual Concentric Glowing Torus Rings)
            const reticleGroup = new THREE.Group();
            const reticleInnerMat = new THREE.MeshBasicMaterial({
              color: 0xfcd34d,
              transparent: true,
              opacity: 0.94,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const reticleOuterMat = new THREE.MeshBasicMaterial({
              color: 0xf59e0b,
              transparent: true,
              opacity: 0.68,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const reticleInnerRing = new THREE.Mesh(
              new THREE.TorusGeometry(0.32, 0.012, 10, 48),
              reticleInnerMat
            );
            const reticleOuterRing = new THREE.Mesh(
              new THREE.TorusGeometry(0.42, 0.007, 8, 56),
              reticleOuterMat
            );
            reticleGroup.add(reticleInnerRing, reticleOuterRing);
            reticleGroup.visible = false;
            astrolabeGroup.add(reticleGroup);

            // 5. Sparse Drifting Golden Space Dust (soft circular additive sprite, zero square gl_Points)
            const dustCount = resolution.resolvedQuality === 'lite' ? 65 : 130;
            const dustPos = new Float32Array(dustCount * 3);
            for (let i = 0; i < dustCount; i++) {
              const theta = (i / dustCount) * Math.PI * 2 + (i % 13) * 0.23;
              const phi = (((i * 29) % 100) / 100 - 0.5) * Math.PI * 0.72;
              const r = 3.4 + ((i * 53) % 100) * 0.036;
              dustPos[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
              dustPos[i * 3 + 1] = Math.sin(phi) * r * 0.66;
              dustPos[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;
            }
            const dustGeo = new THREE.BufferGeometry();
            dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
            const dustMat = new THREE.PointsMaterial({
              map: dustSpriteTex,
              color: 0xfde68a,
              size: 0.14,
              transparent: true,
              opacity: 0.42,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              sizeAttenuation: true,
            });
            const dustPoints = new THREE.Points(dustGeo, dustMat);
            astrolabeGroup.add(dustPoints);

            // Pre-allocated zero-GC math scratch objects
            const dummyMat = new THREE.Matrix4();
            const dummyPos = new THREE.Vector3();
            const dummyQuat = new THREE.Quaternion();
            const dummyEuler = new THREE.Euler();
            const dummyScale = new THREE.Vector3();
            const invRotY = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            const cColor = new THREE.Color();
            const haloColor = new THREE.Color();

            const goldGlow = new THREE.Color('#FCD34D');
            const alertGlow = new THREE.Color('#FB7185');
            const amberGlow = new THREE.Color('#F59E0B');
            const obsidianGlow = new THREE.Color('#5C4B33');
            const dimmedHalo = new THREE.Color('#090807');
            const smokedRing = new THREE.Color('#1B1917');
            const brightGold = new THREE.Color('#FDE68A');

            const syncAstrolabe = (dt: number, elapsed: number) => {
              const curLayout = layoutRef.current;
              const nodes = curLayout.nodes;
              const subFilter = activeSubjectIdRef.current;
              const activeIdx = selectedNodeIdxRef.current;

              invRotY.setFromAxisAngle(yAxis, -astrolabeGroup.rotation.y);
              const billboardQuat = invRotY.multiply(camera.quaternion);
              const damp = 1 - Math.exp(-6.5 * dt);

              // Smooth subject filter emphasis on champagne-gold rings
              for (const r of builtRings) {
                const isFocused = subFilter === 'all' || r.subjectId === subFilter;
                const targetTrackOp = isFocused
                  ? subFilter === 'all'
                    ? r.baseOpacity
                    : 0.78
                  : 0.07;
                const targetHairOp = isFocused
                  ? subFilter === 'all'
                    ? r.baseOpacity * 0.42
                    : 0.36
                  : 0.025;

                r.trackMat.opacity += (targetTrackOp - r.trackMat.opacity) * damp;
                r.hairlineMat.opacity += (targetHairOp - r.hairlineMat.opacity) * damp;

                cColor.copy(r.baseColor);
                if (!isFocused) {
                  cColor.lerp(smokedRing, 0.8);
                } else if (subFilter !== 'all') {
                  cColor.lerp(brightGold, 0.35);
                }
                r.trackMat.color.lerp(cColor, damp);
                r.trackMat.emissive
                  .copy(cColor)
                  .multiplyScalar(isFocused ? (subFilter === 'all' ? 0.32 : 0.72) : 0.02);
              }

              let cCount = 0;
              let aCount = 0;
              let ipCount = 0;
              let nsCount = 0;
              let dCount = 0;

              // Preview ghost crystals when 0 chapters exist
              if (nodes.length === 0) {
                reticleGroup.visible = false;
                const previewPerRing = 5;
                const totalPreview = Math.min(maxNodes, builtRings.length * previewPerRing);
                instancedHalos.count = totalPreview;
                instancedHitProxies.count = 0;

                let idx = 0;
                for (let rIdx = 0; rIdx < builtRings.length; rIdx++) {
                  const ring = builtRings[rIdx];
                  for (let k = 0; k < previewPerRing && idx < totalPreview; k++) {
                    const ang = (k / previewPerRing) * Math.PI * 2 + rIdx * 0.7;
                    const lx = Math.cos(ang) * ring.radius;
                    const lz = Math.sin(ang) * ring.radius;
                    const cz = Math.cos(ring.tiltZ);
                    const sz = Math.sin(ring.tiltZ);
                    const x1 = lx * cz;
                    const y1 = lx * sz;
                    const cx = Math.cos(ring.tiltX);
                    const sx = Math.sin(ring.tiltX);
                    dummyPos.set(x1, y1 * cx - lz * sx, y1 * sx + lz * cx);

                    const breathe = 0.86 + Math.sin(elapsed * 1.4 + idx) * 0.06;
                    dummyEuler.set(elapsed * 0.22 + idx, elapsed * 0.45 + idx, 0.25);
                    dummyQuat.setFromEuler(dummyEuler);
                    dummyScale.setScalar(breathe);
                    dummyMat.compose(dummyPos, dummyQuat, dummyScale);

                    if (idx % 3 === 0) {
                      completedMesh.setMatrixAt(cCount++, dummyMat);
                      haloColor.copy(goldGlow).multiplyScalar(0.55);
                    } else if (idx % 3 === 1) {
                      inProgressMesh.setMatrixAt(ipCount++, dummyMat);
                      haloColor.copy(amberGlow).multiplyScalar(0.45);
                    } else {
                      notStartedMesh.setMatrixAt(nsCount++, dummyMat);
                      haloColor.copy(obsidianGlow).multiplyScalar(0.5);
                    }

                    dummyScale.setScalar(breathe * 1.15);
                    dummyMat.compose(dummyPos, billboardQuat, dummyScale);
                    instancedHalos.setMatrixAt(idx, dummyMat);
                    instancedHalos.setColorAt(idx, haloColor);
                    idx += 1;
                  }
                }
                completedMesh.count = cCount;
                alertMesh.count = aCount;
                inProgressMesh.count = ipCount;
                notStartedMesh.count = nsCount;
                dimmedMesh.count = dCount;

                completedMesh.instanceMatrix.needsUpdate = true;
                inProgressMesh.instanceMatrix.needsUpdate = true;
                notStartedMesh.instanceMatrix.needsUpdate = true;
                instancedHalos.instanceMatrix.needsUpdate = true;
                if (instancedHalos.instanceColor) instancedHalos.instanceColor.needsUpdate = true;
                return;
              }

              const count = Math.min(maxNodes, nodes.length);
              instancedHalos.count = count;
              instancedHitProxies.count = count;

              let reticlePlaced = false;

              for (let i = 0; i < count; i++) {
                const n = nodes[i];
                const isMatch = subFilter === 'all' || n.subject.id === subFilter;
                dummyPos.set(n.worldPosition[0], n.worldPosition[1], n.worldPosition[2]);

                let sc = n.baseScale * (isMatch ? 1.0 : 0.52);
                let haloSc = n.baseScale * (isMatch ? 1.12 : 0.28);

                if (n.visualState === 'completed') {
                  haloSc *= isMatch ? 1.38 : 0.25;
                  haloColor.copy(goldGlow);
                } else if (n.visualState === 'alert') {
                  const pulse = 1 + Math.sin(elapsed * 3.8 + i * 0.9) * 0.16;
                  if (isMatch) {
                    sc *= pulse;
                    haloSc *= pulse * 1.48;
                  }
                  haloColor.copy(alertGlow);
                } else if (n.visualState === 'inProgress') {
                  haloSc *= isMatch ? 1.14 : 0.25;
                  haloColor.copy(amberGlow);
                } else {
                  haloSc *= isMatch ? 0.56 : 0.16;
                  haloColor.copy(obsidianGlow);
                }

                if (!isMatch) {
                  haloColor.copy(dimmedHalo);
                }

                if (activeIdx === i) {
                  sc *= 1.24;
                  haloSc *= 1.32;
                  reticleGroup.visible = true;
                  reticleGroup.position.copy(dummyPos);
                  reticleInnerRing.rotation.x = Math.PI * 0.26 + elapsed * 0.62;
                  reticleInnerRing.rotation.y = elapsed * 0.85;
                  reticleOuterRing.rotation.x = -Math.PI * 0.34 - elapsed * 0.44;
                  reticleOuterRing.rotation.y = -elapsed * 0.6;
                  const isAlertNode = n.visualState === 'alert';
                  reticleInnerMat.color.copy(isAlertNode ? alertGlow : goldGlow);
                  reticleOuterMat.color.copy(isAlertNode ? alertGlow : amberGlow);
                  reticlePlaced = true;
                }

                // Sculptural tumbling facet spin per crystal
                dummyEuler.set(
                  elapsed * 0.24 + i * 0.41,
                  elapsed * 0.52 + i * 0.67,
                  0.28 + (i % 5) * 0.12
                );
                dummyQuat.setFromEuler(dummyEuler);
                dummyScale.setScalar(sc);
                dummyMat.compose(dummyPos, dummyQuat, dummyScale);

                if (!isMatch) {
                  dimmedMesh.setMatrixAt(dCount++, dummyMat);
                } else if (n.visualState === 'completed') {
                  completedMesh.setMatrixAt(cCount++, dummyMat);
                } else if (n.visualState === 'alert') {
                  alertMesh.setMatrixAt(aCount++, dummyMat);
                } else if (n.visualState === 'inProgress') {
                  inProgressMesh.setMatrixAt(ipCount++, dummyMat);
                } else {
                  notStartedMesh.setMatrixAt(nsCount++, dummyMat);
                }

                // Generous hit proxy sphere for mobile touch selection
                dummyScale.setScalar(isMatch ? 1.05 : 0.36);
                dummyMat.compose(dummyPos, dummyQuat.set(0, 0, 0, 1), dummyScale);
                instancedHitProxies.setMatrixAt(i, dummyMat);

                dummyScale.setScalar(haloSc);
                dummyMat.compose(dummyPos, billboardQuat, dummyScale);
                instancedHalos.setMatrixAt(i, dummyMat);
                instancedHalos.setColorAt(i, haloColor);
              }

              if (!reticlePlaced) {
                reticleGroup.visible = false;
              }

              completedMesh.count = cCount;
              alertMesh.count = aCount;
              inProgressMesh.count = ipCount;
              notStartedMesh.count = nsCount;
              dimmedMesh.count = dCount;

              completedMesh.instanceMatrix.needsUpdate = true;
              alertMesh.instanceMatrix.needsUpdate = true;
              inProgressMesh.instanceMatrix.needsUpdate = true;
              notStartedMesh.instanceMatrix.needsUpdate = true;
              dimmedMesh.instanceMatrix.needsUpdate = true;
              instancedHalos.instanceMatrix.needsUpdate = true;
              instancedHitProxies.instanceMatrix.needsUpdate = true;
              if (instancedHalos.instanceColor) instancedHalos.instanceColor.needsUpdate = true;
            };

            // Aspect-aware camera framing so outer rings span ~82% viewport width cleanly on mobile & desktop
            const computeDefaultRadius = (w = ctx.width, h = ctx.height) => {
              const aspect = Math.max(0.45, w / Math.max(1, h));
              const tanHalfV = Math.tan((42 * Math.PI) / 360);
              const tanHalfH = tanHalfV * aspect;
              const boundingR = layoutRef.current.maxRadius + 0.36;
              const distH = boundingR / (0.84 * tanHalfH);
              const distV = (boundingR * 0.8) / (0.64 * tanHalfV);
              return Math.max(7.8, distH, distV);
            };

            let defaultRadius = computeDefaultRadius();
            let userZoomed = false;
            let azimuth = 0.3;
            let targetAzimuth = 0.3;
            let radius = defaultRadius;
            let targetRadius = defaultRadius;
            let polar = 1.08;
            let targetPolar = 1.08;
            // Subtle optical Y offset keeps Astrolabe optically centered between top pills & bottom card
            const lookTarget = new THREE.Vector3(0, 0.06, 0);
            const desiredLookTarget = new THREE.Vector3(0, 0.06, 0);

            const clampRadius = (val: number) => {
              const minR = Math.max(5.2, defaultRadius * 0.54);
              const maxR = Math.max(16.0, defaultRadius * 1.45);
              return Math.max(minR, Math.min(maxR, val));
            };

            focusSubjectRef.current = (subId: string) => {
              userZoomed = false;
              if (subId === 'all') {
                desiredLookTarget.set(0, 0.06, 0);
                targetRadius = computeDefaultRadius();
                targetPolar = 1.08;
              } else {
                const ring = layoutRef.current.ringBySubjectId.get(subId);
                if (ring) {
                  desiredLookTarget.set(0, 0.06, 0);
                  const aspect = Math.max(0.45, ctx.width / Math.max(1, ctx.height));
                  const tanHalfV = Math.tan((42 * Math.PI) / 360);
                  const ringBound = ring.radius + 0.5;
                  const ringDistH = ringBound / (0.82 * tanHalfV * aspect);
                  const ringDistV = (ringBound * 0.8) / (0.64 * tanHalfV);
                  targetRadius = clampRadius(
                    Math.max(defaultRadius * 0.78, 6.8, ringDistH, ringDistV)
                  );
                  targetPolar = Math.max(0.76, Math.min(1.26, 1.02 - ring.tiltX * 0.35));
                }
              }
            };

            resetCameraRef.current = () => {
              userZoomed = false;
              defaultRadius = computeDefaultRadius();
              desiredLookTarget.set(0, 0.06, 0);
              targetRadius = defaultRadius;
              targetPolar = 1.08;
              targetAzimuth = 0.3;
              ctx.requestRender();
            };

            syncAstrolabe(0.016, 0);

            const activePointers = new Map<number, { x: number; y: number }>();
            let prevPinchDist: number | null = null;
            let isDragging = false;
            let dragMoved = false;
            let downX = 0;
            let downY = 0;
            let velAzimuth = 0;
            let velPolar = 0;

            const raycaster = new THREE.Raycaster();
            const pointerNdc = new THREE.Vector2();

            const pickNode = (clientX: number, clientY: number): number | null => {
              if (layoutRef.current.nodes.length === 0 || instancedHitProxies.count === 0) {
                return null;
              }
              const rect = canvas.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return null;
              pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
              pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointerNdc, camera);
              const hits = raycaster.intersectObject(instancedHitProxies, false);
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
              velAzimuth = 0;
              velPolar = 0;
            };

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
                  userZoomed = true;
                  targetRadius = clampRadius(targetRadius + delta * 0.025);
                  ctx.requestRender();
                }
                prevPinchDist = dist;
                return;
              }

              if (!isDragging) return;
              const dx = e.clientX - downX;
              const dy = e.clientY - downY;
              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
              downX = e.clientX;
              downY = e.clientY;
              velAzimuth = dx * 0.0065;
              velPolar = -dy * 0.0045;
              targetAzimuth += velAzimuth;
              targetPolar = Math.max(0.5, Math.min(1.46, targetPolar + velPolar));
              ctx.requestRender();
            };

            const onPointerUp = (e: PointerEvent) => {
              activePointers.delete(e.pointerId);
              if (activePointers.size < 2) {
                prevPinchDist = null;
              }
              if (isDragging && !dragMoved) {
                const idx = pickNode(e.clientX, e.clientY);
                if (idx !== null) {
                  selectedNodeIdxRef.current = idx;
                  setSelectedNodeIdx(idx);
                  ctx.requestRender();
                }
              }
              isDragging = false;
            };

            const onWheel = (e: WheelEvent) => {
              if (!e.ctrlKey && Math.abs(e.deltaY) < 4) return;
              e.preventDefault();
              userZoomed = true;
              targetRadius = clampRadius(targetRadius + e.deltaY * 0.0055);
              ctx.requestRender();
            };

            canvas.addEventListener('pointerdown', onPointerDown);
            canvas.addEventListener('wheel', onWheel, { passive: false });
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp, { passive: true });
            window.addEventListener('pointercancel', onPointerUp, { passive: true });

            return {
              onResize: (w, h) => {
                defaultRadius = computeDefaultRadius(w, h);
                if (!userZoomed && activeSubjectIdRef.current === 'all') {
                  targetRadius = defaultRadius;
                }
              },
              onTick: (dt, elapsed) => {
                if (!isDragging) {
                  if (Math.abs(velAzimuth) > 0.0002 || Math.abs(velPolar) > 0.0002) {
                    targetAzimuth += velAzimuth;
                    targetPolar = Math.max(0.5, Math.min(1.46, targetPolar + velPolar));
                    const decay = Math.exp(-5.5 * dt);
                    velAzimuth *= decay;
                    velPolar *= decay;
                  } else if (!resolution.isSoftwareGl && !ambientPausedRef.current) {
                    targetAzimuth += dt * 0.062;
                  }
                }

                const damp = 1 - Math.exp(-5.5 * dt);
                azimuth += (targetAzimuth - azimuth) * damp;
                polar += (targetPolar - polar) * damp;
                radius += (targetRadius - radius) * damp;
                lookTarget.lerp(desiredLookTarget, damp);

                astrolabeGroup.rotation.y = azimuth;
                coreSunUniforms.uTime.value = elapsed;

                if (!ambientPausedRef.current) {
                  coreWireframe.rotation.y += dt * 0.14;
                  coreWireframe.rotation.x += dt * 0.07;
                  dustPoints.rotation.y = -elapsed * 0.018;
                }

                camera.position.set(
                  lookTarget.x,
                  lookTarget.y + radius * Math.cos(polar),
                  lookTarget.z + radius * Math.sin(polar)
                );
                camera.lookAt(lookTarget);

                syncAstrolabe(dt, elapsed);

                if (
                  lookTarget.distanceTo(desiredLookTarget) > 0.01 ||
                  Math.abs(targetRadius - radius) > 0.01 ||
                  Math.abs(targetAzimuth - azimuth) > 0.002 ||
                  Math.abs(velAzimuth) > 0.0004
                ) {
                  ctx.requestRender();
                }
              },
              onDispose: () => {
                isDisposed = true;
                sceneCtxRef.current = null;
                focusSubjectRef.current = null;
                rebuildRingsRef.current = null;
                resetCameraRef.current = null;
                canvas.removeEventListener('pointerdown', onPointerDown);
                canvas.removeEventListener('wheel', onWheel);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                disposeBuiltRings();
                coreCoronaTex.dispose();
                crystalHaloTex.dispose();
                dustSpriteTex.dispose();
                scene.environment = null;
                envRenderTarget?.dispose();
                envRenderTarget = null;
              },
            };
          }}
        />
      </div>

      {/* Floating Top UI Overlay (Subject Filter Pills, Pause/Reset Controls & Static Legend) */}
      <div className="dh-astrolabe-top-overlay">
        <div className="flex items-center justify-between gap-2">
          <div
            className="dh-scroll-chips pointer-events-auto flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
            role="group"
            aria-label="Focus astrolabe orbital ring by subject"
          >
            {onSelectSubjectFilter && activeSubjects.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => onSelectSubjectFilter('all')}
                  aria-pressed={activeSubjectId === 'all'}
                  className={`dh-astrolabe-pill ${activeSubjectId === 'all' ? 'active' : ''}`}
                >
                  All
                </button>
                {activeSubjects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectSubjectFilter(s.id)}
                    aria-pressed={activeSubjectId === s.id}
                    className={`dh-astrolabe-pill ${activeSubjectId === s.id ? 'active' : ''}`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: s.color || '#F5C451' }}
                      aria-hidden="true"
                    />
                    <span>{s.name}</span>
                  </button>
                ))}
              </>
            ) : (
              <span className="text-[14px] font-semibold text-[#F8FAFC]">
                Syllabus astrolabe
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAmbientPaused((v) => !v)}
              aria-label={ambientPaused ? 'Resume astrolabe orbit' : 'Pause astrolabe orbit'}
              aria-pressed={ambientPaused}
              title={ambientPaused ? 'Resume orbit' : 'Pause orbit'}
              className="dh-astrolabe-icon-btn"
            >
              {ambientPaused ? <Play size={15} strokeWidth={1.75} /> : <Pause size={15} strokeWidth={1.75} />}
            </button>
            <button
              type="button"
              onClick={() => resetCameraRef.current?.()}
              aria-label="Reset astrolabe view"
              title="Reset view"
              className="dh-astrolabe-icon-btn"
            >
              <RotateCcw size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Compact Static Status Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#CBD5E1]/75">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#FCD34D]" aria-hidden="true" />
            <span>Completed</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#FB7185]" aria-hidden="true" />
            <span>Revision due</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full border border-[#94A3B8]/60 bg-[#1C1917]"
              aria-hidden="true"
            />
            <span>Not started</span>
          </span>
        </div>
      </div>

      {/* Empty-State Calibration CTA when 0 chapters exist */}
      {chapters.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center p-5 text-center">
          <div className="pointer-events-auto max-w-xs space-y-2.5 rounded-2xl border border-white/12 bg-[#0E0F13]/88 p-4">
            <p className="text-[14px] font-semibold text-[#F8FAFC]">
              Add chapters to calibrate your astrolabe
            </p>
            <p className="text-[13px] text-[#94A3B8]">
              Each chapter mounts onto its subject&apos;s orbital track and ignites gold as you master it.
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

      {/* Floating Bottom Chapter Detail Card */}
      {selectedNode && selectedStatusMeta && (
        <div className="dh-astrolabe-bottom-overlay">
          <div
            role="status"
            aria-live="polite"
            className="dh-astrolabe-chapter-bar"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: selectedStatusMeta.dotColor }}
                  aria-hidden="true"
                />
                <strong className="truncate text-[14px] font-semibold text-[#F8FAFC]">
                  {selectedNode.chapter.name}
                </strong>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#94A3B8]">
                <span
                  className="shrink-0 rounded-full border px-2 py-0.5 text-[13px] font-medium leading-tight"
                  style={{
                    background: selectedStatusMeta.badgeBg,
                    borderColor: selectedStatusMeta.badgeBorder,
                    color: selectedStatusMeta.badgeText,
                  }}
                >
                  {selectedStatusMeta.label}
                </span>
                <span className="truncate">
                  {selectedNode.subject.e} {selectedNode.subject.name}
                </span>
                <span
                  className="inline-flex items-center gap-1"
                  aria-label={`Confidence ${selectedConfidence} of 5`}
                >
                  {[1, 2, 3, 4, 5].map((dot) => (
                    <span
                      key={dot}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        background:
                          dot <= selectedConfidence
                            ? selectedNode.visualState === 'alert'
                              ? '#FB7185'
                              : '#F5C451'
                            : 'rgba(255, 255, 255, 0.16)',
                      }}
                      aria-hidden="true"
                    />
                  ))}
                  <span className="tnum ml-0.5 text-[13px] text-[#CBD5E1]/80">
                    {selectedConfidence}/5
                  </span>
                </span>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="shrink-0"
              icon={<Play size={13} />}
              onClick={() => onSelectChapter(selectedNode.chapter)}
            >
              Focus
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
