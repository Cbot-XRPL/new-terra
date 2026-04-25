import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

type ContractStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'VOID';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function downloadPdf(id: string, filename: string) {
  const token = localStorage.getItem('nt_token');
  const res = await fetch(`${API_BASE}/api/contracts/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    alert('Could not download PDF');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}-${id.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface VariableDef {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
}

interface Contract {
  id: string;
  templateId: string | null;
  templateNameSnapshot: string;
  bodySnapshot: string;
  variableValues: Record<string, string>;
  status: ContractStatus;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  signatureName: string | null;
  declineReason: string | null;
  createdAt: string;
  customer: { id: string; name: string; email: string };
  createdBy: { id: string; name: string };
  template: { id: string; name: string; variables: VariableDef[] } | null;
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);

  // Sales/admin in-place edit of variable values while the contract is still
  // a draft.
  const [editValues, setEditValues] = useState<Record<string, string> | null>(null);

  async function load() {
    if (!id) return;
    try {
      const { contract } = await api<{ contract: Contract }>(`/api/contracts/${id}`);
      setContract(contract);
      setEditValues(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load contract');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (!contract) {
    return (
      <div className="dashboard">
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const isStaffAccess = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales);
  const isCustomer = user?.role === 'CUSTOMER';
  const isOwner = contract.createdBy.id === user?.id || user?.role === 'ADMIN';

  async function send() {
    if (!confirm('Send this contract to the customer?')) return;
    try {
      await api(`/api/contracts/${contract!.id}/send`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    }
  }

  async function voidContract() {
    if (!confirm('Void this contract? It cannot be unvoided.')) return;
    try {
      await api(`/api/contracts/${contract!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'VOID' }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Void failed');
    }
  }

  async function saveEdits() {
    if (!editValues) return;
    setSubmitting(true);
    try {
      await api(`/api/contracts/${contract!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ variableValues: editValues }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function sign(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/contracts/${contract!.id}/sign`, {
        method: 'POST',
        body: JSON.stringify({ signatureName }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function decline(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/contracts/${contract!.id}/decline`, {
        method: 'POST',
        body: JSON.stringify({ reason: declineReason || undefined }),
      });
      setShowDecline(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Decline failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/contracts" className="muted">← Contracts</Link>
        <h1>{contract.templateNameSnapshot}</h1>
        <div className="muted">
          <span className={`badge ${
            contract.status === 'SIGNED' ? 'badge-paid'
              : contract.status === 'DECLINED' ? 'badge-overdue'
              : contract.status === 'SENT' || contract.status === 'VIEWED' ? 'badge-sent'
              : contract.status === 'VOID' ? 'badge-void'
              : 'badge-draft'
          }`}>
            {contract.status.toLowerCase()}
          </span>
          {' · '}
          {isCustomer ? (
            <>From {contract.createdBy.name}</>
          ) : (
            <>For <strong>{contract.customer.name}</strong> · sent by {contract.createdBy.name}</>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="row-between">
          <h2>Audit trail</h2>
          {contract.status !== 'DRAFT' && (
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => downloadPdf(contract.id, contract.templateNameSnapshot)}
            >
              Download PDF
            </button>
          )}
        </div>
        <ul className="list">
          <li>Created {formatDateTime(contract.createdAt)} by {contract.createdBy.name}</li>
          {contract.sentAt && <li>Sent {formatDateTime(contract.sentAt)}</li>}
          {contract.viewedAt && <li>Viewed by customer {formatDateTime(contract.viewedAt)}</li>}
          {contract.signedAt && (
            <li>
              <strong>Signed</strong> {formatDateTime(contract.signedAt)}
              {contract.signatureName && ` by ${contract.signatureName}`}
            </li>
          )}
          {contract.declinedAt && (
            <li>
              <strong>Declined</strong> {formatDateTime(contract.declinedAt)}
              {contract.declineReason && ` — "${contract.declineReason}"`}
            </li>
          )}
        </ul>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Contract</h2>
          {isStaffAccess && contract.status === 'DRAFT' && contract.template && !editValues && (
            <button
              className="button-ghost button-small"
              onClick={() =>
                setEditValues({ ...(contract.variableValues as Record<string, string>) })
              }
            >
              Edit values
            </button>
          )}
        </div>

        {editValues && contract.template ? (
          <>
            {contract.template.variables.map((v) => (
              <div key={v.key}>
                <label htmlFor={`ev-${v.key}`}>
                  {v.label}{v.required && <span style={{ color: 'var(--error)' }}> *</span>}
                </label>
                {v.multiline ? (
                  <textarea
                    id={`ev-${v.key}`}
                    rows={3}
                    value={editValues[v.key] ?? ''}
                    onChange={(e) => setEditValues({ ...editValues, [v.key]: e.target.value })}
                  />
                ) : (
                  <input
                    id={`ev-${v.key}`}
                    value={editValues[v.key] ?? ''}
                    onChange={(e) => setEditValues({ ...editValues, [v.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={saveEdits} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save'}
              </button>
              <button className="button-ghost" onClick={() => setEditValues(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <pre className="contract-body">{contract.bodySnapshot}</pre>
        )}
      </section>

      {isStaffAccess && (
        <section className="card">
          <h2>Actions</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {contract.status === 'DRAFT' && isOwner && (
              <button onClick={send}>Send to customer</button>
            )}
            {(contract.status === 'SENT' || contract.status === 'VIEWED') && (
              <button className="button-ghost" onClick={voidContract}>Void</button>
            )}
            {contract.status === 'DRAFT' && contract.signatureName === null && (
              <span className="muted">Customer hasn't received this yet.</span>
            )}
          </div>
        </section>
      )}

      {isCustomer && (contract.status === 'SENT' || contract.status === 'VIEWED') && (
        <section className="card">
          <h2>Sign or decline</h2>
          <p className="muted">
            By typing your full legal name and clicking Sign, you agree to be legally bound by the
            terms of this contract. Your signature, the date and time, and your IP address will be
            recorded as part of the audit trail.
          </p>
          <form onSubmit={sign}>
            <label htmlFor="sig">Type your full legal name</label>
            <input
              id="sig"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              required
              minLength={2}
              autoComplete="name"
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Signing…' : 'Sign contract'}
              </button>
              <button
                type="button"
                className="button-ghost"
                onClick={() => setShowDecline((v) => !v)}
              >
                {showDecline ? 'Cancel decline' : 'Decline instead'}
              </button>
            </div>
          </form>

          {showDecline && (
            <form onSubmit={decline} style={{ marginTop: '1rem' }}>
              <label htmlFor="dr">Why are you declining? (optional)</label>
              <textarea
                id="dr"
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <button type="submit" className="button-ghost" disabled={submitting}>
                {submitting ? 'Declining…' : 'Confirm decline'}
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
