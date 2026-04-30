import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../lib/api';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'CUSTOMER' | 'SUBCONTRACTOR'>('CUSTOMER');
  const [tradeType, setTradeType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (role === 'SUBCONTRACTOR' && !tradeType.trim()) {
      setError('Pick a trade so we know what kind of work you do.');
      return;
    }
    setSubmitting(true);
    try {
      await register({
        email,
        name,
        password,
        phone: phone.trim() || undefined,
        role,
        tradeType: role === 'SUBCONTRACTOR' ? tradeType.trim() : undefined,
      });
      navigate('/portal');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Common Atlanta-area trades — covers ~95% of the subs we work with.
  // The picker still allows free text via the "Other" option below.
  const COMMON_TRADES = [
    'Framing',
    'Demolition',
    'Concrete',
    'Roofing',
    'Siding',
    'Electrical',
    'Plumbing',
    'HVAC',
    'Drywall',
    'Insulation',
    'Painting',
    'Flooring',
    'Tile',
    'Cabinets',
    'Countertops',
    'Decks',
    'Fencing',
    'Hardscape',
    'Landscape',
    'Excavation',
    'Other',
  ];

  return (
    <section className="auth-page">
      <div className="form-container">
        <h2>Create your account</h2>
        <p className="muted">
          Already worked with us before? Use the same email and your account
          will pick up any quotes, projects, and history we have on file.
        </p>
        <form onSubmit={onSubmit}>
          <label>I'm signing up as a…</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className={role === 'CUSTOMER' ? 'button' : 'button button-ghost'}
              onClick={() => setRole('CUSTOMER')}
              style={{ flex: 1 }}
            >
              Customer
            </button>
            <button
              type="button"
              className={role === 'SUBCONTRACTOR' ? 'button' : 'button button-ghost'}
              onClick={() => setRole('SUBCONTRACTOR')}
              style={{ flex: 1 }}
            >
              Contractor
            </button>
          </div>

          <label htmlFor="r-email">Email</label>
          <input
            id="r-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <label htmlFor="r-name">Full name</label>
          <input
            id="r-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
          <label htmlFor="r-phone">Phone (optional)</label>
          <input
            id="r-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            autoComplete="tel"
          />
          {role === 'SUBCONTRACTOR' && (
            <>
              <label htmlFor="r-trade">Trade</label>
              <select
                id="r-trade"
                value={tradeType}
                onChange={(e) => setTradeType(e.target.value)}
                required
              >
                <option value="">Pick a trade…</option>
                {COMMON_TRADES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </>
          )}

          <label htmlFor="r-password">Password</label>
          <input
            id="r-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <p className="muted" style={{ fontSize: '0.8rem', margin: '-0.5rem 0 1rem' }}>
            At least 8 characters.
          </p>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </section>
  );
}
