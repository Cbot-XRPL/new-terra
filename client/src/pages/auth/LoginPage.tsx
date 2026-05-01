import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, api } from '../../lib/api';

// Map server-side `?google_error=...` codes back to friendly copy. Keep
// this list in sync with the redirect URLs in server/src/routes/auth.ts.
const GOOGLE_ERRORS: Record<string, string> = {
  missing_params: 'Google sign-in was interrupted. Try again.',
  bad_state: 'That sign-in link expired. Try again.',
  email_unverified: 'Your Google email isn\'t verified. Verify it first or sign in with a password.',
  no_account:
    "We couldn't find a portal account for that Google email. Ask an admin to invite you, or sign in with the email + password we sent.",
  account_disabled: 'That account is disabled. Contact an admin.',
};

export default function LoginPage() {
  const { login, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Pluck the JWT off the URL hash after a Google round-trip
  // (#google_token=...) and complete sign-in. Hash is preferred over
  // querystring because servers don't log fragments.
  useEffect(() => {
    const hash = location.hash || '';
    if (hash.startsWith('#google_token=')) {
      const token = decodeURIComponent(hash.slice('#google_token='.length));
      // Wipe the hash so a refresh doesn't re-run this branch.
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
      (async () => {
        try {
          await loginWithToken(token);
          navigate('/portal');
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Google sign-in failed');
        }
      })();
      return;
    }
    // Surface server-side error redirects (?google_error=...).
    const params = new URLSearchParams(location.search);
    const ge = params.get('google_error');
    if (ge) {
      setError(GOOGLE_ERRORS[ge] ?? 'Google sign-in failed.');
      // Strip the param so refresh doesn't repaint the error.
      const next = new URLSearchParams(location.search);
      next.delete('google_error');
      const qs = next.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}`,
      );
    }
  }, [location.hash, location.search, loginWithToken, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, remember);
      navigate('/portal');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function startGoogleSignIn() {
    setError(null);
    setGoogleBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/auth/google/start');
      window.location.assign(url);
    } catch (err) {
      setGoogleBusy(false);
      setError(
        err instanceof ApiError && err.status === 503
          ? "Google sign-in isn't configured yet."
          : err instanceof ApiError
            ? err.message
            : 'Could not start Google sign-in',
      );
    }
  }

  return (
    <section className="auth-page">
      <div className="form-container">
        <h2>Sign in to the portal</h2>
        <p className="muted">
          Employees, subcontractors, and customers — use the email associated with your invite.
        </p>

        <button
          type="button"
          className="button button-ghost"
          onClick={startGoogleSignIn}
          disabled={googleBusy}
          style={{
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
          }}
        >
          {/* Inline Google G mark — no asset dependency. */}
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.8-3.7 5.1l6.2 5.2c-.4.4 6.6-4.8 6.6-14.3 0-1.3-.1-2.4-.4-3.5z"/>
          </svg>
          {googleBusy ? 'Redirecting to Google…' : 'Sign in with Google'}
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            margin: '0.5rem 0 1rem',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
          }}
        >
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          or
          <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <form onSubmit={onSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 'normal',
              cursor: 'pointer',
              margin: '0.25rem 0 0.75rem',
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            <span>Remember me on this device</span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          New here? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </section>
  );
}
