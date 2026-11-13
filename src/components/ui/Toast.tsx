import React from 'react';

export interface ToastProps {
  message: string;
  onUndo?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  onUndo,
  actionLabel,
  onAction,
  onDismiss,
}) => (
  <div
    id="toast"
    className="dh-toast"
    role="status"
    style={onAction ? { cursor: 'pointer' } : undefined}
    onClick={() => {
      if (onAction) onAction();
    }}
  >
    <span>{message}</span>
    {onUndo && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUndo();
          onDismiss?.();
        }}
      >
        Undo
      </button>
    )}
    {onAction && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
      >
        {actionLabel || 'Reload'}
      </button>
    )}
  </div>
);
