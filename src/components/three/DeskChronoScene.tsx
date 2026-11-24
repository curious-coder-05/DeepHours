import React, { useEffect, useRef } from 'react';
import {
  computeChronoState,
  type DeskChronoVisualMode,
} from '../../utils/deskModeHelpers';
import {
  Scene3D,
  type Scene3DContext,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface DeskChronoSceneProps {
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  isRunning: boolean;
  isPaused: boolean;
  isOvertime: boolean;
  isCountdown?: boolean;
  /** Live timer ms (elapsed or remaining) used to drive the sweeping second marker. */
  clockMs: number;
  /** True when the container is CSS-rotated in simulated landscape mode. */
  simLandscape?: boolean;
}

const TICK_COUNT = 60;

// ---------------------------------------------------------------------------
// Fresnel Meridian Gimbal Shader (Crisp architectural metallic rim over #000000)
// ---------------------------------------------------------------------------

const GIMBAL_FRESNEL_VERTEX = `
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

const GIMBAL_FRESNEL_FRAGMENT = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform vec3 uBaseColor;
  uniform vec3 uRimColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float ndotv = clamp(abs(dot(n, v)), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 2.2);

    // Subtle traveling specular glint along the meridian circumference
    float ang = atan(vLocalPos.y, vLocalPos.x);
    float glint = 0.72 + 0.28 * sin(ang * 2.0 - uTime * 0.65);

    vec3 col = mix(uBaseColor, uRimColor, clamp(0.32 + fresnel * 0.95, 0.0, 1.0));
    col *= glint * uIntensity;
    float alpha = clamp((0.36 + fresnel * 0.64) * uOpacity * glint, 0.0, 0.95);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Dark Low-Luminance Obsidian Center Shield (keeps pure #FFFFFF digits razor-sharp)
// ---------------------------------------------------------------------------

const OBSIDIAN_CENTER_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OBSIDIAN_CENTER_FRAGMENT = `
  uniform float uIntensity;
  uniform vec3 uRimTint;
  varying vec2 vUv;

  void main() {
    float r = distance(vUv, vec2(0.5)) * 2.0;
    // Pure pitch-black obsidian shield fading smoothly into #000000 void so clock digits stay razor-sharp
    float rim = smoothstep(0.82, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r));
    vec3 col = uRimTint * rim * 0.025 * uIntensity;
    float alpha = (1.0 - smoothstep(0.76, 1.0, r)) * 0.96;
    gl_FragColor = vec4(col, alpha);
  }
`;

function createSoftGlowSpriteTexture(
  THREE: typeof import('three')
): import('three').CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    g.addColorStop(0.28, 'rgba(255, 240, 184, 0.72)');
    g.addColorStop(0.62, 'rgba(245, 197, 66, 0.22)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMicroMoteTexture(
  THREE: typeof import('three')
): import('three').CanvasTexture {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.42, 'rgba(255, 232, 168, 0.45)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Pitch-black `#000000` Three.js 3D Architectural Orbital Chronometer backdrop for StandBy Desk Mode.
 * Strict thermal budget: `priority="overlay"`, `dpr <= 1.5`, `30 fps`, zero post-processing,
 * pure `#000000` clear color, and live `propsRef` reactivity with zero React re-renders.
 */
export const DeskChronoScene: React.FC<DeskChronoSceneProps> = ({
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  isRunning,
  isPaused,
  isOvertime,
  isCountdown = false,
  clockMs,
  simLandscape = false,
}) => {
  const sceneCtxRef = useRef<Scene3DContext | null>(null);

  const propsRef = useRef({
    isRunning,
    isPaused,
    isOvertime,
    isCountdown,
    clockMs,
    simLandscape,
  });
  propsRef.current = {
    isRunning,
    isPaused,
    isOvertime,
    isCountdown,
    clockMs,
    simLandscape,
  };

  // Trigger on-demand redraws on Lite/software-WebGL whenever clock ticks or visual state changes
  const secBucket = Math.floor(Math.max(0, clockMs) / 1000);
  useEffect(() => {
    sceneCtxRef.current?.requestRender();
  }, [isRunning, isPaused, isOvertime, isCountdown, secBucket, simLandscape]);

  return (
    <Scene3D
      testId="desk-chrono-scene"
      ui3dSetting={ui3dSetting}
      ui3dQuality={ui3dQuality}
      deskMode={false}
      priority="overlay"
      active={true}
      continuous={true}
      maxDpr={1.5}
      maxFps={30}
      height="100%"
      fov={38}
      cameraPosition={[0, 0.12, 6.4]}
      className="dh-desk-chrono-host"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        background: '#000000',
      }}
      setup={(ctx: Scene3DContext) => {
        const { THREE, scene, camera, renderer, resolution } = ctx;
        sceneCtxRef.current = ctx;

        // Enforce pure pitch-black #000000 AMOLED void — zero muddy red fog or haze
        renderer.setClearColor(0x000000, 1);
        scene.background = new THREE.Color(0x000000);

        const fitCameraForAspect = (w: number, h: number) => {
          const aspect = Math.max(0.4, w / Math.max(1, h));
          // Exact FOV=38 (tan(19deg)=0.3443) framing so outer 2.88 bezel + beacon stay ~90% inside frame
          const zVert = 9.05;
          const zHoriz = 9.45 / aspect;
          const safeZ = Math.max(zVert, zHoriz);
          camera.position.set(0, 0.08, safeZ);
          camera.lookAt(0, 0, 0);
        };
        fitCameraForAspect(ctx.width, ctx.height);

        const glowSpriteTex = createSoftGlowSpriteTexture(THREE);
        const moteTex = createMicroMoteTexture(THREE);

        // Master orbital rig (tilted cleanly in 3D space across landscape viewport)
        const chronoRig = new THREE.Group();
        chronoRig.rotation.x = 0.44;
        chronoRig.rotation.z = -0.06;
        scene.add(chronoRig);

        // 1. Dark Low-Luminance Obsidian Center Shield behind digital clock digits
        const centerDiscGeo = new THREE.PlaneGeometry(3.45, 3.45);
        const centerDiscUniforms = {
          uIntensity: { value: 0.9 },
          uRimTint: { value: new THREE.Color('#D4AF37') },
        };
        const centerDiscMat = new THREE.ShaderMaterial({
          uniforms: centerDiscUniforms,
          vertexShader: OBSIDIAN_CENTER_VERTEX,
          fragmentShader: OBSIDIAN_CENTER_FRAGMENT,
          transparent: true,
          depthWrite: false,
        });
        const centerDisc = new THREE.Mesh(centerDiscGeo, centerDiscMat);
        centerDisc.position.set(0, 0, -0.35);
        scene.add(centerDisc);

        // 2. Wide Tilted Champagne-Gold & Dark-Titanium Orbital Ring Bezel
        const mainRingRadius = 2.68;
        const titaniumBezelGeo = new THREE.TorusGeometry(mainRingRadius, 0.022, 12, 128);
        const titaniumBezelUniforms = {
          uTime: { value: 0 },
          uIntensity: { value: 1.0 },
          uOpacity: { value: 0.78 },
          uBaseColor: { value: new THREE.Color('#27241F') },
          uRimColor: { value: new THREE.Color('#D4AF37') },
        };
        const titaniumBezelMat = new THREE.ShaderMaterial({
          uniforms: titaniumBezelUniforms,
          vertexShader: GIMBAL_FRESNEL_VERTEX,
          fragmentShader: GIMBAL_FRESNEL_FRAGMENT,
          transparent: true,
          depthWrite: false,
        });
        const titaniumBezel = new THREE.Mesh(titaniumBezelGeo, titaniumBezelMat);
        chronoRig.add(titaniumBezel);

        // Inner champagne hairline track
        const innerTrackGeo = new THREE.TorusGeometry(2.48, 0.007, 8, 128);
        const innerTrackMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#C5A358'),
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const innerTrack = new THREE.Mesh(innerTrackGeo, innerTrackMat);
        chronoRig.add(innerTrack);

        // Outer dark-titanium structural perimeter ring
        const outerPerimeterGeo = new THREE.TorusGeometry(2.88, 0.008, 8, 128);
        const outerPerimeterMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#524A3E'),
          transparent: true,
          opacity: 0.36,
          depthWrite: false,
        });
        const outerPerimeter = new THREE.Mesh(outerPerimeterGeo, outerPerimeterMat);
        chronoRig.add(outerPerimeter);

        // 3. 60 Instanced Crisp 3D Second Ticks (brighter cardinal 12/3/6/9 ticks)
        const tickGeo = new THREE.BoxGeometry(0.024, 0.13, 0.018);
        const tickMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.94,
        });
        const tickInstanced = new THREE.InstancedMesh(tickGeo, tickMat, TICK_COUNT);
        const scratchMat4 = new THREE.Matrix4();
        const scratchPos = new THREE.Vector3();
        const scratchQuat = new THREE.Quaternion();
        const scratchEuler = new THREE.Euler();
        const scratchScale = new THREE.Vector3();
        const tickColor = new THREE.Color();

        for (let i = 0; i < TICK_COUNT; i++) {
          // 12 o'clock at top (+Y), advancing clockwise
          const angle = Math.PI / 2 - (i / TICK_COUNT) * Math.PI * 2;
          const isCardinal = i % 15 === 0;
          const isMajor = i % 5 === 0;
          const r = mainRingRadius + (isCardinal ? 0.015 : 0);
          scratchPos.set(Math.cos(angle) * r, Math.sin(angle) * r, 0.02);
          scratchEuler.set(0, 0, angle - Math.PI / 2);
          scratchQuat.setFromEuler(scratchEuler);
          if (isCardinal) {
            scratchScale.set(1.85, 1.95, 1.35);
          } else if (isMajor) {
            scratchScale.set(1.25, 1.3, 1.1);
          } else {
            scratchScale.set(0.82, 0.78, 0.85);
          }
          scratchMat4.compose(scratchPos, scratchQuat, scratchScale);
          tickInstanced.setMatrixAt(i, scratchMat4);
          tickInstanced.setColorAt(i, tickColor.set('#3A342B'));
        }
        tickInstanced.instanceMatrix.needsUpdate = true;
        if (tickInstanced.instanceColor) {
          tickInstanced.instanceColor.needsUpdate = true;
        }
        tickInstanced.computeBoundingSphere();
        tickInstanced.frustumCulled = false;
        chronoRig.add(tickInstanced);

        // 4. Glowing Lumen Gold (#F5C542) Live Sweeping Second Marker
        const sweepMarkerGroup = new THREE.Group();
        chronoRig.add(sweepMarkerGroup);

        const needleGeo = new THREE.BoxGeometry(0.036, 0.34, 0.032);
        const needleMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#F5C542'),
          transparent: true,
          opacity: 0.98,
        });
        const needleMesh = new THREE.Mesh(needleGeo, needleMat);
        sweepMarkerGroup.add(needleMesh);

        const beaconGeo = new THREE.OctahedronGeometry(0.072, 0);
        const beaconMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#FFF3C4'),
          transparent: true,
          opacity: 0.96,
        });
        const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
        beaconMesh.position.set(0, 0.14, 0.02);
        sweepMarkerGroup.add(beaconMesh);

        const markerGlowMat = new THREE.SpriteMaterial({
          map: glowSpriteTex,
          color: new THREE.Color('#F5C542'),
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const markerGlowSprite = new THREE.Sprite(markerGlowMat);
        markerGlowSprite.scale.set(0.72, 0.72, 1);
        markerGlowSprite.position.set(0, 0.04, 0.04);
        sweepMarkerGroup.add(markerGlowSprite);

        // 5. Two Ultra-Thin Counter-Rotating Rose Copper & Lumen Gold Meridian Gimbal Arcs
        const gimbalGoldGeo = new THREE.TorusGeometry(2.14, 0.011, 10, 128);
        const gimbalGoldUniforms = {
          uTime: { value: 0 },
          uIntensity: { value: 1.0 },
          uOpacity: { value: 0.56 },
          uBaseColor: { value: new THREE.Color('#7C5C1D') },
          uRimColor: { value: new THREE.Color('#F5C542') },
        };
        const gimbalGoldMat = new THREE.ShaderMaterial({
          uniforms: gimbalGoldUniforms,
          vertexShader: GIMBAL_FRESNEL_VERTEX,
          fragmentShader: GIMBAL_FRESNEL_FRAGMENT,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const gimbalGold = new THREE.Mesh(gimbalGoldGeo, gimbalGoldMat);
        gimbalGold.rotation.set(0.68, 0.34, 0.18);
        scene.add(gimbalGold);

        const gimbalCopperGeo = new THREE.TorusGeometry(2.36, 0.0095, 10, 128);
        const gimbalCopperUniforms = {
          uTime: { value: 0 },
          uIntensity: { value: 1.0 },
          uOpacity: { value: 0.48 },
          uBaseColor: { value: new THREE.Color('#6E3426') },
          uRimColor: { value: new THREE.Color('#E88D67') },
        };
        const gimbalCopperMat = new THREE.ShaderMaterial({
          uniforms: gimbalCopperUniforms,
          vertexShader: GIMBAL_FRESNEL_VERTEX,
          fragmentShader: GIMBAL_FRESNEL_FRAGMENT,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const gimbalCopper = new THREE.Mesh(gimbalCopperGeo, gimbalCopperMat);
        gimbalCopper.rotation.set(-0.56, -0.42, 0.28);
        scene.add(gimbalCopper);

        // 6. Sparse, Subtle Warm-Gold Micro-Motes along the Orbital Plane (avoiding center clock digits)
        const moteCount = resolution.resolvedQuality === 'lite' ? 40 : 68;
        const motePositions = new Float32Array(moteCount * 3);
        const moteSeeds = new Float32Array(moteCount * 3);
        for (let i = 0; i < moteCount; i++) {
          const theta = (i / moteCount) * Math.PI * 2 + (i % 7) * 0.23;
          const r = 2.08 + ((i * 53) % 100) * 0.011;
          const zOff = (((i * 31) % 100) / 100 - 0.5) * 0.65;
          motePositions[i * 3] = Math.cos(theta) * r;
          motePositions[i * 3 + 1] = Math.sin(theta) * r;
          motePositions[i * 3 + 2] = zOff;
          moteSeeds[i * 3] = theta;
          moteSeeds[i * 3 + 1] = r;
          moteSeeds[i * 3 + 2] = zOff;
        }
        const moteGeo = new THREE.BufferGeometry();
        const motePosAttr = new THREE.BufferAttribute(motePositions, 3);
        moteGeo.setAttribute('position', motePosAttr);
        const moteMat = new THREE.PointsMaterial({
          map: moteTex,
          color: new THREE.Color('#F5D276'),
          size: resolution.resolvedQuality === 'lite' ? 0.085 : 0.075,
          transparent: true,
          opacity: 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        });
        const motePoints = new THREE.Points(moteGeo, moteMat);
        chronoRig.add(motePoints);

        // Pre-allocated color targets (zero GC inside render loop)
        const cAccentTarget = new THREE.Color('#F5C542');
        const cAccentCurrent = new THREE.Color('#F5C542');
        const cMeridianTarget = new THREE.Color('#E88D67');
        const cMeridianCurrent = new THREE.Color('#E88D67');
        const cCardinalColor = new THREE.Color('#E8C872');
        const cMajorColor = new THREE.Color('#6F634C');
        const cMinorColor = new THREE.Color('#2E2A23');
        const cBeaconTarget = new THREE.Color('#FFF5CC');
        const cTemp = new THREE.Color();

        let currentIntensity = 1.0;
        let lastClockMs = propsRef.current.clockMs;
        let subSecondDriftMs = 0;
        let shaderClock = 0;

        return {
          onResize: (w, h) => {
            fitCameraForAspect(w, h);
          },
          onTick: (dt, elapsed) => {
            const p = propsRef.current;

            // Smoothly interpolate sub-second sweep between 1Hz timer updates
            if (p.clockMs !== lastClockMs) {
              lastClockMs = p.clockMs;
              subSecondDriftMs = 0;
            } else if (p.isRunning && !p.isPaused) {
              subSecondDriftMs = Math.min(980, subSecondDriftMs + dt * 1000);
            }
            const interpolatedMs = p.isCountdown
              ? Math.max(0, lastClockMs - subSecondDriftMs)
              : lastClockMs + subSecondDriftMs;

            const chrono = computeChronoState({
              isRunning: p.isRunning,
              isPaused: p.isPaused,
              isOvertime: p.isOvertime,
              clockMs: interpolatedMs,
              isCountdown: p.isCountdown,
            });

            const damp = 1 - Math.exp(-3.8 * dt);
            currentIntensity += (chrono.intensity - currentIntensity) * damp;
            cAccentTarget.set(chrono.accentHex);
            cMeridianTarget.set(chrono.meridianHex);
            cAccentCurrent.lerp(cAccentTarget, damp);
            cMeridianCurrent.lerp(cMeridianTarget, damp);

            const modeSpeed =
              chrono.visualMode === 'paused'
                ? 0.22
                : chrono.visualMode === 'overtime'
                  ? 1.32
                  : 1.0;
            shaderClock += dt * modeSpeed;

            // Update bezel & meridian gimbal uniforms
            titaniumBezelUniforms.uTime.value = shaderClock;
            titaniumBezelUniforms.uIntensity.value = currentIntensity;
            titaniumBezelUniforms.uRimColor.value.copy(cAccentCurrent);

            gimbalGoldUniforms.uTime.value = shaderClock;
            gimbalGoldUniforms.uIntensity.value = currentIntensity;
            gimbalGoldUniforms.uRimColor.value.copy(cAccentCurrent);
            gimbalGoldUniforms.uOpacity.value =
              chrono.visualMode === 'paused' ? 0.28 : 0.56;

            gimbalCopperUniforms.uTime.value = -shaderClock * 0.85;
            gimbalCopperUniforms.uIntensity.value = currentIntensity;
            gimbalCopperUniforms.uRimColor.value.copy(cMeridianCurrent);
            gimbalCopperUniforms.uOpacity.value =
              chrono.visualMode === 'paused' ? 0.24 : 0.48;

            centerDiscUniforms.uIntensity.value = currentIntensity;
            centerDiscUniforms.uRimTint.value.copy(cAccentCurrent);

            innerTrackMat.color.copy(cAccentCurrent);
            innerTrackMat.opacity = chrono.visualMode === 'paused' ? 0.14 : 0.28;
            outerPerimeterMat.opacity = chrono.visualMode === 'paused' ? 0.2 : 0.36;

            // Update live sweeping second marker position on the tilted orbital ring
            const sweepAngle = Math.PI / 2 - chrono.secondFraction * Math.PI * 2;
            sweepMarkerGroup.position.set(
              Math.cos(sweepAngle) * mainRingRadius,
              Math.sin(sweepAngle) * mainRingRadius,
              0.04
            );
            sweepMarkerGroup.rotation.z = sweepAngle - Math.PI / 2;
            beaconMesh.rotation.y += dt * 1.4 * modeSpeed;

            needleMat.color.copy(cAccentCurrent);
            markerGlowMat.color.copy(cAccentCurrent);
            markerGlowMat.opacity =
              (chrono.visualMode === 'paused' ? 0.36 : 0.86) +
              0.08 * Math.sin(elapsed * 2.4);
            cBeaconTarget.set(
              chrono.visualMode === 'overtime'
                ? '#FFE4E6'
                : chrono.visualMode === 'paused'
                  ? '#D6A68E'
                  : '#FFF7D6'
            );
            beaconMat.color.lerp(cBeaconTarget, damp);

            // Update 60 instanced tick colors (cardinals brighter, active sweeping trail luminous)
            const activeIdx = chrono.activeTickIndex;
            const visualMode: DeskChronoVisualMode = chrono.visualMode;
            cCardinalColor.set(
              visualMode === 'overtime'
                ? '#FB7185'
                : visualMode === 'paused'
                  ? '#7D5441'
                  : '#EAD086'
            );
            cMajorColor.set(
              visualMode === 'overtime'
                ? '#7F1D1D'
                : visualMode === 'paused'
                  ? '#44322A'
                  : '#706144'
            );
            cMinorColor.set(
              visualMode === 'overtime'
                ? '#3D131C'
                : visualMode === 'paused'
                  ? '#211B18'
                  : '#2E2A22'
            );

            for (let i = 0; i < TICK_COUNT; i++) {
              const distBehind = (activeIdx - i + TICK_COUNT) % TICK_COUNT;
              const isCardinal = i % 15 === 0;
              const isMajor = i % 5 === 0;

              if (distBehind === 0) {
                cTemp.copy(cAccentCurrent);
              } else if (distBehind <= 4) {
                const trailMix = 1 - distBehind / 5;
                cTemp
                  .copy(isCardinal ? cCardinalColor : isMajor ? cMajorColor : cMinorColor)
                  .lerp(cAccentCurrent, trailMix * 0.78);
              } else if (isCardinal) {
                cTemp.copy(cCardinalColor);
              } else if (isMajor) {
                cTemp.copy(cMajorColor);
              } else {
                cTemp.copy(cMinorColor);
              }
              tickInstanced.setColorAt(i, cTemp);
            }
            if (tickInstanced.instanceColor) {
              tickInstanced.instanceColor.needsUpdate = true;
            }

            // Serene 3D gimbal precession & subtle orbital breathing
            chronoRig.rotation.x = 0.42 + Math.sin(elapsed * 0.18) * 0.035;
            chronoRig.rotation.y = Math.cos(elapsed * 0.14) * 0.05;

            gimbalGold.rotation.y += dt * 0.055 * modeSpeed;
            gimbalGold.rotation.z += dt * 0.028 * modeSpeed;
            gimbalCopper.rotation.y -= dt * 0.042 * modeSpeed;
            gimbalCopper.rotation.x += dt * 0.022 * modeSpeed;

            // Sparse warm-gold micro-motes drifting smoothly along the orbital plane
            moteMat.color.copy(cAccentCurrent);
            moteMat.opacity =
              chrono.visualMode === 'paused' ? 0.16 : 0.4 * currentIntensity;
            for (let i = 0; i < moteCount; i++) {
              const idx = i * 3;
              const ang = moteSeeds[idx] + elapsed * 0.048 * modeSpeed;
              const r = moteSeeds[idx + 1];
              const z = moteSeeds[idx + 2] + Math.sin(elapsed * 0.45 + i) * 0.06;
              motePositions[idx] = Math.cos(ang) * r;
              motePositions[idx + 1] = Math.sin(ang) * r;
              motePositions[idx + 2] = z;
            }
            motePosAttr.needsUpdate = true;
          },
          onDispose: () => {
            glowSpriteTex.dispose();
            moteTex.dispose();
            sceneCtxRef.current = null;
          },
        };
      }}
    />
  );
};
