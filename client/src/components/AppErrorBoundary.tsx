import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render-time + lazy-import errors so a thrown chunk-load
// (common after a deploy when stale tabs request a hashed JS file that
// no longer exists) doesn't leave the user staring at a black screen.
//
// Three behaviors based on the error shape:
//   1. ChunkLoadError / "Failed to fetch dynamically imported module"
//      → auto-reload once. The new page picks up the fresh index.html
//      and its updated chunk references.
//   2. Any other error → show a manual "Reload" + "Go home" UI so the
//      user has a way out without DevTools.
//   3. We only auto-reload once per session via sessionStorage so an
//      actual broken chunk doesn't put us in a reload loop.
const RELOADED_KEY = 'nt_chunk_reload_attempted';

function isChunkLoadError(err: Error): boolean {
  const msg = err.message ?? '';
  const name = err.name ?? '';
  return (
    name === 'ChunkLoadError' ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Importing a module script failed')
  );
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info);
    if (isChunkLoadError(error)) {
      const alreadyTried = sessionStorage.getItem(RELOADED_KEY);
      if (!alreadyTried) {
        sessionStorage.setItem(RELOADED_KEY, '1');
        // Brief defer so the error log lands before the navigation.
        setTimeout(() => window.location.reload(), 50);
      }
    }
  }

  reset = () => {
    sessionStorage.removeItem(RELOADED_KEY);
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Auto-reloading: render a quiet placeholder while the reload fires.
    if (isChunkLoadError(error) && !sessionStorage.getItem('nt_chunk_reload_done')) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Updating…
        </div>
      );
    }

    return (
      <div
        style={{
          padding: '2rem 1rem',
          maxWidth: 480,
          margin: '4rem auto',
          textAlign: 'center',
          color: 'var(--text)',
        }}
      >
        <h2>Something went wrong.</h2>
        <p className="muted" style={{ margin: '0.5rem 0 1.5rem' }}>
          {isChunkLoadError(error)
            ? 'Looks like the app updated while this tab was open. Reloading should clear it.'
            : 'A page crashed unexpectedly. Reload to recover.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          <button onClick={this.reset}>Reload</button>
          <a href="/" className="button button-ghost">Go home</a>
        </div>
        {import.meta.env.DEV && (
          <pre
            style={{
              marginTop: '1.5rem',
              textAlign: 'left',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.stack ?? error.message}
          </pre>
        )}
      </div>
    );
  }
}
