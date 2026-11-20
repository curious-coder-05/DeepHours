import React, { useEffect, useRef, useState } from 'react';
import { Compass, Pause, Play } from 'lucide-react';
import type { ActiveTimerMode, TimerPhase } from '../../types';
import {
  FOCUS_ORB_STYLE_EVENT,
  computeFocusSessionHeat,
  getFocusOrbPalette,
  loadFocusOrbStyle,
  type FocusOrbStyle,
} from '../../utils/scene3dHelpers';
import {
  Scene3D,
  type Scene3DContext,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface FocusOrbitSceneProps {
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  deskMode: boolean;
  priority?: 'stage' | 'overlay';
  hapticsEnabled?: boolean;
  status: 'idle' | 'running' | 'paused';
  mode: ActiveTimerMode;
  phase: TimerPhase;
  subjectColor: string;
  subjectName?: string;
  progressPct: number;
  totalActiveMs: number;
  overtimeMs: number;
  completedPomodorosToday?: number;
  height?: number;
  onBreatheStateChange?: (cue: string | null) => void;
}

const ARC_SEGMENTS = 60;
const MAX_SATELLITES = 12;
const STOPWATCH_RING_COUNT = 8;

// ---------------------------------------------------------------------------
// High-Contrast Solar Eclipse Core Shader (SphereGeometry 1.45)
// Pitch-black obsidian inner face (dot > 0.45) + incandescent Fresnel rim
// ---------------------------------------------------------------------------

const ECLIPSE_CORE_VERTEX = `
  uniform float uTime;
  uniform float uPulse;
  uniform float uTapProgress;
  uniform vec3 uTapOrigin;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;
  varying float vRipple;

  void main() {
    float ripple = 0.0;
    if (uTapProgress > 0.0 && uTapProgress < 1.0) {
      float d = distance(normalize(position), normalize(uTapOrigin));
      float waveFront = uTapProgress * 2.35;
      float env = exp(-pow((d - waveFront) * 5.0, 2.0)) * (1.0 - uTapProgress);
      ripple = env * sin((d - waveFront) * 16.0);
    }
    float subtleBreath = sin(position.x * 2.8 + uTime * 0.85) * cos(position.y * 2.8 - uTime * 0.7) * 0.012;
    vec3 displaced = position + normal * (subtleBreath * (0.35 + uPulse * 0.65) + ripple * 0.07);
    vLocalPos = normalize(position);
    vRipple = abs(ripple);
    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const ECLIPSE_CORE_FRAGMENT = `
  uniform float uTime;
  uniform float uHeat;
  uniform float uIntensity;
  uniform float uCrimsonWeight;
  uniform vec3 uCenterColor;
  uniform vec3 uWhiteHotColor;
  uniform vec3 uInnerRimColor;
  uniform vec3 uOuterCoronaColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;
  varying float vRipple;

  float plasmaWave(vec3 p, float t) {
    float w1 = sin(p.x * 2.4 + t * 0.42) * cos(p.y * 2.2 - t * 0.36);
    float w2 = sin(p.z * 2.9 - t * 0.31) * cos((p.x + p.y) * 1.9 + t * 0.28);
    return 0.5 + 0.5 * (w1 * 0.56 + w2 * 0.44);
  }

  float coronaNoise(vec3 p, float t) {
    float a = sin(p.x * 4.8 + t * 0.72) * cos(p.y * 4.4 - t * 0.6);
    float b = sin(p.z * 5.6 + t * 0.85) * cos(p.x * 3.5 + p.y * 3.8 - t * 0.52);
    return 0.5 + 0.5 * (a * 0.58 + b * 0.42);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float ndotv = clamp(dot(n, v), 0.0, 1.0);
    float f = 1.0 - ndotv;

    // Continuous soft radial Fresnel falloff (zero flat-black cutoff)
    float midBlend = pow(f, 1.25);
    float rimHot = pow(f, 3.1);
    float razorEdge = pow(f, 5.2);

    float slowPlasma = plasmaWave(vLocalPos, uTime);
    float flare = coronaNoise(vLocalPos, uTime);

    // Warm volcanic obsidian-ember interior with slow drifting plasma depth
    vec3 deepCrimson = mix(vec3(0.62, 0.07, 0.22), uOuterCoronaColor, 0.52);
    vec3 moltenAmber = uInnerRimColor;
    vec3 livingCenter = uCenterColor * (0.86 + slowPlasma * 0.36);
    livingCenter += deepCrimson * (0.14 + slowPlasma * 0.14) * (0.75 + uHeat * 0.35);

    // Blend deep crimson and molten amber deeply inward across 60-70% of orb radius
    vec3 warmMid = mix(
      deepCrimson,
      moltenAmber,
      clamp(smoothstep(0.18, 0.84, midBlend) * (0.85 - uCrimsonWeight * 0.24), 0.0, 1.0)
    );
    float midStrength = clamp(midBlend * (0.88 + uHeat * 0.34) * (0.86 + flare * 0.26), 0.0, 1.0);
    vec3 col = mix(livingCenter, warmMid * (1.06 + uHeat * 0.28), midStrength);

    // Incandescent solar amber & white-gold rim along the outer limb
    col += mix(moltenAmber, uWhiteHotColor, 0.55) * rimHot * (1.08 + uHeat * 0.38) * (0.88 + flare * 0.24);
    col += uWhiteHotColor * razorEdge * (1.15 + uHeat * 0.35);

    // Subtle tap ripple highlight
    col += uWhiteHotColor * clamp(vRipple * 1.15, 0.0, 0.56);

    col *= clamp(uIntensity, 0.48, 1.32);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Outer Atmospheric Corona Shell (SphereGeometry 1.82, BackSide, Additive)
// Fades strictly to 0.0 before outer geometric silhouette (zero stray red ring)
// ---------------------------------------------------------------------------

const CORONA_SHELL_VERTEX = `
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

const CORONA_SHELL_FRAGMENT = `
  uniform float uTime;
  uniform float uHeat;
  uniform float uIntensity;
  uniform float uCrimsonWeight;
  uniform vec3 uWhiteHotColor;
  uniform vec3 uInnerRimColor;
  uniform vec3 uOuterCoronaColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float absNdv = clamp(abs(dot(n, v)), 0.0, 1.0);

    // Strictly decay to 0.0 well before the outer geometric edge (absNdv -> 0)
    float edgeKill = smoothstep(0.08, 0.46, absNdv);
    float falloff = pow(absNdv, 2.8) * edgeKill;
    float innerHalo = pow(absNdv, 4.4) * edgeKill;

    float ang = atan(vLocalPos.y, vLocalPos.x);
    float plume =
      0.82 +
      0.12 * sin(ang * 4.0 + uTime * 0.48) +
      0.06 * cos(ang * 7.0 - uTime * 0.64);

    vec3 glowCol = mix(uOuterCoronaColor, uInnerRimColor, smoothstep(0.18, 0.62, absNdv));
    glowCol = mix(glowCol, uWhiteHotColor, innerHalo * 0.36);

    float alpha = clamp(
      (falloff * (0.44 + uHeat * 0.3) + innerHalo * 0.34) * plume * uIntensity,
      0.0,
      0.76
    );

    gl_FragColor = vec4(glowCol * (0.92 + uCrimsonWeight * 0.22) * uIntensity, alpha);
  }
`;

function createEclipseCoronaSpriteTexture(
  THREE: typeof import('three')
): import('three').CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 26, half, half, half);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 0.14)');
    g.addColorStop(0.46, 'rgba(255, 248, 224, 0.72)');
    g.addColorStop(0.62, 'rgba(255, 214, 140, 0.36)');
    g.addColorStop(0.82, 'rgba(255, 160, 96, 0.10)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createEmberDustTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 1, half, half, half);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 0.98)');
    g.addColorStop(0.4, 'rgba(255, 255, 255, 0.48)');
    g.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildOuterTickRingGeometry(
  THREE: typeof import('three'),
  radius: number,
  tickCount: number,
  majorEvery: number
): import('three').BufferGeometry {
  const positions = new Float32Array(tickCount * 2 * 3);
  for (let i = 0; i < tickCount; i++) {
    const angle = (i / tickCount) * Math.PI * 2;
    const isMajor = i % majorEvery === 0;
    const innerR = radius - (isMajor ? 0.085 : 0.042);
    const outerR = radius + (isMajor ? 0.025 : 0.01);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const idx = i * 6;
    positions[idx] = cos * innerR;
    positions[idx + 1] = sin * innerR;
    positions[idx + 2] = 0;
    positions[idx + 3] = cos * outerR;
    positions[idx + 4] = sin * outerR;
    positions[idx + 5] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

export const FocusOrbitScene: React.FC<FocusOrbitSceneProps> = ({
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  deskMode,
  priority = 'stage',
  hapticsEnabled = true,
  status,
  mode,
  phase,
  subjectColor,
  subjectName,
  progressPct,
  totalActiveMs,
  overtimeMs,
  completedPomodorosToday = 0,
  height = 336,
  onBreatheStateChange,
}) => {
  const [ambientPaused, setAmbientPaused] = useState(false);
  const [gyroEnabled, setGyroEnabled] = useState(false);
  const [orbStyle, setOrbStyle] = useState<FocusOrbStyle>(() => loadFocusOrbStyle());

  // Listen for live localStorage palette switches from Settings -> Appearance
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStyleEvent = (ev: Event) => {
      const custom = ev as CustomEvent<FocusOrbStyle>;
      if (custom.detail) {
        setOrbStyle(custom.detail);
      } else {
        setOrbStyle(loadFocusOrbStyle());
      }
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'dh_focus_orb_style_v1') {
        setOrbStyle(loadFocusOrbStyle());
      }
    };
    window.addEventListener(FOCUS_ORB_STYLE_EVENT, onStyleEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FOCUS_ORB_STYLE_EVENT, onStyleEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const supportsGyro =
    typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

  const sceneCtxRef = useRef<Scene3DContext | null>(null);
  const gyroOffsetRef = useRef({ x: 0, y: 0 });

  const propsRef = useRef({
    status,
    mode,
    phase,
    subjectColor,
    orbStyle,
    progressPct,
    totalActiveMs,
    overtimeMs,
    completedPomodorosToday,
    ambientPaused,
    hapticsEnabled,
    onBreatheStateChange,
  });
  propsRef.current = {
    status,
    mode,
    phase,
    subjectColor,
    orbStyle,
    progressPct,
    totalActiveMs,
    overtimeMs,
    completedPomodorosToday,
    ambientPaused,
    hapticsEnabled,
    onBreatheStateChange,
  };

  useEffect(() => {
    sceneCtxRef.current?.requestRender();
  }, [
    status,
    mode,
    phase,
    orbStyle,
    progressPct,
    totalActiveMs,
    overtimeMs,
    completedPomodorosToday,
    ambientPaused,
  ]);

  useEffect(() => {
    if (!gyroEnabled || typeof window === 'undefined') {
      gyroOffsetRef.current.x = 0;
      gyroOffsetRef.current.y = 0;
      return;
    }
    const onOrientation = (ev: DeviceOrientationEvent) => {
      const gamma = typeof ev.gamma === 'number' ? ev.gamma : 0;
      const beta = typeof ev.beta === 'number' ? ev.beta - 45 : 0;
      gyroOffsetRef.current.x = Math.max(-0.28, Math.min(0.28, (gamma / 45) * 0.24));
      gyroOffsetRef.current.y = Math.max(-0.22, Math.min(0.22, (beta / 45) * 0.18));
      sceneCtxRef.current?.requestRender();
    };
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      gyroOffsetRef.current.x = 0;
      gyroOffsetRef.current.y = 0;
    };
  }, [gyroEnabled]);

  const handleToggleGyro = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (gyroEnabled) {
      setGyroEnabled(false);
      return;
    }
    try {
      const DevOrient = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (DevOrient && typeof DevOrient.requestPermission === 'function') {
        const res = await DevOrient.requestPermission();
        if (res !== 'granted') return;
      }
      setGyroEnabled(true);
    } catch {
      // Ignore permission rejection
    }
  };

  // Strictly unmount WebGL when StandBy Desk Mode is active or 3D is Off
  if (deskMode || ui3dSetting === 'off') {
    return null;
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
      }}
    >
      <span className="sr-only">
        Solar Eclipse focus core ({getFocusOrbPalette(orbStyle).label}):{' '}
        {status === 'running' ? 'active' : status === 'paused' ? 'paused' : 'ready'},{' '}
        {phase === 'break' ? 'break phase' : 'study phase'}
        {subjectName ? `, ${subjectName}` : ''}, {Math.round(progressPct)}% progress,{' '}
        {completedPomodorosToday} completed pomodoros today
        {mode === 'stopwatch'
          ? `, ${Math.floor(totalActiveMs / 900000)} fifteen-minute rings active`
          : ''}
        {overtimeMs > 0 ? ', high solar corona active' : ''}.
      </span>

      {supportsGyro && priority === 'stage' && (
        <button
          type="button"
          aria-label={gyroEnabled ? 'Disable gyroscope parallax' : 'Enable gyroscope parallax'}
          aria-pressed={gyroEnabled}
          title={gyroEnabled ? 'Gyroscope tilt on' : 'Tilt parallax'}
          onClick={handleToggleGyro}
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            zIndex: 5,
            width: '40px',
            height: '40px',
            minWidth: '40px',
            minHeight: '40px',
            padding: 0,
            borderRadius: '12px',
            background: gyroEnabled
              ? 'var(--ac-soft)'
              : 'color-mix(in srgb, var(--sf-1) 82%, transparent)',
            border: gyroEnabled ? '1px solid var(--ac)' : '1px solid var(--line)',
            color: gyroEnabled ? 'var(--ac-ink)' : 'var(--tx-2)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Compass size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        aria-label={ambientPaused ? 'Resume 3D ambient motion' : 'Pause 3D ambient motion'}
        aria-pressed={ambientPaused}
        title={ambientPaused ? 'Resume 3D motion' : 'Pause 3D motion'}
        onClick={(e) => {
          e.stopPropagation();
          setAmbientPaused((v) => !v);
        }}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          zIndex: 5,
          width: '40px',
          height: '40px',
          minWidth: '40px',
          minHeight: '40px',
          padding: 0,
          borderRadius: '12px',
          background: 'color-mix(in srgb, var(--sf-1) 82%, transparent)',
          border: '1px solid var(--line)',
          color: 'var(--tx-2)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {ambientPaused ? (
          <Play size={16} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>

      <Scene3D
        testId="focus-orbit-scene"
        ui3dSetting={ui3dSetting}
        ui3dQuality={ui3dQuality}
        deskMode={deskMode}
        priority={priority}
        active={!deskMode && !ambientPaused}
        continuous={!ambientPaused}
        height={height}
        fov={42}
        cameraPosition={[0, 0.06, 5.75]}
        className="w-full select-none"
        setup={(ctx: Scene3DContext) => {
          const { THREE, scene, camera, canvas, resolution } = ctx;
          sceneCtxRef.current = ctx;

          const fitCameraForAspect = (w: number, h: number) => {
            const aspect = Math.max(0.66, w / Math.max(1, h));
            const safeZ = aspect < 0.96 ? 5.75 * (0.96 / aspect) : 5.75;
            camera.position.set(0, 0.06, safeZ);
            camera.lookAt(0, 0, 0);
          };
          fitCameraForAspect(ctx.width, ctx.height);

          const initPalette = getFocusOrbPalette(propsRef.current.orbStyle);
          const coronaSpriteTex = createEclipseCoronaSpriteTexture(THREE);
          const emberDustTex = createEmberDustTexture(THREE);

          const coreGroup = new THREE.Group();
          scene.add(coreGroup);

          // 1. 256x256 Offscreen-Canvas Radial Corona Glow Sprite Behind the Orb (Zero Post-Processing)
          const coronaSpriteMat = new THREE.SpriteMaterial({
            map: coronaSpriteTex,
            color: new THREE.Color(initPalette.innerRimHex),
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const coronaSprite = new THREE.Sprite(coronaSpriteMat);
          coronaSprite.position.set(0, 0, -0.35);
          coronaSprite.scale.set(4.55, 4.55, 1);
          scene.add(coronaSprite);

          // 2. Outer Atmospheric Corona Shell (SphereGeometry 1.82, BackSide, Additive — strictly 0.0 before boundary)
          const coronaShellGeo = new THREE.SphereGeometry(
            1.82,
            resolution.resolvedQuality === 'lite' ? 28 : 40,
            resolution.resolvedQuality === 'lite' ? 28 : 40
          );
          const coronaShellUniforms = {
            uTime: { value: 0 },
            uHeat: { value: 0.2 },
            uIntensity: { value: 0.96 },
            uCrimsonWeight: { value: 0.42 },
            uWhiteHotColor: { value: new THREE.Color(initPalette.whiteHotHex) },
            uInnerRimColor: { value: new THREE.Color(initPalette.innerRimHex) },
            uOuterCoronaColor: { value: new THREE.Color(initPalette.outerCoronaHex) },
          };
          const coronaShellMat = new THREE.ShaderMaterial({
            uniforms: coronaShellUniforms,
            vertexShader: CORONA_SHELL_VERTEX,
            fragmentShader: CORONA_SHELL_FRAGMENT,
            side: THREE.BackSide,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const coronaShellMesh = new THREE.Mesh(coronaShellGeo, coronaShellMat);
          coreGroup.add(coronaShellMesh);

          // 3. Commanding Blended Solar Eclipse Core (SphereGeometry 1.48, 48x48)
          const coreGeo = new THREE.SphereGeometry(
            1.48,
            resolution.resolvedQuality === 'lite' ? 32 : 48,
            resolution.resolvedQuality === 'lite' ? 32 : 48
          );
          const coreUniforms = {
            uTime: { value: 0 },
            uPulse: { value: 0.2 },
            uHeat: { value: 0.2 },
            uIntensity: { value: 1.0 },
            uCrimsonWeight: { value: 0.42 },
            uTapProgress: { value: 0 },
            uTapOrigin: { value: new THREE.Vector3(0, 0, 1) },
            uCenterColor: { value: new THREE.Color(initPalette.coreCenterHex) },
            uWhiteHotColor: { value: new THREE.Color(initPalette.whiteHotHex) },
            uInnerRimColor: { value: new THREE.Color(initPalette.innerRimHex) },
            uOuterCoronaColor: { value: new THREE.Color(initPalette.outerCoronaHex) },
          };
          const coreMat = new THREE.ShaderMaterial({
            uniforms: coreUniforms,
            vertexShader: ECLIPSE_CORE_VERTEX,
            fragmentShader: ECLIPSE_CORE_FRAGMENT,
          });
          const coreMesh = new THREE.Mesh(coreGeo, coreMat);
          coreGroup.add(coreMesh);

          // 4. Restrained Slowly Rotating Geodesic Wireframe Cage (IcosahedronGeometry 1.72, 1 — opacity 0.11)
          const cageSrcGeo = new THREE.IcosahedronGeometry(1.72, 1);
          const cageEdgesGeo = new THREE.EdgesGeometry(cageSrcGeo);
          cageSrcGeo.dispose();
          const cageMat = new THREE.LineBasicMaterial({
            color: new THREE.Color(initPalette.wireframeHex),
            transparent: true,
            opacity: 0.11,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const geodesicCage = new THREE.LineSegments(cageEdgesGeo, cageMat);
          coreGroup.add(geodesicCage);

          // 5. Two Razor-Thin Counter-Rotating Tilted Orbital Rings (Warm Gold & Subtle Champagne)
          const ringPrimaryGeo = new THREE.TorusGeometry(1.8, 0.008, 8, 96);
          const ringPrimaryMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(initPalette.ringPrimaryHex),
            transparent: true,
            opacity: 0.46,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const ringPrimary = new THREE.Mesh(ringPrimaryGeo, ringPrimaryMat);
          ringPrimary.rotation.x = Math.PI * 0.36;
          ringPrimary.rotation.y = Math.PI * 0.14;
          coreGroup.add(ringPrimary);

          const ringSecondaryGeo = new THREE.TorusGeometry(1.92, 0.006, 8, 96);
          const ringSecondaryMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(initPalette.ringSecondaryHex),
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const ringSecondary = new THREE.Mesh(ringSecondaryGeo, ringSecondaryMat);
          ringSecondary.rotation.x = -Math.PI * 0.32;
          ringSecondary.rotation.y = -Math.PI * 0.2;
          coreGroup.add(ringSecondary);

          // 6. Subtle Muted Champagne-Gold Outer 72-Tick Degree Ring (#D4AF37, opacity 0.16)
          const outerTickGeo = buildOuterTickRingGeometry(THREE, 1.98, 72, 6);
          const outerTickMat = new THREE.LineBasicMaterial({
            color: new THREE.Color('#D4AF37'),
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const outerTicks = new THREE.LineSegments(outerTickGeo, outerTickMat);
          scene.add(outerTicks);

          // 7. Stopwatch 15-Minute Milestone Concentric Rings
          const stopwatchRingsGroup = new THREE.Group();
          coreGroup.add(stopwatchRingsGroup);
          const stopwatchRingMeshes: Array<{
            mesh: import('three').Mesh;
            mat: import('three').MeshBasicMaterial;
          }> = [];
          for (let rIdx = 0; rIdx < STOPWATCH_RING_COUNT; rIdx++) {
            const rRadius = 1.73 + rIdx * 0.042;
            const rGeo = new THREE.TorusGeometry(rRadius, 0.0085, 6, 72);
            const rMat = new THREE.MeshBasicMaterial({
              color: new THREE.Color(initPalette.innerRimHex),
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const rMesh = new THREE.Mesh(rGeo, rMat);
            rMesh.rotation.x = Math.PI * (0.28 + (rIdx % 3) * 0.14);
            rMesh.rotation.y = (rIdx % 2 === 0 ? 1 : -1) * Math.PI * (0.12 + rIdx * 0.04);
            rMesh.visible = false;
            stopwatchRingsGroup.add(rMesh);
            stopwatchRingMeshes.push({ mesh: rMesh, mat: rMat });
          }

          // 8. Sleek 60-Segment 3D Progress Arc (InstancedMesh)
          const segGeo = new THREE.BoxGeometry(0.075, 0.024, 0.024);
          const segMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
          });
          const progressArcInstanced = new THREE.InstancedMesh(segGeo, segMat, ARC_SEGMENTS);
          const dummyMat4 = new THREE.Matrix4();
          const dummyPos = new THREE.Vector3();
          const dummyQuat = new THREE.Quaternion();
          const dummyScale = new THREE.Vector3(1, 1, 1);
          const dummyEuler = new THREE.Euler();
          const dimTrackColor = new THREE.Color('#14171D');

          const arcRadius = 2.04;
          for (let i = 0; i < ARC_SEGMENTS; i++) {
            const angle = Math.PI / 2 - (i / ARC_SEGMENTS) * Math.PI * 2;
            dummyPos.set(Math.cos(angle) * arcRadius, Math.sin(angle) * arcRadius, 0);
            dummyEuler.set(0, 0, angle);
            dummyQuat.setFromEuler(dummyEuler);
            dummyMat4.compose(dummyPos, dummyQuat, dummyScale);
            progressArcInstanced.setMatrixAt(i, dummyMat4);
            progressArcInstanced.setColorAt(i, dimTrackColor);
          }
          progressArcInstanced.instanceMatrix.needsUpdate = true;
          if (progressArcInstanced.instanceColor) {
            progressArcInstanced.instanceColor.needsUpdate = true;
          }
          progressArcInstanced.frustumCulled = false;
          scene.add(progressArcInstanced);

          // 9. Completed Pomodoro Satellite Orbs (InstancedMesh up to 12)
          const satGeo = new THREE.SphereGeometry(0.062, 12, 12);
          const satMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(initPalette.whiteHotHex),
            transparent: true,
            opacity: 0.94,
          });
          const satInstanced = new THREE.InstancedMesh(satGeo, satMat, MAX_SATELLITES);
          satInstanced.count = 0;
          satInstanced.frustumCulled = false;
          scene.add(satInstanced);

          // 10. 90-140 Soft Drifting Ember Stardust Particles (Circular Additive Sprite)
          const particleCount = resolution.resolvedQuality === 'lite' ? 90 : 132;
          const pPositions = new Float32Array(particleCount * 3);
          const pColors = new Float32Array(particleCount * 3);
          const pSeeds = new Float32Array(particleCount * 3);
          const cEmberA = new THREE.Color(initPalette.emberPrimaryHex);
          const cEmberB = new THREE.Color(initPalette.emberSecondaryHex);
          const cMix = new THREE.Color();

          for (let i = 0; i < particleCount; i++) {
            const theta = (i / particleCount) * Math.PI * 2 + (i % 9) * 0.19;
            const rSpread = 1.64 + ((i * 67) % 100) * 0.0085;
            const ySpread = (((i * 37) % 100) / 100 - 0.5) * 1.45;
            const mixFactor = ((i * 29) % 100) / 100;
            pPositions[i * 3] = Math.cos(theta) * rSpread;
            pPositions[i * 3 + 1] = ySpread;
            pPositions[i * 3 + 2] = Math.sin(theta) * rSpread * 0.55;
            pSeeds[i * 3] = theta;
            pSeeds[i * 3 + 1] = rSpread;
            pSeeds[i * 3 + 2] = mixFactor;

            cMix.copy(cEmberA).lerp(cEmberB, mixFactor);
            pColors[i * 3] = cMix.r;
            pColors[i * 3 + 1] = cMix.g;
            pColors[i * 3 + 2] = cMix.b;
          }

          const particleGeo = new THREE.BufferGeometry();
          const posAttr = new THREE.BufferAttribute(pPositions, 3);
          const colAttr = new THREE.BufferAttribute(pColors, 3);
          particleGeo.setAttribute('position', posAttr);
          particleGeo.setAttribute('color', colAttr);
          const particleMat = new THREE.PointsMaterial({
            map: emberDustTex,
            vertexColors: true,
            size: resolution.resolvedQuality === 'lite' ? 0.095 : 0.088,
            transparent: true,
            opacity: 0.78,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
          });
          const particleSystem = new THREE.Points(particleGeo, particleMat);
          particleSystem.rotation.x = 0.16;
          scene.add(particleSystem);

          let lastAppliedPaletteId: FocusOrbStyle = initPalette.id;

          const applyEmberColors = (pal: ReturnType<typeof getFocusOrbPalette>) => {
            cEmberA.set(pal.emberPrimaryHex);
            cEmberB.set(pal.emberSecondaryHex);
            for (let i = 0; i < particleCount; i++) {
              cMix.copy(cEmberA).lerp(cEmberB, pSeeds[i * 3 + 2]);
              pColors[i * 3] = cMix.r;
              pColors[i * 3 + 1] = cMix.g;
              pColors[i * 3 + 2] = cMix.b;
            }
            colAttr.needsUpdate = true;
          };

          // Interactive gesture state (zero GC in render loop)
          let dragActive = false;
          let pointerDownTime = 0;
          let pointerDownX = 0;
          let pointerDownY = 0;
          let lastPointerX = 0;
          let lastPointerY = 0;
          let movedDist = 0;
          let velY = 0;
          let velX = 0;
          let userRotY = 0;
          let userRotX = 0;
          let parallaxX = 0;
          let parallaxY = 0;
          let pulseBoost = 0;
          let tapRipple = 0;
          let breatheMode = false;
          let breatheElapsed = 0;
          let breatheTimerId: number | null = null;
          let lastBreatheStage: string | null = null;

          const clearHoldTimer = () => {
            if (breatheTimerId !== null) {
              window.clearTimeout(breatheTimerId);
              breatheTimerId = null;
            }
          };

          const exitBreatheMode = () => {
            clearHoldTimer();
            if (breatheMode) {
              breatheMode = false;
              lastBreatheStage = null;
              propsRef.current.onBreatheStateChange?.(null);
              ctx.requestRender();
            }
          };

          const onPointerDown = (e: PointerEvent) => {
            dragActive = true;
            pointerDownTime = performance.now();
            pointerDownX = e.clientX;
            pointerDownY = e.clientY;
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
            movedDist = 0;
            clearHoldTimer();
            breatheTimerId = window.setTimeout(() => {
              if (dragActive && movedDist < 8) {
                breatheMode = true;
                breatheElapsed = 0;
                lastBreatheStage = 'Inhale (4s)';
                propsRef.current.onBreatheStateChange?.('Inhale (4s)');
                ctx.requestRender();
                if (
                  propsRef.current.hapticsEnabled &&
                  typeof navigator !== 'undefined' &&
                  typeof navigator.vibrate === 'function'
                ) {
                  navigator.vibrate(14);
                }
              }
            }, 460);
          };

          const onPointerMove = (e: PointerEvent) => {
            if (!dragActive && e.target !== canvas) return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              parallaxX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.22;
              parallaxY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.16;
            }
            if (!dragActive) return;
            const dx = e.clientX - lastPointerX;
            const dy = e.clientY - lastPointerY;
            movedDist += Math.hypot(dx, dy);
            if (movedDist >= 8) {
              clearHoldTimer();
            }
            velY += dx * 0.008;
            velX += dy * 0.004;
            userRotY += dx * 0.006;
            userRotX = Math.max(-0.55, Math.min(0.55, userRotX + dy * 0.004));
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
            ctx.requestRender();
          };

          const onPointerUp = (e: PointerEvent) => {
            const elapsedTap = performance.now() - pointerDownTime;
            const distFromStart = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
            if (!breatheMode && elapsedTap < 220 && distFromStart < 8) {
              pulseBoost = 1.0;
              tapRipple = 0.001;
              const rect = canvas.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
                coreUniforms.uTapOrigin.value.set(nx * 0.8, ny * 0.8, 0.9).normalize();
              } else {
                coreUniforms.uTapOrigin.value.set(0, 0, 1);
              }
              ctx.requestRender();
              if (
                propsRef.current.hapticsEnabled &&
                typeof navigator !== 'undefined' &&
                typeof navigator.vibrate === 'function'
              ) {
                navigator.vibrate(12);
              }
            }
            dragActive = false;
            exitBreatheMode();
          };

          canvas.addEventListener('pointerdown', onPointerDown);
          window.addEventListener('pointermove', onPointerMove, { passive: true });
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);

          let currentHeat = 0.16;
          let currentCrimsonWeight = 0.24;
          let currentDim = 0.92;
          let currentEmberSpeed = 0.45;
          let shaderClock = 0;
          let lastMilestoneQuarter = Math.floor(propsRef.current.totalActiveMs / 900000);

          const tCenter = new THREE.Color();
          const tWhiteHot = new THREE.Color();
          const tInnerRim = new THREE.Color();
          const tOuterCorona = new THREE.Color();
          const tWireframe = new THREE.Color();
          const tRingA = new THREE.Color();
          const tRingB = new THREE.Color();
          const tSpriteTint = new THREE.Color();
          const tArcColor = new THREE.Color();
          const breakSoftRim = new THREE.Color('#D8E2F0');
          const breakSoftOuter = new THREE.Color('#64748B');

          return {
            onResize: (w, h) => {
              fitCameraForAspect(w, h);
            },
            onTick: (dt, elapsed) => {
              const p = propsRef.current;
              const isRunning = p.status === 'running';
              const isPaused = p.status === 'paused';

              const pal = getFocusOrbPalette(p.orbStyle);
              if (pal.id !== lastAppliedPaletteId) {
                lastAppliedPaletteId = pal.id;
                applyEmberColors(pal);
              }

              const heatMetrics = computeFocusSessionHeat({
                status: p.status,
                phase: p.phase,
                totalActiveMs: p.totalActiveMs,
                overtimeMs: p.overtimeMs,
              });

              const damp = 1 - Math.exp(-4.2 * dt);
              currentHeat += (heatMetrics.heat - currentHeat) * damp;
              currentCrimsonWeight += (heatMetrics.crimsonWeight - currentCrimsonWeight) * damp;
              currentEmberSpeed += (heatMetrics.emberSpeed - currentEmberSpeed) * damp;
              const desiredDim = isRunning ? 1.05 : isPaused ? 0.56 : 0.92;
              currentDim += (desiredDim - currentDim) * damp;

              tCenter.set(pal.coreCenterHex);
              if (p.phase === 'break') {
                tWhiteHot.set(pal.whiteHotHex).lerp(breakSoftRim, 0.5);
                tInnerRim.set(pal.innerRimHex).lerp(breakSoftRim, 0.55);
                tOuterCorona.set(pal.outerCoronaHex).lerp(breakSoftOuter, 0.72);
                tWireframe.copy(tInnerRim);
                tRingA.copy(tInnerRim);
                tRingB.copy(tOuterCorona);
              } else {
                tWhiteHot.set(pal.whiteHotHex);
                tInnerRim.set(pal.innerRimHex);
                tOuterCorona.set(pal.outerCoronaHex);
                tWireframe.set(pal.wireframeHex);
                tRingA.set(pal.ringPrimaryHex);
                tRingB.set(pal.ringSecondaryHex);
              }

              coreUniforms.uCenterColor.value.lerp(tCenter, damp);
              coreUniforms.uWhiteHotColor.value.lerp(tWhiteHot, damp);
              coreUniforms.uInnerRimColor.value.lerp(tInnerRim, damp);
              coreUniforms.uOuterCoronaColor.value.lerp(tOuterCorona, damp);

              coronaShellUniforms.uWhiteHotColor.value.lerp(tWhiteHot, damp);
              coronaShellUniforms.uInnerRimColor.value.lerp(tInnerRim, damp);
              coronaShellUniforms.uOuterCoronaColor.value.lerp(tOuterCorona, damp);

              tSpriteTint.copy(tInnerRim).lerp(tOuterCorona, currentCrimsonWeight * 0.45);
              coronaSpriteMat.color.lerp(tSpriteTint, damp);
              cageMat.color.lerp(tWireframe, damp);
              ringPrimaryMat.color.lerp(tRingA, damp);
              ringSecondaryMat.color.lerp(tRingB, damp);
              satMat.color.lerp(tWhiteHot, damp);

              shaderClock += dt * (isPaused ? 0.22 : isRunning ? 0.85 + currentHeat * 0.55 : 0.45);
              coreUniforms.uTime.value = shaderClock;
              coronaShellUniforms.uTime.value = shaderClock;

              // Tap pulse + radial ripple decay
              pulseBoost = Math.max(0, pulseBoost - dt * 2.1);
              if (tapRipple > 0) {
                tapRipple += dt * 1.35;
                if (tapRipple >= 1.0) tapRipple = 0;
              }
              coreUniforms.uTapProgress.value = tapRipple;
              coreUniforms.uPulse.value = 0.2 + pulseBoost * 0.9;
              coreUniforms.uHeat.value = currentHeat;
              coreUniforms.uCrimsonWeight.value = currentCrimsonWeight;

              // Press-and-hold 4-4-4 Breathe Scale (smoothly expands core, wireframe cage & corona glow)
              let breatheScale = 1.0;
              let breatheGlowBoost = 0;
              if (breatheMode) {
                breatheElapsed += dt;
                const cycle = breatheElapsed % 12;
                let stageLabel = 'Inhale (4s)';
                if (cycle < 4) {
                  stageLabel = 'Inhale (4s)';
                  const t = cycle / 4;
                  const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
                  breatheScale = 1.0 + 0.14 * ease;
                  breatheGlowBoost = 0.26 * ease;
                } else if (cycle < 8) {
                  stageLabel = 'Hold (4s)';
                  breatheScale = 1.14;
                  breatheGlowBoost = 0.26;
                } else {
                  stageLabel = 'Exhale (4s)';
                  const t = (cycle - 8) / 4;
                  const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
                  breatheScale = 1.14 - 0.14 * ease;
                  breatheGlowBoost = 0.26 * (1 - ease);
                }
                if (stageLabel !== lastBreatheStage) {
                  lastBreatheStage = stageLabel;
                  p.onBreatheStateChange?.(stageLabel);
                }
              }

              coreUniforms.uIntensity.value = currentDim + pulseBoost * 0.28 + breatheGlowBoost;
              coronaShellUniforms.uHeat.value = currentHeat;
              coronaShellUniforms.uCrimsonWeight.value = currentCrimsonWeight;
              coronaShellUniforms.uIntensity.value =
                (0.92 + pulseBoost * 0.26 + breatheGlowBoost) * currentDim;
              coronaSpriteMat.opacity =
                (0.64 + currentHeat * 0.22 + pulseBoost * 0.16 + breatheGlowBoost * 0.65) *
                currentDim;

              // Stopwatch 15-minute milestone concentric rings
              const curQuarter = Math.floor(p.totalActiveMs / 900000);
              if (p.mode === 'stopwatch' && curQuarter > lastMilestoneQuarter && isRunning) {
                lastMilestoneQuarter = curQuarter;
                pulseBoost = 1.0;
                tapRipple = 0.001;
              } else if (curQuarter < lastMilestoneQuarter) {
                lastMilestoneQuarter = curQuarter;
              }

              const activeStopwatchRings =
                p.mode === 'stopwatch' ? Math.min(STOPWATCH_RING_COUNT, curQuarter) : 0;
              for (let rIdx = 0; rIdx < STOPWATCH_RING_COUNT; rIdx++) {
                const entry = stopwatchRingMeshes[rIdx];
                const isLit = rIdx < activeStopwatchRings;
                const targetOp = isLit
                  ? (0.28 + 0.12 * Math.sin(elapsed * 1.7 + rIdx)) * currentDim
                  : 0;
                entry.mat.opacity += (targetOp - entry.mat.opacity) * (1 - Math.exp(-3.5 * dt));
                entry.mat.color.copy(tInnerRim).lerp(tOuterCorona, Math.min(1, rIdx * 0.14));
                entry.mesh.visible = entry.mat.opacity > 0.015;
                if (entry.mesh.visible) {
                  entry.mesh.rotation.z += dt * (rIdx % 2 === 0 ? 0.24 : -0.18);
                }
              }

              cageMat.opacity = (0.11 + currentHeat * 0.025 + breatheGlowBoost * 0.14) * currentDim;
              ringPrimaryMat.opacity = (0.42 + currentHeat * 0.18 + pulseBoost * 0.16) * currentDim;
              ringSecondaryMat.opacity = (0.2 + currentHeat * 0.12) * currentDim;
              outerTickMat.opacity = 0.16 * currentDim;
              particleMat.opacity = (0.64 + currentHeat * 0.24) * currentDim;
              segMat.opacity = 0.86 * currentDim;

              // Commanding scale behind 00:00:00 (~240-265px on 360px mobile)
              const baseOrbScale = 1.04;
              const targetScale = baseOrbScale * (breatheScale + pulseBoost * 0.08);
              coreGroup.scale.setScalar(targetScale);
              const spriteScale =
                4.55 * heatMetrics.coronaScale * (breatheScale + pulseBoost * 0.1);
              coronaSprite.scale.set(spriteScale, spriteScale, 1);

              // Drag inertia + pointer/gyroscope parallax
              userRotY += velY;
              userRotX = Math.max(-0.55, Math.min(0.55, userRotX + velX));
              velY *= Math.exp(-4.0 * dt);
              velX *= Math.exp(-4.0 * dt);

              const px = parallaxX + gyroOffsetRef.current.x;
              const py = parallaxY + gyroOffsetRef.current.y;

              coreGroup.rotation.y += dt * currentEmberSpeed * 0.16;
              coreGroup.rotation.x = Math.sin(elapsed * 0.35) * 0.05 + userRotX + py;
              coreMesh.rotation.y = userRotY + px;

              // Signature slow geodesic wireframe cage counter-rotation
              geodesicCage.rotation.y -= dt * (0.14 + currentHeat * 0.08);
              geodesicCage.rotation.x += dt * 0.075;

              // Razor-thin counter-rotating tilted orbital rings
              ringPrimary.rotation.z += dt * (0.26 + currentHeat * 0.22);
              ringSecondary.rotation.z -= dt * (0.2 + currentHeat * 0.28);
              outerTicks.rotation.z = -elapsed * 0.03;

              // Soft drifting golden & crimson ember stardust orbiting the eclipse
              for (let i = 0; i < particleCount; i++) {
                const idx3 = i * 3;
                const baseAngle = pSeeds[idx3] + elapsed * currentEmberSpeed * 0.14;
                const baseR = pSeeds[idx3 + 1] + currentHeat * 0.06;
                const driftY = Math.sin(baseAngle * 2.0 + elapsed * 0.45) * 0.36;
                const radialWobble = baseR + Math.cos(elapsed * 0.6 + i * 0.21) * 0.06;
                pPositions[idx3] = Math.cos(baseAngle) * radialWobble;
                pPositions[idx3 + 1] = driftY;
                pPositions[idx3 + 2] = Math.sin(baseAngle) * radialWobble * 0.56;
              }
              posAttr.needsUpdate = true;
              particleSystem.rotation.y = userRotY * 0.38 + px * 0.5;

              // Completed Pomodoro Satellite Orbs
              const satCount = Math.min(
                MAX_SATELLITES,
                Math.max(0, Math.floor(p.completedPomodorosToday))
              );
              satInstanced.count = satCount;
              for (let i = 0; i < satCount; i++) {
                const orbitAngle = elapsed * 0.36 + (i / Math.max(1, satCount)) * Math.PI * 2;
                const satR = 2.12;
                dummyPos.set(
                  Math.cos(orbitAngle) * satR,
                  Math.sin(orbitAngle * 2) * 0.2,
                  Math.sin(orbitAngle) * satR * 0.52
                );
                dummyEuler.set(0, 0, 0);
                dummyQuat.setFromEuler(dummyEuler);
                dummyScale.setScalar(1);
                dummyMat4.compose(dummyPos, dummyQuat, dummyScale);
                satInstanced.setMatrixAt(i, dummyMat4);
              }
              if (satCount > 0) {
                satInstanced.instanceMatrix.needsUpdate = true;
              }

              // 60-segment 3D progress arc tinted with Eclipse gold -> crimson heat progression
              const litCount =
                p.mode === 'stopwatch'
                  ? Math.round(((p.totalActiveMs % 60000) / 60000) * ARC_SEGMENTS)
                  : Math.round((Math.max(0, Math.min(100, p.progressPct)) / 100) * ARC_SEGMENTS);

              for (let i = 0; i < ARC_SEGMENTS; i++) {
                if (i < litCount) {
                  const segFrac = i / Math.max(1, ARC_SEGMENTS - 1);
                  tArcColor
                    .copy(tInnerRim)
                    .lerp(tOuterCorona, segFrac * currentCrimsonWeight * 0.72);
                  progressArcInstanced.setColorAt(i, tArcColor);
                } else {
                  progressArcInstanced.setColorAt(i, dimTrackColor);
                }
              }
              if (progressArcInstanced.instanceColor) {
                progressArcInstanced.instanceColor.needsUpdate = true;
              }

              if (
                pulseBoost > 0.01 ||
                tapRipple > 0 ||
                Math.abs(velX) > 0.0005 ||
                Math.abs(velY) > 0.0005 ||
                breatheMode
              ) {
                ctx.requestRender();
              }
            },
            onDispose: () => {
              sceneCtxRef.current = null;
              clearHoldTimer();
              canvas.removeEventListener('pointerdown', onPointerDown);
              window.removeEventListener('pointermove', onPointerMove);
              window.removeEventListener('pointerup', onPointerUp);
              window.removeEventListener('pointercancel', onPointerUp);
              coronaSpriteTex.dispose();
              emberDustTex.dispose();
            },
          };
        }}
      />
    </div>
  );
};
