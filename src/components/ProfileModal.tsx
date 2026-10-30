import React, { useState } from 'react';
import type { UserProfile } from '../types';
import { validateNickname } from '../utils/groups';

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
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Anonymous Study Profile"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0,0,0,0.68)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          maxHeight: '90vh',
          overflowY: 'auto',
          margin: 0,
          padding: 18,
          border: '1px solid var(--bd)',
        }}
      >
        <div className="row sp" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ fontSize: 28 }} aria-hidden="true">
              {emoji || '🩺'}
            </span>
            <div>
              <b style={{ fontSize: 16 }}>Anonymous Study Profile</b>
              <div className="mut" style={{ fontSize: 12 }}>
                Shown in Study Groups · Never shares your email or Google name
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ib"
            onClick={onClose}
            aria-label="Close profile modal"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            ✕
          </button>
        </div>

        {promptReason && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              fontSize: 12,
              marginBottom: 12,
              color: 'var(--tx)',
            }}
          >
            {promptReason}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="profile-nick-input"
              className="mut"
              style={{ display: 'block', fontSize: 12, marginBottom: 6 }}
            >
              Nickname (2–20 chars, no email or phone number)
            </label>
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
              style={{ minHeight: 44, width: '100%' }}
              autoFocus
            />
            <div className="row sp" style={{ marginTop: 4 }}>
              <span className="mut" style={{ fontSize: 11 }}>
                Plain text only · No @ or 7+ digits
              </span>
              <span className="mut mono" style={{ fontSize: 11 }}>
                {nick.trim().length}/20
              </span>
            </div>
            {error && (
              <div
                role="alert"
                style={{ color: '#f43f5e', fontSize: 12, marginTop: 6, fontWeight: 600 }}
              >
                {error}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div className="mut" style={{ fontSize: 12, marginBottom: 6 }}>
              Avatar Emoji
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 1fr)',
                gap: 6,
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
                      minHeight: 44,
                      minWidth: 40,
                      borderRadius: 10,
                      fontSize: 20,
                      border: selected
                        ? '2px solid var(--ac)'
                        : '1px solid var(--bd)',
                      background: selected ? 'var(--sf2)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {em}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="mut" style={{ fontSize: 12, marginBottom: 6 }}>
              Target NEET Exam Year (optional)
            </div>
            <div className="chips" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button
                type="button"
                className={`chip ${!examYear ? 'on' : ''}`}
                onClick={() => setExamYear(undefined)}
                style={{ minHeight: 40 }}
              >
                Not set
              </button>
              {EXAM_YEARS.map((yr) => (
                <button
                  key={yr}
                  type="button"
                  className={`chip ${examYear === yr ? 'on' : ''}`}
                  onClick={() => setExamYear(yr)}
                  style={{ minHeight: 40 }}
                >
                  NEET {yr}
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn s"
              onClick={onClose}
              style={{ minHeight: 44, padding: '0 16px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn pri"
              style={{ minHeight: 44, padding: '0 18px' }}
            >
              Save Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
