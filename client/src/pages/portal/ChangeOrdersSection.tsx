import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

type Status = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'VOID';

interface ChangeOrder {
  id: string;
  number: string;
  title: string;
  description: string | null;
  amountCents: number;
  status: Status;
  sentAt: string | null;
  signedAt: string | null;
  signatureName: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  invoice: { id: string; number: string; status: string } | null;
}

interface Props {
  projectId: string;
  customerName: string;
}

const STATUS_BADGE: Record<Status, string> = {
  DRAFT: 'badge-draft',
  SENT: 'badge-sent',
  ACCEPTED: 'badge-paid',
  DECLINED: 'badge-overdue',
  VOID: 'badge-void',
};

export default function ChangeOrdersSection({ projectId, customerName }: Props) {
  const { user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  // Sales-flagged employees + admin can author / send / void.
  const canAuthor = user?.role === 'ADMIN'
    || (user?.role === 'EMPLOYEE' && user.isSales);

  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // New-CO form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Customer signoff modal — keep state for the currently-acting CO.
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState('');

  async function load() {
    try {
      const r = await api<{ changeOrders: ChangeOrder[] }>(
        `/api/change-orders?projectId=${projectId}`,
      );
      setItems(r.changeOrders);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load change orders');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents === 0) {
      setError('Enter a non-zero amount (use a negative number for a credit)');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/change-orders', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          title,
          description: description || null,
          amountCents: cents,
        }),
      });
      setTitle('');
      setDescription('');
      setAmount('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create change order');
    } finally {
      setSubmitting(false);
    }
  }

  async function send(id: string) {
    if (!confirm('Send this change order to the customer? They\'ll be able to accept or decline.')) return;
    try {
      await api(`/api/change-orders/${id}/send`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    }
  }

  async function accept(id: string) {
    if (!signatureName.trim()) {
      setError('Type your full name as signature');
      return;
    }
    try {
      await api(`/api/change-orders/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ signatureName: signatureName.trim() }),
      });
      setSigningId(null);
      setSignatureName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Accept failed');
    }
  }

  async function decline(id: string) {
    const reason = prompt('Reason for declining (optional)?');
    if (reason === null) return;
    try {
      await api(`/api/change-orders/${id}/decline`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Decline failed');
    }
  }

  async function voidCo(id: string) {
    if (!confirm('Void this change order? This cannot be undone.')) return;
    try {
      await api(`/api/change-orders/${id}/void`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Void failed');
    }
  }

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2>Change orders</h2>
          <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
            Signed addendums to the contract. Positive amount = additional bill, negative = credit.
            Accepting one auto-issues a draft invoice for the change amount.
          </p>
        </div>
        {canAuthor && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New change order'}
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {canAuthor && showForm && (
        <form onSubmit={create} className="invoice-form">
          <p className="muted">Change order for {customerName}</p>
          <label htmlFor="co-title">Title</label>
          <input
            id="co-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. Add screen porch enclosure"
          />
          <label htmlFor="co-amt">Amount (USD, negative for credit)</label>
          <input
            id="co-amt"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <label htmlFor="co-desc">Description</label>
          <textarea
            id="co-desc"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scope of the change, materials, delays, etc."
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Create draft'}
          </button>
        </form>
      )}

      {items.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
              <th>Signoff</th>
              <th>Invoice</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((co) => (
              <tr key={co.id}>
                <td>{co.number}</td>
                <td>
                  <div><strong>{co.title}</strong></div>
                  {co.description && (
                    <div className="muted" style={{ fontSize: '0.85rem', maxWidth: 320 }}>
                      {co.description}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', color: co.amountCents < 0 ? '#0f9d58' : undefined }}>
                  {formatCents(co.amountCents)}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[co.status]}`}>
                    {co.status.toLowerCase()}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: '0.85rem' }}>
                  {co.signedAt
                    ? <>Signed {formatDate(co.signedAt)} by {co.signatureName}</>
                    : co.declinedAt
                      ? <>Declined {formatDate(co.declinedAt)}{co.declineReason ? ` · ${co.declineReason}` : ''}</>
                      : '—'}
                </td>
                <td>
                  {co.invoice
                    ? <span className="muted">{co.invoice.number}</span>
                    : <span className="muted">—</span>}
                </td>
                <td>
                  {canAuthor && co.status === 'DRAFT' && (
                    <>
                      <button
                        type="button"
                        className="button-small"
                        onClick={() => send(co.id)}
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => voidCo(co.id)}
                      >
                        Void
                      </button>
                    </>
                  )}
                  {isCustomer && co.status === 'SENT' && (
                    <>
                      {signingId === co.id ? (
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            value={signatureName}
                            onChange={(e) => setSignatureName(e.target.value)}
                            placeholder="Type your full name"
                            style={{ width: 180 }}
                          />
                          <button
                            type="button"
                            className="button-small"
                            onClick={() => accept(co.id)}
                          >
                            Sign
                          </button>
                          <button
                            type="button"
                            className="button-ghost button-small"
                            onClick={() => { setSigningId(null); setSignatureName(''); }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="button-small"
                            onClick={() => setSigningId(co.id)}
                          >
                            Accept & sign
                          </button>
                          <button
                            type="button"
                            className="button-ghost button-small"
                            style={{ marginLeft: '0.4rem' }}
                            onClick={() => decline(co.id)}
                          >
                            Decline
                          </button>
                        </>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No change orders on this project.</p>
      )}
    </section>
  );
}
