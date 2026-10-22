import { useCallback, useEffect, useRef, useState } from 'react';
import type { PulseHabitState } from '../types';
import { ensureAudioEngine } from '../utils/audioEngine';
import {
  fmtHMS,
  fmtHMShort,
  fmtMS,
  getHeadingColor,
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

  const [inAppPiPOpen, setInAppPiPOpen] = useState(false);

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

  const drawCanvasFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 480;
    const H = 270;

    const curState = stateRef.current;
    const now = Date.now();
    const todayKey = logicalKey(now, curState.set.dayResetHour ?? 4);
    const m = getTimerMetrics(curState, now);
    const isRunning = m && m.status === 'running';
    const isPaused = m && m.status === 'paused';
    const heading = m ? m.heading : 'Deep Study Session';
    const dotColor = m ? getHeadingColor(heading) : '#6366F1';
    const todayTotalMs = getTodaySubjectMs(curState, 'any', todayKey, todayKey, now);

    // 1. Pure dark #090D16 background
    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, W, H);

    // 2. Bold #10B981 (emerald), #F59E0B (amber paused), or #6366F1 (indigo) progress border
    const borderCol = isPaused
      ? '#F59E0B'
      : m && m.overtimeMs > 0
        ? '#10B981'
        : isRunning
          ? '#10B981'
          : '#6366F1';
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);

    const pct = m ? Math.max(0.05, m.progressPct / 100) : 0;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 10;
    ctx.beginPath();
    const perim = 2 * (W - 10) + 2 * (H - 10);
    ctx.setLineDash([perim * pct, perim]);
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.setLineDash([]);

    // 3. Top Row: Session Heading + Color Dot & Status Badge ("STUDYING" / "PAUSED")
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(32, 38, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '700 20px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`⚡ ${heading}`.slice(0, 24), 48, 45);

    // Status Pill on Top Right
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

    // 4. Center: Large HH:MM:SS Monospace Digits
    const clockStr = m
      ? fmtHMS(m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs)
      : '00:00:00';
    ctx.fillStyle = isPaused ? '#FBBF24' : '#FFFFFF';
    ctx.font = '800 76px ui-monospace, "JetBrains Mono", "SF Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(clockStr, W / 2, 152);

    // Overtime or Purity Subtitle
    ctx.font = '700 18px ui-monospace, monospace';
    if (m && m.overtimeMs > 0) {
      ctx.fillStyle = '#10B981';
      ctx.fillText(`OVERTIME +${fmtMS(m.overtimeMs)} · PURITY ${m.purity}%`, W / 2, 190);
    } else if (m) {
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`${m.mode.toUpperCase()} · FOCUS PURITY ${m.purity}%`, W / 2, 190);
    } else {
      ctx.fillStyle = '#94A3B8';
      ctx.fillText('DEEP HOURS · PRESS PLAY TO START', W / 2, 190);
    }

    // 5. Bottom Bar: Today's Total Hours Studied & Active Session Slice
    ctx.fillStyle = '#131A2A';
    ctx.fillRect(14, H - 54, W - 28, 40);
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '700 17px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Today Studied: ${fmtHMShort(todayTotalMs)}   |   Active: ${m ? fmtHMShort(m.totalActiveMs) : '0m'}`,
      W / 2,
      H - 28
    );

    pushCanvasFrame();
  }, [pushCanvasFrame]);

  const renderDocPiP = useCallback(() => {
    const docPipWin = docPipWinRef.current;
    if (!docPipWin || docPipWin.closed) return;
    const curState = stateRef.current;
    const m = getTimerMetrics(curState);
    const heading = m ? m.heading : 'Study Session';
    const dotColor = getHeadingColor(heading);
    const isPaused = m?.status === 'paused';
    const isRun = m?.status === 'running';
    const esc = (s: string) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
      );

    docPipWin.document.body.style.setProperty('--pip-bd', isPaused ? '#f59e0b' : '#10b981');
    docPipWin.document.body.innerHTML = `
      <div class="pip-top">
        <span style="display:flex;align-items:center;gap:5px">
          <i class="dot" style="--sc:${esc(dotColor)}"></i>
          ⚡ ${esc(heading.slice(0, 16))}
        </span>
        <span style="color:${isPaused ? '#fbbf24' : '#34d399'}">
          ${m && m.overtimeMs > 0 ? `+${fmtMS(m.overtimeMs)}` : isPaused ? 'PAUSED' : isRun ? `${m.purity}%` : 'IDLE'}
        </span>
      </div>
      <div class="pip-clock">${m ? fmtHMS(m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs) : '00:00:00'}</div>
      <div class="pip-actions">
        <button data-pip-act="toggle" style="background:${isRun ? '#f59e0b' : '#10b981'};color:#052e16">
          ${isRun ? '⏸ Pause' : isPaused ? '▶ Resume' : '▶ Start'}
        </button>
        ${m ? `<button data-pip-act="stop" style="background:#334155;color:#fca5a5">⏹ Stop</button>` : ''}
      </div>
    `;
  }, []);

  // Immediate optimistic Play/Resume handler so background PiP controls work without waiting for foreground rAF
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

  // Immediate optimistic Pause handler for background PiP controls
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

  const setupMediaSessionHandlers = useCallback(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const curState = stateRef.current;
      const now = Date.now();
      const todayKey = logicalKey(now, curState.set.dayResetHour ?? 4);
      const m = getTimerMetrics(curState, now);
      const heading = m ? m.heading : 'Deep Study Session';
      const liveClock = m
        ? fmtHMS(m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs)
        : '00:00:00';
      const elapsedClock = m ? fmtHMS(m.totalActiveMs) : '00:00:00';

      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `⚡ ${heading} · ${liveClock}`,
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
    } catch {
      // ignore mediaSession errors
    }
  }, [handleExternalPause, handleExternalResumeOrStart]);

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

      if (!videoListenersAttachedRef.current) {
        video.addEventListener('pause', () => {
          if (syncGuardRef.current) return;
          // Note: When browser minimizes or closes PiP, video may emit 'pause' unless user explicitly paused
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

  const togglePiP = useCallback(
    async (forceMode?: 'video' | 'doc') => {
      if (!stateRef.current.activeTimer) {
        actionsRef.current.onStart();
      }

      if (docPipWinRef.current && !docPipWinRef.current.closed) {
        docPipWinRef.current.close();
        docPipWinRef.current = null;
        setInAppPiPOpen(false);
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
        setInAppPiPOpen(false);
        return;
      }
      if (inAppPiPOpen) {
        setInAppPiPOpen(false);
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

      // Fallback in-app floating PiP preview overlay (for sandboxed iframes / browsers without native PiP)
      drawCanvasFrame();
      setInAppPiPOpen(true);
      actionsRef.current.onToast('Floating Lecture PiP overlay active');
    },
    [drawCanvasFrame, inAppPiPOpen, initVideoStream, openDocumentPiP]
  );

  // Synchronous state sync (NO requestAnimationFrame wrapper, so it works even when document.hidden is true!)
  const syncState = useCallback(() => {
    drawCanvasFrame();
    renderDocPiP();
    setupMediaSessionHandlers();

    const isRun = stateRef.current.activeTimer?.status === 'running';
    if (isRun && !combinedStreamRef.current) {
      void initVideoStream();
      return;
    }

    const video = videoRef.current;
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
    setInAppPiPOpen(false);
  }, []);

  useEffect(() => {
    syncState();
  }, [state.activeTimer?.status, state.activeTimer?.heading, state.activeTimer?.mode, syncState]);

  useEffect(() => {
    const onVis = () => {
      syncState();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [syncState]);

  return {
    canvasRef,
    videoRef,
    inAppPiPOpen,
    setInAppPiPOpen,
    togglePiP,
    syncState,
    renderTick,
    closePiP,
  };
}
