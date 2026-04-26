import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the reset link');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section className="auth-page">
        <div className="form-container">
          <h2>Check your email</h2>
          <p>
            If an account exists for <strong>{email}</strong>, a password-reset link is on its
            way. The link is good for 60 minutes.
          </p>
          <p className="muted">
            Didn't get one? Wait a few minutes, check spam, then{' '}
            <Link to="/forgot-password">try again</Link>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <div className="form-container">
        <h2>Forgot your password?</h2>
        <p className="muted">Enter the email you sign in with. We'll send you a reset link.</p>
        <form onSubmit={onSubmit}>
          <label htmlFor="fp-email">Email</label>
          <input
            id="fp-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
          {error && <div className="form-error">{error}</div>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Remembered it? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </section>
  );
}
