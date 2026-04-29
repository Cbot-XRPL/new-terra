// W-9 banner + inline form. Red CTA at the top of Request Pay nags every
// non-customer to file a W-9 if they haven't yet. Click it → form opens
// in-place (no modal so mobile keyboards don't fight a fixed overlay).
//
// Submission stamps signedAt + signedIp on the User row and writes an
// audit event so admin has a paper trail.

import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { AlertTriangle, Check } from 'lucide-react';

interface W9Status {
  onFile: boolean;
  legalName: string | null;
  taxClassification: string | null;
  taxIdType: 'SSN' | 'EIN' | null;
  taxIdMasked: string | null;
  mailingAddress: string | null;
  signedAt: string | null;
  signedName: string | null;
}

const CLASSIFICATIONS: Array<{ value: string; label: string }> = [
  { value: 'individual', label: 'Individual / Sole proprietor' },
  { value: 'sole_prop', label: 'Single-member LLC (disregarded)' },
  { value: 'llc', label: 'LLC (multi-member)' },
  { value: 'c_corp', label: 'C corporation' },
  { value: 's_corp', label: 'S corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'other', label: 'Other' },
];

interface Props {
  defaultLegalName?: string;
}

export default function W9Banner({ defaultLegalName }: Props) {
  const [status, setStatus] = useState<W9Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [legalName, setLegalName] = useState(defaultLegalName ?? '');
  const [taxClassification, setTaxClassification] = useState('individual');
  const [taxIdType, setTaxIdType] = useState<'SSN' | 'EIN'>('SSN');
  const [taxId, setTaxId] = useState('');
  const [mailingAddress, setMailingAddress] = useState('');
  const [signatureName, setSignatureName] = useState('');

  async function load() {
    try {
      const s = await api<W9Status>('/api/me/w9');
      setStatus(s);
      // Prefill form with whatever's already on file (empties on first run).
      if (s.legalName) setLegalName(s.legalName);
      if (s.taxClassification) setTaxClassification(s.taxClassification);
      if (s.taxIdType) setTaxIdType(s.taxIdType);
      if (s.mailingAddress) setMailingAddress(s.mailingAddress);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load W-9 status');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api('/api/me/w9', {
        method: 'POST',
        body: JSON.stringify({
          legalName,
          taxClassification,
          taxIdType,
          taxId,
          mailingAddress,
          signatureName,
        }),
      });
      setTaxId(''); // don't keep the full TIN in state once submitted
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'W-9 submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) return null;

  // Already on file — small confirmation chip, expandable to update.
  if (status.onFile && !open) {
    return (
      <div
        style={{
          padding: '0.6rem 0.9rem',
          background: 'rgba(0, 186, 124, 0.08)',
          border: '1px solid rgba(0, 186, 124, 0.4)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.9rem',
        }}
      >
        <Check size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
        <span>
          W-9 on file
          {status.signedAt && (
            <>
              {' '}— signed {new Date(status.signedAt).toLocaleDateString()} as{' '}
              <strong>{status.signedName}</strong>
              {status.taxIdMasked && (
                <span className="muted"> · {status.taxIdType ?? ''} {status.taxIdMasked}</span>
              )}
            </>
          )}
        </span>
        <button
          type="button"
          className="button-ghost button-small"
          onClick={() => setOpen(true)}
          style={{ marginLeft: 'auto' }}
        >
          Update
        </button>
      </div>
    );
  }

  return (
    <>
      {!open && !status.onFile && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: '100%',
            background: 'var(--error)',
            color: '#fff',
            border: 0,
            borderRadius: '10px',
            padding: '0.85rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.95rem',
            textAlign: 'left',
          }}
          title="Required before any pay can be issued"
        >
          <AlertTriangle size={20} style={{ flexShrink: 0 }} />
          <span>
            W-9 required — fill out your tax info before pay is processed.
          </span>
          <span style={{ marginLeft: 'auto', textDecoration: 'underline' }}>
            Open form →
          </span>
        </button>
      )}

      {open && (
        <section
          className="card"
          style={{
            border: status.onFile
              ? '1px solid var(--border)'
              : '2px solid var(--error)',
          }}
        >
          <div className="row-between" style={{ marginBottom: '0.5rem' }}>
            <div>
              <h2 style={{ margin: 0 }}>W-9 — Request for Taxpayer ID</h2>
              <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Required by the IRS before we issue 1099-NEC payments. Stored
                encrypted at rest. You can update any time from this page.
              </p>
            </div>
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>

          {error && <div className="form-error">{error}</div>}

          <form onSubmit={submit}>
            <label htmlFor="w9-name">Legal name (as on tax filing)</label>
            <input
              id="w9-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              required
              placeholder="John Doe (or registered LLC name)"
            />

            <label htmlFor="w9-class">Tax classification</label>
            <select
              id="w9-class"
              value={taxClassification}
              onChange={(e) => setTaxClassification(e.target.value)}
              required
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <div className="form-row">
              <div>
                <label htmlFor="w9-type">TIN type</label>
                <select
                  id="w9-type"
                  value={taxIdType}
                  onChange={(e) => setTaxIdType(e.target.value as 'SSN' | 'EIN')}
                >
                  <option value="SSN">SSN (individual)</option>
                  <option value="EIN">EIN (business)</option>
                </select>
              </div>
              <div>
                <label htmlFor="w9-tin">
                  {taxIdType} {status.taxIdMasked && <span className="muted">(currently {status.taxIdMasked})</span>}
                </label>
                <input
                  id="w9-tin"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder={taxIdType === 'SSN' ? '123-45-6789' : '12-3456789'}
                  required
                  autoComplete="off"
                />
              </div>
            </div>

            <label htmlFor="w9-addr">Mailing address</label>
            <textarea
              id="w9-addr"
              rows={3}
              value={mailingAddress}
              onChange={(e) => setMailingAddress(e.target.value)}
              required
              placeholder={'123 Main St\nAnytown, NY 10001'}
            />

            <label htmlFor="w9-sig">Type your full legal name to sign</label>
            <input
              id="w9-sig"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              required
              placeholder="John Doe"
            />
            <p className="muted" style={{ fontSize: '0.75rem', margin: '-0.25rem 0 0.75rem' }}>
              By signing, you certify under penalty of perjury that the TIN above is correct
              and you are not subject to backup withholding. We log the signature, your IP, and
              the timestamp.
            </p>

            <button type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit W-9'}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
