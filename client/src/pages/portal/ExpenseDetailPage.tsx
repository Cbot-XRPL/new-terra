import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate, formatDateTime } from '../../lib/format';

type SyncStatus = 'LOCAL_ONLY' | 'QUEUED' | 'SYNCED' | 'ERROR';

interface Expense {
  id: string;
  amountCents: number;
  date: string;
  description: string | null;
  notes: string | null;
  reimbursable: boolean;
  reimbursedAt: string | null;
  syncStatus: SyncStatus;
  qbExpenseId: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
  receiptUrl: string | null;
  receiptThumbnailUrl: string | null;
  createdAt: string;
  vendor: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  paidBy: { id: string; name: string } | null;
  submittedBy: { id: string; name: string } | null;
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  const [expense, setExpense] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      const { expense } = await api<{ expense: Expense }>(`/api/finance/expenses/${id}`);
      setExpense(expense);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load expense');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (!expense) {
    return (
      <div className="dashboard">
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  async function markReimbursed(value: boolean) {
    try {
      await api(`/api/finance/expenses/${expense!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reimbursedAt: value ? new Date().toISOString() : null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function remove() {
    if (!confirm('Delete this expense and its receipt?')) return;
    try {
      await api(`/api/finance/expenses/${expense!.id}`, { method: 'DELETE' });
      navigate('/portal/finance/expenses');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/finance/expenses" className="muted">← Expenses</Link>
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{formatCents(expense.amountCents)}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {formatDate(expense.date)}
              {expense.vendor && ` · ${expense.vendor.name}`}
              {expense.project && (
                <>
                  {' · '}
                  <Link to={`/portal/projects/${expense.project.id}`}>{expense.project.name}</Link>
                </>
              )}
            </p>
          </div>
          {isAccounting && (
            <button type="button" className="button-ghost button-small" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <div className="form-row">
        <section className="card">
          <h2>Receipt</h2>
          {expense.receiptUrl ? (
            <a href={expense.receiptUrl} target="_blank" rel="noreferrer">
              <img
                src={expense.receiptUrl}
                alt="receipt"
                style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                loading="lazy"
              />
            </a>
          ) : (
            <p className="muted">No receipt image attached.</p>
          )}
        </section>

        <section className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Vendor</dt>
            <dd>{expense.vendor?.name ?? '—'}</dd>
            <dt>Category</dt>
            <dd>{expense.category?.name ?? '—'}</dd>
            <dt>Project</dt>
            <dd>
              {expense.project ? (
                <Link to={`/portal/projects/${expense.project.id}`}>{expense.project.name}</Link>
              ) : (
                '—'
              )}
            </dd>
            <dt>Paid by</dt>
            <dd>{expense.paidBy?.name ?? '—'}</dd>
            <dt>Submitted by</dt>
            <dd>
              {expense.submittedBy?.name ?? '—'}
              {' · '}
              {formatDateTime(expense.createdAt)}
            </dd>
            <dt>Reimbursable</dt>
            <dd>
              {expense.reimbursable
                ? expense.reimbursedAt
                  ? `Reimbursed ${formatDate(expense.reimbursedAt)}`
                  : 'Pending reimbursement'
                : 'No (company expense)'}
              {expense.reimbursable && (
                <button
                  type="button"
                  className="button-ghost button-small"
                  style={{ marginLeft: '0.5rem' }}
                  onClick={() => markReimbursed(!expense.reimbursedAt)}
                  disabled={!isAccounting && !expense.reimbursable}
                >
                  {expense.reimbursedAt ? 'Mark unpaid' : 'Mark reimbursed'}
                </button>
              )}
            </dd>
          </dl>

          {expense.description && (
            <>
              <h3>Description</h3>
              <p>{expense.description}</p>
            </>
          )}
          {expense.notes && (
            <>
              <h3>Notes</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{expense.notes}</p>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Sync status</h2>
        <p>
          <span className={`badge ${
            expense.syncStatus === 'SYNCED' ? 'badge-paid'
              : expense.syncStatus === 'ERROR' ? 'badge-overdue'
              : expense.syncStatus === 'QUEUED' ? 'badge-sent'
              : 'badge-draft'
          }`}>
            {expense.syncStatus.toLowerCase().replace('_', ' ')}
          </span>
          {expense.qbExpenseId && (
            <span className="muted">{' · QuickBooks #'}{expense.qbExpenseId}</span>
          )}
        </p>
        {expense.lastSyncAttemptAt && (
          <p className="muted">
            Last attempt {formatDateTime(expense.lastSyncAttemptAt)}
            {expense.lastSyncError && ` — ${expense.lastSyncError}`}
          </p>
        )}
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Local-only entries stay in this app indefinitely. When you connect QuickBooks
          (or another accounting system) entries with status <code>QUEUED</code> get pushed on the next sync.
        </p>
      </section>
    </div>
  );
}
