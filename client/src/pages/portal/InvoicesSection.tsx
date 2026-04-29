import { Fragment, type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';
import PaymentsPanel from './PaymentsPanel';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'VOID';

interface Invoice {
  id: string;
  number: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
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
  const [showDraws, setShowDraws] = useState(false);
  const [openPayments, setOpenPayments] = useState<string | null>(null);

  // Draw schedule form state. Defaults to a typical 4-stage builder schedule
  // (deposit / framing / mechanicals / final).
  const [contractValue, setContractValue] = useState('');
  const [draws, setDraws] = useState<Array<{ label: string; percent: string; offsetDays: string }>>([
    { label: 'Deposit at signing', percent: '25', offsetDays: '0' },
    { label: 'Framing complete', percent: '25', offsetDays: '14' },
    { label: 'Mechanical rough-in', percent: '25', offsetDays: '30' },
    { label: 'Final on substantial completion', percent: '25', offsetDays: '60' },
  ]);
  const [drawSubmitting, setDrawSubmitting] = useState(false);

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

  async function generatePaymentLink(id: string) {
    if (!confirm('Generate a Stripe payment link? The customer will get a one-click "Pay now" button on this invoice.')) return;
    try {
      const { stub } = await api<{ stub: boolean }>(`/api/invoices/${id}/payment-link`, {
        method: 'POST',
      });
      await load();
      if (stub) {
        alert('Stripe is not configured on the server, so a stub link was saved. Edit it manually if you want to send something real.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate link');
    }
  }

  // Invoice PDFs need the bearer token, so we fetch as a blob and open
  // the result in a new tab.
  async function downloadInvoicePdf(id: string, number: string) {
    const apiBase = import.meta.env.VITE_API_URL ?? '';
    const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
    try {
      const res = await fetch(`${apiBase}/api/invoices/${id}/invoice.pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setError('Could not download invoice PDF');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF download failed');
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

  async function generateDrawSchedule(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(contractValue) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a valid contract value');
      return;
    }
    const parsed = draws.map((d) => ({
      label: d.label.trim(),
      percent: Number(d.percent),
      dueOffsetDays: d.offsetDays === '' ? null : Number(d.offsetDays),
    }));
    if (parsed.some((d) => !d.label || !Number.isFinite(d.percent) || d.percent <= 0)) {
      setError('Each draw needs a label and a positive percent');
      return;
    }
    const totalPercent = parsed.reduce((s, d) => s + d.percent, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      setError(`Percents must sum to 100% (got ${totalPercent}%)`);
      return;
    }
    setDrawSubmitting(true);
    try {
      const r = await api<{ invoices: Array<{ number: string }> }>(
        `/api/invoices/_admin/draw-schedule/${projectId}`,
        {
          method: 'POST',
          body: JSON.stringify({ contractValueCents: cents, draws: parsed }),
        },
      );
      alert(`Created ${r.invoices.length} draft invoices: ${r.invoices.map((i) => i.number).join(', ')}`);
      setShowDraws(false);
      setContractValue('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate schedule');
    } finally {
      setDrawSubmitting(false);
    }
  }

  function patchDraw(idx: number, patch: Partial<{ label: string; percent: string; offsetDays: string }>) {
    setDraws((arr) => arr.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function removeDraw(idx: number) {
    setDraws((arr) => arr.filter((_, i) => i !== idx));
  }
  function addDraw() {
    setDraws((arr) => [...arr, { label: '', percent: '0', offsetDays: '' }]);
  }

  // Live percent-sum display so admin sees the schedule balance as they type.
  const drawPercentSum = draws.reduce((s, d) => s + (Number(d.percent) || 0), 0);

  return (
    <section className="card">
      <div className="row-between">
        <h2>Invoices</h2>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => setShowDraws((v) => !v)}
              title="Generate a series of draft invoices for a deposit + progress payments"
            >
              {showDraws ? 'Cancel draws' : 'Draw schedule…'}
            </button>
            <button onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'New invoice'}
            </button>
          </div>
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

      {isAdmin && showDraws && (
        <form onSubmit={generateDrawSchedule} className="invoice-form">
          <p className="muted">
            Generates one DRAFT invoice per draw, sized by % of contract value, dated by days
            from project start. Last draw absorbs any rounding so amounts sum exactly.
          </p>
          <div className="form-row">
            <div>
              <label htmlFor="d-cv">Contract value (USD)</label>
              <input
                id="d-cv"
                type="number"
                step="0.01"
                min="0"
                value={contractValue}
                onChange={(e) => setContractValue(e.target.value)}
                required
              />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <span className={drawPercentSum === 100 ? '' : 'form-error'} style={{ fontSize: '0.85rem' }}>
                Total: {drawPercentSum.toFixed(2)}% {drawPercentSum === 100 ? '✓' : '(must = 100)'}
              </span>
            </div>
          </div>
          <table className="table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Label</th>
                <th style={{ width: 90 }}>%</th>
                <th style={{ width: 110 }}>Days from start</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draws.map((d, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      value={d.label}
                      onChange={(e) => patchDraw(idx, { label: e.target.value })}
                      placeholder="e.g. Framing complete"
                      required
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={d.percent}
                      onChange={(e) => patchDraw(idx, { percent: e.target.value })}
                      required
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={d.offsetDays}
                      placeholder="optional"
                      onChange={(e) => patchDraw(idx, { offsetDays: e.target.value })}
                    />
                  </td>
                  <td>
                    {draws.length > 1 && (
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => removeDraw(idx)}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <button type="button" className="button-ghost button-small" onClick={addDraw}>
              + Add draw
            </button>
            <button type="submit" disabled={drawSubmitting || drawPercentSum !== 100}>
              {drawSubmitting ? 'Generating…' : `Generate ${draws.length} draft invoices`}
            </button>
          </div>
        </form>
      )}

      {invoices.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>#</th><th>Issued</th><th>Due</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th>Status</th>
              <th></th>
              <th>{isAdmin ? '' : 'Pay'}</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <Fragment key={inv.id}>
                <tr>
                  <td>{inv.number}</td>
                  <td>{formatDate(inv.issuedAt)}</td>
                  <td>{formatDate(inv.dueAt)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(inv.amountCents)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: inv.balanceCents > 0 ? 'var(--accent)' : undefined,
                    }}
                  >
                    {formatCents(inv.balanceCents)}
                  </td>
                  <td>
                    <span className={`badge badge-${inv.status.toLowerCase()}`}>
                      {inv.status.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button-ghost button-small"
                      onClick={() => setOpenPayments(openPayments === inv.id ? null : inv.id)}
                    >
                      {openPayments === inv.id ? 'Hide' : 'Payments'}
                    </button>
                    <button
                      type="button"
                      className="button-ghost button-small"
                      style={{ marginLeft: '0.4rem' }}
                      onClick={() => downloadInvoicePdf(inv.id, inv.number)}
                      title="Download a PDF of this invoice"
                    >
                      PDF
                    </button>
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
                    ) : isAdmin && inv.status !== 'PAID' && inv.status !== 'VOID' ? (
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => generatePaymentLink(inv.id)}
                        title="Optional Stripe payment link — most teams just use Record payment instead"
                      >
                        Generate link
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <select
                        value={inv.status}
                        onChange={(e) => setStatus(inv.id, e.target.value as InvoiceStatus)}
                        title="Manual override — payments will recompute on the next change"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s.toLowerCase()}</option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
                {openPayments === inv.id && (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} style={{ background: 'var(--surface)' }}>
                      <PaymentsPanel invoiceId={inv.id} onChange={load} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No invoices for this project yet.</p>
      )}
    </section>
  );
}
