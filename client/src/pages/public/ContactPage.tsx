import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot — must remain empty for the submission to be processed.
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus('sending');
    try {
      await api('/api/public/contact', {
        method: 'POST',
        body: JSON.stringify({ name, email, phone, message, website }),
      });
      setStatus('sent');
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : 'Could not send your message');
    }
  }

  if (status === 'sent') {
    return (
      <section className="auth-page">
        <div className="form-container">
          <h2>Thanks!</h2>
          <p>We've received your inquiry and will be in touch shortly.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <div className="form-container">
        <h2>Inquiry form</h2>
        <p className="muted">Tell us about your project and we'll be in touch.</p>
        <form onSubmit={onSubmit}>
          <label htmlFor="c-name">Name</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required />

          <label htmlFor="c-email">Email</label>
          <input
            id="c-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="c-phone">Phone</label>
          <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />

          <label htmlFor="c-message">Message</label>
          <textarea
            id="c-message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
          />

          {/* Honeypot field — hidden via CSS; bots fill it, humans don't. */}
          <div className="hp-field" aria-hidden="true">
            <label htmlFor="c-website">Website</label>
            <input
              id="c-website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Submit'}
          </button>
        </form>

        <div className="cta-row">
          <a className="button" href="tel:6782079719">Call 678-207-9719</a>
          <a className="button button-ghost" href="mailto:sales@newterraconstruction.com">
            sales@newterraconstruction.com
          </a>
        </div>
      </div>
    </section>
  );
}
