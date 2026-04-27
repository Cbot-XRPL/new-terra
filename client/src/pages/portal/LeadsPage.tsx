import { type FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'QUOTE_SENT' | 'WON' | 'LOST' | 'ON_HOLD';
type LeadSource =
  | 'WEBSITE_FORM'
  | 'REFERRAL'
  | 'REPEAT_CUSTOMER'
  | 'GOOGLE'
  | 'ANGI'
  | 'HOME_DEPOT'
  | 'WALK_IN'
  | 'OTHER';

interface LeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  scope: string | null;
  estimatedValueCents: number | null;
  status: LeadStatus;
  source: LeadSource;
  serviceCategory: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  convertedToCustomer: { id: string; name: string; email: string } | null;
  _count: { activities: number };
}

interface ListResponse {
  leads: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface BoardSummary {
  byStatus: Array<{ status: LeadStatus; count: number; valueCents: number }>;
}

const STATUSES: LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'QUOTE_SENT',
  'WON',
  'LOST',
  'ON_HOLD',
];
const SOURCES: LeadSource[] = [
  'WEBSITE_FORM',
  'REFERRAL',
  'REPEAT_CUSTOMER',
  'GOOGLE',
  'ANGI',
  'HOME_DEPOT',
  'WALK_IN',
  'OTHER',
];

const STATUS_BADGE: Record<LeadStatus, string> = {
  NEW: 'badge-draft',
  CONTACTED: 'badge-sent',
  QUALIFIED: 'badge-sent',
  QUOTE_SENT: 'badge-sent',
  WON: 'badge-paid',
  LOST: 'badge-overdue',
  ON_HOLD: 'badge-void',
};

function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, ' ');
}

export default function LeadsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const status = (params.get('status') ?? 'ALL') as 'ALL' | LeadStatus;
  const source = (params.get('source') ?? 'ALL') as 'ALL' | LeadSource;
  const mine = params.get('mine') === 'true';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.max(1, Number(params.get('pageSize')) || 25);
  const sort = params.get('sort') ?? 'updatedAt';
  const dir = (params.get('dir') as 'asc' | 'desc') || 'desc';

  const [data, setData] = useState<ListResponse | null>(null);
  const [board, setBoard] = useState<BoardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New-lead form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [scope, setScope] = useState('');
  const [estimate, setEstimate] = useState('');
  const [statusInput, setStatusInput] = useState<LeadStatus>('NEW');
  const [sourceInput, setSourceInput] = useState<LeadSource>('OTHER');
  const [submitting, setSubmitting] = useState(false);

  // Search debounce
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

  async function load() {
    try {
      const search = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
        dir,
      });
      if (status !== 'ALL') search.set('status', status);
      if (source !== 'ALL') search.set('source', source);
      if (mine) search.set('mine', 'true');
      if (q) search.set('q', q);
      const [res, boardRes] = await Promise.all([
        api<ListResponse>(`/api/leads?${search.toString()}`),
        api<BoardSummary>('/api/leads/board-summary'),
      ]);
      setData(res);
      setBoard(boardRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load leads');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, pageSize, sort, dir, status, source, mine, q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const cents = estimate ? Math.round(Number(estimate) * 100) : undefined;
      await api('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone: phone || undefined,
          address: address || undefined,
          scope: scope || undefined,
          estimatedValueCents: Number.isFinite(cents) ? cents : undefined,
          status: statusInput,
          source: sourceInput,
        }),
      });
      setName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setScope('');
      setEstimate('');
      setStatusInput('NEW');
      setSourceInput('OTHER');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function quickStatus(id: string, next: LeadStatus) {
    try {
      await api(`/api/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status update failed');
    }
  }

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Leads</h1>
          <p className="muted">Track every potential customer from first contact to signed contract.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            style={{ marginBottom: 0, minWidth: 180 }}
          />
          <select
            value={status}
            onChange={(e) => patchParams({ status: e.target.value }, { resetPage: true })}
            style={{ marginBottom: 0, minWidth: 140 }}
          >
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => patchParams({ source: e.target.value }, { resetPage: true })}
            style={{ marginBottom: 0, minWidth: 140 }}
          >
            <option value="ALL">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </select>
          {user?.role === 'EMPLOYEE' && user.isSales && (
            <label style={{ marginBottom: 0, alignSelf: 'center' }}>
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => patchParams({ mine: e.target.checked ? 'true' : null }, { resetPage: true })}
                style={{ width: 'auto', marginRight: 6 }}
              />
              Only mine
            </label>
          )}
          <button
            type="button"
            className="button-ghost"
            onClick={async () => {
              try {
                const r = await api<{ considered: number; notified: number; skippedNoOwner: number }>(
                  '/api/leads/admin/notify-stale',
                  { method: 'POST' },
                );
                alert(
                  `Stale-lead nudge: emailed ${r.notified} rep${r.notified === 1 ? '' : 's'} ` +
                    `(considered ${r.considered}, ${r.skippedNoOwner} unowned).`,
                );
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Notify failed');
              }
            }}
            title="Email each assigned rep about leads that have gone quiet > 5 days"
          >
            Nudge stale
          </button>
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New lead'}
          </button>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {board && (
        <section className="card">
          <div className="invoice-stats">
            {STATUSES.filter((s) => s !== 'ON_HOLD').map((s) => {
              const row = board.byStatus.find((b) => b.status === s);
              return (
                <div key={s}>
                  <div className="stat-label">{humanize(s)}</div>
                  <div className="stat-value">{row?.count ?? 0}</div>
                  {row && row.valueCents > 0 && (
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {formatCents(row.valueCents)} pipeline
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showForm && (
        <section className="card">
          <h2>New lead</h2>
          <form onSubmit={submit}>
            <div className="form-row">
              <div>
                <label htmlFor="l-name">Name</label>
                <input id="l-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="l-email">Email</label>
                <input id="l-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div>
                <label htmlFor="l-phone">Phone</label>
                <input id="l-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="l-address">Address</label>
                <input id="l-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
            </div>
            <label htmlFor="l-scope">Scope of interest</label>
            <textarea
              id="l-scope"
              rows={3}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. 16x20 trex deck with stairs and screen porch"
            />
            <div className="form-row">
              <div>
                <label htmlFor="l-est">Estimated value (USD)</label>
                <input
                  id="l-est"
                  type="number"
                  min="0"
                  step="100"
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="l-status">Status</label>
                <select id="l-status" value={statusInput} onChange={(e) => setStatusInput(e.target.value as LeadStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{humanize(s)}</option>
                  ))}
                </select>
              </div>
            </div>
            <label htmlFor="l-source">Source</label>
            <select id="l-source" value={sourceInput} onChange={(e) => setSourceInput(e.target.value as LeadSource)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </select>
            <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Add lead'}</button>
          </form>
        </section>
      )}

      <section className="card">
        {data && data.leads.length ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Scope</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Est.</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={`/portal/leads/${l.id}`}><strong>{l.name}</strong></Link>
                      {l.serviceCategory && (
                        <div style={{ fontSize: '0.75rem', marginTop: '0.15rem' }}>
                          <span className="portfolio-tag">{l.serviceCategory}</span>
                        </div>
                      )}
                      {l.address && <div className="muted" style={{ fontSize: '0.85rem' }}>{l.address}</div>}
                    </td>
                    <td>
                      {l.email && <div>{l.email}</div>}
                      {l.phone && <div className="muted">{l.phone}</div>}
                    </td>
                    <td className="muted" style={{ maxWidth: 280 }}>
                      {l.scope ? l.scope.slice(0, 80) + (l.scope.length > 80 ? '…' : '') : '—'}
                    </td>
                    <td>{l.owner?.name ?? <span className="muted">unassigned</span>}</td>
                    <td>
                      <select
                        value={l.status}
                        onChange={(e) => quickStatus(l.id, e.target.value as LeadStatus)}
                        style={{ marginBottom: 0 }}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{humanize(s)}</option>
                        ))}
                      </select>
                      <div className="muted" style={{ marginTop: 4 }}>
                        <span className={`badge ${STATUS_BADGE[l.status]}`}>{humanize(l.status)}</span>
                      </div>
                    </td>
                    <td>{l.estimatedValueCents ? formatCents(l.estimatedValueCents) : <span className="muted">—</span>}</td>
                    <td>{formatDate(l.updatedAt)}</td>
                    <td>
                      <Link to={`/portal/leads/${l.id}`} className="button button-ghost button-small">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination">
              <span className="muted">
                {data.leads.length === 0
                  ? '0 of 0'
                  : `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + data.leads.length} of ${data.total}`}
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
          <p className="muted">No leads yet.</p>
        )}
      </section>
    </div>
  );
}
