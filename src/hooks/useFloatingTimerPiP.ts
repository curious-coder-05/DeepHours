import { useCallback, useEffect, useRef, useState } from 'react';
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

  const [inAppPiPOpen, setInAppPiPOpen] = useState(false);
  const [pipCollapsed, setPipCollapsed] = useState(false);
  const [pipGhost, setPipGhost] = useState(false);
  const [pipTopY, setPipTopY] = useState<number>(136);

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

  // Compact wide pill ratio (420x150) with Regain-style obsidian + indigo/emerald neon layout
  const drawCanvasFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 420;
    const H = 150;
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
    const todayTotalMs = getTodaySubjectMs(curState, 'any', todayKey, todayKey, now);

    // 1. Deep Obsidian Base Fill (#090D16)
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = aesthetic === 'retro' ? '#14110D' : '#090D16';
    ctx.fillRect(0, 0, W, H);

    // Subtle ambient glow inside the pill canvas
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    if (aesthetic === 'retro') {
      bgGrad.addColorStop(0, 'rgba(30, 25, 18, 0.96)');
      bgGrad.addColorStop(1, 'rgba(18, 14, 10, 0.98)');
    } else {
      bgGrad.addColorStop(0, 'rgba(15, 23, 42, 0.96)');
      bgGrad.addColorStop(1, 'rgba(9, 13, 22, 0.98)');
    }
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(2, 2, W - 4, H - 4, 12);
    } else {
      ctx.rect(2, 2, W - 4, H - 4);
    }
    ctx.fill();

    // 2. Pill Accent Border (#6366F1 -> #10B981 when studying, #F59E0B when paused)
    const borderGrad = ctx.createLinearGradient(0, 0, W, H);
    if (isPaused) {
      borderGrad.addColorStop(0, '#F59E0B');
      borderGrad.addColorStop(1, '#D97706');
    } else if (aesthetic === 'retro') {
      borderGrad.addColorStop(0, '#F59E0B');
      borderGrad.addColorStop(1, '#B45309');
    } else {
      borderGrad.addColorStop(0, '#6366F1');
      borderGrad.addColorStop(1, '#10B981');
    }

    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = aesthetic === 'minimal' ? 2 : 3.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(2, 2, W - 4, H - 4, 12);
    } else {
      ctx.rect(2, 2, W - 4, H - 4);
    }
    ctx.stroke();

    // 3. Left Circular Glowing Status Orb + Progress Ring
    const orbX = 66;
    const orbY = H / 2;
    const ringR = 44;
    const orbR = 35;

    // Background track ring
    ctx.beginPath();
    ctx.arc(orbX, orbY, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Active progress arc around the orb
    const pct = m ? Math.max(0.06, Math.min(1, m.progressPct / 100)) : 0.12;
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      orbX,
      orbY,
      ringR,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * pct
    );
    ctx.strokeStyle = isPaused ? '#F59E0B' : '#10B981';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    if (aesthetic === 'neon') {
      ctx.shadowColor = isPaused ? '#F59E0B' : '#10B981';
      ctx.shadowBlur = 10;
    }
    ctx.stroke();
    ctx.restore();

    // Inner Glowing Radial Gradient Orb (#6366F1 to #10B981)
    ctx.save();
    const orbGrad = ctx.createRadialGradient(
      orbX - 10,
      orbY - 10,
      4,
      orbX,
      orbY,
      orbR
    );
    if (isPaused) {
      orbGrad.addColorStop(0, '#FBBF24');
      orbGrad.addColorStop(1, '#D97706');
    } else if (aesthetic === 'retro') {
      orbGrad.addColorStop(0, '#F59E0B');
      orbGrad.addColorStop(1, '#92400E');
    } else {
      orbGrad.addColorStop(0, '#6366F1');
      orbGrad.addColorStop(1, '#10B981');
    }
    if (aesthetic === 'neon') {
      ctx.shadowColor = isPaused ? 'rgba(245, 158, 11, 0.55)' : 'rgba(16, 185, 129, 0.55)';
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(orbX, orbY, orbR, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();
    ctx.restore();

    // Play / Pause glyph inside the orb
    ctx.fillStyle = '#FFFFFF';
    if (isRunning) {
      // Pause bars
      const bw = 6;
      const bh = 22;
      ctx.fillRect(orbX - 9, orbY - bh / 2, bw, bh);
      ctx.fillRect(orbX + 3, orbY - bh / 2, bw, bh);
    } else {
      // Play triangle
      ctx.beginPath();
      ctx.moveTo(orbX - 6, orbY - 12);
      ctx.lineTo(orbX - 6, orbY + 12);
      ctx.lineTo(orbX + 12, orbY);
      ctx.closePath();
      ctx.fill();
    }

    // 4. Center/Right Bold Monospace Clock + "Time focused • [Heading]" Subtitle
    const clockMs = m ? (m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs) : 0;
    const totalSec = Math.max(0, Math.floor(clockMs / 1000));
    const hrs = Math.floor(totalSec / 3600);
    const clockStr = hrs > 0 ? fmtHMS(clockMs) : fmtMS(clockMs);

    const textLeft = 128;
    ctx.save();
    if (aesthetic === 'neon') {
      ctx.shadowColor = isPaused ? 'rgba(245, 158, 11, 0.45)' : 'rgba(99, 102, 241, 0.5)';
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = isPaused ? '#FBBF24' : aesthetic === 'retro' ? '#FBBF24' : '#F8FAFC';
    ctx.font =
      aesthetic === 'minimal'
        ? `400 ${hrs > 0 ? 44 : 52}px ui-monospace, "JetBrains Mono", "SF Mono", monospace`
        : `800 ${hrs > 0 ? 46 : 54}px ui-monospace, "JetBrains Mono", "SF Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(clockStr, textLeft, 74);
    ctx.restore();

    // Status pill badge on top-right
    const statusText = isPaused
      ? 'PAUSED'
      : m && m.overtimeMs > 0
        ? `+${fmtMS(m.overtimeMs)}`
        : isRunning
          ? 'FOCUSING'
          : 'READY';
    ctx.fillStyle = isPaused
      ? 'rgba(245, 158, 11, 0.2)'
      : 'rgba(16, 185, 129, 0.2)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(W - 104, 18, 86, 24, 12);
    } else {
      ctx.rect(W - 104, 18, 86, 24);
    }
    ctx.fill();

    ctx.fillStyle = isPaused ? '#FBBF24' : '#34D399';
    ctx.font = '800 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(statusText, W - 61, 34);

    // Subtitle: "Time focused • [Heading]" in muted slate (#94A3B8)
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    const cleanTopic =
      heading.toLowerCase() === activeSub.name.toLowerCase()
        ? `${activeSub.e} ${activeSub.name}`
        : `${activeSub.e} ${heading}`;
    const subtitle = `Time focused • ${cleanTopic}`;
    ctx.fillText(subtitle.slice(0, 31), textLeft, 103);

    // Secondary micro-row: Today's Total & Focus Purity
    ctx.fillStyle = '#64748B';
    ctx.font = '700 12.5px ui-monospace, monospace';
    ctx.fillText(
      `Today ${fmtHMShort(todayTotalMs)}  •  Purity ${m ? m.purity : 100}%`,
      textLeft,
      126
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
    const isPaused = m?.status === 'paused';
    const isRun = m?.status === 'running';
    const clockMs = m ? (m.overtimeMs > 0 ? m.totalActiveMs : m.displayMs) : 0;
    const totalSec = Math.max(0, Math.floor(clockMs / 1000));
    const hrs = Math.floor(totalSec / 3600);
    const clockStr = hrs > 0 ? fmtHMS(clockMs) : fmtMS(clockMs);
    const pct = m ? Math.max(6, Math.min(100, m.progressPct)) : 12;
    const r = 19;
    const circ = 2 * Math.PI * r;
    const dashOffset = circ * (1 - pct / 100);
    const esc = (s: string) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
      );

    docPipWin.document.body.className = `pip-body aesthetic-${aesthetic}`;
    docPipWin.document.body.style.setProperty(
      '--pip-bd',
      isPaused ? '#f59e0b' : aesthetic === 'retro' ? '#d97706' : '#6366f1'
    );
    docPipWin.document.body.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;height:100%;padding:2px 4px;">
        <button data-pip-act="toggle" style="position:relative;width:44px;height:44px;border-radius:999px;border:0;cursor:pointer;background:radial-gradient(circle at 30% 30%, ${isPaused ? '#fbbf24, #d97706' : '#6366f1, #10b981'});color:#fff;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 14px ${isPaused ? 'rgba(245,158,11,0.45)' : 'rgba(16,185,129,0.45)'}">
          <svg width="44" height="44" viewBox="0 0 44 44" style="position:absolute;inset:0;transform:rotate(-90deg);pointer-events:none">
            <circle cx="22" cy="22" r="${r}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2.5"/>
            <circle cx="22" cy="22" r="${r}" fill="none" stroke="${isPaused ? '#fde68a' : '#6ee7b7'}" stroke-width="2.5" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}" stroke-linecap="round"/>
          </svg>
          <span>${isRun ? '⏸' : '▶'}</span>
        </button>
        <div style="flex:1;min-width:0;">
          <div class="pip-clock" style="text-align:left;font-size:24px;margin:0;line-height:1.1;">${clockStr}</div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">
            Time focused • ${esc(sub.e)} ${esc(heading)}
          </div>
        </div>
        ${m ? `<button data-pip-act="stop" title="Finish Session" style="width:28px;height:28px;border-radius:999px;border:1px solid rgba(248,113,113,0.35);background:rgba(239,68,68,0.15);color:#fca5a5;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">⏹</button>` : ''}
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
        width: 280,
        height: 92,
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
                : `Time focused (${elapsedClock}) · Purity ${m ? m.purity : 100}% · Deep Hours`,
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

      // Automatic Picture-in-Picture MediaSession handler for installed PWAs & Android Chrome
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
                // fallback to Document PiP if supported
              }
            }
            await openDocumentPiP();
          }
        );
      } catch {
        // enterpictureinpicture action not supported in this browser version
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

      // Enable automatic Picture-in-Picture when swiping home on Android / desktop Chrome
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
        setInAppPiPOpen(false);
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
        setInAppPiPOpen(false);
        return;
      }

      // Always activate the sleek in-app Regain-style pill
      setInAppPiPOpen(true);
      setPipCollapsed(false);
      setPipGhost(false);

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
      actionsRef.current.onToast('Sleek Floating Pill active');
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
    setInAppPiPOpen(false);
    setPipCollapsed(false);
    setPipGhost(false);
  }, []);

  // Automatically show the sleek floating pill when a timer starts in any mode
  useEffect(() => {
    if (state.activeTimer) {
      setInAppPiPOpen(true);
    }
  }, [ Boolean(state.activeTimer) ]);

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

  // Automatic Picture-in-Picture trigger on visibilitychange when minimizing on Android / PWA
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
          video.requestPictureInPicture().catch(() => {
            // Browser requires Automatic PiP via autoPictureInPicture attribute or enterpictureinpicture handler
          });
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [syncState]);

  return {
    canvasRef,
    videoRef,
    inAppPiPOpen,
    setInAppPiPOpen,
    pipCollapsed,
    setPipCollapsed,
    pipGhost,
    setPipGhost,
    pipTopY,
    setPipTopY,
    togglePiP,
    syncState,
    renderTick,
    closePiP,
  };
}
