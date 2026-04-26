import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';

interface Settings {
  companyName: string | null;
  legalName: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  zelleEmail: string | null;
  zelleName: string | null;
  zellePhone: string | null;
  achInstructions: string | null;
  checkPayableTo: string | null;
  checkMailingAddress: string | null;
  paymentNotes: string | null;
}

const FIELDS: Array<{ key: keyof Settings; label: string; multiline?: boolean; placeholder?: string }> = [
  // identity
  { key: 'companyName', label: 'Company name (display)' },
  { key: 'legalName', label: 'Legal entity name' },
  { key: 'taxId', label: 'Tax ID / EIN' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'websiteUrl', label: 'Website URL', placeholder: 'https://newterraconstruction.com' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
];

const PAYMENT_FIELDS: Array<{ key: keyof Settings; label: string; multiline?: boolean; placeholder?: string }> = [
  { key: 'zelleEmail', label: 'Zelle email' },
  { key: 'zelleName', label: 'Zelle recipient name' },
  { key: 'zellePhone', label: 'Zelle phone' },
  {
    key: 'achInstructions',
    label: 'ACH instructions',
    multiline: true,
    placeholder: 'e.g. "Email accounting@… for routing/account info" or paste the bank details directly.',
  },
  { key: 'checkPayableTo', label: 'Make checks payable to' },
  {
    key: 'checkMailingAddress',
    label: 'Check mailing address',
    multiline: true,
    placeholder: 'Where customers mail paper checks (multi-line OK).',
  },
  {
    key: 'paymentNotes',
    label: 'Payment notes',
    multiline: true,
    placeholder: 'Free-form note shown above the payment options on every unpaid invoice.',
  },
];

export default function CompanySettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>('/api/settings')
      .then((r) => setSettings(r.settings))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settings'));
  }, []);

  function patch(key: keyof Settings, value: string) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    // Convert empty strings back to null so the field reads as "unset" rather
    // than "intentionally blank string", and the server validation skips the
    // .email() / .url() refinements on empty input.
    const payload: Record<string, string | null> = {};
    for (const k of Object.keys(settings) as Array<keyof Settings>) {
      const v = settings[k];
      payload[k] = v === '' ? null : v;
    }
    try {
      const r = await api<{ settings: Settings }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setSettings(r.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <div className="dashboard"><p className="muted">Loading…</p></div>;

  return (
    <div className="dashboard">
      <header>
        <h1>Company settings</h1>
        <p className="muted">
          These details show up on customer-facing invoices, payment instructions,
          and PDF receipts. Leave a field blank to hide it from customers.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {saved && <div className="form-success">Saved.</div>}

      <form onSubmit={save}>
        <section className="card">
          <h2>Business identity</h2>
          {FIELDS.map((f) => (
            <SettingField
              key={f.key}
              field={f}
              value={settings[f.key]}
              onChange={(v) => patch(f.key, v)}
            />
          ))}
        </section>

        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>Payment instructions</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Customers see whichever methods you fill in below on every unpaid invoice.
            Best practice: only fill in the methods you actually accept so you don&rsquo;t
            get checks mailed to a stale address.
          </p>
          {PAYMENT_FIELDS.map((f) => (
            <SettingField
              key={f.key}
              field={f}
              value={settings[f.key]}
              onChange={(v) => patch(f.key, v)}
            />
          ))}
        </section>

        <div style={{ marginTop: '1rem' }}>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingField({
  field,
  value,
  onChange,
}: {
  field: { key: string; label: string; multiline?: boolean; placeholder?: string };
  value: string | null;
  onChange: (v: string) => void;
}) {
  const id = `s-${field.key}`;
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label htmlFor={id}>{field.label}</label>
      {field.multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
