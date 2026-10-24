import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMsg: error instanceof Error ? error.message : String(error),
    };
  }

  handleDownloadRawData = () => {
    try {
      const raw =
        (typeof localStorage !== 'undefined' &&
          (localStorage.getItem('dh') || localStorage.getItem('ph'))) ||
        '{}';
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deep-hours-raw-saved-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // ignore download error
    }
  };

  render() {
    if (this.state.hasError) {
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
                  color: 'var(--dg)',
                  fontSize: '11px',
                  wordBreak: 'break-word',
                }}
              >
                {this.state.errorMsg}
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
