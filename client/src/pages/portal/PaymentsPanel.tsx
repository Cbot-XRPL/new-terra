import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';
import PaymentInstructions from './PaymentInstructions';

interface Payment {
  id: string;
  amountCents: number;
  method: string;
  referenceNumber: string | null;
  receivedAt: string;
  notes: string | null;
  recordedBy: { id: string; name: string } | null;
}

interface InvoiceDetail {
  id: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
  // Milestone acknowledgment fields. When requiresAcknowledgment is true
  // and acknowledgedAt is null, the customer must sign before payment
  // instructions are revealed.
  requiresAcknowledgment: boolean;
  milestoneLabel: string | null;
  acknowledgedAt: string | null;
  acknowledgedName: string | null;
  payments: Payment[];
}

interface Props {
  invoiceId: string;
  // Notify parent so the row in the surrounding table can refresh status/balance
  // without a full page reload.
  onChange?: () => void;
}

// Hint text per method so admins recording a Zelle/check don't have to
// remember the convention. Strictly informational — the API doesn't enforce
// the format.
const REF_HINT: Record<string, string> = {
  CASH: 'optional — receipt #',
  CHECK: 'check number',
  ZELLE: 'Zelle confirmation code',
  ACH: 'bank trace / transaction id',
  WIRE: 'wire reference',
  CARD: 'last 4 of card',
  STRIPE: 'auto-filled by webhook',
  QUICKBOOKS: 'QB transaction id',
  OTHER: 'free text',
};

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CHECK: 'Check',
  ZELLE: 'Zelle',
  ACH: 'ACH transfer',
  WIRE: 'Wire',
  CARD: 'Card',
  STRIPE: 'Stripe',
  QUICKBOOKS: 'QuickBooks',
  OTHER: 'Other',
};

export default function PaymentsPanel({ invoiceId, onChange }: Props) {
  const { user } = useAuth();
  // Plain employees and customers can see their invoice payments but cannot
  // record/delete — that's accounting + admin only.
  const canRecord = user?.role === 'ADMIN' ||
    (user?.role === 'EMPLOYEE' && user.isAccounting);

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('CHECK');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  // Cash typically gets a hand-off receipt rather than an email; everything
  // else defaults to emailing the customer the PDF.
  const [emailReceipt, setEmailReceipt] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { invoice } = await api<{ invoice: InvoiceDetail }>(
        `/api/invoices/${invoiceId}`,
      );
      setInvoice(invoice);
      // Default the amount to the remaining balance so one-shot full payments
      // are a single click.
      if (!showForm) {
        setAmount((invoice.balanceCents / 100).toFixed(2));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load invoice');
    }
  }

  useEffect(() => {
    load();
    // Methods rarely change; one fetch on first mount is fine.
    if (methods.length === 0) {
      api<{ methods: string[] }>('/api/invoices/_meta/payment-methods')
        .then((r) => setMethods(r.methods))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a valid positive amount');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: cents,
          method,
          referenceNumber: reference || null,
          receivedAt: new Date(receivedAt).toISOString(),
          notes: notes || null,
          emailReceipt,
        }),
      });
      setReference('');
      setNotes('');
      setShowForm(false);
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record payment');
    } finally {
      setSubmitting(false);
    }
  }

  // Receipt PDFs need the bearer token, so we can't just use a plain anchor.
  // Fetch as a blob and open it in a new tab so the customer can save / print.
  async function downloadReceipt(paymentId: string) {
    const apiBase = import.meta.env.VITE_API_URL ?? '';
    const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
    try {
      const res = await fetch(
        `${apiBase}/api/invoices/${invoiceId}/payments/${paymentId}/receipt.pdf`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) {
        setError('Could not download receipt');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoke after a short delay so the new tab has time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Receipt download failed');
    }
  }

  async function emailReceiptToCustomer(paymentId: string) {
    try {
      const r = await api<{ sentTo: string }>(
        `/api/invoices/${invoiceId}/payments/${paymentId}/email-receipt`,
        { method: 'POST' },
      );
      alert(`Receipt emailed to ${r.sentTo}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Receipt email failed');
    }
  }

  async function deletePayment(id: string) {
    if (!confirm('Remove this payment? The invoice balance will be recalculated.')) return;
    try {
      await api(`/api/invoices/${invoiceId}/payments/${id}`, { method: 'DELETE' });
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete payment');
    }
  }

  if (!invoice) {
    return <p className="muted">Loading payments…</p>;
  }

  return (
    <div className="payments-panel">
      {error && <div className="form-error">{error}</div>}

      <div className="payments-summary">
        <div>
          <div className="stat-label">Invoiced</div>
          <div className="stat-value">{formatCents(invoice.amountCents)}</div>
        </div>
        <div>
          <div className="stat-label">Paid</div>
          <div className="stat-value">{formatCents(invoice.paidCents)}</div>
        </div>
        <div>
          <div className="stat-label">Balance</div>
          <div
            className="stat-value"
            style={{ color: invoice.balanceCents > 0 ? 'var(--accent)' : undefined }}
          >
            {formatCents(invoice.balanceCents)}
          </div>
        </div>
      </div>

      {invoice.requiresAcknowledgment && (
        <MilestoneAcknowledgment
          invoice={invoice}
          isCustomer={user?.role === 'CUSTOMER'}
          onSigned={() => { load(); onChange?.(); }}
        />
      )}

      {invoice.balanceCents > 0
        && invoice.status !== 'VOID'
        && (!invoice.requiresAcknowledgment || invoice.acknowledgedAt) && (
        <PaymentInstructions />
      )}

      {invoice.payments.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Method</th>
              <th>Reference</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Recorded by</th>
              <th>Notes</th>
              {canRecord && <th></th>}
            </tr>
          </thead>
          <tbody>
            {invoice.payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.receivedAt)}</td>
                <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                <td className="muted">{p.referenceNumber ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{formatCents(p.amountCents)}</td>
                <td className="muted">{p.recordedBy?.name ?? 'system'}</td>
                <td className="muted" style={{ maxWidth: 220 }}>{p.notes ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => downloadReceipt(p.id)}
                    title="Open a PDF receipt for this payment"
                  >
                    Receipt
                  </button>
                  {canRecord && (
                    <>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => emailReceiptToCustomer(p.id)}
                        title="Re-send the PDF receipt to the customer"
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => deletePayment(p.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No payments recorded yet.</p>
      )}

      {canRecord && invoice.status !== 'VOID' && (
        <>
          {!showForm && invoice.balanceCents > 0 && (
            <button type="button" onClick={() => setShowForm(true)}>
              Record payment
            </button>
          )}
          {!showForm && invoice.balanceCents <= 0 && invoice.payments.length > 0 && (
            <p className="muted">Invoice is paid in full.</p>
          )}
          {showForm && (
            <form onSubmit={recordPayment} className="payment-form">
              <div className="form-row">
                <div>
                  <label htmlFor="p-method">Method</label>
                  <select
                    id="p-method"
                    value={method}
                    onChange={(e) => {
                      setMethod(e.target.value);
                      // Default email-receipt off when method flips to cash;
                      // back on for any other method (admin can still toggle).
                      setEmailReceipt(e.target.value !== 'CASH');
                    }}
                  >
                    {(methods.length ? methods : ['CHECK', 'ZELLE', 'CASH', 'ACH', 'OTHER']).map((m) => (
                      <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="p-amount">Amount (USD)</label>
                  <input
                    id="p-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="p-date">Received on</label>
                  <input
                    id="p-date"
                    type="date"
                    value={receivedAt}
                    onChange={(e) => setReceivedAt(e.target.value)}
                    required
                  />
                </div>
              </div>
              <label htmlFor="p-ref">
                Reference <span className="muted">({REF_HINT[method] ?? 'optional'})</span>
              </label>
              <input
                id="p-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={REF_HINT[method] ?? ''}
              />
              <label htmlFor="p-notes">Notes</label>
              <input
                id="p-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. deposited at chase 4/24"
              />
              <label
                htmlFor="p-email-receipt"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
              >
                <input
                  id="p-email-receipt"
                  type="checkbox"
                  checked={emailReceipt}
                  onChange={(e) => setEmailReceipt(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Email PDF receipt to customer
              </label>
              <div className="form-actions">
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save payment'}
                </button>
                <button
                  type="button"
                  className="button-ghost"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

// Pay-now gate: when an invoice requires acknowledgment, the customer must
// sign first. Staff just see a status badge — they don't sign on the
// customer's behalf. Once signed, this collapses into a small confirmation.
function MilestoneAcknowledgment({
  invoice,
  isCustomer,
  onSigned,
}: {
  invoice: InvoiceDetail;
  isCustomer: boolean;
  onSigned: () => void;
}) {
  const [signatureName, setSignatureName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (invoice.acknowledgedAt) {
    return (
      <div className="payment-instructions" style={{ borderColor: 'rgba(15,157,88,0.4)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="badge badge-paid">milestone acknowledged</span>
          <span className="muted">
            Signed by <strong>{invoice.acknowledgedName}</strong> on {new Date(invoice.acknowledgedAt).toLocaleString()}
          </span>
        </div>
      </div>
    );
  }

  if (!isCustomer) {
    return (
      <div className="payment-instructions">
        <h3 style={{ marginTop: 0 }}>Awaiting customer acknowledgment</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          {invoice.milestoneLabel
            ? <>Milestone: <strong>{invoice.milestoneLabel}</strong>. </>
            : null}
          The customer must sign this draw before payment options appear on their side.
        </p>
      </div>
    );
  }

  async function sign() {
    if (!signatureName.trim()) {
      setErr('Type your full name as signature');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api(`/api/invoices/${invoice.id}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify({ signatureName: signatureName.trim() }),
      });
      onSigned();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not sign');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="payment-instructions" style={{ borderColor: 'rgba(249,171,0,0.4)' }}>
      <h3 style={{ marginTop: 0 }}>Acknowledge milestone before paying</h3>
      <p>
        Please confirm that the milestone
        {invoice.milestoneLabel ? <> &mdash; <strong>{invoice.milestoneLabel}</strong></> : null}
        {' '}has been completed to your satisfaction. Payment options will appear once
        you sign below.
      </p>
      {err && <div className="form-error">{err}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={signatureName}
          onChange={(e) => setSignatureName(e.target.value)}
          placeholder="Type your full name"
          style={{ minWidth: 240 }}
        />
        <button type="button" onClick={sign} disabled={submitting}>
          {submitting ? 'Signing…' : 'Sign & continue to payment'}
        </button>
      </div>
    </div>
  );
}
