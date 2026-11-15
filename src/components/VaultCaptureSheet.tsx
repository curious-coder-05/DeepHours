import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Crop, ImagePlus, Trash2 } from 'lucide-react';
import type { Chapter, Subject } from '../types';
import { uid } from '../utils/studyLogic';
import {
  closeDecodedImage,
  decodeImageFile,
  validateImageFileCandidate,
  type ProcessedVaultImage,
} from '../utils/vaultImage';
import { clampVaultSolutionText, clampVaultText } from '../utils/vaultLogic';
import { getVaultBlob, saveVaultItem } from '../utils/vaultStore';
import { VAULT_LIMITS, type VaultItem, type VaultKind } from '../utils/vaultTypes';
import { VaultCropper } from './VaultCropper';
import {
  Button,
  Chip,
  Dialog,
  Field,
  Segmented,
  Select,
  Sheet,
} from './ui';

const LAST_SUBJECT_KEY = 'dh_vault_last_subject';
const LAST_CHAPTER_KEY = 'dh_vault_last_chapter';

export interface VaultCaptureSheetProps {
  open: boolean;
  subjects: readonly Subject[];
  chapters: readonly Chapter[];
  editingItem?: VaultItem | null;
  initialSubjectId?: string;
  initialChapterId?: string;
  initialKind?: VaultKind;
  onClose: () => void;
  onSaved: (item: VaultItem, addAnother: boolean) => void;
}

type CaptureStep = 'source' | 'crop-q' | 'crop-s' | 'details';

function readStoredString(key: string): string {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) || '' : '';
  } catch {
    return '';
  }
}

function writeStoredString(key: string, val: string): void {
  try {
    if (typeof window !== 'undefined') {
      if (val) window.localStorage.setItem(key, val);
      else window.localStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

export const VaultCaptureSheet: React.FC<VaultCaptureSheetProps> = ({
  open,
  subjects,
  chapters,
  editingItem,
  initialSubjectId,
  initialChapterId,
  initialKind,
  onClose,
  onSaved,
}) => {
  const activeSubjects = useMemo(() => subjects.filter((s) => !s.arch), [subjects]);
  const fallbackSubId = activeSubjects[0]?.id || subjects[0]?.id || 'sub_phy';

  const [step, setStep] = useState<CaptureStep>('source');
  const [subjectId, setSubjectId] = useState<string>(fallbackSubId);
  const [chapterId, setChapterId] = useState<string>('');
  const [kind, setKind] = useState<VaultKind>('unsolved');
  const [answerText, setAnswerText] = useState<string>('');
  const [solutionText, setSolutionText] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const [qSource, setQSource] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [sSource, setSSource] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [qProcessed, setQProcessed] = useState<ProcessedVaultImage | null>(null);
  const [sProcessed, setSProcessed] = useState<ProcessedVaultImage | null>(null);
  const [removeExistingSolImage, setRemoveExistingSolImage] = useState<boolean>(false);

  const [qPreviewUrl, setQPreviewUrl] = useState<string | null>(null);
  const [sPreviewUrl, setSPreviewUrl] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState<boolean>(false);

  const qCameraRef = useRef<HTMLInputElement | null>(null);
  const qGalleryRef = useRef<HTMLInputElement | null>(null);
  const sCameraRef = useRef<HTMLInputElement | null>(null);
  const sGalleryRef = useRef<HTMLInputElement | null>(null);

  // Manage preview URLs cleanly
  useEffect(() => {
    if (!qProcessed?.blob) return;
    const url = URL.createObjectURL(qProcessed.blob);
    setQPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, [qProcessed]);

  useEffect(() => {
    if (!sProcessed?.blob) return;
    const url = URL.createObjectURL(sProcessed.blob);
    setSPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, [sProcessed]);

  const cleanupMediaRefs = () => {
    setQSource((prev) => {
      closeDecodedImage(prev);
      return null;
    });
    setSSource((prev) => {
      closeDecodedImage(prev);
      return null;
    });
    setQPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // Initialize form whenever opened or editingItem changes
  useEffect(() => {
    if (!open) {
      cleanupMediaRefs();
      setQProcessed(null);
      setSProcessed(null);
      setConfirmDiscardOpen(false);
      setErrorMsg(null);
      return;
    }

    setErrorMsg(null);
    setRemoveExistingSolImage(false);

    if (editingItem) {
      setSubjectId(editingItem.subjectId || fallbackSubId);
      setChapterId(editingItem.chapterId || '');
      setKind(editingItem.kind);
      setAnswerText(editingItem.answerText || '');
      setSolutionText(editingItem.solutionText || '');
      setNote(editingItem.note || '');
      setQProcessed(null);
      setSProcessed(null);
      setStep('details');

      void (async () => {
        const existingQ = await getVaultBlob(editingItem.id, 'q');
        if (existingQ) {
          const url = URL.createObjectURL(existingQ);
          setQPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
        if (editingItem.hasSolutionImage) {
          const existingS = await getVaultBlob(editingItem.id, 's');
          if (existingS) {
            const url = URL.createObjectURL(existingS);
            setSPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return url;
            });
          }
        }
      })();
      return;
    }

    const rememberedSub = readStoredString(LAST_SUBJECT_KEY);
    const chosenSub =
      initialSubjectId ||
      (activeSubjects.some((s) => s.id === rememberedSub) ? rememberedSub : fallbackSubId);

    const rememberedChap = readStoredString(LAST_CHAPTER_KEY);
    const validChap = initialChapterId
      ? initialChapterId
      : chapters.some((c) => c.id === rememberedChap && c.subjectId === chosenSub)
        ? rememberedChap
        : '';

    setSubjectId(chosenSub);
    setChapterId(validChap);
    setKind(initialKind || 'unsolved');
    setAnswerText('');
    setSolutionText('');
    setNote('');
    setQProcessed(null);
    setSProcessed(null);
    setStep('source');
  }, [open, editingItem, initialSubjectId, initialChapterId, initialKind, fallbackSubId, activeSubjects, chapters]);

  const subjectChapters = useMemo(
    () => chapters.filter((c) => c.subjectId === subjectId),
    [chapters, subjectId]
  );

  const chapterSelectOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...subjectChapters.map((c) => ({ value: c.id, label: c.name })),
    ],
    [subjectChapters]
  );

  const isDirty = useMemo(() => {
    if (editingItem) {
      return (
        subjectId !== editingItem.subjectId ||
        (chapterId || '') !== (editingItem.chapterId || '') ||
        kind !== editingItem.kind ||
        answerText !== (editingItem.answerText || '') ||
        solutionText !== (editingItem.solutionText || '') ||
        note !== (editingItem.note || '') ||
        qProcessed !== null ||
        sProcessed !== null ||
        removeExistingSolImage
      );
    }
    return Boolean(
      qSource || qProcessed || sProcessed || answerText.trim() || solutionText.trim() || note.trim()
    );
  }, [
    answerText,
    chapterId,
    editingItem,
    kind,
    note,
    qProcessed,
    qSource,
    removeExistingSolImage,
    sProcessed,
    solutionText,
    subjectId,
  ]);

  const handleRequestClose = () => {
    if (saving) return;
    if (isDirty) {
      setConfirmDiscardOpen(true);
    } else {
      onClose();
    }
  };

  const handlePickImageFile = async (
    file: File | undefined,
    slot: 'q' | 's'
  ) => {
    if (!file) return;
    setErrorMsg(null);
    const check = validateImageFileCandidate({
      type: file.type,
      size: file.size,
      name: file.name,
    });
    if (!check.ok) {
      setErrorMsg(check.reason || 'Unsupported image file.');
      return;
    }

    try {
      const decoded = await decodeImageFile(file);
      if (slot === 'q') {
        setQSource((prev) => {
          closeDecodedImage(prev);
          return decoded;
        });
        setStep('crop-q');
      } else {
        setSSource((prev) => {
          closeDecodedImage(prev);
          return decoded;
        });
        setRemoveExistingSolImage(false);
        setStep('crop-s');
      }
    } catch {
      setErrorMsg('Could not open that image. Please try another JPG, PNG, or WebP photo.');
    }
  };

  const handleSave = async (addAnother: boolean) => {
    if (!editingItem && !qProcessed) {
      setErrorMsg('Please capture or upload a question photo first.');
      setStep('source');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const now = Date.now();
      const itemId = editingItem ? editingItem.id : uid('vq');
      writeStoredString(LAST_SUBJECT_KEY, subjectId);
      writeStoredString(LAST_CHAPTER_KEY, chapterId);

      const hasSolImage = sProcessed
        ? true
        : editingItem
          ? Boolean(editingItem.hasSolutionImage && !removeExistingSolImage)
          : false;

      const nextItem: VaultItem = {
        id: itemId,
        subjectId,
        chapterId: chapterId || undefined,
        kind,
        createdAt: editingItem ? editingItem.createdAt : now,
        updatedAt: now,
        mastered: editingItem ? editingItem.mastered : false,
        masteredAt: editingItem ? editingItem.masteredAt : undefined,
        answerText: clampVaultText(answerText, VAULT_LIMITS.answerMax),
        solutionText: clampVaultSolutionText(solutionText),
        note: clampVaultText(note, VAULT_LIMITS.noteMax),
        hasSolutionImage: hasSolImage,
        qBytes: qProcessed ? qProcessed.bytes : editingItem?.qBytes || 0,
        width: qProcessed ? qProcessed.width : editingItem?.width || 1080,
        height: qProcessed ? qProcessed.height : editingItem?.height || 1080,
        mime: qProcessed ? qProcessed.mime : editingItem?.mime || 'image/webp',
        revisionCount: editingItem ? editingItem.revisionCount : 0,
        lastRevisedAt: editingItem ? editingItem.lastRevisedAt : undefined,
        syncState: 'pending',
      };

      const saved = await saveVaultItem(
        nextItem,
        qProcessed
          ? {
              blob: qProcessed.blob,
              width: qProcessed.width,
              height: qProcessed.height,
              mime: qProcessed.mime,
            }
          : undefined,
        removeExistingSolImage
          ? 'delete'
          : sProcessed
            ? {
                blob: sProcessed.blob,
                width: sProcessed.width,
                height: sProcessed.height,
                mime: sProcessed.mime,
              }
            : undefined
      );

      if (addAnother) {
        cleanupMediaRefs();
        setQProcessed(null);
        setSProcessed(null);
        setAnswerText('');
        setSolutionText('');
        setNote('');
        setStep('source');
        onSaved(saved, true);
      } else {
        onSaved(saved, false);
        onClose();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not save question to Vault.'
      );
    } finally {
      setSaving(false);
    }
  };

  const stepIndex =
    step === 'source' ? 1 : step === 'crop-q' || step === 'crop-s' ? 2 : 3;
  const stepTitle =
    editingItem
      ? step === 'crop-q'
        ? 'Crop question photo'
        : step === 'crop-s'
          ? 'Crop solution photo'
          : 'Edit Vault question'
      : step === 'source'
        ? 'Add question · Step 1 of 3'
        : step === 'crop-q'
          ? 'Crop question · Step 2 of 3'
          : step === 'crop-s'
            ? 'Crop solution photo'
            : 'Add details · Step 3 of 3';

  return (
    <>
      <Sheet
        open={open}
        onClose={handleRequestClose}
        title={stepTitle}
        subtitle={
          step === 'source'
            ? 'Pick subject, type, and snap or upload the question'
            : step === 'crop-q' || step === 'crop-s'
              ? 'Trim extra margins and sharpen text for easy reading'
              : 'Optional answer key & solution stay hidden until you reveal them'
        }
      >
        <div style={{ display: 'grid', gap: '14px' }}>
          {/* Compact 3-step indicator for new captures */}
          {!editingItem && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {[
                { num: 1, label: 'Source' },
                { num: 2, label: 'Crop' },
                { num: 3, label: 'Details' },
              ].map((s) => {
                const active = stepIndex === s.num;
                const done = stepIndex > s.num;
                return (
                  <div
                    key={s.num}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '10px',
                      background: active
                        ? 'var(--ac-soft)'
                        : done
                          ? 'color-mix(in srgb, var(--ok) 12%, transparent)'
                          : 'var(--sf-2)',
                      border: active
                        ? '1px solid var(--ac-bd)'
                        : '1px solid var(--line)',
                      color: active
                        ? 'var(--ac-ink)'
                        : done
                          ? 'var(--ok-ink)'
                          : 'var(--tx-2)',
                      fontSize: '13px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span className="tabular-nums">
                      {done ? <Check size={14} strokeWidth={2} /> : `${s.num}.`}
                    </span>
                    <span>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: 'color-mix(in srgb, var(--err) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--err) 40%, transparent)',
                color: 'var(--err-ink)',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Hidden file inputs */}
          <input
            ref={qCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void handlePickImageFile(e.target.files?.[0], 'q');
              e.target.value = '';
            }}
          />
          <input
            ref={qGalleryRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void handlePickImageFile(e.target.files?.[0], 'q');
              e.target.value = '';
            }}
          />
          <input
            ref={sCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void handlePickImageFile(e.target.files?.[0], 's');
              e.target.value = '';
            }}
          />
          <input
            ref={sGalleryRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void handlePickImageFile(e.target.files?.[0], 's');
              e.target.value = '';
            }}
          />

          {/* STEP 1: SOURCE */}
          {step === 'source' && (
            <div style={{ display: 'grid', gap: '14px' }}>
              <Field label="Subject">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {activeSubjects.map((sub) => (
                    <Chip
                      key={sub.id}
                      selected={subjectId === sub.id}
                      colorDot={sub.color}
                      onClick={() => {
                        setSubjectId(sub.id);
                        setChapterId('');
                      }}
                    >
                      {sub.e} {sub.name}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Chapter (optional)">
                <Select
                  value={chapterId}
                  onChange={setChapterId}
                  ariaLabel="Chapter"
                  options={chapterSelectOptions}
                />
              </Field>

              <Field label="Question type">
                <Segmented<VaultKind>
                  ariaLabel="Question type"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'unsolved', label: 'Unsolved' },
                    { value: 'hard', label: 'Hard / Trap' },
                  ]}
                />
              </Field>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '10px',
                  paddingTop: '4px',
                }}
              >
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => qCameraRef.current?.click()}
                >
                  <Camera size={18} strokeWidth={1.75} aria-hidden="true" />
                  Take photo
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => qGalleryRef.current?.click()}
                >
                  <ImagePlus size={18} strokeWidth={1.75} aria-hidden="true" />
                  Upload
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2A: CROP QUESTION */}
          {step === 'crop-q' && qSource && (
            <VaultCropper
              source={qSource}
              confirmLabel="Continue to details"
              onCancel={() => {
                setStep(editingItem || qProcessed ? 'details' : 'source');
              }}
              onConfirm={(result) => {
                setQProcessed(result);
                setStep('details');
              }}
            />
          )}

          {/* STEP 2B: CROP SOLUTION PHOTO */}
          {step === 'crop-s' && sSource && (
            <VaultCropper
              source={sSource}
              confirmLabel="Attach solution photo"
              onCancel={() => setStep('details')}
              onConfirm={(result) => {
                setSProcessed(result);
                setStep('details');
              }}
            />
          )}

          {/* STEP 3: DETAILS */}
          {step === 'details' && (
            <div style={{ display: 'grid', gap: '14px' }}>
              {/* Question photo preview strip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--sf-2)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  {qPreviewUrl ? (
                    <img
                      src={qPreviewUrl}
                      alt="Question photo preview"
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
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>Question photo</div>
                    <div className="tabular-nums" style={{ fontSize: '13px', color: 'var(--tx-2)' }}>
                      {qProcessed
                        ? `${qProcessed.width} × ${qProcessed.height} · ${Math.round(qProcessed.bytes / 1024)} KB`
                        : editingItem
                          ? `${editingItem.width} × ${editingItem.height} · ${Math.round(editingItem.qBytes / 1024)} KB`
                          : 'Ready'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {qSource && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setStep('crop-q')}
                    >
                      <Crop size={14} strokeWidth={1.75} aria-hidden="true" />
                      Re-crop
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => qGalleryRef.current?.click()}
                  >
                    Replace
                  </Button>
                </div>
              </div>

              {/* Editable metadata tags */}
              <div style={{ display: 'grid', gap: '10px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {activeSubjects.map((sub) => (
                    <Chip
                      key={sub.id}
                      selected={subjectId === sub.id}
                      colorDot={sub.color}
                      onClick={() => {
                        setSubjectId(sub.id);
                        setChapterId('');
                      }}
                    >
                      {sub.e} {sub.name}
                    </Chip>
                  ))}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '10px',
                  }}
                >
                  <Field label="Chapter">
                    <Select
                      value={chapterId}
                      onChange={setChapterId}
                      ariaLabel="Chapter"
                      options={chapterSelectOptions}
                    />
                  </Field>
                  <Field label="Type">
                    <Segmented<VaultKind>
                      ariaLabel="Question type"
                      value={kind}
                      onChange={setKind}
                      options={[
                        { value: 'unsolved', label: 'Unsolved' },
                        { value: 'hard', label: 'Hard / Trap' },
                      ]}
                    />
                  </Field>
                </div>
              </div>

              <Field
                label="Answer (optional)"
                hint={`Hidden until revealed (${answerText.length}/${VAULT_LIMITS.answerMax})`}
              >
                <input
                  type="text"
                  maxLength={VAULT_LIMITS.answerMax}
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="e.g. (C) or 4.2 × 10⁻³ J"
                />
              </Field>

              <Field
                label="Solution / approach (optional)"
                hint={`Hidden until revealed (${solutionText.length}/${VAULT_LIMITS.solutionMax})`}
              >
                <textarea
                  rows={3}
                  maxLength={VAULT_LIMITS.solutionMax}
                  value={solutionText}
                  onChange={(e) => setSolutionText(e.target.value)}
                  placeholder="Key formula, trap to watch out for, or NCERT page..."
                />
              </Field>

              {/* Optional Solution Photo */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--sf-2)',
                  border: '1px solid var(--line)',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    Solution photo (optional)
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => sCameraRef.current?.click()}
                    >
                      <Camera size={14} strokeWidth={1.75} aria-hidden="true" />
                      Snap
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => sGalleryRef.current?.click()}
                    >
                      <ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
                      Upload
                    </Button>
                    {(sPreviewUrl && !removeExistingSolImage) && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setSProcessed(null);
                          setSSource((prev) => {
                            closeDecodedImage(prev);
                            return null;
                          });
                          setRemoveExistingSolImage(true);
                          setSPreviewUrl((prev) => {
                            if (prev) URL.revokeObjectURL(prev);
                            return null;
                          });
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {sPreviewUrl && !removeExistingSolImage && (
                  <img
                    src={sPreviewUrl}
                    alt="Solution photo preview"
                    style={{
                      maxHeight: '140px',
                      width: '100%',
                      objectFit: 'contain',
                      borderRadius: '8px',
                      background: 'var(--sf-1)',
                      border: '1px solid var(--line)',
                    }}
                  />
                )}
              </div>

              <Field
                label="Short note (optional)"
                hint={`Shown on question card (${note.length}/${VAULT_LIMITS.noteMax})`}
              >
                <input
                  type="text"
                  maxLength={VAULT_LIMITS.noteMax}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Aakash AIATS Q42 — sign trap"
                />
              </Field>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
                {!editingItem && (
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void handleSave(true)}
                    style={{ flex: '1 1 160px' }}
                  >
                    Save &amp; add another
                  </Button>
                )}
                <Button
                  variant="primary"
                  disabled={saving}
                  onClick={() => void handleSave(false)}
                  style={{ flex: '2 1 200px' }}
                >
                  {saving
                    ? 'Saving…'
                    : editingItem
                      ? 'Save changes'
                      : 'Save to Vault'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Sheet>

      <Dialog
        open={confirmDiscardOpen}
        onClose={() => setConfirmDiscardOpen(false)}
        title="Discard changes?"
      >
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--tx-2)', lineHeight: 1.5 }}>
          Your cropped photo and unsaved notes for this question will be discarded.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
          <Button variant="secondary" onClick={() => setConfirmDiscardOpen(false)}>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmDiscardOpen(false);
              onClose();
            }}
          >
            Discard
          </Button>
        </div>
      </Dialog>
    </>
  );
};
