import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';

interface TokenInfo {
  email: string;
  name: string;
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError('Missing reset token.');
      return;
    }
    api<TokenInfo>(`/api/auth/reset-token/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) =>
        setTokenError(err instanceof ApiError ? err.message : 'Reset link is invalid or expired'),
      );
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      // Send the user to /login after a short delay so they see the success
      // state. Fresh login means a fresh token without the reset session.
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password');
    } finally {
      setSubmitting(false);
    }
  }

  if (tokenError) {
    return (
      <section className="auth-page">
        <div className="form-container">
          <h2>Reset link problem</h2>
          <p className="form-error">{tokenError}</p>
          <p className="muted">
            <Link to="/forgot-password">Request a new reset link</Link>
          </p>
        </div>
      </section>
    );
  }
  if (done) {
    return (
      <section className="auth-page">
        <div className="form-container">
          <h2>Password updated</h2>
          <p>Redirecting you to sign in…</p>
        </div>
      </section>
    );
  }
  if (!info) {
    return (
      <section className="auth-page"><div className="form-container">Loading…</div></section>
    );
  }

  return (
    <section className="auth-page">
      <div className="form-container">
        <h2>Set a new password</h2>
        <p className="muted">
          Resetting password for <strong>{info.email}</strong>.
        </p>
        <form onSubmit={onSubmit}>
          <label htmlFor="rp-password">New password</label>
          <input
            id="rp-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
          <label htmlFor="rp-confirm">Confirm</label>
          <input
            id="rp-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          {error && <div className="form-error">{error}</div>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </section>
  );
}
