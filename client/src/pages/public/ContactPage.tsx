import { type FormEvent, useCallback, useState } from 'react';
import emailjs from '@emailjs/browser';
import Turnstile from '../../components/Turnstile';
import { usePageMeta } from '../../lib/pageMeta';

// EmailJS does delivery directly from the browser — no backend SMTP needed.
// Template on EmailJS expects: from_name, reply_to, phone, message. The
// inquiry forwards to whatever address the template has configured (set in
// the EmailJS dashboard, not here).
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY ?? '';
const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID ?? '';
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID ?? '';

export default function ContactPage() {
  usePageMeta({
    title: 'Contact us',
    description: 'Get in touch with New Terra Construction — call (678) 207-9719 or send a quick message.',
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot — must remain empty for the submission to be processed.
  const [website, setWebsite] = useState('');
  const [, setTurnstileToken] = useState<string | undefined>();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onTurnstile = useCallback((token: string) => setTurnstileToken(token), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Honeypot — bots fill hidden fields, humans don't. Drop silently to make
    // it look like a successful submit so they don't try other strategies.
    if (website) {
      setStatus('sent');
      return;
    }

    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      setStatus('error');
      setError('Email service is not configured. Please call us directly.');
      return;
    }

    setStatus('sending');
    try {
      await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        { from_name: name, reply_to: email, phone, message },
        { publicKey: EMAILJS_PUBLIC_KEY },
      );
      setStatus('sent');
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : 'Could not send your message';
      setError(msg);
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

          <Turnstile onToken={onTurnstile} />

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
