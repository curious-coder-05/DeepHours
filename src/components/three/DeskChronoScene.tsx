import React, { memo, useEffect, useRef, useState } from 'react';
import type { DeskSculptureKind } from '../../utils/deskModeHelpers';
import {
  resolveRuntimeUi3d,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface DeskBatteryStatus {
  level: number;
  charging: boolean;
}

export interface DeskChronoSceneProps {
  sculpture: DeskSculptureKind;
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  isRunning: boolean;
  isPaused: boolean;
  nightDim?: boolean;
  battery?: DeskBatteryStatus | null;
  simLandscape?: boolean;
  stageRef?: React.RefObject<HTMLDivElement | null>;
}

export const DESK_NIGHT_DIM_FACTOR = 0.45;

/**
 * Battery-aware 3D frame pacing resolver:
 * - Unplugged (< 20%) + Night Dim ON -> 20 fps
 * - Unplugged (< 20%) + Normal       -> 30 fps
 * - Charging, >= 20%, or unavailable -> null (normal native RAF pacing)
 */
export function resolveDeskTargetFps(
  battery: DeskBatteryStatus | null | undefined,
  nightDim: boolean
): number | null {
  if (!battery || battery.charging) return null;
  if (!Number.isFinite(battery.level) || battery.level >= 0.2) return null;
  return nightDim ? 20 : 30;
}

type ThreeModule = typeof import('three');

interface SculptureRigController {
  root: import('three').Group;
  update: (dt: number, isRunning: boolean, isPaused: boolean, dimFactor: number) => void;
  disposeExtra?: () => void;
}

interface EnvPanelSpec {
  readonly pos: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly color: number;
  readonly boost?: number;
  readonly roll?: number;
}

interface StudioLightSpec {
  readonly color: number;
  readonly intensity: number;
  readonly pos: readonly [number, number, number];
}

const ENV_STRIPS = {
  monolith: {
    // High-contrast crisp white + warm Rose Copper specular reflection cards on pure 0x000000 black
    panels: [
      { pos: [1.8, 7.2, 5.5], scale: [7.5, 3.0, 1], color: 0xffffff, boost: 2.3, roll: -0.15 },
      { pos: [6.5, -2.0, 4.8], scale: [6.5, 3.8, 1], color: 0xf2b598, boost: 2.1, roll: 0.2 },
      { pos: [-6.5, 2.5, 4.2], scale: [5.8, 3.2, 1], color: 0xe39b7d, boost: 2.0, roll: -0.1 },
      { pos: [4.8, 3.2, 6.2], scale: [4.8, 2.6, 1], color: 0xffe9dc, boost: 1.8, roll: 0.12 },
      { pos: [-2.4, -6.5, 4.2], scale: [6.0, 2.8, 1], color: 0xb86a4c, boost: 1.7, roll: 0.18 },
      { pos: [0, 4.2, -6.5], scale: [6.5, 2.8, 1], color: 0xffe8da, boost: 1.6, roll: 0 },
    ] as readonly EnvPanelSpec[],
    lights: [
      { color: 0xfff8f2, intensity: 3.4, pos: [4, 7, 6] as [number, number, number] },
      { color: 0xe89b79, intensity: 3.0, pos: [6, -4, 4] as [number, number, number] },
      { color: 0xd48a6a, intensity: 2.2, pos: [-6, 2, -4] as [number, number, number] },
    ] as readonly StudioLightSpec[],
  },
  'kinetic-wave': {
    // High-contrast studio strip softboxes aligned with the 22-rib reflection vectors on pure 0x000000 black
    panels: [
      { pos: [8.5, -1.2, 2.2], scale: [5.5, 9.5, 1], color: 0xe4ecf8, boost: 2.0, roll: -0.18 },
      { pos: [5.2, 6.8, 5.2], scale: [11.5, 2.6, 1], color: 0xffffff, boost: 2.6, roll: -0.25 },
      { pos: [-6.5, 4.5, 4.8], scale: [9.5, 2.4, 1], color: 0xdce6f5, boost: 2.1, roll: 0.22 },
      { pos: [0.5, -7.2, 4.6], scale: [10.5, 2.2, 1], color: 0xc8d4e6, boost: 1.85, roll: 0 },
      { pos: [-7.0, -3.5, 2.8], scale: [6.2, 4.2, 1], color: 0x7b8ca8, boost: 1.45, roll: 0.15 },
      { pos: [2.0, 8.0, -2.5], scale: [9.0, 2.2, 1], color: 0xfffaf2, boost: 1.9, roll: 0 },
    ] as readonly EnvPanelSpec[],
    lights: [
      { color: 0xffffff, intensity: 3.6, pos: [5, 7, 6] as [number, number, number] },
      { color: 0xe4e8f0, intensity: 2.8, pos: [-6, -2, 4] as [number, number, number] },
      { color: 0xf7f2eb, intensity: 2.4, pos: [0, 6, -5] as [number, number, number] },
    ] as readonly StudioLightSpec[],
  },
} as const;

/**
 * High-contrast studio strip PMREM builder on pure 0x000000 black (sigma = 0.02, zero ambient wash).
 * Every strip softbox aims directly at the origin (`lookAt(0, 0, 0)`) with HDR radiance boost.
 * Immediately disposes temporary plane geometry, panel materials, and PMREMGenerator.
 */
function buildStudioEnv(
  THREE: ThreeModule,
  renderer: import('three').WebGLRenderer,
  panels: readonly EnvPanelSpec[]
): import('three').WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x000000);

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const mats: import('three').Material[] = [];
  for (const s of panels) {
    const hdrColor = new THREE.Color(s.color).multiplyScalar(s.boost ?? 1.0);
    const mat = new THREE.MeshBasicMaterial({ color: hdrColor, side: THREE.DoubleSide });
    mats.push(mat);
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    mesh.lookAt(0, 0, 0);
    if (s.roll) {
      mesh.rotateZ(s.roll);
    }
    mesh.scale.set(s.scale[0], s.scale[1], s.scale[2]);
    envScene.add(mesh);
  }

  const rt = pmrem.fromScene(envScene, 0.02);
  planeGeo.dispose();
  mats.forEach((m) => m.dispose());
  pmrem.dispose();
  return rt;
}

/**
 * Recursively disposes every geometry, material, and material texture inside a Three.js Object3D tree.
 */
function disposeObjectTree(root: import('three').Object3D): void {
  const disposedGeometries = new Set<import('three').BufferGeometry>();
  const disposedMaterials = new Set<import('three').Material>();
  const disposedTextures = new Set<import('three').Texture>();

  const disposeMaterial = (mat: import('three').Material) => {
    if (disposedMaterials.has(mat)) return;
    disposedMaterials.add(mat);
    const record = mat as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key] as { isTexture?: boolean; dispose?: () => void } | null;
      if (
        value &&
        typeof value === 'object' &&
        value.isTexture &&
        typeof value.dispose === 'function' &&
        !disposedTextures.has(value as import('three').Texture)
      ) {
        disposedTextures.add(value as import('three').Texture);
        value.dispose();
      }
    }
    mat.dispose();
  };

  root.traverse((obj) => {
    const mesh = obj as import('three').Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      if (!disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry);
        mesh.geometry.dispose();
      }
    }
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m) disposeMaterial(m);
      }
    } else if (mat) {
      disposeMaterial(mat);
    }
  });
}

/**
 * Sculpture A (`monolith` — Mirror-Faceted Rose Copper Obsidian Crystal with Soft Recessed Glow):
 * Glossy 80-face (`detail = 1`) smoked obsidian crystal + fine Rose Copper facet wireframe +
 * soft feathered CanvasTexture radial ember glow sprite + tiny deep faceted nucleus (0.30).
 */
function buildMonolithSculpture(THREE: ThreeModule): SculptureRigController {
  const root = new THREE.Group();

  // 1. Glossy flat-shaded obsidian geodesic crystal (80 triangular facets)
  const shellGeo = new THREE.IcosahedronGeometry(1.48, 1);
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0x0e0a09,
    metalness: 0.88,
    roughness: 0.12,
    flatShading: true,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 3.1,
    side: THREE.FrontSide,
  });
  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.rotation.set(0.24, 0.42, 0);
  root.add(shellMesh);

  // 2. Fine Rose Copper facet wireframe hugging the crystal
  const wireGeo = new THREE.EdgesGeometry(shellGeo, 1);
  const wireMat = new THREE.LineBasicMaterial({
    color: 0xd99b82,
    transparent: true,
    opacity: 0.52,
  });
  const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
  wireMesh.scale.setScalar(1.003);
  wireMesh.rotation.copy(shellMesh.rotation);
  root.add(wireMesh);

  // 3. Soft feathered internal copper ember glow (CanvasTexture radial gradient -> ZERO hard circle edge)
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 128;
  glowCanvas.height = 128;
  const gctx = glowCanvas.getContext('2d');
  if (gctx) {
    const grad = gctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(232, 148, 108, 0.58)');
    grad.addColorStop(0.35, 'rgba(182, 92, 58, 0.24)');
    grad.addColorStop(0.7, 'rgba(95, 42, 24, 0.06)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
  }
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.set(1.55, 1.55, 1);
  root.add(glowSprite);

  // 4. Tiny deep faceted nucleus (radius 0.30) + subtle warm internal point light
  const coreGeo = new THREE.IcosahedronGeometry(0.3, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x3b1d14,
    emissive: 0xc26c48,
    emissiveIntensity: 0.85,
    roughness: 0.3,
    metalness: 0.4,
    flatShading: true,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  root.add(coreMesh);

  const coreLight = new THREE.PointLight(0xe69570, 2.2, 4.5);
  root.add(coreLight);

  let elapsed = 0;

  return {
    root,
    update: (dt: number, isRunning: boolean, isPaused: boolean, dimFactor: number) => {
      const active = isRunning && !isPaused;
      const speed = active ? 1 : 0.2;
      elapsed += dt;
      shellMesh.rotation.y += dt * 0.18 * speed;
      shellMesh.rotation.x += dt * 0.07 * speed;
      wireMesh.rotation.copy(shellMesh.rotation);
      coreMesh.rotation.y -= dt * 0.16 * speed;
      coreMesh.rotation.x += dt * 0.08 * speed;
      const pulse = active ? 0.85 + Math.sin(elapsed * 1.25) * 0.22 : 0.55;
      shellMat.envMapIntensity = 3.1 * dimFactor;
      wireMat.opacity = 0.52 * dimFactor;
      glowMat.opacity = pulse * dimFactor;
      coreMat.emissiveIntensity = pulse * dimFactor;
      coreLight.intensity = pulse * 2.2 * dimFactor;
    },
    disposeExtra: () => {
      glowTex.dispose();
      glowMat.dispose();
    },
  };
}

/**
 * Sculpture B (`kinetic-wave` — Razor-Thin High-Contrast Obsidian Steel 22-Rib Horizontal-Diagonal Coil):
 * 22 razor-thin (`0.045` wall) hollow rounded-square dark obsidian-steel loops sweeping sleekly
 * upper-left to lower-right (~1.7:1 horizontal ratio).
 */
function buildKineticWaveSculpture(THREE: ThreeModule): SculptureRigController {
  const createRoundedSquarePath = (half: number, radius: number, isHole: boolean) => {
    const p = isHole ? new THREE.Path() : new THREE.Shape();
    const r = Math.min(radius, half * 0.9);
    p.moveTo(-half + r, -half);
    p.lineTo(half - r, -half);
    p.quadraticCurveTo(half, -half, half, -half + r);
    p.lineTo(half, half - r);
    p.quadraticCurveTo(half, half, half - r, half);
    p.lineTo(-half + r, half);
    p.quadraticCurveTo(-half, half, -half, half - r);
    p.lineTo(-half, -half + r);
    p.quadraticCurveTo(-half, -half, -half + r, -half);
    return p;
  };

  // Razor-thin precision frame (0.045 wall thickness)
  const ribShape = createRoundedSquarePath(0.72, 0.24, false) as import('three').Shape;
  ribShape.holes.push(createRoundedSquarePath(0.675, 0.205, true));

  const ribGeo = new THREE.ExtrudeGeometry(ribShape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.011,
    bevelSegments: 2,
    curveSegments: 18,
  });
  ribGeo.center();

  const ribMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a4350,
    metalness: 0.92,
    roughness: 0.22,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
    envMapIntensity: 2.9,
  });

  const root = new THREE.Group();
  // Sleek horizontal-diagonal sweep (upper-left to lower-right, wider than tall)
  root.rotation.set(0.24, 0.78, -0.22);

  const RIB_COUNT = 22;
  const SPACING = 0.138;
  const ribs: import('three').Mesh[] = [];
  for (let i = 0; i < RIB_COUNT; i++) {
    const u = i / (RIB_COUNT - 1) - 0.5;
    const mesh = new THREE.Mesh(ribGeo, ribMat);
    mesh.position.z = u * (RIB_COUNT - 1) * SPACING;
    const taper = 0.82 + 0.18 * Math.cos(u * Math.PI);
    mesh.scale.setScalar(taper);
    root.add(mesh);
    ribs.push(mesh);
  }

  let phase = 0.8;

  const applyPhase = (curPhase: number) => {
    for (let i = 0; i < ribs.length; i++) {
      ribs[i].rotation.z = i * 0.16 + Math.sin(curPhase * 0.95 - i * 0.24) * 0.36;
      ribs[i].position.y = Math.sin(curPhase * 1.15 - i * 0.26) * 0.1;
    }
  };
  applyPhase(phase);

  return {
    root,
    update: (dt: number, isRunning: boolean, isPaused: boolean, dimFactor: number) => {
      const active = isRunning && !isPaused;
      phase += dt * (active ? 1.0 : 0.18);
      applyPhase(phase);
      ribMat.envMapIntensity = 2.9 * dimFactor;
    },
  };
}

interface PersistentEngineHandle {
  swapSculpture: (kind: DeskSculptureKind) => void;
  syncViewport: () => void;
}

/**
 * StandBy Desk Mode Procedural 3D Sculpture Renderer (v45).
 * Initializes WebGLRenderer, PerspectiveCamera, ResizeObserver, and the render loop ONCE on mount,
 * and hot-swaps sculptures synchronously in-place (`useEffect([sculpture])`) with ZERO blank flash.
 *
 * Performance & Lifecycle Guardrails:
 * - Zero React re-renders on 1-second timer ticks (live running/paused via ref)
 * - Strictly lazy-loads `three` inside mount `useEffect`
 * - Zero ambient light: pure 0x000000 PMREM strip softboxes (sigma = 0.02) for jet-black shadows
 * - Caps pixel ratio at `Math.min(window.devicePixelRatio || 1, 2)` (1 on software WebGL)
 * - Observes inner active Desk Mode stage (`clientWidth x clientHeight`) via ResizeObserver
 * - Pauses render loop when `document.hidden === true`
 * - Paces frames via GPU fence `afterDraw()` on software WebGL so headless renders never stall
 * - Recursively disposes all geometries, materials, textures, PMREM targets, and renderer on swap/unmount
 */
export const DeskChronoScene: React.FC<DeskChronoSceneProps> = memo(
  ({
    sculpture,
    ui3dSetting = 'auto',
    ui3dQuality = 'auto',
    isRunning,
    isPaused,
    nightDim = false,
    battery = null,
    simLandscape = false,
    stageRef,
  }) => {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<PersistentEngineHandle | null>(null);
    const sculptureRef = useRef<DeskSculptureKind>(sculpture);
    sculptureRef.current = sculpture;

    const [webglFailed, setWebglFailed] = useState(false);

    // Keep live timer, Night Dim, and Battery state in propsRef so changes NEVER tear down WebGL
    const propsRef = useRef({ isRunning, isPaused, nightDim, battery });
    propsRef.current = { isRunning, isPaused, nightDim, battery };

    const resolution = resolveRuntimeUi3d(ui3dSetting, false, ui3dQuality);

    // Hot-swap sculpture synchronously inside the existing WebGL context (ZERO blank black flash)
    useEffect(() => {
      engineRef.current?.swapSculpture(sculpture);
    }, [sculpture]);

    // Sync canvas aspect smoothly when toggling CSS Simulated Landscape without tearing down WebGL
    useEffect(() => {
      const id = window.requestAnimationFrame(() => {
        engineRef.current?.syncViewport();
      });
      return () => window.cancelAnimationFrame(id);
    }, [simLandscape]);

    // Initialize WebGLRenderer, PerspectiveCamera, ResizeObserver, and RAF loop ONCE on mount
    useEffect(() => {
      if (!resolution.enabled || webglFailed) return;
      const container = mountRef.current;
      if (!container) return;
      const observedStage = stageRef?.current || container;

      let disposed = false;
      let rafId = 0;
      let timerId = 0;
      let isContextLost = false;
      let renderer: import('three').WebGLRenderer | null = null;
      let scene: import('three').Scene | null = null;
      let camera: import('three').PerspectiveCamera | null = null;
      let envRenderTarget: import('three').WebGLRenderTarget | null = null;
      let rig: SculptureRigController | null = null;
      let activeLights: Array<{
        light: import('three').DirectionalLight;
        baseIntensity: number;
      }> = [];
      let dimFactor = propsRef.current.nightDim ? DESK_NIGHT_DIM_FACTOR : 1.0;
      let resizeObserver: ResizeObserver | null = null;
      let cleanupListeners: (() => void) | null = null;

      const cancelScheduledFrame = () => {
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
        if (timerId) {
          window.clearTimeout(timerId);
          timerId = 0;
        }
      };

      const readStageSize = () => {
        const target = stageRef?.current || container;
        const w = Math.max(
          1,
          Math.floor(target.clientWidth || container.clientWidth || window.innerWidth || 800)
        );
        const h = Math.max(
          1,
          Math.floor(target.clientHeight || container.clientHeight || window.innerHeight || 360)
        );
        return { w, h };
      };

      const disposeActiveSculpture = () => {
        if (rig) {
          if (scene) {
            scene.remove(rig.root);
          }
          try {
            rig.disposeExtra?.();
          } catch {
            // ignore disposal errors
          }
          disposeObjectTree(rig.root);
          rig = null;
        }
        if (activeLights.length > 0) {
          if (scene) {
            for (const entry of activeLights) {
              scene.remove(entry.light);
            }
          }
          activeLights = [];
        }
        if (scene) {
          scene.environment = null;
        }
        if (envRenderTarget) {
          envRenderTarget.dispose();
          envRenderTarget = null;
        }
      };

      import('three')
        .then((THREE) => {
          if (disposed || !mountRef.current) return;

          const { w: initW, h: initH } = readStageSize();
          const isSoftwareGl = resolution.isSoftwareGl;

          renderer = new THREE.WebGLRenderer({
            antialias: !isSoftwareGl,
            alpha: false,
            powerPreference: 'high-performance',
          });
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.0;
          renderer.setPixelRatio(
            isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
          );
          renderer.setSize(initW, initH, false);
          renderer.setClearColor(0x000000, 1);

          const canvas = renderer.domElement;
          canvas.setAttribute('aria-hidden', 'true');
          canvas.style.display = 'block';
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.pointerEvents = 'none';

          container.replaceChildren();
          container.appendChild(canvas);

          scene = new THREE.Scene();
          scene.background = new THREE.Color(0x000000);

          camera = new THREE.PerspectiveCamera(36, initW / initH, 0.1, 100);

          const updateCameraFraming = (
            w: number,
            h: number,
            kind: 'monolith' | 'kinetic-wave'
          ) => {
            if (!camera) return;
            const aspect = Math.max(w, 1) / Math.max(h, 1);
            camera.aspect = aspect;
            const baseZ = kind === 'monolith' ? 7.6 : 7.5;
            camera.position.set(
              0,
              0,
              aspect >= 1 ? baseZ : (baseZ * 1.2) / Math.max(aspect, 0.46)
            );
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();
          };

          const canRender = () =>
            !disposed &&
            !isContextLost &&
            (typeof document === 'undefined' || !document.hidden);

          const applyLightDamping = (factor: number) => {
            for (const entry of activeLights) {
              entry.light.intensity = entry.baseIntensity * factor;
            }
          };

          const swapSculpture = (kind: DeskSculptureKind) => {
            if (disposed || !renderer || !scene || !camera) return;

            // Dispose ONLY previous sculpture group, its lights, and its PMREM target
            disposeActiveSculpture();

            // Build per-sculpture high-contrast studio strip PMREM (pure 0x000000 bg, zero ambient wash)
            const stripCfg = ENV_STRIPS[kind];
            envRenderTarget = buildStudioEnv(THREE, renderer, stripCfg.panels);
            scene.environment = envRenderTarget.texture;

            dimFactor = propsRef.current.nightDim ? DESK_NIGHT_DIM_FACTOR : 1.0;
            for (const l of stripCfg.lights) {
              const dl = new THREE.DirectionalLight(l.color, l.intensity * dimFactor);
              dl.position.set(l.pos[0], l.pos[1], l.pos[2]);
              scene.add(dl);
              activeLights.push({ light: dl, baseIntensity: l.intensity });
            }

            rig =
              kind === 'monolith'
                ? buildMonolithSculpture(THREE)
                : buildKineticWaveSculpture(THREE);
            scene.add(rig.root);

            const { w, h } = readStageSize();
            updateCameraFraming(w, h, kind);
            renderer.setSize(w, h, false);

            // Render immediately & synchronously so switching has ZERO blank black flash
            if (canRender()) {
              rig.update(
                0.016,
                propsRef.current.isRunning,
                propsRef.current.isPaused,
                dimFactor
              );
              renderer.render(scene, camera);
            }
          };

          const syncViewport = () => {
            if (disposed || !renderer || !scene || !camera) return;
            const { w, h } = readStageSize();
            updateCameraFraming(w, h, sculptureRef.current);
            renderer.setSize(w, h, false);
            if (canRender()) {
              renderer.render(scene, camera);
            }
          };

          engineRef.current = { swapSculpture, syncViewport };

          // Mount initial sculpture and render frame 0 synchronously
          swapSculpture(sculptureRef.current);

          let lastRenderTime = performance.now();

          const afterDraw = (cb: () => void) => {
            if (disposed || !renderer) return;
            const gl = renderer.getContext() as WebGL2RenderingContext | null;
            if (!gl || typeof gl.fenceSync !== 'function') {
              timerId = window.setTimeout(cb, 80);
              return;
            }
            const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
            const poll = () => {
              if (disposed) {
                if (sync) gl.deleteSync(sync);
                return;
              }
              const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
              if (status === gl.UNSIGNALED) {
                timerId = window.setTimeout(poll, 5);
              } else {
                if (sync) gl.deleteSync(sync);
                timerId = window.setTimeout(cb, 80);
              }
            };
            timerId = window.setTimeout(poll, 5);
          };

          const tick = (now: number) => {
            rafId = 0;
            if (!canRender() || !renderer || !scene || !camera || !rig) return;

            const {
              isRunning: running,
              isPaused: paused,
              nightDim: dimEnabled,
              battery: curBattery,
            } = propsRef.current;

            // Battery-aware frame-delta pacing (30fps when unplugged < 20%, 20fps if Dim is also ON)
            const targetFps = resolveDeskTargetFps(curBattery, dimEnabled);
            if (!isSoftwareGl && targetFps !== null) {
              const minFrameMs = 1000 / targetFps;
              if (now - lastRenderTime < minFrameMs - 1) {
                rafId = window.requestAnimationFrame(tick);
                return;
              }
            }

            const dt = Math.min(0.12, Math.max(0.001, (now - lastRenderTime) / 1000));
            lastRenderTime = now;

            // Smoothly damp studio strip specular & directional lights by ~55% when Night Dim is ON
            const targetDim = dimEnabled ? DESK_NIGHT_DIM_FACTOR : 1.0;
            if (Math.abs(dimFactor - targetDim) > 0.002) {
              dimFactor += (targetDim - dimFactor) * Math.min(1, dt * 8);
            } else {
              dimFactor = targetDim;
            }
            applyLightDamping(dimFactor);

            rig.update(dt, running, paused, dimFactor);
            renderer.render(scene, camera);

            if (isSoftwareGl) {
              afterDraw(() => {
                if (canRender()) {
                  tick(performance.now());
                }
              });
            } else {
              rafId = window.requestAnimationFrame(tick);
            }
          };

          const startLoop = () => {
            cancelScheduledFrame();
            if (!canRender()) return;
            lastRenderTime = performance.now();
            rafId = window.requestAnimationFrame(tick);
          };

          const handleVisibilityChange = () => {
            if (document.hidden) {
              cancelScheduledFrame();
            } else {
              startLoop();
            }
          };

          const handleContextLost = (e: Event) => {
            e.preventDefault();
            isContextLost = true;
            cancelScheduledFrame();
          };

          const handleContextRestored = () => {
            isContextLost = false;
            startLoop();
          };

          document.addEventListener('visibilitychange', handleVisibilityChange);
          canvas.addEventListener('webglcontextlost', handleContextLost, false);
          canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
          cleanupListeners = () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
          };

          if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
              syncViewport();
            });
            resizeObserver.observe(observedStage);
          }

          if (canRender()) {
            if (isSoftwareGl) {
              afterDraw(() => {
                if (canRender()) tick(performance.now());
              });
            } else {
              rafId = window.requestAnimationFrame(tick);
            }
          }
        })
        .catch(() => {
          if (!disposed) {
            setWebglFailed(true);
          }
        });

      return () => {
        disposed = true;
        engineRef.current = null;
        cancelScheduledFrame();
        resizeObserver?.disconnect();
        cleanupListeners?.();

        disposeActiveSculpture();
        if (scene) {
          scene.clear();
          scene = null;
        }
        camera = null;
        if (renderer) {
          renderer.dispose();
          renderer = null;
        }
        if (container) {
          container.replaceChildren();
        }
      };
    }, [resolution.enabled, resolution.isSoftwareGl, webglFailed, stageRef]);

    if (!resolution.enabled || webglFailed) {
      return null;
    }

    return (
      <div
        ref={mountRef}
        data-testid="desk-chrono-scene"
        data-sculpture={sculpture}
        data-running={isRunning ? 'true' : 'false'}
        className="dh-desk-chrono-host"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          background: '#000000',
          overflow: 'hidden',
        }}
      />
    );
  }
);

DeskChronoScene.displayName = 'DeskChronoScene';
