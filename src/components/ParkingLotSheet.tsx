import React, { useState } from 'react';
import { Lightbulb, Plus, X } from 'lucide-react';
import type { ParkedThought } from '../utils/parkingLot';
import { triggerHaptic } from '../utils/haptics';
import { BottomSheet } from './BottomSheet';
import { Button } from './ui';

export interface ParkingLotSheetProps {
  open: boolean;
  onClose: () => void;
  thoughts: ParkedThought[];
  onAddThought: (text: string) => void;
  onRemoveThought: (id: string) => void;
}

export const ParkingLotSheet: React.FC<ParkingLotSheetProps> = ({
  open,
  onClose,
  thoughts,
  onAddThought,
  onRemoveThought,
}) => {
  const [draft, setDraft] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    triggerHaptic('success');
    onAddThought(clean);
    setDraft('');
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Park a thought"
      subtitle="Dump a stray doubt or reminder without pausing your timer"
    >
      <form onSubmit={handleSubmit} className="dh-parking-form">
        <input
          type="text"
          data-sheet-autofocus="true"
          aria-label="Thought or doubt to park"
          placeholder="e.g., Check Nernst equation sign convention…"
          value={draft}
          maxLength={160}
          onChange={(e) => setDraft(e.target.value)}
          className="dh-parking-input"
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!draft.trim()}
          icon={<Plus size={16} strokeWidth={2.2} />}
        >
          Park
        </Button>
      </form>

      {thoughts.length > 0 && (
        <div className="dh-parking-list" aria-label="Currently parked thoughts">
          <div className="dh-parking-list-head">
            <Lightbulb size={14} strokeWidth={1.8} style={{ color: 'var(--ac-ink)' }} />
            <span>
              Parked this session ({thoughts.length}) · Review on wrap-up
            </span>
          </div>
          {thoughts.map((item) => (
            <div key={item.id} className="dh-parking-row">
              <span className="dh-parking-row-text">{item.text}</span>
              <button
                type="button"
                className="dh-parking-dismiss-btn"
                aria-label={`Dismiss parked thought: ${item.text}`}
                onClick={() => {
                  triggerHaptic('tap');
                  onRemoveThought(item.id);
                }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
};
