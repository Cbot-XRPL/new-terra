import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

interface Invoice {
  id: string;
  number: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
  issuedAt: string;
  dueAt: string | null;
  paymentUrl: string | null;
  customer: { id: string; name: string };
  project: { id: string; name: string } | null;
}

interface ReminderResult {
  considered: number;
  upcomingReminded: number;
  overdueReminded: number;
  flippedToOverdue: number;
  skippedCooldown: number;
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reminderInfo, setReminderInfo] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function load() {
    api<{ invoices: Invoice[] }>('/api/invoices')
      .then((d) => setInvoices(d.invoices))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }
  useEffect(() => { load(); }, []);

  async function runReminders() {
    if (!confirm('Email customers about upcoming-due and overdue invoices? Each invoice has a 3-day cooldown so this is safe to click more than once.')) return;
    setRunning(true);
    setReminderInfo(null);
    setError(null);
    try {
      const r = await api<ReminderResult>('/api/invoices/_admin/run-reminders', { method: 'POST' });
      setReminderInfo(
        `Considered ${r.considered}; emailed ${r.upcomingReminded} upcoming + ${r.overdueReminded} overdue` +
        (r.flippedToOverdue ? `; flipped ${r.flippedToOverdue} to OVERDUE` : '') +
        (r.skippedCooldown ? `; ${r.skippedCooldown} skipped (cooldown)` : ''),
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reminder run failed');
    } finally {
      setRunning(false);
    }
  }

  const total = invoices.reduce((sum, i) => sum + i.amountCents, 0);
  // Outstanding = sum of remaining balances on every non-VOID invoice. This
  // is the number accountants actually want — partial payments shrink it
  // straight away instead of waiting for the status to flip to PAID.
  const outstanding = invoices
    .filter((i) => i.status !== 'VOID')
    .reduce((sum, i) => sum + Math.max(0, i.balanceCents), 0);

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Invoices</h1>
          <p className="muted">
            {user?.role === 'CUSTOMER' ? 'Your invoices.' : 'All invoices across projects.'}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/portal/invoices/recurring" className="button-ghost button-small">
              Recurring →
            </Link>
            <button
              type="button"
              className="button-ghost button-small"
              onClick={runReminders}
              disabled={running}
              title="Email upcoming-due + overdue customers now (also flips past-due invoices to OVERDUE)"
            >
              {running ? 'Sending…' : 'Run invoice reminders'}
            </button>
          </div>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}
      {reminderInfo && <div className="form-success">{reminderInfo}</div>}

      <section className="card">
        <div className="invoice-stats">
          <div>
            <div className="stat-label">Total billed</div>
            <div className="stat-value">{formatCents(total)}</div>
          </div>
          <div>
            <div className="stat-label">Outstanding</div>
            <div className="stat-value">{formatCents(outstanding)}</div>
          </div>
          <div>
            <div className="stat-label">Count</div>
            <div className="stat-value">{invoices.length}</div>
          </div>
        </div>
      </section>

      <section className="card">
        {invoices.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Issued</th>
                <th>Due</th>
                {user?.role !== 'CUSTOMER' && <th>Customer</th>}
                <th>Project</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td data-label="#">{inv.number}</td>
                  <td data-label="Issued">{formatDate(inv.issuedAt)}</td>
                  <td data-label="Due">{formatDate(inv.dueAt)}</td>
                  {user?.role !== 'CUSTOMER' && <td data-label="Customer">{inv.customer.name}</td>}
                  <td data-label="Project">
                    {inv.project ? (
                      <Link to={`/portal/projects/${inv.project.id}`}>{inv.project.name}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label="Amount" style={{ textAlign: 'right' }}>{formatCents(inv.amountCents)}</td>
                  <td
                    data-label="Balance"
                    style={{
                      textAlign: 'right',
                      color: inv.balanceCents > 0 && inv.status !== 'VOID' ? 'var(--accent)' : undefined,
                    }}
                  >
                    {formatCents(inv.balanceCents)}
                  </td>
                  <td data-label="Status">
                    <span className={`badge badge-${inv.status.toLowerCase()}`}>
                      {inv.status.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    {inv.paymentUrl && inv.status !== 'PAID' && inv.status !== 'VOID' && (
                      <a
                        className="button button-small"
                        href={inv.paymentUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Pay now
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No invoices yet.</p>
        )}
      </section>
    </div>
  );
}
