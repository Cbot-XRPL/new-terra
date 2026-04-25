import { type FormEvent, useState } from 'react';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Public contact form is intentionally not wired to the backend yet — leaving
    // a mailto fallback so the existing inquiry flow keeps working without a public
    // unauthenticated POST endpoint that could be abused.
    const subject = encodeURIComponent(`Inquiry from ${name}`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\n\n${message}`,
    );
    window.location.href = `mailto:sales@newterraconstruction.com?subject=${subject}&body=${body}`;
    setStatus('Opening your email client…');
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
          <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label htmlFor="c-phone">Phone</label>
          <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />

          <label htmlFor="c-message">Message</label>
          <textarea id="c-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} required />

          <button type="submit">Submit</button>
          {status && <p className="muted">{status}</p>}
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
