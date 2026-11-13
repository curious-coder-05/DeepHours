import React, { useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { ActiveTimerMode, TimerPhase } from '../../types';
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

const CORE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vDisp;

  float noise3(vec3 p) {
    return sin(p.x * 2.7 + uTime * 1.1) * cos(p.y * 2.5 - uTime * 0.9) * sin(p.z * 2.9 + uTime * 0.7);
  }

  void main() {
    float n = noise3(position * 1.45);
    float disp = n * (0.045 + uPulse * 0.055);
    vDisp = disp;
    vec3 displaced = position + normal * disp;
    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vViewPos = -mvPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CORE_FRAGMENT_SHADER = `
  uniform vec3 uBaseColor;
  uniform vec3 uGlowColor;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vDisp;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewPos);
    float fresnel = pow(1.0 - max(0.0, dot(n, v)), 2.25);
    float shimmer = clamp(0.5 + vDisp * 6.0, 0.0, 1.0);
    vec3 col = mix(uBaseColor, uGlowColor, fresnel * 0.85 + shimmer * 0.18);
    col += uGlowColor * fresnel * (0.55 * uIntensity);
    float alpha = clamp(0.76 + fresnel * 0.24, 0.0, 1.0) * clamp(uIntensity, 0.35, 1.15);
    gl_FragColor = vec4(col, alpha);
  }
`;

function createRadialHaloTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.32, 'rgba(255, 255, 255, 0.32)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.07)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const FocusOrbitScene: React.FC<FocusOrbitSceneProps> = ({
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  deskMode,
  status,
  mode,
  phase,
  subjectColor,
  subjectName,
  progressPct,
  totalActiveMs,
  overtimeMs,
  completedPomodorosToday = 0,
  height = 320,
  onBreatheStateChange,
}) => {
  const [ambientPaused, setAmbientPaused] = useState(false);

  const propsRef = useRef({
    status,
    mode,
    phase,
    subjectColor,
    progressPct,
    totalActiveMs,
    overtimeMs,
    completedPomodorosToday,
    ambientPaused,
    onBreatheStateChange,
  });
  propsRef.current = {
    status,
    mode,
    phase,
    subjectColor,
    progressPct,
    totalActiveMs,
    overtimeMs,
    completedPomodorosToday,
    ambientPaused,
    onBreatheStateChange,
  };

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
        Focus core visualization:{' '}
        {status === 'running' ? 'active' : status === 'paused' ? 'paused' : 'ready'},{' '}
        {phase === 'break' ? 'break phase' : 'study phase'}
        {subjectName ? `, ${subjectName}` : ''}, {Math.round(progressPct)}% progress,{' '}
        {completedPomodorosToday} completed pomodoros today.
      </span>

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
        active={!deskMode && !ambientPaused}
        continuous={!ambientPaused}
        height={320}
        fov={42}
        cameraPosition={[0, 0.25, 6.4]}
        className="w-full select-none"
        setup={(ctx: Scene3DContext) => {
          const { THREE, scene, canvas, resolution } = ctx;

          // Warm key + cool sky fill
          const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0b0d10, 0.85);
          scene.add(hemiLight);

          const keyLight = new THREE.DirectionalLight(0xfff3d1, 1.35);
          keyLight.position.set(3.5, 4.5, 5.0);
          scene.add(keyLight);

          const coreGroup = new THREE.Group();
          scene.add(coreGroup);

          const initialAccent = new THREE.Color(propsRef.current.subjectColor || '#F5C451');
          const darkCoreBase = new THREE.Color('#14181F');
          const warmOvertimeColor = new THREE.Color('#F5C451');
          const breakColor = new THREE.Color('#60A5FA');

          // 1. Custom Shader Glowing Core (Fresnel + procedural noise displacement)
          const coreGeo = new THREE.IcosahedronGeometry(0.84, resolution.resolvedQuality === 'lite' ? 3 : 4);
          const coreUniforms = {
            uTime: { value: 0 },
            uPulse: { value: 0.2 },
            uBaseColor: { value: darkCoreBase.clone().lerp(initialAccent, 0.25) },
            uGlowColor: { value: initialAccent.clone() },
            uIntensity: { value: 0.9 },
          };
          const coreMat = new THREE.ShaderMaterial({
            uniforms: coreUniforms,
            vertexShader: CORE_VERTEX_SHADER,
            fragmentShader: CORE_FRAGMENT_SHADER,
            transparent: true,
          });
          const coreMesh = new THREE.Mesh(coreGeo, coreMat);
          coreGroup.add(coreMesh);

          // 2. Additive Halo Sprite Glow
          const haloTexture = createRadialHaloTexture(THREE);
          const haloMat = new THREE.SpriteMaterial({
            map: haloTexture,
            color: initialAccent.clone(),
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const haloSprite = new THREE.Sprite(haloMat);
          haloSprite.scale.set(3.6, 3.6, 1);
          coreGroup.add(haloSprite);

          // 3. Outer Wire Lattice & Equatorial Gimbal Ring
          const shellGeo = new THREE.IcosahedronGeometry(1.14, 1);
          const shellMat = new THREE.MeshStandardMaterial({
            color: initialAccent.clone(),
            roughness: 0.5,
            metalness: 0.25,
            wireframe: true,
            transparent: true,
            opacity: 0.28,
          });
          const shellMesh = new THREE.Mesh(shellGeo, shellMat);
          coreGroup.add(shellMesh);

          const gimbalGeo = new THREE.TorusGeometry(1.48, 0.018, 8, 72);
          const gimbalMat = new THREE.MeshStandardMaterial({
            color: initialAccent.clone(),
            roughness: 0.2,
            metalness: 0.7,
            transparent: true,
            opacity: 0.55,
          });
          const gimbalMesh = new THREE.Mesh(gimbalGeo, gimbalMat);
          gimbalMesh.rotation.x = Math.PI * 0.36;
          coreGroup.add(gimbalMesh);

          // 4. Coronal Flare Ring (illuminates during Overtime Flow or Stopwatch 15m milestones)
          const coronaGeo = new THREE.TorusGeometry(1.76, 0.022, 8, 72);
          const coronaMat = new THREE.MeshBasicMaterial({
            color: warmOvertimeColor,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
          coronaMesh.rotation.x = -Math.PI * 0.26;
          coronaMesh.rotation.y = Math.PI * 0.16;
          coreGroup.add(coronaMesh);

          // 5. Luminous 60-segment Progress Arc (InstancedMesh)
          const segGeo = new THREE.BoxGeometry(0.115, 0.044, 0.044);
          const segMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
          });
          const progressArcInstanced = new THREE.InstancedMesh(segGeo, segMat, ARC_SEGMENTS);
          const dummyMat4 = new THREE.Matrix4();
          const dummyPos = new THREE.Vector3();
          const dummyQuat = new THREE.Quaternion();
          const dummyScale = new THREE.Vector3(1, 1, 1);
          const dummyEuler = new THREE.Euler();
          const segColor = new THREE.Color();
          const dimTrackColor = new THREE.Color('#232A35');

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
          progressArcInstanced.computeBoundingSphere();
          scene.add(progressArcInstanced);

          // 6. Completed Pomodoro Satellite Orbs (InstancedMesh up to 12)
          const satGeo = new THREE.SphereGeometry(0.085, 14, 14);
          const satMat = new THREE.MeshBasicMaterial({
            color: 0xf5c451,
            transparent: true,
            opacity: 0.95,
          });
          const satInstanced = new THREE.InstancedMesh(satGeo, satMat, MAX_SATELLITES);
          satInstanced.count = 0;
          scene.add(satInstanced);

          // 7. Curl-drifting dust cloud (~1500 High / ~400 Lite)
          const particleCount =
            resolution.resolvedQuality === 'lite'
              ? 400
              : Math.max(600, resolution.particleBudget || 1500);
          const pPositions = new Float32Array(particleCount * 3);
          const pSeeds = new Float32Array(particleCount * 2);
          for (let i = 0; i < particleCount; i++) {
            const theta = (i / particleCount) * Math.PI * 2 + (i % 7) * 0.13;
            const rSpread = 1.9 + ((i * 73) % 100) * 0.015;
            const ySpread = ((((i * 37) % 100) / 100) - 0.5) * 1.4;
            pPositions[i * 3] = Math.cos(theta) * rSpread;
            pPositions[i * 3 + 1] = ySpread;
            pPositions[i * 3 + 2] = Math.sin(theta) * rSpread * 0.65;
            pSeeds[i * 2] = theta;
            pSeeds[i * 2 + 1] = rSpread;
          }
          const particleGeo = new THREE.BufferGeometry();
          const posAttr = new THREE.BufferAttribute(pPositions, 3);
          particleGeo.setAttribute('position', posAttr);
          const particleMat = new THREE.PointsMaterial({
            color: initialAccent.clone(),
            size: resolution.resolvedQuality === 'lite' ? 0.05 : 0.038,
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const particleSystem = new THREE.Points(particleGeo, particleMat);
          particleSystem.rotation.x = 0.22;
          scene.add(particleSystem);

          // Interactive gesture state (zero GC in loop)
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
                if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                  navigator.vibrate(14);
                }
              }
            }, 460);
          };

          const onPointerMove = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              parallaxX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.24;
              parallaxY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.18;
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
          };

          const onPointerUp = (e: PointerEvent) => {
            const elapsedTap = performance.now() - pointerDownTime;
            const distFromStart = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
            if (!breatheMode && elapsedTap < 200 && distFromStart < 8) {
              pulseBoost = 1.0;
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
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

          // Animation damping state
          let currentSpeed = 0.4;
          let currentDim = 0.85;
          let currentCoronaOpacity = 0;
          let shaderClock = 0;
          let lastMilestoneQuarter = Math.floor(propsRef.current.totalActiveMs / 900000);
          const targetTint = new THREE.Color();
          const blendedBase = new THREE.Color();

          return {
            onTick: (dt, elapsed) => {
              const p = propsRef.current;
              const isRunning = p.status === 'running';
              const isPaused = p.status === 'paused';
              const isOvertime = p.overtimeMs > 0;

              if (p.phase === 'break') {
                targetTint.copy(breakColor);
              } else if (isOvertime) {
                targetTint.set(p.subjectColor || '#F5C451').lerp(warmOvertimeColor, 0.6);
              } else {
                targetTint.set(p.subjectColor || '#F5C451');
              }

              const damp = 1 - Math.exp(-4.5 * dt);
              coreUniforms.uGlowColor.value.lerp(targetTint, damp);
              blendedBase.copy(darkCoreBase).lerp(targetTint, 0.28);
              coreUniforms.uBaseColor.value.lerp(blendedBase, damp);
              haloMat.color.lerp(targetTint, damp);
              shellMat.color.lerp(targetTint, damp);
              gimbalMat.color.lerp(targetTint, damp);
              particleMat.color.lerp(targetTint, damp);

              const desiredSpeed = isRunning
                ? p.phase === 'break'
                  ? 0.35
                  : isOvertime
                    ? 0.95
                    : 0.62
                : isPaused
                  ? 0.08
                  : 0.25;
              const desiredDim = isRunning ? 1.0 : isPaused ? 0.38 : 0.78;
              currentSpeed += (desiredSpeed - currentSpeed) * damp;
              currentDim += (desiredDim - currentDim) * damp;

              shaderClock += dt * (isPaused ? 0.25 : isRunning ? 1.15 : 0.55);
              coreUniforms.uTime.value = shaderClock;

              // Tap pulse decay
              pulseBoost = Math.max(0, pulseBoost - dt * 2.2);
              coreUniforms.uPulse.value = 0.2 + pulseBoost * 0.95;
              coreUniforms.uIntensity.value = currentDim + pulseBoost * 0.35;

              // Stopwatch 15-minute milestone coronal ring pulse
              const curQuarter = Math.floor(p.totalActiveMs / 900000);
              if (p.mode === 'stopwatch' && curQuarter > lastMilestoneQuarter && isRunning) {
                lastMilestoneQuarter = curQuarter;
                pulseBoost = 1.0;
                currentCoronaOpacity = 0.9;
              } else if (curQuarter < lastMilestoneQuarter) {
                lastMilestoneQuarter = curQuarter;
              }

              const desiredCorona = isOvertime
                ? 0.55 + Math.sin(elapsed * 2.4) * 0.16
                : p.mode === 'stopwatch' && curQuarter > 0
                  ? 0.22
                  : 0;
              currentCoronaOpacity += (desiredCorona - currentCoronaOpacity) * (1 - Math.exp(-2.8 * dt));
              coronaMat.opacity = Math.max(0, Math.min(1, currentCoronaOpacity * currentDim));

              haloMat.opacity = (0.38 + pulseBoost * 0.28) * currentDim;
              shellMat.opacity = 0.28 * currentDim;
              gimbalMat.opacity = 0.56 * currentDim;
              particleMat.opacity = 0.72 * currentDim;
              segMat.opacity = 0.9 * currentDim;

              // Press-and-hold 4-4-4 Breathe Scale
              let breatheScale = 1.0;
              if (breatheMode) {
                breatheElapsed += dt;
                const cycle = breatheElapsed % 12;
                let stageLabel = 'Inhale (4s)';
                if (cycle < 4) {
                  stageLabel = 'Inhale (4s)';
                  const t = cycle / 4;
                  breatheScale = 1.0 + 0.24 * (0.5 - 0.5 * Math.cos(Math.PI * t));
                } else if (cycle < 8) {
                  stageLabel = 'Hold (4s)';
                  breatheScale = 1.24;
                } else {
                  stageLabel = 'Exhale (4s)';
                  const t = (cycle - 8) / 4;
                  breatheScale = 1.24 - 0.24 * (0.5 - 0.5 * Math.cos(Math.PI * t));
                }
                if (stageLabel !== lastBreatheStage) {
                  lastBreatheStage = stageLabel;
                  p.onBreatheStateChange?.(stageLabel);
                }
              }

              const targetScale = breatheScale + pulseBoost * 0.14;
              coreGroup.scale.setScalar(targetScale);

              // Drag inertia & pointer parallax
              userRotY += velY;
              userRotX = Math.max(-0.55, Math.min(0.55, userRotX + velX));
              velY *= Math.exp(-4.0 * dt);
              velX *= Math.exp(-4.0 * dt);

              coreGroup.rotation.y += dt * currentSpeed * 0.85;
              coreGroup.rotation.x = Math.sin(elapsed * 0.45) * 0.1 + userRotX + parallaxY;
              coreMesh.rotation.y = userRotY + parallaxX;
              gimbalMesh.rotation.z += dt * currentSpeed * 0.75;
              coronaMesh.rotation.z -= dt * currentSpeed * 0.95;

              // Curl-style particle drift without allocations
              const stepCount = particleCount;
              for (let i = 0; i < stepCount; i++) {
                const idx3 = i * 3;
                const baseAngle = pSeeds[i * 2] + elapsed * currentSpeed * 0.18;
                const baseR = pSeeds[i * 2 + 1];
                const curlY = Math.sin(baseAngle * 2.0 + elapsed * 0.6) * 0.34;
                const radialWobble = baseR + Math.cos(elapsed * 0.8 + i * 0.17) * 0.08;
                pPositions[idx3] = Math.cos(baseAngle) * radialWobble;
                pPositions[idx3 + 1] = curlY;
                pPositions[idx3 + 2] = Math.sin(baseAngle) * radialWobble * 0.68;
              }
              posAttr.needsUpdate = true;
              particleSystem.rotation.y = userRotY * 0.45 + parallaxX * 0.6;

              // Update Completed Pomodoro Satellite Orbs
              const satCount = Math.min(MAX_SATELLITES, Math.max(0, Math.floor(p.completedPomodorosToday)));
              satInstanced.count = satCount;
              for (let i = 0; i < satCount; i++) {
                const orbitAngle = elapsed * 0.42 + (i / Math.max(1, satCount)) * Math.PI * 2;
                const satR = 2.38;
                dummyPos.set(
                  Math.cos(orbitAngle) * satR,
                  Math.sin(orbitAngle * 2) * 0.24,
                  Math.sin(orbitAngle) * satR * 0.55
                );
                dummyEuler.set(0, 0, 0);
                dummyQuat.setFromEuler(dummyEuler);
                dummyMat4.compose(dummyPos, dummyQuat, dummyScale);
                satInstanced.setMatrixAt(i, dummyMat4);
              }
              if (satCount > 0) {
                satInstanced.instanceMatrix.needsUpdate = true;
              }

              // Update 60-segment 3D progress arc
              const litCount =
                p.mode === 'stopwatch'
                  ? Math.round(((p.totalActiveMs % 60000) / 60000) * ARC_SEGMENTS)
                  : Math.round((Math.max(0, Math.min(100, p.progressPct)) / 100) * ARC_SEGMENTS);

              for (let i = 0; i < ARC_SEGMENTS; i++) {
                progressArcInstanced.setColorAt(i, i < litCount ? targetTint : dimTrackColor);
              }
              if (progressArcInstanced.instanceColor) {
                progressArcInstanced.instanceColor.needsUpdate = true;
              }
            },
            onDispose: () => {
              clearHoldTimer();
              canvas.removeEventListener('pointerdown', onPointerDown);
              window.removeEventListener('pointermove', onPointerMove);
              window.removeEventListener('pointerup', onPointerUp);
              window.removeEventListener('pointercancel', onPointerUp);
              haloTexture.dispose();
            },
          };
        }}
      />
    </div>
  );
};
