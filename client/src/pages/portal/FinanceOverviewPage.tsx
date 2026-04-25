import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

type SyncStatus = 'LOCAL_ONLY' | 'QUEUED' | 'SYNCED' | 'ERROR';

interface ExpenseRow {
  id: string;
  amountCents: number;
  date: string;
  description: string | null;
  reimbursable: boolean;
  reimbursedAt: string | null;
  syncStatus: SyncStatus;
  receiptThumbnailUrl: string | null;
  vendor: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  paidBy: { id: string; name: string } | null;
  submittedBy: { id: string; name: string } | null;
}

interface Summary {
  monthTotalCents: number;
  pendingReimburseCents: number;
  pendingReimburseCount: number;
  bySyncStatus: Array<{ status: SyncStatus; count: number; totalCents: number }>;
  byCategory: Array<{ categoryId: string | null; name: string; count: number; totalCents: number }>;
  byProject: Array<{ projectId: string | null; name: string; count: number; totalCents: number }>;
  recent: ExpenseRow[];
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  LOCAL_ONLY: 'local only',
  QUEUED: 'queued for sync',
  SYNCED: 'synced',
  ERROR: 'sync error',
};

const SYNC_BADGE: Record<SyncStatus, string> = {
  LOCAL_ONLY: 'badge-draft',
  QUEUED: 'badge-sent',
  SYNCED: 'badge-paid',
  ERROR: 'badge-overdue',
};

export default function FinanceOverviewPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Summary>('/api/finance/summary')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Finance</h1>
          <p className="muted">
            {isAccounting
              ? 'Company-wide expenses and job costing.'
              : 'Your submitted expenses + receipts on your projects.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link to="/portal/finance/expenses/new" className="button">
            + Add receipt
          </Link>
          <Link to="/portal/finance/expenses" className="button button-ghost">
            All expenses
          </Link>
          {isAccounting && (
            <Link to="/portal/finance/qb" className="button button-ghost">
              QuickBooks
            </Link>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {data && (
        <>
          <section className="card">
            <div className="invoice-stats">
              <div>
                <div className="stat-label">This month</div>
                <div className="stat-value">{formatCents(data.monthTotalCents)}</div>
              </div>
              <div>
                <div className="stat-label">Pending reimbursement</div>
                <div className="stat-value">{formatCents(data.pendingReimburseCents)}</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {data.pendingReimburseCount} entr{data.pendingReimburseCount === 1 ? 'y' : 'ies'}
                </div>
              </div>
              {data.bySyncStatus.map((s) => (
                <div key={s.status}>
                  <div className="stat-label">{SYNC_LABEL[s.status]}</div>
                  <div className="stat-value">{s.count}</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {formatCents(s.totalCents)}
                  </div>
                </div>
              ))}
            </div>
            {/*
              Reminder: every "synced" / "queued" stat above is an integration
              add-on. The app works fine if no QuickBooks (or other) connection
              is ever wired — entries simply stay LOCAL_ONLY.
            */}
          </section>

          <div className="form-row">
            <section className="card">
              <h2>Top categories this month</h2>
              {data.byCategory.length ? (
                <table className="table">
                  <thead>
                    <tr><th>Category</th><th>Count</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((c) => (
                      <tr key={c.categoryId ?? 'uncat'}>
                        <td>{c.name}</td>
                        <td>{c.count}</td>
                        <td>{formatCents(c.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No expenses this month.</p>
              )}
            </section>

            <section className="card">
              <h2>Top projects this month</h2>
              {data.byProject.length ? (
                <table className="table">
                  <thead>
                    <tr><th>Project</th><th>Count</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {data.byProject.map((p) => (
                      <tr key={p.projectId ?? 'unassigned'}>
                        <td>
                          {p.projectId ? (
                            <Link to={`/portal/projects/${p.projectId}`}>{p.name}</Link>
                          ) : (
                            p.name
                          )}
                        </td>
                        <td>{p.count}</td>
                        <td>{formatCents(p.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No project-tagged expenses this month.</p>
              )}
            </section>
          </div>

          <section className="card">
            <h2>Recent expenses</h2>
            {data.recent.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Project</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.receiptThumbnailUrl ? (
                          <a href={e.receiptThumbnailUrl} target="_blank" rel="noreferrer">
                            <img
                              src={e.receiptThumbnailUrl}
                              alt="receipt"
                              style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }}
                            />
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{formatDate(e.date)}</td>
                      <td>{e.vendor?.name ?? <span className="muted">—</span>}</td>
                      <td>{e.category?.name ?? <span className="muted">—</span>}</td>
                      <td>
                        {e.project ? (
                          <Link to={`/portal/projects/${e.project.id}`}>{e.project.name}</Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{formatCents(e.amountCents)}</td>
                      <td>
                        <span className={`badge ${SYNC_BADGE[e.syncStatus]}`}>
                          {SYNC_LABEL[e.syncStatus]}
                        </span>
                      </td>
                      <td>
                        <Link to={`/portal/finance/expenses/${e.id}`} className="button button-ghost button-small">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No expenses yet. Add a receipt to get started.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
