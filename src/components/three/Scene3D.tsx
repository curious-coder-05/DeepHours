import React, { Component, useEffect, useRef, useState } from 'react';
import {
  evaluateUi3dEligibility,
  type QualityTier,
  type Ui3dEnvironmentProbe,
  type Ui3dQuality,
  type Ui3dResolution,
  type Ui3dSetting,
} from '../../utils/uiHelpers';

export {
  evaluateUi3dEligibility,
  type QualityTier,
  type Ui3dEnvironmentProbe,
  type Ui3dQuality,
  type Ui3dResolution,
  type Ui3dSetting,
};

export type ThreeModule = typeof import('three');

let cachedWebGlProbe: { supported: boolean; isSoftwareGl: boolean } | null = null;

export function probeBrowserWebGL2(): { supported: boolean; isSoftwareGl: boolean } {
  if (cachedWebGlProbe) return cachedWebGlProbe;
  if (typeof document === 'undefined') {
    return { supported: false, isSoftwareGl: true };
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      powerPreference: 'default',
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      cachedWebGlProbe = { supported: false, isSoftwareGl: true };
      return cachedWebGlProbe;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    cachedWebGlProbe = { supported: true, isSoftwareGl };
    return cachedWebGlProbe;
  } catch {
    cachedWebGlProbe = { supported: false, isSoftwareGl: true };
    return cachedWebGlProbe;
  }
}

export function resolveRuntimeUi3d(
  ui3dSetting: Ui3dSetting = 'auto',
  deskMode = false,
  ui3dQuality: Ui3dQuality = 'auto'
): Ui3dResolution {
  if (typeof window === 'undefined') {
    return {
      enabled: false,
      tier: 'off',
      resolvedQuality: 'off',
      maxDpr: 1,
      antialias: false,
      targetFps: 0,
      particleBudget: 0,
      isSoftwareGl: true,
    };
  }
  if (ui3dSetting === 'off' || deskMode) {
    return evaluateUi3dEligibility({
      ui3dSetting,
      ui3dQuality,
      webgl2Supported: false,
      isSoftwareGl: false,
      prefersReducedMotion: false,
      saveData: false,
      deskMode,
    });
  }

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const saveData = Boolean(nav.connection?.saveData);
  const { supported, isSoftwareGl } = probeBrowserWebGL2();

  return evaluateUi3dEligibility({
    ui3dSetting,
    ui3dQuality,
    webgl2Supported: supported,
    isSoftwareGl,
    prefersReducedMotion,
    saveData,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    deskMode,
  });
}

export interface Scene3DContext {
  THREE: ThreeModule;
  scene: import('three').Scene;
  camera: import('three').PerspectiveCamera;
  renderer: import('three').WebGLRenderer;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  resolution: Ui3dResolution;
  width: number;
  height: number;
  requestRender: () => void;
}

export interface Scene3DControllers {
  /** Called on each animation frame with elapsed seconds (`dt`) and total time (`elapsed`). */
  onTick?: (dt: number, elapsed: number, ctx: Scene3DContext) => void;
  /** Called whenever the container resizes. */
  onResize?: (width: number, height: number, ctx: Scene3DContext) => void;
  /** Optional custom cleanup for scene listeners. Geometries/materials in `scene` are disposed automatically. */
  onDispose?: () => void;
}

export interface Scene3DProps {
  ui3dSetting?: Ui3dSetting;
  ui3dQuality?: Ui3dQuality;
  deskMode?: boolean;
  active?: boolean;
  continuous?: boolean;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  fov?: number;
  cameraPosition?: [number, number, number];
  setup: (ctx: Scene3DContext) => Scene3DControllers | void;
  fallback?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class Scene3DErrorBoundary extends Component<
  { fallback?: React.ReactNode; children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    // Silently fall back to 2D UI if WebGL or Three.js throws
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

function disposeSceneResources(scene: import('three').Scene) {
  scene.traverse((obj) => {
    const mesh = obj as import('three').Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
    }
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        disposeMaterial(m);
      }
    } else if (mat) {
      disposeMaterial(mat);
    }
  });
  scene.clear();
}

function disposeMaterial(mat: import('three').Material) {
  const anyMat = mat as unknown as Record<string, unknown>;
  for (const key of Object.keys(anyMat)) {
    const val = anyMat[key] as { isTexture?: boolean; dispose?: () => void } | null;
    if (val && typeof val === 'object' && val.isTexture && typeof val.dispose === 'function') {
      val.dispose();
    }
  }
  if (typeof mat.dispose === 'function') {
    mat.dispose();
  }
}

const Scene3DInner: React.FC<Scene3DProps> = ({
  ui3dSetting = 'auto',
  ui3dQuality = 'auto',
  deskMode = false,
  active = true,
  continuous = true,
  height = 220,
  className = '',
  style,
  fov = 45,
  cameraPosition = [0, 0, 6],
  setup,
  fallback = null,
  children,
  testId,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;

  const activeRef = useRef(active);
  activeRef.current = active;

  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  const startOrResumeRef = useRef<(() => void) | null>(null);

  const [webglFailed, setWebglFailed] = useState(false);

  const resolution = resolveRuntimeUi3d(ui3dSetting, deskMode, ui3dQuality);

  useEffect(() => {
    if (active) {
      startOrResumeRef.current?.();
    }
  }, [active, continuous]);

  useEffect(() => {
    if (!resolution.enabled || webglFailed) return;
    const container = mountRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let isVisibleInViewport = true;
    let isContextLost = false;
    let rendererInstance: import('three').WebGLRenderer | null = null;
    let sceneInstance: import('three').Scene | null = null;
    let controllers: Scene3DControllers | void = undefined;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let cleanupVisibility: (() => void) | null = null;
    let cleanupContextListeners: (() => void) | null = null;

    // Lazy dynamic import of 'three' so it stays out of the entry bundle
    import('three')
      .then((THREE) => {
        if (disposed || !mountRef.current) return;

        const rect = container.getBoundingClientRect();
        const initW = Math.max(1, Math.floor(rect.width || container.clientWidth || 320));
        const initH = Math.max(
          1,
          Math.floor(rect.height || container.clientHeight || (typeof height === 'number' ? height : 220))
        );

        const renderer = new THREE.WebGLRenderer({
          antialias: resolution.antialias,
          alpha: true,
          powerPreference: resolution.tier === 'lite' ? 'low-power' : 'default',
        });
        rendererInstance = renderer;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.setPixelRatio(
          resolution.isSoftwareGl
            ? 1
            : Math.min(window.devicePixelRatio || 1, resolution.maxDpr)
        );
        renderer.setSize(initW, initH, false);
        renderer.setClearColor(0x000000, 0);

        const canvas = renderer.domElement;
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.touchAction = 'pan-y';

        container.innerHTML = '';
        container.appendChild(canvas);

        const scene = new THREE.Scene();
        sceneInstance = scene;

        const camera = new THREE.PerspectiveCamera(fov, initW / initH, 0.1, 100);
        camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
        camera.lookAt(0, 0, 0);

        let lastTime = performance.now();
        let elapsedTotal = 0;
        let renderBusy = false;
        let renderDirty = false;
        const minFrameIntervalMs =
          resolution.targetFps > 0 ? 1000 / resolution.targetFps : 16.6;
        let lastRenderTs = 0;

        const canRun = () =>
          !disposed &&
          !isContextLost &&
          activeRef.current &&
          isVisibleInViewport &&
          (typeof document === 'undefined' || !document.hidden);

        function afterDraw(cb: () => void) {
          if (disposed || !rendererInstance) return;
          const gl = rendererInstance.getContext() as WebGL2RenderingContext | null;
          if (!gl || typeof gl.fenceSync !== 'function') {
            frameId = window.setTimeout(cb, 80);
            return;
          }
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) return;
            const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (state === gl.UNSIGNALED) {
              frameId = window.setTimeout(poll, 5);
            } else {
              if (sync) gl.deleteSync(sync);
              frameId = window.setTimeout(cb, 80);
            }
          };
          frameId = window.setTimeout(poll, 5);
        }

        const ctx: Scene3DContext = {
          THREE,
          scene,
          camera,
          renderer,
          canvas,
          container,
          resolution,
          width: initW,
          height: initH,
          requestRender: () => {
            if (!canRun()) return;
            if (renderBusy) {
              renderDirty = true;
              return;
            }
            renderBusy = true;
            frameId = window.requestAnimationFrame((now) => {
              renderDirty = false;
              if (!canRun()) {
                renderBusy = false;
                return;
              }
              const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
              lastTime = now;
              elapsedTotal += dt;
              controllers?.onTick?.(dt, elapsedTotal, ctx);
              renderer.render(scene, camera);
              const done = () => {
                renderBusy = false;
                if (renderDirty && canRun()) ctx.requestRender();
              };
              if (resolution.isSoftwareGl) afterDraw(done);
              else done();
            });
          },
        };

        controllers = setupRef.current(ctx);

        if (!resolution.isSoftwareGl) {
          try {
            renderer.compile(scene, camera);
          } catch {
            // Ignore shader pre-warm warnings
          }
        }

        const loop = (now: number) => {
          if (!canRun()) return;
          const deltaMs = now - lastRenderTs;
          if (!resolution.isSoftwareGl && deltaMs < minFrameIntervalMs * 0.85) {
            frameId = window.requestAnimationFrame(loop);
            return;
          }
          lastRenderTs = now;
          const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
          lastTime = now;
          elapsedTotal += dt;

          controllers?.onTick?.(dt, elapsedTotal, ctx);
          renderer.render(scene, camera);

          if (!continuousRef.current) return;
          if (resolution.isSoftwareGl) {
            afterDraw(() => {
              if (canRun() && continuousRef.current) {
                loop(performance.now());
              }
            });
          } else {
            frameId = window.requestAnimationFrame(loop);
          }
        };

        const startOrResume = () => {
          window.cancelAnimationFrame(frameId);
          window.clearTimeout(frameId);
          if (!canRun()) return;
          lastTime = performance.now();
          if (continuousRef.current) {
            frameId = window.requestAnimationFrame(loop);
          } else {
            ctx.requestRender();
          }
        };
        startOrResumeRef.current = startOrResume;

        const pauseLoop = () => {
          window.cancelAnimationFrame(frameId);
          window.clearTimeout(frameId);
          renderBusy = false;
        };

        // ResizeObserver for responsive container sizing
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver((entries) => {
            if (disposed || !rendererInstance) return;
            const entry = entries[0];
            if (!entry) return;
            const w = Math.max(1, Math.floor(entry.contentRect.width));
            const h = Math.max(1, Math.floor(entry.contentRect.height));
            if (w === ctx.width && h === ctx.height) return;
            ctx.width = w;
            ctx.height = h;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
            controllers?.onResize?.(w, h, ctx);
            if (!continuousRef.current) {
              ctx.requestRender();
            }
          });
          resizeObserver.observe(container);
        }

        // IntersectionObserver to pause off-screen canvases
        if (typeof IntersectionObserver !== 'undefined') {
          intersectionObserver = new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (!entry) return;
              isVisibleInViewport = entry.isIntersecting;
              if (isVisibleInViewport) {
                startOrResume();
              } else {
                pauseLoop();
              }
            },
            { threshold: 0.01 }
          );
          intersectionObserver.observe(container);
        }

        // Document visibility listener
        const handleVisibilityChange = () => {
          if (document.hidden) {
            pauseLoop();
          } else {
            startOrResume();
          }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        cleanupVisibility = () =>
          document.removeEventListener('visibilitychange', handleVisibilityChange);

        // WebGL context loss & restoration handlers
        const handleContextLost = (e: Event) => {
          e.preventDefault();
          isContextLost = true;
          pauseLoop();
        };
        const handleContextRestored = () => {
          isContextLost = false;
          startOrResume();
        };
        canvas.addEventListener('webglcontextlost', handleContextLost, false);
        canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
        cleanupContextListeners = () => {
          canvas.removeEventListener('webglcontextlost', handleContextLost);
          canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        };

        startOrResume();
      })
      .catch(() => {
        if (!disposed) {
          setWebglFailed(true);
        }
      });

    return () => {
      disposed = true;
      startOrResumeRef.current = null;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      cleanupVisibility?.();
      cleanupContextListeners?.();
      try {
        controllers?.onDispose?.();
      } catch {
        // ignore dispose errors
      }
      if (sceneInstance) {
        disposeSceneResources(sceneInstance);
      }
      if (rendererInstance) {
        rendererInstance.dispose();
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [
    resolution.enabled,
    resolution.tier,
    resolution.resolvedQuality,
    resolution.antialias,
    resolution.maxDpr,
    resolution.targetFps,
    resolution.particleBudget,
    resolution.isSoftwareGl,
    webglFailed,
    fov,
  ]);

  if (!resolution.enabled || webglFailed) {
    return <>{fallback}</>;
  }

  return (
    <div
      data-testid={testId}
      data-tier={resolution.tier}
      className={`relative overflow-hidden ${className}`.trim()}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        ...style,
      }}
    >
      <div
        ref={mountRef}
        aria-hidden="true"
        className="pointer-events-auto h-full w-full"
      />
      {children}
    </div>
  );
};

export const Scene3D: React.FC<Scene3DProps> = (props) => (
  <Scene3DErrorBoundary fallback={props.fallback}>
    <Scene3DInner {...props} />
  </Scene3DErrorBoundary>
);
