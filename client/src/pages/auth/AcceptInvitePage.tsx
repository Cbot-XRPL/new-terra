import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, api } from '../../lib/api';

interface InviteInfo {
  email: string;
  role: string;
}

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { acceptInvite } = useAuth();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Missing invitation token.');
      return;
    }
    api<InviteInfo>(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : 'Invalid invite');
      });
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
      await acceptInvite({ token, name, password, phone: phone || undefined });
      navigate('/portal');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept invite');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <section className="auth-page">
        <div className="form-container">
          <h2>Invitation problem</h2>
          <p className="form-error">{loadError}</p>
          <p className="muted">Ask your administrator to send a new invite.</p>
        </div>
      </section>
    );
  }

  if (!info) {
    return <section className="auth-page"><div className="form-container">Loading invite…</div></section>;
  }

  return (
    <section className="auth-page">
      <div className="form-container">
        <h2>Accept your invitation</h2>
        <p className="muted">
          Welcome to New Terra. You're joining as <strong>{info.role.toLowerCase()}</strong>{' '}
          ({info.email}).
        </p>
        <form onSubmit={onSubmit}>
          <label htmlFor="name">Full name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />

          <label htmlFor="phone">Phone (optional)</label>
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />

          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />

          {error && <div className="form-error">{error}</div>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </section>
  );
}
