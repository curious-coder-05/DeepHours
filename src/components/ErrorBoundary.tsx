import React from 'react';
import { readRawSavedDataForDownload } from '../utils/storage';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  variant?: 'page' | 'section';
  scopeLabel?: string;
  resetKey?: string | number;
  silentFallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
  downloadNotice: string | null;
}

export function getLocalDownloadDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMsg: '',
      downloadNotice: null,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMsg: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.hasError &&
      prevProps.resetKey !== undefined &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({
        hasError: false,
        errorMsg: '',
        downloadNotice: null,
      });
    }
  }

  handleResetSection = () => {
    this.setState({
      hasError: false,
      errorMsg: '',
      downloadNotice: null,
    });
  };

  handleDownloadRawData = async () => {
    try {
      this.setState({ downloadNotice: null });
      const raw = await readRawSavedDataForDownload();
      if (!raw) {
        this.setState({
          downloadNotice: 'No saved data was found on this device.',
        });
        return;
      }
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deep-hours-raw-saved-data-${getLocalDownloadDate()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.setState({
        downloadNotice: 'No saved data was found on this device.',
      });
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.silentFallback !== undefined) {
        return this.props.silentFallback;
      }

      if (this.props.variant === 'section') {
        const label = this.props.scopeLabel || 'this view';
        return (
          <section
            role="alert"
            className="mx-auto my-6 max-w-lg rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[#0A0808] p-5 text-left"
          >
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--tx)]">
              Could not render {label}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--tx-2)]">
              Your study data is safely stored on this device. Reload this view or download a
              backup JSON copy below.
            </p>
            {this.state.errorMsg && (
              <p className="mono mt-3 break-words rounded-lg bg-[#141010] px-2.5 py-2 text-[12px] text-[var(--err-ink)]">
                {this.state.errorMsg}
              </p>
            )}
            {this.state.downloadNotice && (
              <p className="mt-2.5 rounded-lg bg-[#141010] px-2.5 py-2 text-[12px] font-medium text-[var(--warn-ink)]">
                {this.state.downloadNotice}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="pri g"
                onClick={this.handleResetSection}
              >
                Reload view
              </button>
              <button
                type="button"
                className="g"
                onClick={this.handleDownloadRawData}
              >
                Download backup JSON
              </button>
            </div>
          </section>
        );
      }

      return (
        <main
          id="v"
          style={{
            display: 'grid',
            placeItems: 'center',
            minHeight: '85vh',
            padding: '20px',
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '460px',
              width: '100%',
              display: 'grid',
              gap: '12px',
              textAlign: 'center',
            }}
          >
            <h2>Something went wrong</h2>
            <small>
              A rendering error occurred, but your study data is still stored on
              your device. You can reload the app or download your raw saved JSON
              data below.
            </small>
            {this.state.errorMsg && (
              <small
                className="mono"
                style={{
                  display: 'block',
                  padding: '8px',
                  borderRadius: '8px',
                  background: 'var(--c2)',
                  color: 'var(--err-ink)',
                  fontSize: '12px',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.errorMsg}
              </small>
            )}
            {this.state.downloadNotice && (
              <small
                style={{
                  display: 'block',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'var(--sf-2)',
                  color: 'var(--warn-ink)',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {this.state.downloadNotice}
              </small>
            )}
            <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pri g"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button
                type="button"
                className="g"
                onClick={this.handleDownloadRawData}
              >
                Download raw saved data
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
