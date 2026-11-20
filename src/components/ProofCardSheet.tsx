import React, { useEffect, useRef, useState } from 'react';
import { Download, EyeOff, Share2 } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { Switch } from './ui';
import { triggerHaptic } from '../utils/haptics';
import {
  buildProofCardFilename,
  renderProofCardBlob,
  type ProofCardPayload,
} from '../utils/proofCardCanvas';

export interface ProofCardSheetProps {
  payload: ProofCardPayload | null;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

export const ProofCardSheet: React.FC<ProofCardSheetProps> = ({
  payload,
  onClose,
  onToast,
}) => {
  const [hideDetails, setHideDetails] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const blobRef = useRef<Blob | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const revokeCurrentPreview = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (!payload) {
      revokeCurrentPreview();
      blobRef.current = null;
      setPreviewUrl(null);
      setErrorMsg(null);
      return;
    }

    let cancelled = false;
    setRendering(true);
    setErrorMsg(null);

    void renderProofCardBlob(payload, { hideDetails })
      .then((blob) => {
        if (cancelled) return;
        revokeCurrentPreview();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        blobRef.current = blob;
        setPreviewUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMsg('Unable to render proof card preview.');
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [payload, hideDetails]);

  useEffect(() => {
    return () => {
      revokeCurrentPreview();
    };
  }, []);

  if (!payload) return null;

  const filename = buildProofCardFilename(payload);

  const triggerDownload = (blob: Blob) => {
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(dlUrl), 1500);
  };

  const handleShareOrDownload = async () => {
    triggerHaptic('tap');
    setSharing(true);
    try {
      const blob =
        blobRef.current ||
        (await renderProofCardBlob(payload, { hideDetails }));
      blobRef.current = blob;

      const file =
        typeof File !== 'undefined'
          ? new File([blob], filename, { type: 'image/png' })
          : null;

      const canNativeShare =
        Boolean(file) &&
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file!] });

      if (canNativeShare && file) {
        try {
          await navigator.share({
            files: [file],
            title: 'Deep Hours Study Proof',
            text:
              payload.kind === 'session'
                ? `${payload.subjectLabel} · Deep Hours`
                : `Daily study proof (${payload.dateLabel}) · Deep Hours`,
          });
          triggerHaptic('success');
          onToast?.('Proof card shared');
          return;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }
          // Fall through cleanly to direct PNG download
        }
      }

      triggerDownload(blob);
      triggerHaptic('success');
      onToast?.('Saved proof card PNG');
    } catch {
      onToast?.('Could not export proof card PNG');
    } finally {
      setSharing(false);
    }
  };

  const supportsNativeShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';

  return (
    <BottomSheet
      open={Boolean(payload)}
      onClose={onClose}
      title="Study proof card"
      subtitle="1080×1350 portrait PNG · Ready to share"
      snap="tall"
    >
      <div className="dh-proof-sheet">
        <div className="dh-proof-preview-frame">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Study proof card preview"
              className="dh-proof-preview-img"
            />
          ) : (
            <div className="dh-proof-preview-placeholder">
              <span>{errorMsg || (rendering ? 'Rendering card…' : 'Preparing preview…')}</span>
            </div>
          )}
        </div>

        <div className="dh-proof-privacy-row">
          <div className="dh-proof-privacy-copy">
            <span className="dh-proof-privacy-title">
              <EyeOff size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Hide chapter/topic details</span>
            </span>
            <span className="dh-proof-privacy-sub">
              Remove personal chapter and topic text from the exported image
            </span>
          </div>
          <Switch
            checked={hideDetails}
            onChange={(checked) => {
              triggerHaptic('tap');
              setHideDetails(checked);
            }}
            aria-label="Hide chapter or topic details on proof card"
          />
        </div>

        <button
          type="button"
          className="dh-btn-gold dh-proof-share-cta"
          disabled={rendering || sharing}
          onClick={handleShareOrDownload}
        >
          {supportsNativeShare ? (
            <Share2 size={17} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Download size={17} strokeWidth={2} aria-hidden="true" />
          )}
          <span>{sharing ? 'Preparing PNG…' : 'Share PNG'}</span>
        </button>
      </div>
    </BottomSheet>
  );
};
