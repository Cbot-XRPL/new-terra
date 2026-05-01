import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';
import { addView, listViews, removeView, type SavedView } from '../../lib/savedViews';

const VIEWS_SCOPE = 'contracts';

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

  // Filter state lives in the URL so the back button + bookmarks + shared
  // links all work. Defaults come from the URL or fall back to sensible
  // values (newest first, page 1, 25/page).
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'ALL') as 'ALL' | ContractStatus;
  const sort = (params.get('sort') as SortField) || 'createdAt';
  const dir = (params.get('dir') as 'asc' | 'desc') || 'desc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.max(1, Number(params.get('pageSize')) || 25);
  const q = params.get('q') ?? '';

  // Setter helpers — patch one (or many) keys without losing the others.
  function patchParams(patch: Record<string, string | null>, options?: { resetPage?: boolean }) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === 'ALL') next.delete(key);
      else next.set(key, value);
    }
    if (options?.resetPage) next.delete('page');
    setParams(next, { replace: true });
  }

  // Saved filter views (localStorage) so reps can stash combos like
  // "my SENT contracts sorted by sentAt asc" and jump back with one click.
  const [views, setViews] = useState<SavedView[]>(() => listViews(VIEWS_SCOPE));

  // Debounced search — input typed locally, written to the URL after 300ms.
  const [qInput, setQInput] = useState(q);
  useEffect(() => { setQInput(q); /* sync if URL changes externally */ }, [q]);
  useEffect(() => {
    if (qInput === q) return;
    const t = setTimeout(() => patchParams({ q: qInput || null }, { resetPage: true }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  useEffect(() => {
    const search = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      dir,
    });
    if (status !== 'ALL') search.set('status', status);
    if (q) search.set('q', q);
    api<ListResponse>(`/api/contracts?${search.toString()}`)
      .then((d) => {
        setContracts(d.contracts);
        setTotal(d.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [page, pageSize, sort, dir, status, q]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(field: SortField) {
    if (sort === field) {
      patchParams({ dir: dir === 'asc' ? 'desc' : 'asc' });
    } else {
      patchParams({ sort: field, dir: 'desc' });
    }
  }

  function sortIndicator(field: SortField) {
    if (sort !== field) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Contracts</h1>
        <p className="muted">
          {user?.role === 'CUSTOMER'
            ? 'Contracts sent to you for review and signature.'
            : user?.role === 'ADMIN'
              ? 'All contracts across every sales rep.'
              : 'Your active and historical contracts.'}
        </p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search contracts…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select
          value={status}
          onChange={(e) =>
            patchParams({ status: e.target.value === 'ALL' ? null : e.target.value }, { resetPage: true })
          }
        >
          <option value="ALL">All statuses</option>
          {(['DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOID'] as ContractStatus[]).map((s) => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
        <div className="toolbar-spacer" />
        {isStaffAccess && (
          <Link to="/portal/contracts/new" className="button">
            New contract
          </Link>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {(views.length > 0 || params.toString()) && (
        <div className="saved-views">
          {views.map((v) => (
            <span key={v.id} className="saved-view-chip">
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams(v.query), { replace: true })}
                title={`Apply: ?${v.query || '(default)'}`}
              >
                {v.name}
              </button>
              <button
                type="button"
                className="saved-view-remove"
                onClick={() => {
                  removeView(VIEWS_SCOPE, v.id);
                  setViews(listViews(VIEWS_SCOPE));
                }}
                aria-label={`Remove saved view ${v.name}`}
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
          {params.toString() && (
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => {
                const name = prompt('Save current filters as:');
                if (!name) return;
                addView(VIEWS_SCOPE, name.trim(), params.toString());
                setViews(listViews(VIEWS_SCOPE));
              }}
            >
              ★ Save current view
            </button>
          )}
        </div>
      )}

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
                    <td data-label="Template">{c.templateNameSnapshot}</td>
                    {user?.role !== 'CUSTOMER' && <td data-label="Customer">{c.customer?.name}</td>}
                    {user?.role === 'ADMIN' && <td data-label="Rep">{c.createdBy?.name}</td>}
                    <td data-label="Status"><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status.toLowerCase()}</span></td>
                    <td data-label="Created">{formatDate(c.createdAt)}</td>
                    <td data-label="Sent">{formatDate(c.sentAt)}</td>
                    <td data-label="Signed">{formatDate(c.signedAt)}</td>
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
            No contracts{status !== 'ALL' ? ` with status ${status.toLowerCase()}` : ''}
            {q ? ` matching "${q}"` : ''}.
          </p>
        )}
      </section>
    </div>
  );
}
