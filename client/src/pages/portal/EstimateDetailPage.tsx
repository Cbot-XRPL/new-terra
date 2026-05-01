import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate, formatDateTime } from '../../lib/format';
import PhotoAttachments from '../../components/PhotoAttachments';

type EstimateStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED' | 'VOID';

interface Line {
  id: string;
  description: string;
  quantity: string;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
  category: string | null;
  notes: string | null;
  position: number;
}
interface Estimate {
  id: string;
  number: string;
  status: EstimateStatus;
  title: string;
  scope: string | null;
  notes: string | null;
  termsText: string | null;
  templateNameSnapshot: string | null;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  validUntil: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  acceptedBySignature: string | null;
  customer: { id: string; name: string; email: string } | null;
  lead: { id: string; name: string; email: string | null } | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  lines: Line[];
  convertedProject: { id: string; name: string } | null;
  convertedContract: { id: string; status: string } | null;
}

interface ContractTemplateRef { id: string; name: string }

const STATUS_BADGE: Record<EstimateStatus, string> = {
  DRAFT: 'badge-draft',
  SENT: 'badge-sent',
  VIEWED: 'badge-sent',
  ACCEPTED: 'badge-paid',
  DECLINED: 'badge-overdue',
  EXPIRED: 'badge-overdue',
  CONVERTED: 'badge-paid',
  VOID: 'badge-void',
};

export default function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const isStaff = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales);

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [contractTemplates, setContractTemplates] = useState<ContractTemplateRef[]>([]);
  const [convertContractTemplateId, setConvertContractTemplateId] = useState('');

  async function load() {
    if (!id) return;
    try {
      const { estimate } = await api<{ estimate: Estimate }>(`/api/estimates/${id}`);
      setEstimate(estimate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load estimate');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  useEffect(() => {
    if (!isStaff) return;
    api<{ templates: ContractTemplateRef[] }>('/api/contract-templates')
      .then((r) => setContractTemplates(r.templates))
      .catch(() => undefined);
  }, [isStaff]);

  if (!estimate) {
    return (
      <div className="dashboard">
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  async function send() {
    if (!confirm('Send this estimate to the customer?')) return;
    try {
      await api(`/api/estimates/${estimate!.id}/send`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    }
  }

  async function voidEstimate() {
    if (!confirm('Void this estimate?')) return;
    try {
      await api(`/api/estimates/${estimate!.id}/void`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Void failed');
    }
  }

  async function accept(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/estimates/${estimate!.id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ signatureName: signature }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Accept failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function decline(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/estimates/${estimate!.id}/decline`, {
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

  async function convert() {
    if (!confirm('Convert this estimate into a project + draft contract?')) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/estimates/${estimate!.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          contractTemplateId: convertContractTemplateId || undefined,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Conversion failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Group lines by category for the customer-facing display.
  const grouped = estimate.lines.reduce<Map<string, Line[]>>((m, l) => {
    const key = l.category || 'Items';
    const arr = m.get(key) ?? [];
    arr.push(l);
    m.set(key, arr);
    return m;
  }, new Map());

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/estimates" className="muted">← Estimates</Link>
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{estimate.title}</h1>
            <p className="muted" style={{ margin: 0 }}>
              <strong>{estimate.number}</strong>
              {' · '}
              <span className={`badge ${STATUS_BADGE[estimate.status]}`}>
                {estimate.status.toLowerCase()}
              </span>
              {estimate.customer && <> · for {estimate.customer.name}</>}
              {!estimate.customer && estimate.lead && <> · lead: {estimate.lead.name}</>}
            </p>
          </div>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <h2>Summary</h2>
        <dl className="kv">
          <dt>Created</dt>
          <dd>{formatDateTime(estimate.createdAt)} by {estimate.createdBy.name}</dd>
          {estimate.templateNameSnapshot && (
            <>
              <dt>Template</dt>
              <dd>{estimate.templateNameSnapshot}</dd>
            </>
          )}
          {estimate.sentAt && (<><dt>Sent</dt><dd>{formatDateTime(estimate.sentAt)}</dd></>)}
          {estimate.viewedAt && (<><dt>Viewed</dt><dd>{formatDateTime(estimate.viewedAt)}</dd></>)}
          {estimate.acceptedAt && (
            <>
              <dt>Accepted</dt>
              <dd>
                {formatDateTime(estimate.acceptedAt)}
                {estimate.acceptedBySignature && ` by ${estimate.acceptedBySignature}`}
              </dd>
            </>
          )}
          {estimate.declinedAt && (
            <>
              <dt>Declined</dt>
              <dd>
                {formatDateTime(estimate.declinedAt)}
                {estimate.declineReason && ` — "${estimate.declineReason}"`}
              </dd>
            </>
          )}
          {estimate.validUntil && (
            <>
              <dt>Valid until</dt>
              <dd>{formatDate(estimate.validUntil)}</dd>
            </>
          )}
          {estimate.convertedProject && (
            <>
              <dt>Converted to</dt>
              <dd>
                <Link to={`/portal/projects/${estimate.convertedProject.id}`}>
                  Project: {estimate.convertedProject.name}
                </Link>
                {estimate.convertedContract && (
                  <>
                    {' · '}
                    <Link to={`/portal/contracts/${estimate.convertedContract.id}`}>
                      Contract: {estimate.convertedContract.status.toLowerCase()}
                    </Link>
                  </>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      {estimate.scope && (
        <section className="card">
          <h2>Scope of work</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{estimate.scope}</p>
        </section>
      )}

      <section className="card">
        <h2>Line items</h2>
        {[...grouped.entries()].map(([cat, items]) => {
          const subtotal = items.reduce((s, l) => s + l.totalCents, 0);
          return (
            <div key={cat} style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>{cat}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td>{l.quantity}</td>
                      <td>{l.unit ?? '—'}</td>
                      <td>{formatCents(l.unitPriceCents)}</td>
                      <td><strong>{formatCents(l.totalCents)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right' }}><em>Subtotal — {cat}</em></td>
                    <td><strong>{formatCents(subtotal)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}

        <dl className="kv" style={{ maxWidth: 360, marginLeft: 'auto' }}>
          <dt>Subtotal</dt><dd>{formatCents(estimate.subtotalCents)}</dd>
          <dt>Tax ({(estimate.taxRateBps / 100).toFixed(2)}%)</dt><dd>{formatCents(estimate.taxCents)}</dd>
          <dt><strong>Total</strong></dt><dd><strong>{formatCents(estimate.totalCents)}</strong></dd>
        </dl>
      </section>

      {estimate.termsText && (
        <section className="card">
          <h2>Terms</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{estimate.termsText}</p>
        </section>
      )}

      {estimate.notes && isStaff && (
        <section className="card">
          <h2>Internal notes</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{estimate.notes}</p>
        </section>
      )}

      {/* Customer actions */}
      {isCustomer && (estimate.status === 'SENT' || estimate.status === 'VIEWED') && (
        <section className="card">
          <h2>Accept or decline</h2>
          <p className="muted">
            By typing your name and clicking Accept, you agree to proceed with the work as estimated.
            We'll get a draft contract over to you shortly.
          </p>
          <form onSubmit={accept}>
            <label>Type your full name</label>
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              required
              minLength={2}
              autoComplete="name"
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Accept estimate'}
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
              <label>Why are you declining? (optional)</label>
              <textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              <button type="submit" className="button-ghost" disabled={submitting}>
                {submitting ? 'Declining…' : 'Confirm decline'}
              </button>
            </form>
          )}
        </section>
      )}

      <PhotoAttachments
        parent="estimates"
        parentId={estimate.id}
        canEdit={!!isStaff}
        emptyText="No photos yet — upload site shots so the customer + the eventual PM see what you saw."
      />

      {/* Staff actions */}
      {isStaff && (
        <section className="card">
          <h2>Actions</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {estimate.status === 'DRAFT' && estimate.customer && (
              <button onClick={send}>Send to customer</button>
            )}
            {estimate.status === 'DRAFT' && !estimate.customer && (
              <span className="muted">
                Convert the lead to a customer first (in /portal/leads), then come back to send.
              </span>
            )}
            {(estimate.status === 'SENT' || estimate.status === 'VIEWED' || estimate.status === 'DRAFT') && (
              <button className="button-ghost" onClick={voidEstimate}>Void</button>
            )}
            {estimate.status === 'ACCEPTED' && !estimate.convertedProject && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ marginBottom: 0 }}>Contract template (optional)</label>
                  <select
                    value={convertContractTemplateId}
                    onChange={(e) => setConvertContractTemplateId(e.target.value)}
                    style={{ marginBottom: 0 }}
                  >
                    <option value="">— no contract draft —</option>
                    {contractTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <button onClick={convert} disabled={submitting}>
                  {submitting ? 'Converting…' : 'Convert to project + contract'}
                </button>
              </div>
            )}
          </div>
          {estimate.status === 'DRAFT' && (
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
              To change line items on a draft, void it and start a new estimate. Inline edit
              is on the roadmap.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
