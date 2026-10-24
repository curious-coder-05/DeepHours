import { useCallback, useEffect, useRef } from 'react';
import type { PulseHabitState } from '../types';
import { ensureAudioEngine } from '../utils/audioEngine';
import {
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getSubject,
  getTimerMetrics,
  getTodaySubjectMs,
  logicalKey,
} from '../utils/studyLogic';

interface FloatingPiPActions {
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onTogglePause: () => void;
  onStopAndReflect: () => void;
  onToast: (msg: string) => void;
}

export function useFloatingTimerPiP(
  state: PulseHabitState,
  actions: FloatingPiPActions
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const docPipWinRef = useRef<Window | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const canvasTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoListenersAttachedRef = useRef(false);
  const syncGuardRef = useRef(false);
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);

  stateRef.current = state;
  actionsRef.current = actions;

  const pushCanvasFrame = useCallback(() => {
    const track = canvasTrackRef.current as
      | (MediaStreamTrack & { requestFrame?: () => void })
      | null;
    if (track && typeof track.requestFrame === 'function') {
      try {
        track.requestFrame();
      } catch {
        // ignore if stream is inactive
      }
    }
  }, []);

  // Full-bleed 16:9 (480x270) rectangular Android Picture-in-Picture canvas
  const drawCanvasFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 480;
    const H = 270;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const curState = stateRef.current;
    const aesthetic = curState.set.timerAesthetic || 'neon';
    const now = Date.now();
    const todayKey = logicalKey(now, curState.set.dayResetHour ?? 4);
    const m = getTimerMetrics(curState, now);
    const isRunning = Boolean(m && m.status === 'running');
    const isPaused = Boolean(m && m.status === 'paused');
    const activeSub = m ? m.subject : getSubject(curState);
    const heading = m ? m.heading : activeSub.name || 'Deep Study Session';
    const dotColor = activeSub.color || '#3b82f6';
    const todayTotalMs = getTodaySubjectMs(curState, 'any', todayKey, todayKey, now);

    // 1. Fill entire 480x270 rectangle with #090D16 (zero rounded outer corners)
    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, W, H);

    // 2. Clean full-bleed rectangular progress border (strokeRect(5, 5, W - 10, H - 10))
    const borderCol = isPaused
      ? '#F59E0B'
      : aesthetic === 'retro'
        ? '#D97706'
        : m && m.overtimeMs > 0
          ? '#10B981'
          : isRunning
            ? '#10B981'
            : dotColor;
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = aesthetic === 'minimal' ? 4 : 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);

    const pct = m ? Math.max(0.05, m.progressPct / 100) : 0;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = aesthetic === 'minimal' ? 4 : 10;
    ctx.beginPath();
    const perim = 2 * (W - 10) + 2 * (H - 10);
    ctx.setLineDash([perim * pct, perim]);
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.setLineDash([]);

    // 3. Top Left: Color dot + Active Session Heading (m.heading)
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(32, 38, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '700 19px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const titleLabel =
      heading.toLowerCase() === activeSub.name.toLowerCase()
        ? `${activeSub.e} ${activeSub.name}`
        : `${activeSub.e} ${heading}`;
    ctx.fillText(titleLabel.slice(0, 26), 48, 45);

    // 4. Top Right: Status badge (STUDYING in #10B981, PAUSED in #F59E0B, or FLOW +OT)
    const statusTxt = isPaused
      ? 'PAUSED'
      : m && m.overtimeMs > 0
        ? 'FLOW +OT'
        : isRunning
          ? 'STUDYING'
          : 'READY';
    const badgeBg = isPaused ? '#F59E0B' : isRunning ? '#10B981' : '#6366F1';
    ctx.fillStyle = badgeBg;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(W - 138, 20, 114, 32, 16);
    } else {
      ctx.rect(W - 138, 20, 114, 32);
    }
    ctx.fill();

    ctx.fillStyle = '#090D16';
    ctx.font = '800 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(statusTxt, W - 81, 41);

    // 5. Center: Large 76px monospace clock (HH:MM:SS) + mode/purity subtitle
    const clockMs = m ? (m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs) : 0;
    const clockStr = fmtHMS(clockMs);

    ctx.save();
    if (aesthetic === 'neon') {
      ctx.shadowColor = isPaused ? '#F59E0B' : borderCol;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = isPaused ? '#FBBF24' : aesthetic === 'retro' ? '#FBBF24' : '#FFFFFF';
    ctx.font =
      aesthetic === 'minimal'
        ? '400 76px ui-monospace, "JetBrains Mono", "SF Mono", monospace'
        : '800 76px ui-monospace, "JetBrains Mono", "SF Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(clockStr, W / 2, 152);
    ctx.restore();

    // Mode / Purity Subtitle
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.textAlign = 'center';
    if (m && m.overtimeMs > 0) {
      ctx.fillStyle = '#10B981';
      ctx.fillText(`OVERTIME +${fmtMS(m.overtimeMs)} · PURITY ${m.purity}%`, W / 2, 194);
    } else if (m) {
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${m.mode.toUpperCase()} · FOCUS PURITY ${m.purity}%`, W / 2, 194);
    } else {
      ctx.fillStyle = '#94A3B8';
      ctx.fillText('DEEP HOURS · PRESS PLAY TO START', W / 2, 194);
    }

    // 6. Bottom Bar: Today Studied: Xh Ym | Active: Xh Ym
    ctx.fillStyle = '#131A2A';
    ctx.fillRect(14, H - 54, W - 28, 40);
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '700 17px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Today Studied: ${fmtHMShort(todayTotalMs)} | Active: ${m ? fmtHMShort(m.totalActiveMs) : '0m'}`,
      W / 2,
      H - 28
    );

    pushCanvasFrame();
  }, [pushCanvasFrame]);

  const renderDocPiP = useCallback(() => {
    const docPipWin = docPipWinRef.current;
    if (!docPipWin || docPipWin.closed) return;
    const curState = stateRef.current;
    const aesthetic = curState.set.timerAesthetic || 'neon';
    const m = getTimerMetrics(curState);
    const sub = m ? m.subject : getSubject(curState);
    const heading = m ? m.heading : sub.name || 'Study Session';
    const dotColor = sub.color || '#3b82f6';
    const isPaused = m?.status === 'paused';
    const isRun = m?.status === 'running';
    const clockMs = m ? (m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs) : 0;
    const clockStr = fmtHMS(clockMs);
    const esc = (s: string) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
      );

    docPipWin.document.body.className = `pip-body aesthetic-${aesthetic}`;
    docPipWin.document.body.style.setProperty(
      '--pip-bd',
      isPaused ? '#f59e0b' : aesthetic === 'retro' ? '#d97706' : '#10b981'
    );
    docPipWin.document.body.innerHTML = `
      <div class="pip-top">
        <span style="display:flex;align-items:center;gap:5px">
          <i class="dot" style="--sc:${esc(dotColor)}"></i>
          ${esc(sub.e)} ${esc(heading.slice(0, 18))}
        </span>
        <span style="color:${isPaused ? '#fbbf24' : '#34d399'}">
          ${m && m.overtimeMs > 0 ? `FLOW +${fmtMS(m.overtimeMs)}` : isPaused ? 'PAUSED' : isRun ? 'STUDYING' : 'READY'}
        </span>
      </div>
      <div class="pip-clock">${clockStr}</div>
      <div class="pip-actions">
        <button data-pip-act="toggle" style="background:${isRun ? '#f59e0b' : '#10b981'};color:#052e16">
          ${isRun ? '⏸ Pause' : isPaused ? '▶ Resume' : '▶ Start'}
        </button>
        ${m ? `<button data-pip-act="stop" style="background:#334155;color:#fca5a5">⏹ Stop</button>` : ''}
      </div>
    `;
  }, []);

  const handleExternalResumeOrStart = useCallback(() => {
    ensureAudioEngine();
    const cur = stateRef.current;
    const now = Date.now();
    if (!cur.activeTimer) {
      actionsRef.current.onStart();
    } else if (cur.activeTimer.status === 'paused') {
      const t = cur.activeTimer;
      const deltaPause = t.pauseStartTs ? Math.max(0, now - t.pauseStartTs) : 0;
      stateRef.current = {
        ...cur,
        activeTimer: {
          ...t,
          status: 'running',
          pauseStartTs: null,
          pausedDurationMs: (t.pausedDurationMs || 0) + deltaPause,
          slicePausedMs: (t.slicePausedMs || 0) + deltaPause,
        },
      };
      actionsRef.current.onResume();
    }
    drawCanvasFrame();
    renderDocPiP();
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // ignore
      }
    }
    const video = videoRef.current;
    if (video && video.paused) {
      syncGuardRef.current = true;
      video
        .play()
        .catch(() => {})
        .finally(() => {
          syncGuardRef.current = false;
        });
    }
  }, [drawCanvasFrame, renderDocPiP]);

  const handleExternalPause = useCallback(() => {
    const cur = stateRef.current;
    const now = Date.now();
    if (cur.activeTimer?.status === 'running') {
      const t = cur.activeTimer;
      stateRef.current = {
        ...cur,
        activeTimer: {
          ...t,
          status: 'paused',
          pauseStartTs: now,
          pauseCount: (t.pauseCount || 0) + 1,
          slicePauseCount: (t.slicePauseCount || 0) + 1,
        },
      };
      actionsRef.current.onPause();
    }
    drawCanvasFrame();
    renderDocPiP();
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused';
      } catch {
        // ignore
      }
    }
  }, [drawCanvasFrame, renderDocPiP]);

  const openDocumentPiP = useCallback(async () => {
    const w = window as unknown as {
      documentPictureInPicture?: {
        requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
      };
    };
    if (!w.documentPictureInPicture) return false;
    try {
      const docPipWin = await w.documentPictureInPicture.requestWindow({
        width: 260,
        height: 130,
      });
      docPipWinRef.current = docPipWin;
      [...document.styleSheets].forEach((ss) => {
        try {
          const cssRules = [...ss.cssRules].map((r) => r.cssText).join('');
          const style = docPipWin.document.createElement('style');
          style.textContent = cssRules;
          docPipWin.document.head.appendChild(style);
        } catch {
          if (ss.href) {
            const link = docPipWin.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = ss.href;
            docPipWin.document.head.appendChild(link);
          }
        }
      });

      docPipWin.document.body.className = 'pip-body';
      renderDocPiP();

      docPipWin.document.body.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const b = target.closest('[data-pip-act]') as HTMLElement | null;
        if (!b) return;
        const act = b.dataset.pipAct;
        if (act === 'toggle') {
          if (!stateRef.current.activeTimer) {
            handleExternalResumeOrStart();
          } else if (stateRef.current.activeTimer.status === 'paused') {
            handleExternalResumeOrStart();
          } else {
            handleExternalPause();
          }
        } else if (act === 'stop') {
          actionsRef.current.onStopAndReflect();
          docPipWin.close();
        }
      });

      docPipWin.addEventListener('pagehide', () => {
        docPipWinRef.current = null;
      });
      return true;
    } catch {
      return false;
    }
  }, [handleExternalPause, handleExternalResumeOrStart, renderDocPiP]);

  const setupMediaSessionHandlers = useCallback(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const curState = stateRef.current;
      const now = Date.now();
      const todayKey = logicalKey(now, curState.set.dayResetHour ?? 4);
      const m = getTimerMetrics(curState, now);
      const sub = m ? m.subject : getSubject(curState);
      const heading = m ? m.heading : sub.name || 'Deep Study Session';
      const liveClock = m
        ? fmtHMS(m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs)
        : '00:00:00';
      const elapsedClock = m ? fmtHMS(m.totalActiveMs) : '00:00:00';

      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `${sub.e} ${sub.name} · ${heading} · ${liveClock}`,
          artist:
            m?.status === 'paused'
              ? `PAUSED (${elapsedClock}) · Deep Hours`
              : m && m.overtimeMs > 0
                ? `FLOW +${fmtMS(m.overtimeMs)} · Purity ${m.purity}% · Deep Hours`
                : `STUDYING (${elapsedClock}) · Purity ${m ? m.purity : 100}% · Deep Hours`,
          album: `Today Studied: ${fmtHMShort(
            getTodaySubjectMs(curState, 'any', todayKey, todayKey, now)
          )}`,
          artwork: [
            {
              src: '/icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
            },
          ],
        });
      }

      navigator.mediaSession.playbackState =
        m?.status === 'running'
          ? 'playing'
          : m?.status === 'paused'
            ? 'paused'
            : 'none';

      navigator.mediaSession.setActionHandler('play', () => {
        handleExternalResumeOrStart();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        handleExternalPause();
      });

      navigator.mediaSession.setActionHandler('stop', () => {
        if (stateRef.current.activeTimer) {
          actionsRef.current.onStopAndReflect();
        }
      });

      try {
        navigator.mediaSession.setActionHandler(
          'enterpictureinpicture' as MediaSessionAction,
          async () => {
            const video = videoRef.current;
            if (
              video &&
              typeof video.requestPictureInPicture === 'function' &&
              !document.pictureInPictureElement
            ) {
              try {
                await video.requestPictureInPicture();
                return;
              } catch {
                // fallback to Document PiP
              }
            }
            await openDocumentPiP();
          }
        );
      } catch {
        // enterpictureinpicture action not supported
      }
    } catch {
      // ignore mediaSession errors
    }
  }, [handleExternalPause, handleExternalResumeOrStart, openDocumentPiP]);

  const initVideoStream = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const { audioTracks } = ensureAudioEngine();
    drawCanvasFrame();

    if (typeof canvas.captureStream === 'function') {
      if (!combinedStreamRef.current) {
        const canvasStream = canvas.captureStream(15);
        canvasTrackRef.current = canvasStream.getVideoTracks()[0] || null;
        combinedStreamRef.current = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks,
        ]);
      } else if (
        audioTracks.length > 0 &&
        combinedStreamRef.current.getAudioTracks().length === 0
      ) {
        audioTracks.forEach((track) => combinedStreamRef.current?.addTrack(track));
      }

      if (video.srcObject !== combinedStreamRef.current) {
        video.srcObject = combinedStreamRef.current;
      }

      // Crucial Android Chrome requirement: keep <video> unmuted with the 0.001 gain oscillator track
      video.muted = false;
      video.removeAttribute('muted');
      video.volume = 1.0;

      (
        video as HTMLVideoElement & {
          autoPictureInPicture?: boolean;
          disablePictureInPicture?: boolean;
        }
      ).autoPictureInPicture = true;
      (
        video as HTMLVideoElement & { disablePictureInPicture?: boolean }
      ).disablePictureInPicture = false;
      video.setAttribute('autopictureinpicture', '');

      if (!videoListenersAttachedRef.current) {
        video.addEventListener('pause', () => {
          if (syncGuardRef.current) return;
          if (stateRef.current.activeTimer?.status === 'running') {
            syncGuardRef.current = true;
            handleExternalPause();
            syncGuardRef.current = false;
          }
        });

        video.addEventListener('play', () => {
          if (syncGuardRef.current) return;
          syncGuardRef.current = true;
          handleExternalResumeOrStart();
          syncGuardRef.current = false;
        });

        videoListenersAttachedRef.current = true;
      }
    }

    setupMediaSessionHandlers();
    try {
      syncGuardRef.current = true;
      await video.play();
    } catch {
      // ignore autoplay block until user gesture
    } finally {
      syncGuardRef.current = false;
    }
    return video;
  }, [
    drawCanvasFrame,
    handleExternalPause,
    handleExternalResumeOrStart,
    setupMediaSessionHandlers,
  ]);

  const togglePiP = useCallback(
    async (forceMode?: 'video' | 'doc') => {
      if (!stateRef.current.activeTimer) {
        actionsRef.current.onStart();
      }

      if (docPipWinRef.current && !docPipWinRef.current.closed) {
        docPipWinRef.current.close();
        docPipWinRef.current = null;
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
        return;
      }

      const pref = forceMode || stateRef.current.set.pipPref || 'video';
      const isAndroid = /Android/i.test(navigator.userAgent);

      if (pref === 'doc' && !isAndroid && 'documentPictureInPicture' in window) {
        const ok = await openDocumentPiP();
        if (ok) {
          actionsRef.current.onToast('Floating Document PiP active');
          return;
        }
      }

      try {
        const video = await initVideoStream();
        if (video && typeof video.requestPictureInPicture === 'function') {
          await video.requestPictureInPicture();
          actionsRef.current.onToast('Floating PiP active · Switch to your lecture app');
          return;
        }
      } catch {
        // fallback below
      }

      if ('documentPictureInPicture' in window) {
        const ok = await openDocumentPiP();
        if (ok) {
          actionsRef.current.onToast('Floating Document PiP active');
          return;
        }
      }

      drawCanvasFrame();
      actionsRef.current.onToast('Timer stream active for Picture-in-Picture');
    },
    [drawCanvasFrame, initVideoStream, openDocumentPiP]
  );

  const syncState = useCallback(() => {
    drawCanvasFrame();
    renderDocPiP();
    setupMediaSessionHandlers();

    const activeTimer = stateRef.current.activeTimer;
    const isRun = activeTimer?.status === 'running';
    const video = videoRef.current;

    if (video) {
      if (activeTimer) {
        (
          video as HTMLVideoElement & { autoPictureInPicture?: boolean }
        ).autoPictureInPicture = true;
        video.setAttribute('autopictureinpicture', '');
      } else {
        (
          video as HTMLVideoElement & { autoPictureInPicture?: boolean }
        ).autoPictureInPicture = false;
        video.removeAttribute('autopictureinpicture');
      }
    }

    if (isRun && !combinedStreamRef.current) {
      void initVideoStream();
      return;
    }

    if (video && combinedStreamRef.current) {
      syncGuardRef.current = true;
      if (isRun && video.paused) {
        ensureAudioEngine();
        video
          .play()
          .catch(() => {})
          .finally(() => {
            syncGuardRef.current = false;
          });
      } else if (!isRun && !video.paused && document.pictureInPictureElement === video) {
        video.pause();
        syncGuardRef.current = false;
      } else {
        syncGuardRef.current = false;
      }
    }
  }, [drawCanvasFrame, initVideoStream, renderDocPiP, setupMediaSessionHandlers]);

  const renderTick = useCallback(() => {
    drawCanvasFrame();
    renderDocPiP();
    if (stateRef.current.activeTimer) {
      setupMediaSessionHandlers();
    }
  }, [drawCanvasFrame, renderDocPiP, setupMediaSessionHandlers]);

  const closePiP = useCallback(() => {
    if (docPipWinRef.current && !docPipWinRef.current.closed) {
      docPipWinRef.current.close();
      docPipWinRef.current = null;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
  }, []);

  useEffect(() => {
    syncState();
  }, [
    state.activeTimer?.status,
    state.activeTimer?.subjectId,
    state.activeTimer?.heading,
    state.activeTimer?.mode,
    state.set.timerAesthetic,
    syncState,
  ]);

  useEffect(() => {
    const onVis = () => {
      syncState();
      if (
        document.visibilityState === 'hidden' &&
        stateRef.current.activeTimer?.status === 'running'
      ) {
        const video = videoRef.current;
        if (
          video &&
          typeof video.requestPictureInPicture === 'function' &&
          !document.pictureInPictureElement
        ) {
          video.requestPictureInPicture().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [syncState]);

  return {
    canvasRef,
    videoRef,
    togglePiP,
    syncState,
    renderTick,
    closePiP,
  };
}
