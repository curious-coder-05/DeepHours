import React, { memo, useEffect, useRef, useState } from 'react';
import {
  KINETIC_WAVE_RIB_COUNT,
  computeKineticWaveRibTransform,
  computeMonolithMotion,
  type DeskSculptureKind,
} from '../../utils/deskModeHelpers';
import {
  resolveRuntimeUi3d,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface DeskChronoSceneProps {
  sculpture: DeskSculptureKind;
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  isRunning: boolean;
  isPaused: boolean;
  simLandscape?: boolean;
}

type ThreeModule = typeof import('three');

interface SculptureRigController {
  fitCamera: (width: number, height: number) => void;
  update: (dt: number, isRunning: boolean, isPaused: boolean) => void;
  disposeExtra: () => void;
}

/**
 * Generates an offline procedural brushed Obsidian Steel grayscale texture for
 * subtle micro-anisotropic roughness & bump detail (zero external fetches).
 */
function createBrushedSteelTexture(
  THREE: ThreeModule,
  maxAnisotropy: number
): import('three').CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, size, size);

    // Deterministic fine horizontal brushed grain lines
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let y = 0; y < size; y++) {
      const lum = Math.floor(110 + rand() * 58);
      ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
      ctx.fillRect(0, y, size, 1);
    }

    // Subtle micro-scratches for specular breakup across chamfered edges
    for (let i = 0; i < 180; i++) {
      const y = Math.floor(rand() * size);
      const x = Math.floor(rand() * size);
      const w = 18 + Math.floor(rand() * 72);
      const bright = rand() > 0.45 ? 190 : 82;
      ctx.fillStyle = `rgba(${bright},${bright},${bright},0.22)`;
      ctx.fillRect(x, y, w, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a soft cool-silver volumetric glow sprite for the Monolith's suspended core.
 */
function createCoreGlowTexture(THREE: ThreeModule): import('three').CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0.0, 'rgba(232, 240, 250, 0.92)');
    g.addColorStop(0.24, 'rgba(196, 212, 232, 0.46)');
    g.addColorStop(0.58, 'rgba(128, 148, 176, 0.14)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a chamfered octagonal shape for extruded Obsidian Steel blocks and collars.
 */
function createChamferRectShape(
  THREE: ThreeModule,
  width: number,
  height: number,
  chamfer: number
): import('three').Shape {
  const hw = width / 2;
  const hh = height / 2;
  const c = Math.min(chamfer, hw * 0.45, hh * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + c, -hh);
  shape.lineTo(hw - c, -hh);
  shape.lineTo(hw, -hh + c);
  shape.lineTo(hw, hh - c);
  shape.lineTo(hw - c, hh);
  shape.lineTo(-hw + c, hh);
  shape.lineTo(-hw, hh - c);
  shape.lineTo(-hw, -hh + c);
  shape.closePath();
  return shape;
}

/**
 * Recursively disposes every geometry, material, and material texture inside a Three.js scene/group.
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
 * Sculpture 1: Smoked Obsidian Monolith (`monolith`)
 * Chamfered dark obsidian glass & brushed-gunmetal monolith enclosing a suspended
 * cool-silver internal glowing core that breathes while running and dims/settles when paused.
 */
function buildMonolithSculpture(
  THREE: ThreeModule,
  scene: import('three').Scene,
  camera: import('three').PerspectiveCamera,
  brushedTex: import('three').CanvasTexture,
  isSoftwareGl: boolean
): SculptureRigController {
  const root = new THREE.Group();
  scene.add(root);

  // 1. Primary Silhouette: Chamfered Smoked Obsidian Outer Shell
  const shellShape = createChamferRectShape(THREE, 1.82, 2.92, 0.24);
  const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
    depth: 1.06,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.11,
    bevelSegments: 4,
    curveSegments: 8,
  });
  shellGeo.center();

  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#080A0F'),
    metalness: 0.22,
    roughness: 0.11,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    ior: 1.56,
    reflectivity: 0.92,
    envMapIntensity: 1.05,
    transparent: true,
    opacity: isSoftwareGl ? 0.44 : 0.4,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.renderOrder = 3;
  root.add(shellMesh);

  // Subtle dark inner smoked shell lining for architectural depth
  const innerShellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#07090D'),
    metalness: 0.32,
    roughness: 0.16,
    clearcoat: 0.85,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const innerShellMesh = new THREE.Mesh(shellGeo, innerShellMat);
  innerShellMesh.scale.set(0.985, 0.985, 0.985);
  innerShellMesh.renderOrder = 2;
  root.add(innerShellMesh);

  // Restrained specular silver-steel hairline bevel edges
  const edgesGeo = new THREE.EdgesGeometry(shellGeo, 28);
  const edgesMat = new THREE.LineBasicMaterial({
    color: new THREE.Color('#BAC6D6'),
    transparent: true,
    opacity: 0.22,
  });
  const edgesLines = new THREE.LineSegments(edgesGeo, edgesMat);
  edgesLines.renderOrder = 4;
  root.add(edgesLines);

  // 2. Secondary Read: Brushed Gunmetal Machined Exoskeleton Collars & End Caps
  const gunmetalMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1B212C'),
    metalness: 0.94,
    roughness: 0.28,
    roughnessMap: brushedTex,
    bumpMap: brushedTex,
    bumpScale: 0.012,
    clearcoat: 0.36,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.15,
  });

  const trimSteelMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#C8D2DE'),
    metalness: 0.98,
    roughness: 0.14,
    envMapIntensity: 1.25,
  });

  // Top & bottom chamfered machined end-cap plates
  const capShape = createChamferRectShape(THREE, 1.56, 0.96, 0.2);
  const capGeo = new THREE.ExtrudeGeometry(capShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.035,
    bevelSegments: 2,
  });
  capGeo.center();
  capGeo.rotateX(Math.PI / 2);

  const topCap = new THREE.Mesh(capGeo, gunmetalMat);
  topCap.position.y = 1.54;
  root.add(topCap);

  const bottomCap = new THREE.Mesh(capGeo, gunmetalMat);
  bottomCap.position.y = -1.54;
  root.add(bottomCap);

  // Twin vertical brushed-gunmetal corner rails flanking the smoked chamber
  const railGeo = new THREE.BoxGeometry(0.085, 2.96, 0.085);
  const railOffsets: ReadonlyArray<readonly [number, number]> = [
    [-0.86, 0.52],
    [0.86, 0.52],
    [-0.86, -0.52],
    [0.86, -0.52],
  ];
  for (const [rx, rz] of railOffsets) {
    const rail = new THREE.Mesh(railGeo, gunmetalMat);
    rail.position.set(rx, 0, rz);
    root.add(rail);
  }

  // Slim machined end-frame collars flanking the open smoked chamber
  const collarShape = createChamferRectShape(THREE, 2.0, 1.3, 0.24);
  const collarHole = createChamferRectShape(THREE, 1.84, 1.14, 0.2);
  collarShape.holes.push(collarHole);
  const collarGeo = new THREE.ExtrudeGeometry(collarShape, {
    depth: 0.052,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.014,
    bevelSegments: 2,
  });
  collarGeo.center();
  collarGeo.rotateX(Math.PI / 2);

  const upperCollar = new THREE.Mesh(collarGeo, gunmetalMat);
  upperCollar.position.y = 1.16;
  root.add(upperCollar);

  const lowerCollar = new THREE.Mesh(collarGeo, gunmetalMat);
  lowerCollar.position.y = -1.16;
  root.add(lowerCollar);

  // Central suspension axis needles anchoring the floating core
  const needleGeo = new THREE.CylinderGeometry(0.011, 0.011, 2.86, 10);
  const needleMesh = new THREE.Mesh(needleGeo, trimSteelMat);
  root.add(needleMesh);

  // 3. Accent Detail: Suspended Internal Glowing Obsidian Steel Core
  const coreGroup = new THREE.Group();
  root.add(coreGroup);

  const coreCrystalGeo = new THREE.OctahedronGeometry(0.46, 0);
  const coreCrystalMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#CFD8E3'),
    emissive: new THREE.Color('#D8E6F5'),
    emissiveIntensity: 1.05,
    metalness: 0.35,
    roughness: 0.22,
    flatShading: true,
  });
  const coreCrystal = new THREE.Mesh(coreCrystalGeo, coreCrystalMat);
  coreCrystal.scale.set(0.76, 1.58, 0.76);
  coreGroup.add(coreCrystal);

  const coreEquatorialRingGeo = new THREE.TorusGeometry(0.48, 0.013, 12, 48);
  const coreEquatorialRing = new THREE.Mesh(coreEquatorialRingGeo, trimSteelMat);
  coreEquatorialRing.rotation.x = Math.PI / 2;
  coreGroup.add(coreEquatorialRing);

  const coreHaloGeo = new THREE.OctahedronGeometry(0.62, 1);
  const coreHaloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#A8BCD4'),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const coreHalo = new THREE.Mesh(coreHaloGeo, coreHaloMat);
  coreHalo.scale.set(0.84, 1.52, 0.84);
  coreHalo.renderOrder = 2;
  coreGroup.add(coreHalo);

  const coreGlowTex = createCoreGlowTexture(THREE);
  const coreSpriteMat = new THREE.SpriteMaterial({
    map: coreGlowTex,
    color: new THREE.Color('#D8E5F4'),
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const coreSprite = new THREE.Sprite(coreSpriteMat);
  coreSprite.scale.set(2.15, 2.95, 1);
  coreSprite.renderOrder = 1;
  coreGroup.add(coreSprite);

  const coreLight = new THREE.PointLight(0xdce8f7, 2.2, 5.5, 2);
  coreLight.position.set(0, 0, 0);
  root.add(coreLight);

  let phase = 0.65;
  let energy = 1.0;

  const fitCamera = (width: number, height: number) => {
    const aspect = Math.max(0.35, width / Math.max(1, height));
    // Frame the tall monolith gracefully in both landscape (800x360, 1440x900) and portrait
    const zVert = 6.35;
    const zHoriz = 4.9 / aspect;
    const safeZ = Math.max(zVert, zHoriz);
    camera.position.set(0, 0.08, safeZ);
    camera.lookAt(0, 0, 0);
  };

  const update = (dt: number, isRunning: boolean, isPaused: boolean) => {
    const targetEnergy = isRunning && !isPaused ? 1.0 : 0.0;
    const damp = 1 - Math.exp(-3.2 * dt);
    energy += (targetEnergy - energy) * damp;

    const speed = 0.18 + 0.82 * energy;
    phase += dt * speed;

    const motion = computeMonolithMotion(phase, energy);
    root.rotation.set(motion.rotX, motion.rotY, motion.rotZ);
    coreGroup.rotation.y = motion.coreRotY;
    coreGroup.rotation.z = Math.sin(phase * 0.55) * 0.08;
    coreGroup.scale.setScalar(motion.corePulse);

    coreCrystalMat.emissiveIntensity = motion.coreEmissiveIntensity;
    coreLight.intensity = motion.coreLightIntensity;
    coreHaloMat.opacity = motion.coreHaloOpacity;
    coreSpriteMat.opacity = 0.2 + energy * 0.42;
    edgesMat.opacity = 0.14 + energy * 0.11;
  };

  return {
    fitCamera,
    update,
    disposeExtra: () => {
      coreGlowTex.dispose();
    },
  };
}

/**
 * Sculpture 2: 22-Rib Kinetic Wave (`kinetic-wave`)
 * 22 precision-machined, thin chamfered Obsidian Steel ribs arranged along a
 * horizontal spine with continuous sinusoidal wave propagation and brushed specular edges.
 */
function buildKineticWaveSculpture(
  THREE: ThreeModule,
  scene: import('three').Scene,
  camera: import('three').PerspectiveCamera,
  brushedTex: import('three').CanvasTexture
): SculptureRigController {
  const root = new THREE.Group();
  // Subtle architectural 3/4 pitch so brushed chamfers & silver rims catch studio light cleanly
  root.rotation.set(0.24, -0.15, 0.02);
  scene.add(root);

  // 1. Secondary Read: Horizontal Precision Machined Central Spine & End Caps
  const spineMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0E121A'),
    metalness: 0.9,
    roughness: 0.34,
    roughnessMap: brushedTex,
    envMapIntensity: 1.0,
  });
  const capMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#202734'),
    metalness: 0.96,
    roughness: 0.2,
    clearcoat: 0.4,
    envMapIntensity: 1.2,
  });

  const spineGeo = new THREE.CylinderGeometry(0.036, 0.036, 7.68, 20);
  spineGeo.rotateZ(Math.PI / 2);
  const spineMesh = new THREE.Mesh(spineGeo, spineMat);
  root.add(spineMesh);

  const endCapGeo = new THREE.CylinderGeometry(0.088, 0.068, 0.2, 24);
  endCapGeo.rotateZ(Math.PI / 2);
  const leftCap = new THREE.Mesh(endCapGeo, capMat);
  leftCap.position.x = -3.86;
  root.add(leftCap);

  const rightCap = new THREE.Mesh(endCapGeo, capMat);
  rightCap.position.x = 3.86;
  rightCap.rotation.y = Math.PI;
  root.add(rightCap);

  // 2. Primary Silhouette: 22 Precision-Machined Chamfered Metallic Ribs (InstancedMesh)
  // Built in YZ plane (height=2.32, depth=0.64) extruded thin along X (thickness=0.062)
  const ribShape = createChamferRectShape(THREE, 0.62, 2.28, 0.14);
  const ribGeo = new THREE.ExtrudeGeometry(ribShape, {
    depth: 0.056,
    bevelEnabled: true,
    bevelThickness: 0.016,
    bevelSize: 0.015,
    bevelSegments: 2,
    curveSegments: 6,
  });
  ribGeo.center();
  // Rotate so extrusion thickness lies along X (horizontal spine axis) and blade sweeps in YZ
  ribGeo.rotateY(Math.PI / 2);

  const ribMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#141922'),
    metalness: 0.95,
    roughness: 0.24,
    roughnessMap: brushedTex,
    bumpMap: brushedTex,
    bumpScale: 0.01,
    clearcoat: 0.52,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.25,
  });

  const ribInstances = new THREE.InstancedMesh(
    ribGeo,
    ribMat,
    KINETIC_WAVE_RIB_COUNT
  );
  ribInstances.frustumCulled = false;
  root.add(ribInstances);

  // 3. Accent Detail: 22 Restrained Anodized Cool Silver-Steel Specular Leading-Edge Strips
  const rimGeo = new THREE.BoxGeometry(0.02, 1.98, 0.652);
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#9AA8BA'),
    metalness: 0.96,
    roughness: 0.2,
    clearcoat: 0.65,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.05,
  });

  const rimInstances = new THREE.InstancedMesh(
    rimGeo,
    rimMat,
    KINETIC_WAVE_RIB_COUNT
  );
  rimInstances.frustumCulled = false;
  root.add(rimInstances);

  // Pre-allocated scratch math helpers (zero GC inside animation loop)
  const scratchMat4 = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchEuler = new THREE.Euler();
  const scratchScale = new THREE.Vector3();
  const scratchRimScale = new THREE.Vector3();

  let phase = 1.4;
  let energy = 1.0;

  const applyRibMatrices = (currentPhase: number, currentEnergy: number) => {
    for (let i = 0; i < KINETIC_WAVE_RIB_COUNT; i++) {
      const tr = computeKineticWaveRibTransform(
        i,
        KINETIC_WAVE_RIB_COUNT,
        currentPhase,
        currentEnergy
      );
      scratchPos.set(tr.x, tr.yOffset, 0);
      scratchEuler.set(tr.rotX, tr.rotY, tr.rotZ);
      scratchQuat.setFromEuler(scratchEuler);
      scratchScale.set(1, tr.scaleY, 1);
      scratchMat4.compose(scratchPos, scratchQuat, scratchScale);
      ribInstances.setMatrixAt(i, scratchMat4);

      scratchRimScale.set(1, tr.scaleY * 0.985, 1.015);
      scratchMat4.compose(scratchPos, scratchQuat, scratchRimScale);
      rimInstances.setMatrixAt(i, scratchMat4);
    }
    ribInstances.instanceMatrix.needsUpdate = true;
    rimInstances.instanceMatrix.needsUpdate = true;
  };

  // Initialize matrices & bounds before first render
  applyRibMatrices(phase, energy);
  ribInstances.computeBoundingSphere();
  rimInstances.computeBoundingSphere();

  const fitCamera = (width: number, height: number) => {
    const aspect = Math.max(0.35, width / Math.max(1, height));
    // Generous framing so all 22 ribs + machined end-caps sit with pure #000000 breathing room
    const zVert = 6.0;
    const zHoriz = 12.8 / aspect;
    const safeZ = Math.max(zVert, zHoriz);
    camera.position.set(0, 0.14, safeZ);
    camera.lookAt(0, 0, 0);
  };

  const update = (dt: number, isRunning: boolean, isPaused: boolean) => {
    const targetEnergy = isRunning && !isPaused ? 1.0 : 0.0;
    const damp = 1 - Math.exp(-3.0 * dt);
    energy += (targetEnergy - energy) * damp;

    // Smoothly slows to a calm idle drift when paused
    const speed = 0.14 + 0.86 * energy;
    phase += dt * speed;

    root.rotation.x = 0.24 + Math.sin(phase * 0.28) * (0.03 + 0.04 * energy);
    root.rotation.y = -0.15 + Math.cos(phase * 0.22) * (0.04 + 0.05 * energy);
    applyRibMatrices(phase, energy);
  };

  return {
    fitCamera,
    update,
    disposeExtra: () => {
      // Geometries & materials disposed via disposeObjectTree
    },
  };
}

/**
 * StandBy Desk Mode Procedural 3D Sculpture Renderer (v45).
 * Instantiates ONLY the selected sculpture (`monolith` or `kinetic-wave`) with procedural
 * `PMREMGenerator` + `RoomEnvironment` studio lighting on pure `#000000` AMOLED black.
 *
 * Performance & Lifecycle Guardrails:
 * - Zero React re-renders on 1-second timer ticks (no per-second timer prop; live running/paused via ref)
 * - Strictly lazy-loads `three` and `RoomEnvironment` inside `useEffect`
 * - Caps pixel ratio at `Math.min(window.devicePixelRatio, 2)` (1 on software WebGL)
 * - Pauses render loop when `document.hidden === true`
 * - Paces frames via GPU fence `afterDraw()` on software WebGL so headless renders never stall
 * - Recursively disposes all geometries, materials, textures, PMREM targets, and renderer on unmount or switch
 */
export const DeskChronoScene: React.FC<DeskChronoSceneProps> = memo(
  ({
    sculpture,
    ui3dSetting = 'auto',
    ui3dQuality = 'auto',
    isRunning,
    isPaused,
    simLandscape = false,
  }) => {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const syncViewportRef = useRef<(() => void) | null>(null);
    const [webglFailed, setWebglFailed] = useState(false);

    // Keep live timer running/paused state in ref so pausing never tears down WebGL
    const liveStateRef = useRef({ isRunning, isPaused });
    liveStateRef.current = { isRunning, isPaused };

    const resolution = resolveRuntimeUi3d(ui3dSetting, false, ui3dQuality);

    // Sync canvas aspect smoothly when toggling CSS Simulated Landscape without tearing down WebGL
    useEffect(() => {
      const id = window.requestAnimationFrame(() => {
        syncViewportRef.current?.();
      });
      return () => window.cancelAnimationFrame(id);
    }, [simLandscape]);

    useEffect(() => {
      if (!resolution.enabled || webglFailed) return;
      const container = mountRef.current;
      if (!container) return;

      let disposed = false;
      let rafId = 0;
      let timerId = 0;
      let isContextLost = false;
      let renderer: import('three').WebGLRenderer | null = null;
      let scene: import('three').Scene | null = null;
      let pmremGenerator: import('three').PMREMGenerator | null = null;
      let envRenderTarget: import('three').WebGLRenderTarget | null = null;
      let roomEnv: { dispose?: () => void } | null = null;
      let brushedTex: import('three').CanvasTexture | null = null;
      let rig: SculptureRigController | null = null;
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

      Promise.all([
        import('three'),
        import('three/addons/environments/RoomEnvironment.js'),
      ])
        .then(([THREE, envMod]) => {
          if (disposed || !mountRef.current) return;

          // Use local clientWidth/clientHeight first so CSS rotate(90deg) in Simulated Landscape never swaps dimensions
          const rect = container.getBoundingClientRect();
          const initW = Math.max(
            1,
            Math.floor(container.clientWidth || rect.width || window.innerWidth || 800)
          );
          const initH = Math.max(
            1,
            Math.floor(container.clientHeight || rect.height || window.innerHeight || 360)
          );
          const isSoftwareGl = resolution.isSoftwareGl;

          renderer = new THREE.WebGLRenderer({
            antialias: !isSoftwareGl,
            alpha: false,
            powerPreference: 'high-performance',
          });
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          // Restrained studio exposure so foreground #F2F4F8 numerals command top luminance
          renderer.toneMappingExposure = 0.96;
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

          // Procedural Studio Environment via PMREMGenerator + RoomEnvironment (zero external fetches)
          const RoomEnvCtor = envMod.RoomEnvironment;
          pmremGenerator = new THREE.PMREMGenerator(renderer);
          pmremGenerator.compileEquirectangularShader();
          const roomScene = new RoomEnvCtor();
          roomEnv = roomScene;
          envRenderTarget = pmremGenerator.fromScene(roomScene, 0.04);
          scene.environment = envRenderTarget.texture;
          if ('environmentIntensity' in scene) {
            (scene as import('three').Scene & { environmentIntensity: number }).environmentIntensity = 0.66;
          }
          // PMREMGenerator and RoomEnvironment scene are no longer needed after baking target
          if (typeof roomScene.dispose === 'function') {
            roomScene.dispose();
          }
          roomEnv = null;
          pmremGenerator.dispose();
          pmremGenerator = null;

          // Restrained Obsidian Steel 3-Point Studio Lighting Rig
          const hemiLight = new THREE.HemisphereLight(0x52627a, 0x05070b, 0.34);
          scene.add(hemiLight);

          const keyLight = new THREE.DirectionalLight(0xe4edf7, 2.25);
          keyLight.position.set(4.2, 5.2, 4.6);
          scene.add(keyLight);

          const rimLight = new THREE.DirectionalLight(0xb8cae0, 1.55);
          rimLight.position.set(-4.8, -1.6, -3.2);
          scene.add(rimLight);

          const topEdgeLight = new THREE.DirectionalLight(0x94a7bd, 0.85);
          topEdgeLight.position.set(0.4, 6.0, -2.6);
          scene.add(topEdgeLight);

          const camera = new THREE.PerspectiveCamera(36, initW / initH, 0.1, 100);
          brushedTex = createBrushedSteelTexture(
            THREE,
            renderer.capabilities.getMaxAnisotropy()
          );

          // Instantiate ONLY the active sculpture (never hold both in GPU memory)
          rig =
            sculpture === 'monolith'
              ? buildMonolithSculpture(THREE, scene, camera, brushedTex, isSoftwareGl)
              : buildKineticWaveSculpture(THREE, scene, camera, brushedTex);

          rig.fitCamera(initW, initH);

          if (!isSoftwareGl) {
            try {
              renderer.compile(scene, camera);
            } catch {
              // Ignore shader pre-warm quirks
            }
          }

          let lastTime = performance.now();

          const canRender = () =>
            !disposed &&
            !isContextLost &&
            (typeof document === 'undefined' || !document.hidden);

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
            if (!canRender() || !renderer || !scene || !rig) return;

            const dt = Math.min(0.08, Math.max(0.001, (now - lastTime) / 1000));
            lastTime = now;

            const { isRunning: running, isPaused: paused } = liveStateRef.current;
            rig.update(dt, running, paused);
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
            lastTime = performance.now();
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

          const syncViewport = (nextW?: number, nextH?: number) => {
            if (disposed || !renderer || !rig || !scene) return;
            const w = Math.max(1, Math.floor(nextW ?? container.clientWidth ?? initW));
            const h = Math.max(1, Math.floor(nextH ?? container.clientHeight ?? initH));
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
            rig.fitCamera(w, h);
            if (canRender()) {
              renderer.render(scene, camera);
            }
          };
          syncViewportRef.current = () => syncViewport();

          if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver((entries) => {
              const entry = entries[0];
              if (!entry) return;
              syncViewport(entry.contentRect.width, entry.contentRect.height);
            });
            resizeObserver.observe(container);
          }

          // Render immediate first frame and kick off animation loop
          if (canRender()) {
            rig.update(0.016, liveStateRef.current.isRunning, liveStateRef.current.isPaused);
            renderer.render(scene, camera);
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
        cancelScheduledFrame();
        resizeObserver?.disconnect();
        cleanupListeners?.();

        if (rig) {
          try {
            rig.disposeExtra();
          } catch {
            // ignore disposal errors
          }
          rig = null;
        }
        if (scene) {
          disposeObjectTree(scene);
          scene.environment = null;
          scene.clear();
          scene = null;
        }
        if (brushedTex) {
          brushedTex.dispose();
          brushedTex = null;
        }
        if (envRenderTarget) {
          envRenderTarget.dispose();
          envRenderTarget = null;
        }
        if (pmremGenerator) {
          pmremGenerator.dispose();
          pmremGenerator = null;
        }
        if (roomEnv && typeof roomEnv.dispose === 'function') {
          roomEnv.dispose();
          roomEnv = null;
        }
        if (renderer) {
          renderer.dispose();
          renderer = null;
        }
        syncViewportRef.current = null;
        if (container) {
          container.replaceChildren();
        }
      };
    }, [sculpture, resolution.enabled, resolution.isSoftwareGl, webglFailed]);

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
