import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'VOID';

interface Invoice {
  id: string;
  number: string;
  amountCents: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  notes: string | null;
  paymentUrl: string | null;
  customer: { id: string; name: string };
  project: { id: string; name: string } | null;
}

const STATUSES: InvoiceStatus[] = ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID'];

interface Props {
  projectId: string;
  customerId: string;
  customerName: string;
}

export default function InvoicesSection({ projectId, customerId, customerName }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [amount, setAmount] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      // We re-use the global invoices list and filter client-side by project,
      // since the server already scopes to customer for non-admins.
      const { invoices } = await api<{ invoices: Invoice[] }>('/api/invoices');
      setInvoices(invoices.filter((i) => i.project?.id === projectId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load invoices');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function createInvoice(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          projectId,
          amountCents: cents,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          notes: notes || undefined,
          paymentUrl: paymentUrl || undefined,
        }),
      });
      setAmount('');
      setDueAt('');
      setNotes('');
      setPaymentUrl('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: string, status: InvoiceStatus) {
    try {
      await api(`/api/invoices/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Invoices</h2>
        {isAdmin && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New invoice'}
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {isAdmin && showForm && (
        <form onSubmit={createInvoice} className="invoice-form">
          <p className="muted">Invoice for {customerName}</p>
          <div className="form-row">
            <div>
              <label htmlFor="i-amount">Amount (USD)</label>
              <input
                id="i-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="i-due">Due date</label>
              <input
                id="i-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          <label htmlFor="i-notes">Notes</label>
          <textarea
            id="i-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <label htmlFor="i-pay">Hosted payment URL (optional)</label>
          <input
            id="i-pay"
            type="url"
            value={paymentUrl}
            onChange={(e) => setPaymentUrl(e.target.value)}
            placeholder="https://buy.stripe.com/..."
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create invoice'}
          </button>
        </form>
      )}

      {invoices.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>#</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th>
              <th>{isAdmin ? '' : 'Pay'}</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.number}</td>
                <td>{formatDate(inv.issuedAt)}</td>
                <td>{formatDate(inv.dueAt)}</td>
                <td>{formatCents(inv.amountCents)}</td>
                <td>
                  <span className={`badge badge-${inv.status.toLowerCase()}`}>
                    {inv.status.toLowerCase()}
                  </span>
                </td>
                <td>
                  {inv.paymentUrl && inv.status !== 'PAID' && inv.status !== 'VOID' ? (
                    <a
                      className="button button-small"
                      href={inv.paymentUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Pay now
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <select
                      value={inv.status}
                      onChange={(e) => setStatus(inv.id, e.target.value as InvoiceStatus)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s.toLowerCase()}</option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No invoices for this project yet.</p>
      )}
    </section>
  );
}
