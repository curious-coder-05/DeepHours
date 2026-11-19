import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './ui/IconButton';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  snap?: 'auto' | 'tall';
  'aria-label'?: string;
}

/**
 * Reusable frosted-glass BottomSheet for mobile-first ergonomic flows
 * (Focus config, Daily task composer, and upcoming v26 Focus/Vault sheets).
 * Features drag handle pill, darkened blurred backdrop, Escape + backdrop dismiss,
 * focus trap & focus return, overscroll containment, safe-area inset padding,
 * and GPU-only compositor transitions respecting prefers-reduced-motion.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  subtitle,
  footer,
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

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

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
        '[data-sheet-autofocus], [autofocus]'
      );
      if (autoEl) autoEl.focus();
      else sheetRef.current.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === 'function'
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const sheetNode = (
    <div
      className="dh-glass-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || (typeof title === 'string' ? title : 'Sheet')}
        tabIndex={-1}
        className={`dh-glass-sheet ${snap === 'tall' ? 'dh-glass-sheet-tall' : ''}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dh-glass-sheet-handle" aria-hidden="true" />
        {title && (
          <div className="dh-glass-sheet-head">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 className="dh-glass-sheet-title">{title}</h2>
              {subtitle && <p className="dh-glass-sheet-sub">{subtitle}</p>}
            </div>
            <IconButton
              aria-label="Close"
              size={44}
              variant="ghost"
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <div className="dh-glass-sheet-body">{children}</div>
        {footer && <div className="dh-glass-sheet-footer">{footer}</div>}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(sheetNode, document.body)
    : sheetNode;
};
