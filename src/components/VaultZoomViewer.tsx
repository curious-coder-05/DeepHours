import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import { IconButton } from './ui';

export interface VaultZoomViewerProps {
  open: boolean;
  src: string | null;
  alt: string;
  caption?: string;
  onClose: () => void;
}

export const VaultZoomViewer: React.FC<VaultZoomViewerProps> = ({
  open,
  src,
  alt,
  caption,
  onClose,
}) => {
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTapTsRef = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      pointersRef.current.clear();
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setScale((s) => Math.min(4, Number((s + 0.5).toFixed(2))));
      } else if (e.key === '-') {
        setScale((s) => {
          const next = Math.max(1, Number((s - 0.5).toFixed(2)));
          if (next === 1) setOffset({ x: 0, y: 0 });
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !src) return null;

  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist: Math.max(1, dist), scale };
      panStartRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const now = Date.now();
      if (now - lastTapTsRef.current < 280) {
        lastTapTsRef.current = 0;
        if (scale > 1.1) {
          resetZoom();
        } else {
          setScale(2.2);
          setOffset({ x: 0, y: 0 });
        }
        return;
      }
      lastTapTsRef.current = now;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: offset.x,
        oy: offset.y,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const next = Math.max(
        1,
        Math.min(4, pinchStartRef.current.scale * (dist / pinchStartRef.current.dist))
      );
      setScale(next);
      if (next <= 1.02) {
        setOffset({ x: 0, y: 0 });
      }
    } else if (pointersRef.current.size === 1 && panStartRef.current && scale > 1.02) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setOffset({
        x: panStartRef.current.ox + dx,
        y: panStartRef.current.oy + dy,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      panStartRef.current = null;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zoom question photo"
      className="dh-vault-zoom-overlay"
      onClick={onClose}
    >
      <div
        className="dh-vault-zoom-topbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--tx)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {caption || 'Pinch or double-tap to zoom'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconButton
            label="Zoom out"
            onClick={() =>
              setScale((s) => {
                const next = Math.max(1, Number((s - 0.5).toFixed(2)));
                if (next === 1) setOffset({ x: 0, y: 0 });
                return next;
              })
            }
          >
            <Minus size={18} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Reset zoom" onClick={resetZoom}>
            <RotateCcw size={18} strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="Zoom in"
            onClick={() => setScale((s) => Math.min(4, Number((s + 0.5).toFixed(2))))}
          >
            <Plus size={18} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Close zoom viewer" onClick={onClose}>
            <X size={20} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      <div
        className="dh-vault-zoom-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: 'center center',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            borderRadius: '10px',
          }}
        />
      </div>
    </div>
  );
};
