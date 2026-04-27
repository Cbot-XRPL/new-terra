import { type FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/pageMeta';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const SOURCE_OPTIONS = [
  { value: 'WEBSITE_FORM', label: 'Found you online' },
  { value: 'REFERRAL', label: 'Referral / friend' },
  { value: 'GOOGLE', label: 'Google search' },
  { value: 'ANGI', label: 'Angi / HomeAdvisor' },
  { value: 'HOME_DEPOT', label: 'Home Depot' },
  { value: 'REPEAT_CUSTOMER', label: 'Repeat customer' },
  { value: 'OTHER', label: 'Something else' },
];

// Where we stash first-touch attribution. We only persist the FIRST visit's
// landing page + referrer + UTMs so a customer who browses the site for
// a few sessions still gets credited to the original campaign. Cleared
// after a successful signup.
const ATTRIBUTION_KEY = 'nt:firstTouch';

interface FirstTouch {
  landingPath: string;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  capturedAt: string;
}

function readFirstTouch(): FirstTouch | null {
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_KEY);
    return raw ? JSON.parse(raw) as FirstTouch : null;
  } catch {
    return null;
  }
}

export default function SignupPage() {
  const [searchParams] = useSearchParams();
  // Optional ?service=Decks pre-selects the service field on the form.
  const initialService = searchParams.get('service') ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [scope, setScope] = useState('');
  const [serviceCategory, setServiceCategory] = useState(initialService);
  const [budget, setBudget] = useState('');
  const [source, setSource] = useState('WEBSITE_FORM');
  // Honeypot — bots will fill this; real users won't see it.
  const [website, setWebsite] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePageMeta({
    title: 'Start your project',
    description: 'Free estimate, no obligation. Tell us about your project and we\'ll be in touch within a business day.',
  });

  // First-touch attribution: only set on the very first visit. PublicLayout
  // would be a cleaner place but we don't want to touch it from every page;
  // setting it here is fine because most leads land on /start eventually.
  // (Other pages would still capture it the moment a user navigates here.)
  // We intentionally read URL params from window so this fires for any
  // landing path, not just /start.
  useEffect(() => {
    if (readFirstTouch()) return;
    try {
      const url = new URL(window.location.href);
      const ft: FirstTouch = {
        landingPath: url.pathname + url.search,
        referrer: document.referrer || null,
        utmSource: url.searchParams.get('utm_source'),
        utmMedium: url.searchParams.get('utm_medium'),
        utmCampaign: url.searchParams.get('utm_campaign'),
        capturedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(ft));
    } catch { /* localStorage off — silently degrade */ }
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ft = readFirstTouch();
      const body: Record<string, unknown> = {
        name,
        email,
        phone: phone || null,
        address: address || null,
        scope,
        source,
        serviceCategory: serviceCategory || null,
        landingPath: ft?.landingPath ?? null,
        referrer: ft?.referrer ?? null,
        utmSource: ft?.utmSource ?? null,
        utmMedium: ft?.utmMedium ?? null,
        utmCampaign: ft?.utmCampaign ?? null,
        website,
      };
      const cents = budget ? Math.round(Number(budget) * 100) : null;
      if (cents != null && Number.isFinite(cents)) {
        body.estimatedBudgetCents = cents;
      }
      const res = await fetch(`${API_BASE}/api/public/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Submit failed');
        return;
      }
      // Attribution is single-use — clear so a second submission from the
      // same browser doesn't recycle stale UTM params from the first visit.
      try { window.localStorage.removeItem(ATTRIBUTION_KEY); } catch { /* noop */ }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main style={{ maxWidth: 600, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <h1>Thanks, {name.split(/\s+/)[0]}!</h1>
        <p className="muted">
          We got your project details. Someone from our sales team will reach out
          within a business day. Keep an eye on <strong>{email}</strong>.
        </p>
        <p style={{ marginTop: '2rem' }}>
          <Link to="/">← back home</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1>Start your project</h1>
        <p className="muted">
          Tell us a bit about what you have in mind and we&rsquo;ll be in touch shortly.
          Already a customer? <Link to="/login">Sign in here</Link>.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={submit}>
        <section className="card">
          <div className="form-row">
            <div>
              <label htmlFor="su-name">Your name</label>
              <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="su-email">Email</label>
              <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="su-phone">Phone</label>
              <input id="su-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <label htmlFor="su-addr">Project address</label>
          <input id="su-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optional — helps us scope" />

          <div className="form-row">
            <div>
              <label htmlFor="su-service">What kind of work?</label>
              <input
                id="su-service"
                list="su-service-options"
                value={serviceCategory}
                onChange={(e) => setServiceCategory(e.target.value)}
                placeholder="optional — pick one or describe"
              />
              <datalist id="su-service-options">
                <option value="Remodeling" />
                <option value="Decks" />
                <option value="Fencing" />
                <option value="Hardscape" />
                <option value="Landscape" />
              </datalist>
            </div>
            <div>
              <label htmlFor="su-budget">Rough budget (USD, optional)</label>
              <input
                id="su-budget"
                type="number"
                step="100"
                min="0"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <label htmlFor="su-scope">What are you thinking?</label>
          <textarea
            id="su-scope"
            rows={5}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            required
            placeholder="A new deck, kitchen remodel, basement finish — give us the gist."
          />

          <div className="form-row">
            <div>
              <label htmlFor="su-source">How did you hear about us?</label>
              <select id="su-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Honeypot — keep visually hidden but not display:none so bots
              still see it as a fillable input. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px' }}>
            <label htmlFor="su-website">Leave blank</label>
            <input
              id="su-website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send to New Terra'}
            </button>
          </div>
        </section>
      </form>
    </main>
  );
}
