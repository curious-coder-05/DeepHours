import React, { useEffect } from 'react';
import { Award, Flame, Sparkles, X } from 'lucide-react';
import type { RewardMilestonePayload } from '../../utils/scene3dHelpers';
import { Button } from '../ui/Button';
import {
  resolveRuntimeUi3d,
  Scene3D,
  type Scene3DContext,
  type Ui3dQuality,
  type Ui3dSetting,
} from './Scene3D';

export interface RewardBurstDialogProps {
  burst: RewardMilestonePayload | null;
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  sndEnabled?: boolean;
  onClose: () => void;
}

const CONFETTI_PALETTE = [
  0xf5c451,
  0x4ade80,
  0x60a5fa,
  0xf472b6,
  0x34d399,
  0xfb923c,
];

function createBadgeGlowTexture(THREE: typeof import('three')): import('three').CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
    g.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const RewardBurstDialog: React.FC<RewardBurstDialogProps> = ({
  burst,
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  sndEnabled = true,
  onClose,
}) => {
  useEffect(() => {
    if (!burst) return;
    if (
      sndEnabled &&
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      navigator.vibrate([22, 40, 65]);
    }
    const timer = window.setTimeout(() => {
      onClose();
    }, 2800);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [burst, sndEnabled, onClose]);

  if (!burst) return null;

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const runtime3d = resolveRuntimeUi3d(ui3dSetting, false, ui3dQuality);
  const show3dBurst = runtime3d.enabled && !prefersReducedMotion;

  const FallbackIcon =
    burst.kind === 'streak7' || burst.kind === 'streak30'
      ? Flame
      : burst.kind === 'levelUp'
        ? Award
        : Sparkles;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={burst.title}
      data-testid="reward-burst-dialog"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--line-strong,var(--line))] bg-[var(--sf-1)] p-5 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close celebration"
          className="absolute top-3 right-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--sf-2)] text-[var(--tx-2)] hover:text-[var(--tx)]"
        >
          <X size={16} />
        </button>

        {show3dBurst ? (
          <div className="mb-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[#0B0F17]">
            <Scene3D
              testId="reward-burst-scene"
              ui3dSetting={ui3dSetting}
              ui3dQuality={ui3dQuality}
              priority="overlay"
              active={true}
              continuous={true}
              height={220}
              fov={42}
              cameraPosition={[0, 0.2, 5.4]}
              setup={(ctx: Scene3DContext) => {
                const { THREE, scene, resolution } = ctx;

                const hemi = new THREE.HemisphereLight(0xfff4d6, 0x111827, 1.35);
                scene.add(hemi);

                const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
                keyLight.position.set(3, 5, 6);
                scene.add(keyLight);

                const badgeColor = new THREE.Color(burst.accentColor || '#F5C451');

                // Beveled 3D Star/Hex Medallion via ExtrudeGeometry
                const shape = new THREE.Shape();
                const points = 8;
                const outerR = 0.92;
                const innerR = 0.68;
                for (let i = 0; i < points * 2; i++) {
                  const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
                  const r = i % 2 === 0 ? outerR : innerR;
                  const px = Math.cos(angle) * r;
                  const py = Math.sin(angle) * r;
                  if (i === 0) shape.moveTo(px, py);
                  else shape.lineTo(px, py);
                }
                shape.closePath();

                const badgeGeo = new THREE.ExtrudeGeometry(shape, {
                  depth: 0.16,
                  bevelEnabled: true,
                  bevelThickness: 0.05,
                  bevelSize: 0.04,
                  bevelSegments: 2,
                });
                badgeGeo.center();

                const badgeMat = new THREE.MeshStandardMaterial({
                  color: badgeColor,
                  roughness: 0.22,
                  metalness: 0.72,
                });
                const badgeMesh = new THREE.Mesh(badgeGeo, badgeMat);
                scene.add(badgeMesh);

                const glowTex = createBadgeGlowTexture(THREE);
                const glowMat = new THREE.SpriteMaterial({
                  map: glowTex,
                  color: badgeColor,
                  transparent: true,
                  opacity: 0.55,
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                });
                const glowSprite = new THREE.Sprite(glowMat);
                glowSprite.scale.set(3.4, 3.4, 1);
                glowSprite.position.z = -0.35;
                scene.add(glowSprite);

                // 3D Confetti Burst (InstancedMesh)
                const confettiCount = resolution.resolvedQuality === 'lite' ? 48 : 110;
                const confGeo = new THREE.BoxGeometry(0.11, 0.16, 0.025);
                const confMat = new THREE.MeshStandardMaterial({
                  color: 0xffffff,
                  roughness: 0.35,
                  metalness: 0.25,
                });
                const confMesh = new THREE.InstancedMesh(confGeo, confMat, confettiCount);
                confMesh.frustumCulled = false;

                const velocities = new Float32Array(confettiCount * 3);
                const positions = new Float32Array(confettiCount * 3);
                const rotSpeeds = new Float32Array(confettiCount * 3);
                const cColor = new THREE.Color();

                for (let i = 0; i < confettiCount; i++) {
                  const angle = (i / confettiCount) * Math.PI * 2 + (i % 5) * 0.2;
                  const speed = 2.2 + ((i * 37) % 10) * 0.28;
                  velocities[i * 3] = Math.cos(angle) * speed;
                  velocities[i * 3 + 1] = 1.6 + ((i * 19) % 10) * 0.34;
                  velocities[i * 3 + 2] = Math.sin(angle) * (speed * 0.55);
                  positions[i * 3] = 0;
                  positions[i * 3 + 1] = 0;
                  positions[i * 3 + 2] = 0.15;
                  rotSpeeds[i * 3] = 3 + (i % 4);
                  rotSpeeds[i * 3 + 1] = 4 + (i % 5);
                  rotSpeeds[i * 3 + 2] = 2 + (i % 3);

                  cColor.setHex(CONFETTI_PALETTE[i % CONFETTI_PALETTE.length]);
                  confMesh.setColorAt(i, cColor);
                }
                if (confMesh.instanceColor) {
                  confMesh.instanceColor.needsUpdate = true;
                }
                scene.add(confMesh);

                const dummyMat = new THREE.Matrix4();
                const dummyPos = new THREE.Vector3();
                const dummyQuat = new THREE.Quaternion();
                const dummyEuler = new THREE.Euler();
                const dummyScale = new THREE.Vector3(1, 1, 1);

                return {
                  onTick: (dt, elapsed) => {
                    const entranceScale = Math.min(1, elapsed * 3.8);
                    const spring =
                      entranceScale < 1
                        ? 0.4 + 0.6 * Math.sin((entranceScale * Math.PI) / 2)
                        : 1;
                    badgeMesh.scale.setScalar(spring);
                    badgeMesh.rotation.y = elapsed * 1.45;
                    badgeMesh.rotation.x = Math.sin(elapsed * 2.1) * 0.18;
                    glowMat.opacity = 0.44 + Math.sin(elapsed * 3.5) * 0.14;

                    for (let i = 0; i < confettiCount; i++) {
                      const idx3 = i * 3;
                      velocities[idx3 + 1] -= dt * 3.8; // Gravity
                      positions[idx3] += velocities[idx3] * dt;
                      positions[idx3 + 1] += velocities[idx3 + 1] * dt;
                      positions[idx3 + 2] += velocities[idx3 + 2] * dt;

                      const fadeScale = Math.max(0.05, 1 - elapsed / 2.8);
                      dummyPos.set(positions[idx3], positions[idx3 + 1], positions[idx3 + 2]);
                      dummyEuler.set(
                        rotSpeeds[idx3] * elapsed,
                        rotSpeeds[idx3 + 1] * elapsed,
                        rotSpeeds[idx3 + 2] * elapsed
                      );
                      dummyQuat.setFromEuler(dummyEuler);
                      dummyScale.setScalar(fadeScale);
                      dummyMat.compose(dummyPos, dummyQuat, dummyScale);
                      confMesh.setMatrixAt(i, dummyMat);
                    }
                    confMesh.instanceMatrix.needsUpdate = true;
                  },
                  onDispose: () => {
                    glowTex.dispose();
                  },
                };
              }}
            />
          </div>
        ) : (
          <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border-2 border-[var(--ac-bd)] bg-[var(--ac-soft)]">
            <FallbackIcon
              size={40}
              strokeWidth={1.75}
              style={{ color: burst.accentColor || 'var(--ac-ink)' }}
              aria-hidden="true"
            />
          </div>
        )}

        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ac-bd)] bg-[var(--ac-soft)] px-3 py-1 text-[13px] font-semibold text-[var(--ac-ink)]">
          <Sparkles size={13} aria-hidden="true" />
          {burst.badgeText}
        </span>

        <h3 className="mt-2.5 text-[20px] font-bold text-[var(--tx)]">
          {burst.title}
        </h3>
        <p className="mt-1 text-[14px] leading-snug text-[var(--tx-2)]">
          {burst.subtitle}
        </p>

        <div className="mt-4">
          <Button variant="primary" size="md" fullWidth onClick={onClose}>
            Keep going
          </Button>
        </div>
      </div>
    </div>
  );
};
