import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  snap?: 'auto' | 'tall';
  'aria-label'?: string;
}

export const Sheet: React.FC<SheetProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  snap = 'auto',
  'aria-label': ariaLabel,
}) => {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && sheetRef.current) {
        const focusables = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const frameId = requestAnimationFrame(() => {
      if (!sheetRef.current) return;
      const autoEl = sheetRef.current.querySelector<HTMLElement>(
        '[autofocus], input, textarea, button'
      );
      if (autoEl) autoEl.focus();
      else sheetRef.current.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dh-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || (typeof title === 'string' ? title : 'Panel')}
        tabIndex={-1}
        className="dh-sheet"
        style={snap === 'tall' ? { minHeight: 'min(78vh, 640px)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dh-sheet-handle" aria-hidden="true" />
        {title && (
          <div className="dh-sheet-head">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  lineHeight: 1.25,
                  color: 'var(--tx)',
                }}
              >
                {title}
              </div>
              {subtitle && (
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--tx-2)',
                    marginTop: '2px',
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
            <IconButton
              aria-label="Close panel"
              size={40}
              variant="ghost"
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <div className="dh-sheet-body">{children}</div>
      </div>
    </div>
  );
};
