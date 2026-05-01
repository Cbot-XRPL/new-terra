import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, api } from '../lib/api';

// Admin-only "Connect Google Drive" card. Shown on the admin dashboard.
// The OAuth round-trip lands at /portal/admin?drive_connected=1 (or
// drive_error=...) — we read those params on mount to surface a
// confirmation banner and refresh the connection status.

interface ConnectionStatus {
  configured: boolean;
  connected: boolean;
  connection: {
    googleEmail: string | null;
    googleName: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

const DRIVE_ERRORS: Record<string, string> = {
  missing_params: 'Google interrupted the connect flow. Try again.',
  bad_state: 'That connect link expired. Try again.',
  forbidden: 'Only an admin can connect a Drive account.',
  no_refresh_token:
    'Google didn\'t return a refresh token. Disconnect the app from your Google account settings, then try connecting again.',
};

export default function GoogleDriveCard() {
  const location = useLocation();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const s = await api<ConnectionStatus>('/api/integrations/google-drive/status');
      setStatus(s);
    } catch (err) {
      // Non-admin would 403 here. The card is gated to admin upstream
      // so swallow silently — the link will just stay hidden.
      if (err instanceof ApiError && err.status === 403) return;
      setError(err instanceof ApiError ? err.message : 'Could not load Drive status');
    }
  }
  useEffect(() => {
    loadStatus();
  }, []);

  // Surface ?drive_connected=1 / ?drive_error=... after the OAuth
  // redirect lands back on /portal/admin.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('drive_connected') === '1') {
      setSuccess('Google Drive connected.');
      const cleaned = new URLSearchParams(location.search);
      cleaned.delete('drive_connected');
      const qs = cleaned.toString();
      window.history.replaceState({}, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
      loadStatus();
    }
    const e = params.get('drive_error');
    if (e) {
      setError(DRIVE_ERRORS[e] ?? 'Drive connect failed.');
      const cleaned = new URLSearchParams(location.search);
      cleaned.delete('drive_error');
      const qs = cleaned.toString();
      window.history.replaceState({}, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, [location.search, location.pathname]);

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/integrations/google-drive/connect');
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiError && err.status === 503
          ? "Google integration isn't configured yet — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET on the server."
          : err instanceof ApiError
            ? err.message
            : 'Could not start the Drive connect flow',
      );
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Google Drive? The AI tools will stop being able to read files until you reconnect.')) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api('/api/integrations/google-drive', { method: 'DELETE' });
      setSuccess('Google Drive disconnected.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <section className="card">
      <h2>Google Drive</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Connect your Drive once and the AI assistant can pull files
        (photos, PDFs, plans) into projects on demand. Read-only access —
        the integration never writes back to your Drive.
      </p>

      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">{success}</div>}

      {!status.configured ? (
        <p className="muted">
          Google integration isn't configured on the server yet. Set{' '}
          <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{' '}
          in <code>.env</code> and restart, then come back here.
        </p>
      ) : status.connected && status.connection ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div>
            <strong>Connected:</strong>{' '}
            {status.connection.googleName ?? status.connection.googleEmail}{' '}
            {status.connection.googleEmail && (
              <span className="muted">({status.connection.googleEmail})</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Linked {new Date(status.connection.createdAt).toLocaleDateString()}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button type="button" className="button button-ghost" onClick={connect} disabled={busy}>
              Reconnect
            </button>
            <button type="button" className="button button-ghost" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="button" onClick={connect} disabled={busy}>
          {busy ? 'Redirecting to Google…' : 'Connect Google Drive'}
        </button>
      )}
    </section>
  );
}
