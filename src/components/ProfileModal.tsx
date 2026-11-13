import React, { useState } from 'react';
import type { UserProfile } from '../types';
import { validateNickname } from '../utils/groups';
import { Button, Chip, Field, Sheet } from './ui';

const PROFILE_EMOJIS = [
  '🩺',
  '🧬',
  '🔬',
  '⚕️',
  '🧠',
  '🫀',
  '🧪',
  '⚡',
  '📚',
  '🎯',
  '🔥',
  '🌱',
  '🦁',
  '🦅',
  '🚀',
  '🌟',
];

const EXAM_YEARS = [2025, 2026, 2027, 2028, 2029, 2030];

interface ProfileModalProps {
  profile: UserProfile;
  onSave: (nextProfile: UserProfile) => void;
  onClose: () => void;
  promptReason?: string;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profile,
  onSave,
  onClose,
  promptReason,
}) => {
  const [nick, setNick] = useState(profile.nick || '');
  const [emoji, setEmoji] = useState(profile.emoji || '🩺');
  const [examYear, setExamYear] = useState<number | undefined>(profile.examYear);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateNickname(nick);
    if (!validation.valid) {
      setError(validation.error || 'Enter a valid nickname (2–20 characters).');
      return;
    }
    const cleanEmoji = (emoji || '🩺').trim().slice(0, 8) || '🩺';
    onSave({
      nick: validation.cleaned,
      emoji: cleanEmoji,
      ...(examYear ? { examYear } : {}),
      updatedAt: Date.now(),
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Anonymous study profile"
      subtitle="Shown in Community · Never shares your email or Google name"
    >
      {promptReason && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: '12px',
            background: 'color-mix(in srgb, var(--ok) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--ok) 35%, transparent)',
            fontSize: '13px',
            color: 'var(--tx)',
          }}
        >
          {promptReason}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
        <Field
          label="Nickname (2–20 chars, plain text)"
          htmlFor="profile-nick-input"
          hint={`No @ or 7+ digits · ${nick.trim().length}/20`}
          error={error}
        >
          <input
            id="profile-nick-input"
            type="text"
            value={nick}
            maxLength={20}
            placeholder="e.g. Dr. Walter, BioNinja"
            onChange={(e) => {
              setNick(e.target.value);
              if (error) setError(null);
            }}
            aria-label="Study profile nickname"
            autoFocus
          />
        </Field>

        <Field label="Avatar emoji">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
              gap: '6px',
            }}
          >
            {PROFILE_EMOJIS.map((em) => {
              const selected = emoji === em;
              return (
                <button
                  key={em}
                  type="button"
                  onClick={() => setEmoji(em)}
                  aria-label={`Choose avatar ${em}`}
                  aria-pressed={selected}
                  style={{
                    minHeight: '44px',
                    padding: 0,
                    borderRadius: '10px',
                    fontSize: '20px',
                    border: selected
                      ? '2px solid var(--ac)'
                      : '1px solid var(--line)',
                    background: selected ? 'var(--ac-soft)' : 'var(--sf-2)',
                  }}
                >
                  {em}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Target NEET exam year (optional)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <Chip selected={!examYear} onClick={() => setExamYear(undefined)}>
              Not set
            </Chip>
            {EXAM_YEARS.map((yr) => (
              <Chip
                key={yr}
                selected={examYear === yr}
                onClick={() => setExamYear(yr)}
              >
                NEET {yr}
              </Chip>
            ))}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" style={{ flex: 2 }}>
            Save Profile
          </Button>
        </div>
      </form>
    </Sheet>
  );
};
