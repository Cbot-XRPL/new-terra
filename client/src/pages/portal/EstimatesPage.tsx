import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

type EstimateStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED' | 'VOID';

interface EstimateRow {
  id: string;
  number: string;
  title: string;
  status: EstimateStatus;
  totalCents: number;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  validUntil: string | null;
  customer?: { id: string; name: string; email: string } | null;
  lead?: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
}

interface ListResponse {
  estimates: EstimateRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUSES: EstimateStatus[] = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'VOID'];

const STATUS_BADGE: Record<EstimateStatus, string> = {
  DRAFT: 'badge-draft',
  SENT: 'badge-sent',
  VIEWED: 'badge-sent',
  ACCEPTED: 'badge-paid',
  DECLINED: 'badge-overdue',
  EXPIRED: 'badge-overdue',
  CONVERTED: 'badge-paid',
  VOID: 'badge-void',
};

function humanize(s: string) { return s.toLowerCase().replace(/_/g, ' '); }

export default function EstimatesPage() {
  const { user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const [params, setParams] = useSearchParams();

  const status = (params.get('status') ?? 'ALL') as 'ALL' | EstimateStatus;
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.max(1, Number(params.get('pageSize')) || 25);

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
      if (v === null || v === '' || v === 'ALL') next.delete(k);
      else next.set(k, v);
    }
    if (options?.resetPage) next.delete('page');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status !== 'ALL') search.set('status', status);
    if (q) search.set('q', q);
    api<ListResponse>(`/api/estimates?${search.toString()}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, [page, pageSize, status, q]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <div className="dashboard">
      <header>
        <h1>Estimates</h1>
        <p className="muted">
          {isCustomer
            ? 'Estimates we have prepared for you.'
            : user?.role === 'ADMIN'
              ? 'Every estimate across the team.'
              : 'Your estimates.'}
        </p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search estimates…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select
          value={status}
          onChange={(e) => patchParams({ status: e.target.value }, { resetPage: true })}
        >
          <option value="ALL">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <div className="toolbar-spacer" />
        {!isCustomer && (
          <Link to="/portal/estimates/new" className="button">
            + New estimate
          </Link>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        {data && data.estimates.length ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  {!isCustomer && <th>Customer / Lead</th>}
                  {!isCustomer && <th>Rep</th>}
                  <th>Total</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Valid until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.estimates.map((e) => (
                  <tr key={e.id}>
                    <td>{e.number}</td>
                    <td><strong>{e.title}</strong></td>
                    {!isCustomer && (
                      <td>
                        {e.customer?.name ?? e.lead?.name ?? <span className="muted">—</span>}
                      </td>
                    )}
                    {!isCustomer && <td>{e.createdBy.name}</td>}
                    <td>{formatCents(e.totalCents)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[e.status]}`}>{humanize(e.status)}</span>
                    </td>
                    <td>{formatDate(e.createdAt)}</td>
                    <td>{formatDate(e.validUntil)}</td>
                    <td>
                      <Link to={`/portal/estimates/${e.id}`} className="button button-ghost button-small">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination">
              <span className="muted">
                {`${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + data.estimates.length} of ${data.total}`}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="button-ghost button-small" disabled={page <= 1}
                  onClick={() => patchParams({ page: String(page - 1) })}>◀ Prev</button>
                <span className="muted">Page {page} of {totalPages}</span>
                <button className="button-ghost button-small" disabled={page >= totalPages}
                  onClick={() => patchParams({ page: String(page + 1) })}>Next ▶</button>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">No estimates yet.</p>
        )}
      </section>
    </div>
  );
}
