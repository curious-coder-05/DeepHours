import React from 'react';
import { Sheet } from './ui/Sheet';

export interface KeyboardShortcutsSheetProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_ROWS: Array<{ keys: string; description: string }> = [
  { keys: 'Ctrl / Cmd + K', description: 'Open command palette (screens, chapters & actions)' },
  { keys: 'Space', description: 'Start or pause focus timer (when not typing in a field)' },
  { keys: 'N', description: 'Add a new daily task on Today' },
  { keys: '1', description: 'Switch to Today tab' },
  { keys: '2', description: 'Switch to Prep tab' },
  { keys: '3', description: 'Switch to Focus tab' },
  { keys: '4', description: 'Switch to Insights tab' },
  { keys: '5', description: 'Switch to Community tab' },
  { keys: '?', description: 'Show this keyboard shortcuts sheet' },
  { keys: 'Esc', description: 'Close active sheet, dialog, or command palette' },
];

export const KeyboardShortcutsSheet: React.FC<KeyboardShortcutsSheetProps> = ({
  open,
  onClose,
}) => {
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="space-y-2">
        <p className="text-[13px] text-[var(--tx-2)]">
          Navigate Deep Hours faster on desktop or tablet keyboards. Single-key shortcuts are automatically disabled while typing in any input field.
        </p>
        <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--sf-2)] px-3">
          {SHORTCUT_ROWS.map((row) => (
            <div
              key={row.keys}
              className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]"
            >
              <span className="text-[var(--tx)]">{row.description}</span>
              <kbd
                className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--sf-1)] px-2.5 py-1 text-[12px] font-semibold text-[var(--ac-ink)]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {row.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
};
