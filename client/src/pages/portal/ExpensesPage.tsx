import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
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
}

interface ListResponse {
  expenses: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  totalCents: number;
}

const SYNC_BADGE: Record<SyncStatus, string> = {
  LOCAL_ONLY: 'badge-draft',
  QUEUED: 'badge-sent',
  SYNCED: 'badge-paid',
  ERROR: 'badge-overdue',
};

export default function ExpensesPage() {
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.max(1, Number(params.get('pageSize')) || 25);
  const sort = (params.get('sort') as 'date' | 'amountCents' | 'createdAt') || 'date';
  const dir = (params.get('dir') as 'asc' | 'desc') || 'desc';
  const q = params.get('q') ?? '';
  const reimbursable = params.get('reimbursable') ?? '';
  const mine = params.get('mine') === 'true';

  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [qInput, setQInput] = useState(q);
  useEffect(() => { setQInput(q); }, [q]);
  useEffect(() => {
    if (qInput === q) return;
    const t = setTimeout(() => patchParams({ q: qInput || null }, { resetPage: true }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  function patchParams(patch: Record<string, string | null>, options?: { resetPage?: boolean }) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (options?.resetPage) next.delete('page');
    setParams(next, { replace: true });
  }

  async function load() {
    try {
      const search = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
        dir,
      });
      if (q) search.set('q', q);
      if (reimbursable) search.set('reimbursable', reimbursable);
      if (mine) search.set('mine', 'true');
      const res = await api<ListResponse>(`/api/finance/expenses?${search.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load expenses');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, pageSize, sort, dir, q, reimbursable, mine]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  function toggleSort(field: 'date' | 'amountCents' | 'createdAt') {
    if (sort === field) patchParams({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else patchParams({ sort: field, dir: 'desc' });
  }
  function sortInd(field: 'date' | 'amountCents' | 'createdAt') {
    if (sort !== field) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Expenses</h1>
          <p className="muted">Receipts, bills, and reimbursable spending.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search vendor / notes…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            style={{ marginBottom: 0, minWidth: 200 }}
          />
          <select
            value={reimbursable}
            onChange={(e) => patchParams({ reimbursable: e.target.value || null }, { resetPage: true })}
            style={{ marginBottom: 0 }}
          >
            <option value="">All entries</option>
            <option value="true">Reimbursable only</option>
            <option value="false">Company expense only</option>
          </select>
          <label style={{ marginBottom: 0, alignSelf: 'center' }}>
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => patchParams({ mine: e.target.checked ? 'true' : null }, { resetPage: true })}
              style={{ width: 'auto', marginRight: 6 }}
            />
            Only mine
          </label>
          <Link to="/portal/finance/expenses/new" className="button">
            + Add receipt
          </Link>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        {data && data.expenses.length ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th className="sortable" onClick={() => toggleSort('date')}>Date{sortInd('date')}</th>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Project</th>
                  <th>Paid by</th>
                  <th className="sortable" onClick={() => toggleSort('amountCents')}>Amount{sortInd('amountCents')}</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.receiptThumbnailUrl ? (
                        <a href={e.receiptThumbnailUrl} target="_blank" rel="noreferrer">
                          <img
                            src={e.receiptThumbnailUrl}
                            alt="receipt"
                            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }}
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{formatDate(e.date)}</td>
                    <td>
                      {e.vendor?.name ?? <span className="muted">—</span>}
                      {e.description && (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {e.description.slice(0, 60)}{e.description.length > 60 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td>{e.category?.name ?? <span className="muted">—</span>}</td>
                    <td>
                      {e.project ? (
                        <Link to={`/portal/projects/${e.project.id}`}>{e.project.name}</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{e.paidBy?.name ?? <span className="muted">—</span>}</td>
                    <td>
                      {formatCents(e.amountCents)}
                      {e.reimbursable && (
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          {e.reimbursedAt ? 'reimbursed' : 'reimbursable'}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${SYNC_BADGE[e.syncStatus]}`}>
                        {e.syncStatus.toLowerCase().replace('_', ' ')}
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

            <div className="pagination">
              <span className="muted">
                {`${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + data.expenses.length} of ${data.total}`}
                {' · '}
                <strong>{formatCents(data.totalCents)}</strong> matching
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={pageSize}
                  onChange={(e) => patchParams({ pageSize: e.target.value }, { resetPage: true })}
                  style={{ marginBottom: 0 }}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>{n} / page</option>
                  ))}
                </select>
                <button
                  className="button-ghost button-small"
                  disabled={page <= 1}
                  onClick={() => patchParams({ page: String(page - 1) })}
                >
                  ◀ Prev
                </button>
                <span className="muted">Page {page} of {totalPages}</span>
                <button
                  className="button-ghost button-small"
                  disabled={page >= totalPages}
                  onClick={() => patchParams({ page: String(page + 1) })}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">
            No expenses{q ? ` matching "${q}"` : ''}. <Link to="/portal/finance/expenses/new">Add one</Link>.
          </p>
        )}
      </section>
    </div>
  );
}
