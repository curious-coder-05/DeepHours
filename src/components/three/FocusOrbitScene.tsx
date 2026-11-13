import React, { useRef } from 'react';
import type { ActiveTimerMode, TimerPhase } from '../../types';
import { Scene3D, type Scene3DContext, type Ui3dSetting } from './Scene3D';

export interface FocusOrbitSceneProps {
  ui3dSetting?: Ui3dSetting;
  deskMode: boolean;
  status: 'idle' | 'running' | 'paused';
  mode: ActiveTimerMode;
  phase: TimerPhase;
  subjectColor: string;
  progressPct: number;
  totalActiveMs: number;
  overtimeMs: number;
}

const ARC_SEGMENTS = 60;

export const FocusOrbitScene: React.FC<FocusOrbitSceneProps> = ({
  ui3dSetting = 'auto',
  deskMode,
  status,
  mode,
  phase,
  subjectColor,
  progressPct,
  totalActiveMs,
  overtimeMs,
}) => {
  const propsRef = useRef({
    status,
    mode,
    phase,
    subjectColor,
    progressPct,
    totalActiveMs,
    overtimeMs,
  });
  propsRef.current = {
    status,
    mode,
    phase,
    subjectColor,
    progressPct,
    totalActiveMs,
    overtimeMs,
  };

  if (deskMode || ui3dSetting === 'off') {
    return null;
  }

  return (
    <Scene3D
      testId="focus-orbit-scene"
      ui3dSetting={ui3dSetting}
      deskMode={deskMode}
      active={!deskMode}
      continuous={true}
      height={210}
      fov={42}
      cameraPosition={[0, 0.35, 6.2]}
      className="pointer-events-none mx-auto w-full max-w-[440px] select-none"
      setup={(ctx: Scene3DContext) => {
        const { THREE, scene, resolution } = ctx;

        // Warm key light + cool hemisphere fill
        const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0b0d10, 0.85);
        scene.add(hemiLight);

        const keyLight = new THREE.DirectionalLight(0xfff3d1, 1.35);
        keyLight.position.set(3.5, 4.5, 5.0);
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
        rimLight.position.set(-4, -2.5, -3);
        scene.add(rimLight);

        // Composite 4-part low-poly geometric core (THREE.Group)
        const coreGroup = new THREE.Group();
        scene.add(coreGroup);

        const baseColor = new THREE.Color(propsRef.current.subjectColor || '#F5C451');
        const warmOvertimeColor = new THREE.Color('#F5C451');
        const breakColor = new THREE.Color('#60A5FA');

        // 1. Primary silhouette: inner faceted octahedron core
        const innerGeo = new THREE.OctahedronGeometry(0.68, 1);
        const innerMat = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.28,
          metalness: 0.45,
          flatShading: true,
        });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        coreGroup.add(innerMesh);

        // 2. Secondary read: outer low-poly icosahedron lattice shell
        const shellGeo = new THREE.IcosahedronGeometry(0.96, 1);
        const shellMat = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.55,
          metalness: 0.2,
          wireframe: true,
          transparent: true,
          opacity: 0.42,
        });
        const shellMesh = new THREE.Mesh(shellGeo, shellMat);
        coreGroup.add(shellMesh);

        // 3. Accent detail: tilted equatorial gimbal torus
        const gimbalGeo = new THREE.TorusGeometry(1.32, 0.018, 8, 64);
        const gimbalMat = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.22,
          metalness: 0.65,
          transparent: true,
          opacity: 0.62,
        });
        const gimbalMesh = new THREE.Mesh(gimbalGeo, gimbalMat);
        gimbalMesh.rotation.x = Math.PI * 0.36;
        coreGroup.add(gimbalMesh);

        // 4. Secondary harmonic ring (illuminates during Overtime Flow State or Stopwatch minute pulse)
        const harmonicGeo = new THREE.TorusGeometry(1.62, 0.016, 8, 64);
        const harmonicMat = new THREE.MeshBasicMaterial({
          color: warmOvertimeColor,
          transparent: true,
          opacity: 0.0,
        });
        const harmonicMesh = new THREE.Mesh(harmonicGeo, harmonicMat);
        harmonicMesh.rotation.x = -Math.PI * 0.28;
        harmonicMesh.rotation.y = Math.PI * 0.14;
        coreGroup.add(harmonicMesh);

        // 5. 3D Progress Arc using InstancedMesh (60 segments around radius 1.92)
        const segGeo = new THREE.BoxGeometry(0.11, 0.042, 0.042);
        const segMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.88,
        });
        const progressArcInstanced = new THREE.InstancedMesh(segGeo, segMat, ARC_SEGMENTS);
        const dummyMat4 = new THREE.Matrix4();
        const dummyPos = new THREE.Vector3();
        const dummyQuat = new THREE.Quaternion();
        const dummyScale = new THREE.Vector3(1, 1, 1);
        const dummyEuler = new THREE.Euler();
        const segColor = new THREE.Color();
        const dimTrackColor = new THREE.Color('#20252D');

        const arcRadius = 1.94;
        for (let i = 0; i < ARC_SEGMENTS; i++) {
          // Clockwise starting from top (12 o'clock = PI/2)
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

        // 6. Orbiting particle ring (~600 points in Normal mode, ~200 in Lite mode)
        const particleCount = resolution.particleBudget || 200;
        const positions = new Float32Array(particleCount * 3);
        const phases = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) {
          const theta = (i / particleCount) * Math.PI * 2;
          const rSpread = 2.15 + ((i * 73) % 100) * 0.0065;
          const ySpread = ((((i * 37) % 100) / 100) - 0.5) * 0.45;
          positions[i * 3] = Math.cos(theta) * rSpread;
          positions[i * 3 + 1] = ySpread;
          positions[i * 3 + 2] = Math.sin(theta) * rSpread * 0.58;
          phases[i] = theta;
        }
        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
          color: baseColor,
          size: resolution.tier === 'lite' ? 0.055 : 0.045,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        });
        const particleSystem = new THREE.Points(particleGeo, particleMat);
        particleSystem.rotation.x = 0.28;
        scene.add(particleSystem);

        // Animation state variables (zero-GC inside tick)
        let currentSpeed = 0.45;
        let currentDim = 0.85;
        let currentHarmonicOpacity = 0;
        let currentScalePulse = 1;
        let lastCompletedMinute = Math.floor(propsRef.current.totalActiveMs / 60000);
        const targetTint = new THREE.Color();

        return {
          onTick: (dt, elapsed) => {
            const p = propsRef.current;
            const isRunning = p.status === 'running';
            const isPaused = p.status === 'paused';
            const isOvertime = p.overtimeMs > 0;

            // Target color shifts warmer on overtime, blue on break, or subject color
            if (p.phase === 'break') {
              targetTint.copy(breakColor);
            } else if (isOvertime) {
              targetTint.copy( baseColor ).lerp(warmOvertimeColor, 0.55);
            } else {
              targetTint.set(p.subjectColor || '#F5C451');
            }

            const dampFactor = 1 - Math.exp(-4.5 * dt);
            innerMat.color.lerp(targetTint, dampFactor);
            shellMat.color.lerp(targetTint, dampFactor);
            gimbalMat.color.lerp(targetTint, dampFactor);
            particleMat.color.lerp(targetTint, dampFactor);

            // Speed & brightness response to running vs paused vs idle
            const desiredSpeed = isRunning
              ? isOvertime
                ? 0.95
                : 0.62
              : isPaused
                ? 0.0
                : 0.24;
            const desiredDim = isRunning ? 1.0 : isPaused ? 0.38 : 0.72;

            currentSpeed += (desiredSpeed - currentSpeed) * dampFactor;
            currentDim += (desiredDim - currentDim) * dampFactor;

            shellMat.opacity = 0.44 * currentDim;
            gimbalMat.opacity = 0.65 * currentDim;
            particleMat.opacity = 0.78 * currentDim;
            segMat.opacity = 0.88 * currentDim;

            // Stopwatch minute radial pulse detection
            const curMinute = Math.floor(p.totalActiveMs / 60000);
            if (curMinute > lastCompletedMinute && isRunning) {
              lastCompletedMinute = curMinute;
              currentScalePulse = 1.16;
              currentHarmonicOpacity = 0.85;
            } else if (curMinute < lastCompletedMinute) {
              lastCompletedMinute = curMinute;
            }

            currentScalePulse += (1.0 - currentScalePulse) * (1 - Math.exp(-3.2 * dt));
            const desiredHarmonic = isOvertime
              ? 0.58 + Math.sin(elapsed * 2.4) * 0.14
              : 0.0;
            currentHarmonicOpacity +=
              (desiredHarmonic - currentHarmonicOpacity) * (1 - Math.exp(-2.8 * dt));

            harmonicMat.opacity = Math.max(0, Math.min(1, currentHarmonicOpacity * currentDim));
            coreGroup.scale.setScalar(currentScalePulse);

            // Advance rotations smoothly
            coreGroup.rotation.y += dt * currentSpeed;
            coreGroup.rotation.x = Math.sin(elapsed * 0.5) * 0.12;
            gimbalMesh.rotation.z += dt * currentSpeed * 0.8;
            harmonicMesh.rotation.z -= dt * currentSpeed * 1.1;
            particleSystem.rotation.y += dt * currentSpeed * 0.55;

            // Update 3D progress arc colors
            const litCount =
              p.mode === 'stopwatch'
                ? Math.round(((p.totalActiveMs % 60000) / 60000) * ARC_SEGMENTS)
                : Math.round((Math.max(0, Math.min(100, p.progressPct)) / 100) * ARC_SEGMENTS);

            for (let i = 0; i < ARC_SEGMENTS; i++) {
              if (i < litCount) {
                segColor.copy(targetTint);
              } else {
                segColor.copy(dimTrackColor);
              }
              progressArcInstanced.setColorAt(i, segColor);
            }
            if (progressArcInstanced.instanceColor) {
              progressArcInstanced.instanceColor.needsUpdate = true;
            }
          },
        };
      }}
    />
  );
};
