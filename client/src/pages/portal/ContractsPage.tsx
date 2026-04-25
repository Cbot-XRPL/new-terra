import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

type ContractStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'VOID';
type SortField = 'createdAt' | 'sentAt' | 'signedAt' | 'status';

interface ContractRow {
  id: string;
  templateNameSnapshot: string;
  status: ContractStatus;
  sentAt: string | null;
  signedAt: string | null;
  createdAt: string;
  customer?: { id: string; name: string };
  createdBy?: { id: string; name: string };
}

interface ListResponse {
  contracts: ContractRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_BADGE: Record<ContractStatus, string> = {
  DRAFT: 'badge-draft',
  SENT: 'badge-sent',
  VIEWED: 'badge-sent',
  SIGNED: 'badge-paid',
  DECLINED: 'badge-overdue',
  VOID: 'badge-void',
};

export default function ContractsPage() {
  const { user } = useAuth();
  const isStaffAccess =
    user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales);

  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Query state — kept in component for now; URL sync is a follow-up.
  const [status, setStatus] = useState<'ALL' | ContractStatus>('ALL');
  const [sort, setSort] = useState<SortField>('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');

  // Debounce the search box so we don't fetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [status, sort, dir, qDebounced, pageSize]);

  useEffect(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      dir,
    });
    if (status !== 'ALL') params.set('status', status);
    if (qDebounced) params.set('q', qDebounced);
    api<ListResponse>(`/api/contracts?${params.toString()}`)
      .then((d) => {
        setContracts(d.contracts);
        setTotal(d.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [page, pageSize, sort, dir, status, qDebounced]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(field: SortField) {
    if (sort === field) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setDir('desc');
    }
  }

  function sortIndicator(field: SortField) {
    if (sort !== field) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Contracts</h1>
          <p className="muted">
            {user?.role === 'CUSTOMER'
              ? 'Contracts sent to you for review and signature.'
              : user?.role === 'ADMIN'
                ? 'All contracts across every sales rep.'
                : 'Your active and historical contracts.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 0, minWidth: 180 }}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'ALL' | ContractStatus)}
            style={{ marginBottom: 0, minWidth: 140 }}
          >
            <option value="ALL">All statuses</option>
            {(['DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOID'] as ContractStatus[]).map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
          {isStaffAccess && (
            <Link to="/portal/contracts/new" className="button">
              New contract
            </Link>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        {contracts.length ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Template</th>
                  {user?.role !== 'CUSTOMER' && <th>Customer</th>}
                  {user?.role === 'ADMIN' && <th>Rep</th>}
                  <th className="sortable" onClick={() => toggleSort('status')}>
                    Status{sortIndicator('status')}
                  </th>
                  <th className="sortable" onClick={() => toggleSort('createdAt')}>
                    Created{sortIndicator('createdAt')}
                  </th>
                  <th className="sortable" onClick={() => toggleSort('sentAt')}>
                    Sent{sortIndicator('sentAt')}
                  </th>
                  <th className="sortable" onClick={() => toggleSort('signedAt')}>
                    Signed{sortIndicator('signedAt')}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.templateNameSnapshot}</td>
                    {user?.role !== 'CUSTOMER' && <td>{c.customer?.name}</td>}
                    {user?.role === 'ADMIN' && <td>{c.createdBy?.name}</td>}
                    <td><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status.toLowerCase()}</span></td>
                    <td>{formatDate(c.createdAt)}</td>
                    <td>{formatDate(c.sentAt)}</td>
                    <td>{formatDate(c.signedAt)}</td>
                    <td>
                      <Link to={`/portal/contracts/${c.id}`} className="button button-ghost button-small">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination">
              <span className="muted">
                {contracts.length === 0
                  ? '0 of 0'
                  : `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + contracts.length} of ${total}`}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={{ marginBottom: 0 }}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>{n} / page</option>
                  ))}
                </select>
                <button
                  className="button-ghost button-small"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ◀ Prev
                </button>
                <span className="muted">Page {page} of {totalPages}</span>
                <button
                  className="button-ghost button-small"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">
            No contracts{status !== 'ALL' ? ` with status ${status.toLowerCase()}` : ''}
            {qDebounced ? ` matching "${qDebounced}"` : ''}.
          </p>
        )}
      </section>
    </div>
  );
}
