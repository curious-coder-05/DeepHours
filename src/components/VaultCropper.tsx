import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, RotateCw, Undo2 } from 'lucide-react';
import {
  MIN_CROP_SIZE_PX,
  clampCropRect,
  computeWorkingDimensions,
  drawRotatedSourceToCanvas,
  getDecodedImageSize,
  getRotatedDimensions,
  processVaultImageFromSource,
  type CropRect,
  type ProcessedVaultImage,
  type VaultImageOptions,
} from '../utils/vaultImage';
import { Button, Switch } from './ui';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface VaultCropperProps {
  source: ImageBitmap | HTMLImageElement;
  initialOptions?: VaultImageOptions;
  onCancel: () => void;
  onConfirm: (result: ProcessedVaultImage, options: VaultImageOptions) => void;
  confirmLabel?: string;
}

type DragHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState {
  handle: DragHandle;
  startClientX: number;
  startClientY: number;
  startRect: CropRect;
  scaleToWorkingX: number;
  scaleToWorkingY: number;
}

export const VaultCropper: React.FC<VaultCropperProps> = ({
  source,
  initialOptions,
  onCancel,
  onConfirm,
  confirmLabel = 'Use photo',
}) => {
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [enhanceText, setEnhanceText] = useState<boolean>(
    initialOptions?.enhanceText ?? true
  );
  const [keepColors, setKeepColors] = useState<boolean>(
    initialOptions ? !initialOptions.grayscale : false
  );

  const origSize = useMemo(() => getDecodedImageSize(source), [source]);
  const rotatedWorkingDims = useMemo(() => {
    const rot = getRotatedDimensions(origSize.width, origSize.height, rotationDeg);
    const working = computeWorkingDimensions(rot.width, rot.height);
    return { width: working.width, height: working.height };
  }, [origSize.height, origSize.width, rotationDeg]);

  const [cropRect, setCropRect] = useState<CropRect>(() => {
    const rot = getRotatedDimensions(origSize.width, origSize.height, 0);
    const working = computeWorkingDimensions(rot.width, rot.height);
    const padX = Math.round(working.width * 0.06);
    const padY = Math.round(working.height * 0.06);
    return clampCropRect(
      {
        x: padX,
        y: padY,
        width: Math.max(MIN_CROP_SIZE_PX, working.width - padX * 2),
        height: Math.max(MIN_CROP_SIZE_PX, working.height - padY * 2),
      },
      working.width,
      working.height
    );
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    bytes: number;
    width: number;
    height: number;
  } | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Render working rotated image onto stage canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = rotatedWorkingDims.width;
    canvas.height = rotatedWorkingDims.height;

    const rotOrig = getRotatedDimensions(origSize.width, origSize.height, rotationDeg);
    const norm = ((rotationDeg % 360) + 360) % 360;
    if (norm === 0) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const tempRot = drawRotatedSourceToCanvas(
      source,
      origSize.width,
      origSize.height,
      norm
    );
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tempRot, 0, 0, rotOrig.width, rotOrig.height, 0, 0, canvas.width, canvas.height);
    }
    tempRot.width = 0;
    tempRot.height = 0;
  }, [origSize.height, origSize.width, rotatedWorkingDims.height, rotatedWorkingDims.width, rotationDeg, source]);

  const previewUrlRef = useRef<string | null>(null);

  // Debounced live output preview + byte estimate
  useEffect(() => {
    let cancelled = false;
    setProcessing(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await processVaultImageFromSource(
            source,
            cropRect,
            rotatedWorkingDims,
            rotationDeg,
            { enhanceText, grayscale: !keepColors }
          );
          if (cancelled) return;
          const nextUrl = URL.createObjectURL(res.blob);
          if (cancelled) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
          }
          previewUrlRef.current = nextUrl;
          setPreviewUrl(nextUrl);
          setPreviewMeta({
            bytes: res.bytes,
            width: res.width,
            height: res.height,
          });
        } catch {
          // ignore transient preview error
        } finally {
          if (!cancelled) setProcessing(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cropRect, enhanceText, keepColors, rotatedWorkingDims, rotationDeg, source]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const resetDefaultCrop = useCallback((w: number, h: number) => {
    const padX = Math.round(w * 0.05);
    const padY = Math.round(h * 0.05);
    setCropRect(
      clampCropRect(
        {
          x: padX,
          y: padY,
          width: Math.max(MIN_CROP_SIZE_PX, w - padX * 2),
          height: Math.max(MIN_CROP_SIZE_PX, h - padY * 2),
        },
        w,
        h
      )
    );
  }, []);

  const handleRotate = () => {
    const nextDeg = (rotationDeg + 90) % 360;
    const rot = getRotatedDimensions(origSize.width, origSize.height, nextDeg);
    const nextWorking = computeWorkingDimensions(rot.width, rot.height);
    setRotationDeg(nextDeg);
    resetDefaultCrop(nextWorking.width, nextWorking.height);
  };

  const handleFullImage = () => {
    setCropRect({
      x: 0,
      y: 0,
      width: rotatedWorkingDims.width,
      height: rotatedWorkingDims.height,
    });
  };

  const startDrag = (
    handle: DragHandle,
    e: React.PointerEvent<HTMLElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events without active pointer
    }

    dragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: cropRect,
      scaleToWorkingX: rotatedWorkingDims.width / rect.width,
      scaleToWorkingY: rotatedWorkingDims.height / rect.height,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();

    const dx = Math.round((e.clientX - drag.startClientX) * drag.scaleToWorkingX);
    const dy = Math.round((e.clientY - drag.startClientY) * drag.scaleToWorkingY);
    const s = drag.startRect;
    const maxW = rotatedWorkingDims.width;
    const maxH = rotatedWorkingDims.height;

    if (drag.handle === 'move') {
      setCropRect(
        clampCropRect(
          { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height },
          maxW,
          maxH
        )
      );
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;

    if (drag.handle.includes('w')) {
      left = Math.max(0, Math.min(right - MIN_CROP_SIZE_PX, s.x + dx));
    }
    if (drag.handle.includes('e')) {
      right = Math.min(maxW, Math.max(left + MIN_CROP_SIZE_PX, s.x + s.width + dx));
    }
    if (drag.handle.includes('n')) {
      top = Math.max(0, Math.min(bottom - MIN_CROP_SIZE_PX, s.y + dy));
    }
    if (drag.handle.includes('s')) {
      bottom = Math.min(maxH, Math.max(top + MIN_CROP_SIZE_PX, s.y + s.height + dy));
    }

    setCropRect(
      clampCropRect(
        { x: left, y: top, width: right - left, height: bottom - top },
        maxW,
        maxH
      )
    );
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
  };

  const handleCropKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 12;
    let handled = true;
    if (e.shiftKey) {
      if (e.key === 'ArrowRight') {
        setCropRect((r) =>
          clampCropRect({ ...r, width: r.width + step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else if (e.key === 'ArrowLeft') {
        setCropRect((r) =>
          clampCropRect({ ...r, width: r.width - step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else if (e.key === 'ArrowDown') {
        setCropRect((r) =>
          clampCropRect({ ...r, height: r.height + step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else if (e.key === 'ArrowUp') {
        setCropRect((r) =>
          clampCropRect({ ...r, height: r.height - step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else {
        handled = false;
      }
    } else {
      if (e.key === 'ArrowRight') {
        setCropRect((r) =>
          clampCropRect({ ...r, x: r.x + step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else if (e.key === 'ArrowLeft') {
        setCropRect((r) =>
          clampCropRect({ ...r, x: r.x - step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else if (e.key === 'ArrowDown') {
        setCropRect((r) =>
          clampCropRect({ ...r, y: r.y + step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else if (e.key === 'ArrowUp') {
        setCropRect((r) =>
          clampCropRect({ ...r, y: r.y - step }, rotatedWorkingDims.width, rotatedWorkingDims.height)
        );
      } else {
        handled = false;
      }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const options: VaultImageOptions = {
        enhanceText,
        grayscale: !keepColors,
      };
      const processed = await processVaultImageFromSource(
        source,
        cropRect,
        rotatedWorkingDims,
        rotationDeg,
        options
      );
      onConfirm(processed, options);
    } finally {
      setSubmitting(false);
    }
  };

  const pctLeft = (cropRect.x / rotatedWorkingDims.width) * 100;
  const pctTop = (cropRect.y / rotatedWorkingDims.height) * 100;
  const pctWidth = (cropRect.width / rotatedWorkingDims.width) * 100;
  const pctHeight = (cropRect.height / rotatedWorkingDims.height) * 100;

  const HANDLES: Array<{ id: DragHandle; label: string }> = [
    { id: 'nw', label: 'Resize top-left corner' },
    { id: 'n', label: 'Resize top edge' },
    { id: 'ne', label: 'Resize top-right corner' },
    { id: 'e', label: 'Resize right edge' },
    { id: 'se', label: 'Resize bottom-right corner' },
    { id: 's', label: 'Resize bottom edge' },
    { id: 'sw', label: 'Resize bottom-left corner' },
    { id: 'w', label: 'Resize left edge' },
  ];

  const stageAspectRatio = rotatedWorkingDims.width / rotatedWorkingDims.height;

  return (
    <div
      style={{
        display: 'grid',
        gap: '12px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Top toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          alignItems: 'center',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <Button variant="secondary" size="sm" onClick={handleRotate}>
          <RotateCw size={15} strokeWidth={1.75} aria-hidden="true" />
          Rotate 90°
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => resetDefaultCrop(rotatedWorkingDims.width, rotatedWorkingDims.height)}
        >
          <Undo2 size={15} strokeWidth={1.75} aria-hidden="true" />
          Reset
        </Button>
        <Button variant="secondary" size="sm" onClick={handleFullImage}>
          <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />
          Full image
        </Button>
      </div>

      {/* Crop Stage */}
      <div
        className="dh-crop-stage-wrap"
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div
          ref={stageRef}
          className="dh-crop-stage"
          style={{
            aspectRatio: `${rotatedWorkingDims.width} / ${rotatedWorkingDims.height}`,
            width: `min(100%, calc(min(46vh, 320px) * ${stageAspectRatio}))`,
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas ref={canvasRef} className="dh-crop-canvas" />

          {/* Crop Box overlay */}
          <div
            role="slider"
            tabIndex={0}
            aria-label={`Crop frame ${cropRect.width} by ${cropRect.height}. Use arrow keys to move, Shift plus arrow keys to resize.`}
            aria-valuetext={`${cropRect.width} × ${cropRect.height}`}
            className="dh-crop-box"
            style={{
              left: `${pctLeft}%`,
              top: `${pctTop}%`,
              width: `${pctWidth}%`,
              height: `${pctHeight}%`,
            }}
            onPointerDown={(e) => startDrag('move', e)}
            onKeyDown={handleCropKeyDown}
          >
            <span className="dh-crop-grid-v1" aria-hidden="true" />
            <span className="dh-crop-grid-v2" aria-hidden="true" />
            <span className="dh-crop-grid-h1" aria-hidden="true" />
            <span className="dh-crop-grid-h2" aria-hidden="true" />

            {HANDLES.map((h) => (
              <button
                key={h.id}
                type="button"
                tabIndex={-1}
                aria-label={h.label}
                className={`dh-crop-handle dh-crop-handle-${h.id}`}
                onPointerDown={(e) => startDrag(h.id, e)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Enhance & Color Toggles + Processed Output Preview */}
      <div
        style={{
          display: 'grid',
          gap: '10px',
          padding: '12px',
          borderRadius: '12px',
          background: 'var(--sf-2)',
          border: '1px solid var(--line)',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 12px',
            justifyContent: 'space-between',
            minWidth: 0,
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              margin: 0,
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--tx)',
            }}
          >
            <Switch
              aria-label="Enhance text"
              checked={enhanceText}
              onChange={setEnhanceText}
            />
            <span>Enhance text</span>
          </label>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              margin: 0,
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--tx)',
            }}
          >
            <Switch
              aria-label="Keep colors"
              checked={keepColors}
              onChange={setKeepColors}
            />
            <span>Keep colors</span>
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            paddingTop: '8px',
            borderTop: '1px solid var(--line)',
            minWidth: 0,
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Cropped preview"
              style={{
                width: '72px',
                height: '52px',
                objectFit: 'contain',
                borderRadius: '8px',
                background: 'var(--sf-1)',
                border: '1px solid var(--line)',
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: '72px',
                height: '52px',
                borderRadius: '8px',
                background: 'var(--sf-1)',
                border: '1px solid var(--line)',
                flexShrink: 0,
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>
              {processing ? 'Updating crisp preview…' : 'Ready to save'}
            </div>
            <div
              className="tabular-nums"
              style={{
                fontSize: '13px',
                color: 'var(--tx-2)',
                overflowWrap: 'break-word',
              }}
            >
              {previewMeta
                ? `${previewMeta.width} × ${previewMeta.height} · ${formatBytes(previewMeta.bytes)}`
                : 'Compressing under 150 KB'}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        <Button
          variant="secondary"
          onClick={onCancel}
          style={{ flex: '1 1 88px', whiteSpace: 'nowrap' }}
        >
          Back
        </Button>
        <Button
          variant="primary"
          disabled={submitting}
          onClick={() => void handleConfirm()}
          style={{ flex: '2 1 140px' }}
        >
          {submitting ? 'Processing…' : confirmLabel}
        </Button>
      </div>
    </div>
  );
};
