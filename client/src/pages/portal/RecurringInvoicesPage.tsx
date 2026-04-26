import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

interface RecurringInvoice {
  id: string;
  label: string;
  amountCents: number;
  frequency: Frequency;
  dayOfPeriod: number | null;
  notes: string | null;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  endsAt: string | null;
  customer: { id: string; name: string; email: string };
  project: { id: string; name: string } | null;
}

interface CustomerOption { id: string; name: string; email: string }

export default function RecurringInvoicesPage() {
  const { user } = useAuth();
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);
  const isAdmin = user?.role === 'ADMIN';

  const [items, setItems] = useState<RecurringInvoice[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [customerId, setCustomerId] = useState('');
  const [label, setLabel] = useState('Monthly maintenance');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [dayOfPeriod, setDayOfPeriod] = useState('1');
  const [nextRunAt, setNextRunAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [a, c] = await Promise.all([
        api<{ recurringInvoices: RecurringInvoice[] }>('/api/recurring-invoices'),
        isAccounting
          ? api<{ users: CustomerOption[] }>('/api/admin/users?role=CUSTOMER').catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] }),
      ]);
      setItems(a.recurringInvoices);
      setCustomers(c.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAccounting]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!customerId) {
      setError('Pick a customer');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/recurring-invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          label,
          amountCents: cents,
          frequency,
          dayOfPeriod: frequency === 'WEEKLY'
            ? Number(dayOfPeriod) // Sunday=0..Sat=6
            : Number(dayOfPeriod),
          nextRunAt: new Date(nextRunAt).toISOString(),
          notes: notes || null,
        }),
      });
      setAmount('');
      setNotes('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function pauseToggle(item: RecurringInvoice) {
    try {
      await api(`/api/recurring-invoices/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !item.active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function runNow(item: RecurringInvoice) {
    if (!confirm(`Generate a DRAFT invoice now from "${item.label}"? nextRunAt will advance by one period.`)) return;
    try {
      const r = await api<{ generated: number; invoiceIds: string[] }>(
        `/api/recurring-invoices/${item.id}/run-now`,
        { method: 'POST' },
      );
      setInfo(`Generated ${r.generated} draft invoice${r.generated === 1 ? '' : 's'}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Run failed');
    }
  }

  async function runCron() {
    if (!confirm('Run the recurring-invoice cron now? Generates drafts for every template whose nextRunAt has passed.')) return;
    try {
      const r = await api<{ generated: number; considered: number }>(
        '/api/recurring-invoices/_admin/run',
        { method: 'POST' },
      );
      setInfo(`Considered ${r.considered}; generated ${r.generated} drafts.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cron run failed');
    }
  }

  async function remove(item: RecurringInvoice) {
    if (!confirm(`Delete "${item.label}"? Existing draft invoices already created from it stay put.`)) return;
    try {
      await api(`/api/recurring-invoices/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Recurring invoices</h1>
          <p className="muted">
            Templates that auto-issue a DRAFT invoice on a schedule.
            {' '}<Link to="/portal/invoices">View invoices →</Link>
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="button-ghost button-small" onClick={runCron}>
            Run cron now
          </button>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}
      {info && <div className="form-success">{info}</div>}

      {isAccounting && (
        <section className="card">
          <div className="row-between">
            <h2>New template</h2>
            <button type="button" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Add'}
            </button>
          </div>
          {showForm && (
            <form onSubmit={create}>
              <div className="form-row">
                <div>
                  <label htmlFor="ri-cust">Customer</label>
                  <select
                    id="ri-cust"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    required
                  >
                    <option value="">— pick a customer —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} · {c.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ri-label">Label</label>
                  <input
                    id="ri-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label htmlFor="ri-amt">Amount (USD)</label>
                  <input
                    id="ri-amt"
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ri-freq">Frequency</label>
                  <select
                    id="ri-freq"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                  >
                    <option value="WEEKLY">weekly</option>
                    <option value="MONTHLY">monthly</option>
                    <option value="QUARTERLY">quarterly</option>
                    <option value="YEARLY">yearly</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ri-dop">
                    {frequency === 'WEEKLY' ? 'Day of week (0=Sun)' : 'Day of month (1–28)'}
                  </label>
                  <input
                    id="ri-dop"
                    type="number"
                    min={frequency === 'WEEKLY' ? 0 : 1}
                    max={frequency === 'WEEKLY' ? 6 : 28}
                    value={dayOfPeriod}
                    onChange={(e) => setDayOfPeriod(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="ri-next">First run</label>
                  <input
                    id="ri-next"
                    type="date"
                    value={nextRunAt}
                    onChange={(e) => setNextRunAt(e.target.value)}
                    required
                  />
                </div>
              </div>
              <label htmlFor="ri-notes">Notes (copied onto each generated invoice)</label>
              <input
                id="ri-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder='e.g. "Monthly maintenance · April 2026"'
              />
              <button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Create template'}
              </button>
            </form>
          )}
        </section>
      )}

      <section className="card">
        <h2>Templates</h2>
        {items.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Customer</th>
                <th>Frequency</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Next run</th>
                <th>Last run</th>
                <th>Status</th>
                {isAccounting && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} style={{ opacity: it.active ? 1 : 0.6 }}>
                  <td><strong>{it.label}</strong>{it.notes && <div className="muted" style={{ fontSize: '0.85rem' }}>{it.notes}</div>}</td>
                  <td>{it.customer.name}</td>
                  <td>
                    {it.frequency.toLowerCase()}
                    {it.dayOfPeriod != null && (
                      <span className="muted"> · day {it.dayOfPeriod}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatCents(it.amountCents)}</td>
                  <td>{formatDate(it.nextRunAt)}</td>
                  <td>{it.lastRunAt ? formatDate(it.lastRunAt) : <span className="muted">—</span>}</td>
                  <td>
                    {it.active
                      ? <span className="badge badge-paid">active</span>
                      : <span className="badge badge-void">paused</span>}
                  </td>
                  {isAccounting && (
                    <td>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => runNow(it)}
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => pauseToggle(it)}
                      >
                        {it.active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => remove(it)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No recurring templates yet.</p>
        )}
      </section>
    </div>
  );
}
