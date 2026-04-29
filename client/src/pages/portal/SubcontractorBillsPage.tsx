import { Fragment, type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

interface Attachment {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
}

type Status = 'PENDING' | 'APPROVED' | 'PAID' | 'VOID';
type Method = 'CASH' | 'CHECK' | 'ZELLE' | 'ACH' | 'WIRE' | 'CARD' | 'STRIPE' | 'QUICKBOOKS' | 'OTHER';

interface Bill {
  id: string;
  number: string;
  externalNumber: string | null;
  amountCents: number;
  status: Status;
  receivedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  paidMethod: Method | null;
  paidReference: string | null;
  notes: string | null;
  subcontractor: { id: string; name: string; email: string };
  project: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
  expense: { id: string } | null;
  attachments: Attachment[];
}

interface SubOption { id: string; name: string; email: string }
interface ProjectOption { id: string; name: string }

const STATUS_BADGE: Record<Status, string> = {
  PENDING: 'badge-draft',
  APPROVED: 'badge-sent',
  PAID: 'badge-paid',
  VOID: 'badge-void',
};

const METHOD_LABEL: Record<Method, string> = {
  CASH: 'Cash', CHECK: 'Check', ZELLE: 'Zelle', ACH: 'ACH', WIRE: 'Wire',
  CARD: 'Card', STRIPE: 'Stripe', QUICKBOOKS: 'QuickBooks', OTHER: 'Other',
};

export default function SubcontractorBillsPage() {
  const { user } = useAuth();
  const isSub = user?.role === 'SUBCONTRACTOR';
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  const [bills, setBills] = useState<Bill[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // New-bill form
  const [subcontractorId, setSubcontractorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [externalNumber, setExternalNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pay drawer state
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<Method>('CHECK');
  const [payReference, setPayReference] = useState('');

  // Attachments expand
  const [openAttach, setOpenAttach] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);

  // Time-entry pay request bundles (admin/accounting only). One row per
  // worker per week from the /pay-requests endpoint.
  interface PayRequestEntry {
    id: string;
    startedAt: string;
    endedAt: string | null;
    minutes: number;
    dayUnits: number | null;
    notes: string | null;
    amountCents: number;
    project: { id: string; name: string } | null;
    status: 'pending' | 'approved' | 'rejected';
    rejectedReason: string | null;
    rejectedAt: string | null;
    approvedAt: string | null;
  }
  interface PayRequestBundle {
    key: string;
    userId: string;
    userName: string;
    role: 'EMPLOYEE' | 'SUBCONTRACTOR' | 'ADMIN' | 'CUSTOMER';
    billingMode: 'HOURLY' | 'DAILY';
    weekStart: string;
    weekEnd: string;
    totalMinutes: number;
    totalDayUnits: number;
    totalCents: number;
    entryCount: number;
    projects: Array<{ id: string; name: string; cents: number }>;
    entries: PayRequestEntry[];
    status: 'pending' | 'approved';
  }
  const [payRequests, setPayRequests] = useState<PayRequestBundle[]>([]);
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const [b, s, p, pr] = await Promise.all([
        api<{ bills: Bill[] }>('/api/subcontractor-bills'),
        isAccounting
          ? api<{ users: SubOption[] }>('/api/admin/users?role=SUBCONTRACTOR').catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] }),
        api<{ projects: ProjectOption[] }>('/api/projects').catch(() => ({ projects: [] })),
        isAccounting
          ? api<{ bundles: PayRequestBundle[] }>('/api/subcontractor-bills/pay-requests')
              .catch(() => ({ bundles: [] as PayRequestBundle[] }))
          : Promise.resolve({ bundles: [] as PayRequestBundle[] }),
      ]);
      setBills(b.bills);
      setSubs(s.users);
      setProjects(p.projects);
      setPayRequests(pr.bundles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAccounting]);

  // Group pay-request bundles by week for the table render.
  function formatHours(minutes: number): string {
    if (minutes <= 0) return '0h';
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  function formatDays(units: number): string {
    if (units <= 0) return '0';
    return `${units % 1 === 0 ? units.toFixed(0) : units.toFixed(2)} day${units === 1 ? '' : 's'}`;
  }
  const payRequestWeeks = (() => {
    const byWeek = new Map<string, { weekStart: string; weekEnd: string; rows: PayRequestBundle[]; total: number }>();
    for (const b of payRequests) {
      const k = b.weekStart;
      const w = byWeek.get(k) ?? {
        weekStart: b.weekStart,
        weekEnd: b.weekEnd,
        rows: [] as PayRequestBundle[],
        total: 0,
      };
      w.rows.push(b);
      w.total += b.totalCents;
      byWeek.set(k, w);
    }
    return [...byWeek.values()];
  })();

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        amountCents: cents,
        externalNumber: externalNumber || null,
        notes: notes || null,
        projectId: projectId || null,
      };
      if (isAccounting && subcontractorId) body.subcontractorId = subcontractorId;
      await api('/api/subcontractor-bills', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAmount('');
      setExternalNumber('');
      setNotes('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function approve(id: string) {
    try {
      await api(`/api/subcontractor-bills/${id}/approve`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    }
  }

  async function pay(id: string) {
    try {
      await api(`/api/subcontractor-bills/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          paidMethod: payMethod,
          paidReference: payReference || null,
        }),
      });
      setPayingId(null);
      setPayReference('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pay failed');
    }
  }

  async function uploadAttachments(billId: string, files: FileList) {
    setAttaching(true);
    setError(null);
    try {
      const apiBase = import.meta.env.VITE_API_URL ?? '';
      const token = localStorage.getItem('nt_token');
      const form = new FormData();
      for (const f of Array.from(files)) form.append('files', f);
      const res = await fetch(`${apiBase}/api/subcontractor-bills/${billId}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Upload failed');
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setAttaching(false);
    }
  }

  async function deleteAttachment(billId: string, attachmentId: string) {
    if (!confirm('Remove this attachment?')) return;
    try {
      await api(`/api/subcontractor-bills/${billId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function voidBill(id: string) {
    if (!confirm('Void this bill?')) return;
    try {
      await api(`/api/subcontractor-bills/${id}/void`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Void failed');
    }
  }

  // ----- Pay request bundle actions -----

  function toggleBundle(key: string) {
    setExpandedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function rejectEntry(entryId: string) {
    const reason = prompt('Reason for rejecting this day (optional):') ?? '';
    try {
      await api(`/api/time/${entryId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || undefined }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reject failed');
    }
  }

  async function unrejectEntry(entryId: string) {
    try {
      await api(`/api/time/${entryId}/unreject`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Restore failed');
    }
  }

  async function approveBundle(b: PayRequestBundle) {
    if (!confirm(`Approve ${b.userName}'s week of ${new Date(b.weekStart).toLocaleDateString()}? Stamps every non-rejected entry as approved.`)) return;
    try {
      await api('/api/subcontractor-bills/pay-requests/approve-bundle', {
        method: 'POST',
        body: JSON.stringify({ userId: b.userId, weekStart: b.weekStart }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    }
  }

  async function unapproveBundle(b: PayRequestBundle) {
    if (!confirm(`Un-approve ${b.userName}'s week? Lets you reject individual days again.`)) return;
    try {
      await api('/api/subcontractor-bills/pay-requests/unapprove-bundle', {
        method: 'POST',
        body: JSON.stringify({ userId: b.userId, weekStart: b.weekStart }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Un-approve failed');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Subcontractor bills</h1>
          <p className="muted">
            {isSub
              ? 'Bills you have submitted to us, and their status.'
              : 'Bills the company owes to subs. Marking PAID writes a Cost-of-Goods-Sold expense to the project.'}
            {' '}<Link to="/portal/finance">Finance overview →</Link>
          </p>
        </div>
        {(isSub || isAccounting) && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New bill'}
          </button>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}

      {showForm && (
        <section className="card">
          <form onSubmit={create}>
            {isAccounting && (
              <>
                <label htmlFor="sb-sub">Subcontractor</label>
                <select
                  id="sb-sub"
                  value={subcontractorId}
                  onChange={(e) => setSubcontractorId(e.target.value)}
                  required
                >
                  <option value="">— pick a sub —</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {s.email}</option>
                  ))}
                </select>
              </>
            )}
            <div className="form-row">
              <div>
                <label htmlFor="sb-proj">Project (optional)</label>
                <select id="sb-proj" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">— overhead / unassigned —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sb-amt">Amount (USD)</label>
                <input
                  id="sb-amt"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="sb-ext">Your invoice #</label>
                <input
                  id="sb-ext"
                  value={externalNumber}
                  onChange={(e) => setExternalNumber(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>
            <label htmlFor="sb-notes">Notes</label>
            <input
              id="sb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Scope, dates worked, etc."
            />
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Submit bill'}
            </button>
          </form>
        </section>
      )}

      {isAccounting && payRequests.length > 0 && (
        <section className="card">
          <div className="row-between">
            <div>
              <h2 style={{ margin: 0 }}>Pay requests (last 8 weeks)</h2>
              <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Bundled from time entries — one row per worker per week. Expand to
                review each day; reject any individual entry before approving the bundle.
              </p>
            </div>
          </div>

          {payRequestWeeks.map((week) => (
            <div key={week.weekStart} style={{ marginTop: '1rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: '0.25rem',
                  fontSize: '0.95rem',
                }}
              >
                <strong>
                  Week of {new Date(week.weekStart).toLocaleDateString()} —{' '}
                  {new Date(week.weekEnd).toLocaleDateString()}
                </strong>
                <span className="muted">
                  Week total: <strong>{formatCents(week.total)}</strong>
                </span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>Worker</th>
                    <th>Mode</th>
                    <th style={{ textAlign: 'right' }}>Time</th>
                    <th>Projects</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {week.rows.map((b) => {
                    const expanded = expandedBundles.has(b.key);
                    const rejectedCount = b.entries.filter((e) => e.status === 'rejected').length;
                    return (
                      <Fragment key={b.key}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="button-ghost button-small"
                              onClick={() => toggleBundle(b.key)}
                              aria-label={expanded ? 'Collapse' : 'Expand'}
                              style={{ padding: '2px 6px' }}
                            >
                              {expanded ? '▾' : '▸'}
                            </button>
                          </td>
                          <td>
                            <strong>{b.userName}</strong>
                            <div className="muted" style={{ fontSize: '0.75rem' }}>
                              {b.role.toLowerCase()}
                            </div>
                          </td>
                          <td>{b.billingMode === 'DAILY' ? 'Daily' : 'Hourly'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {b.billingMode === 'DAILY'
                              ? formatDays(b.totalDayUnits)
                              : formatHours(b.totalMinutes)}
                            <div className="muted" style={{ fontSize: '0.75rem' }}>
                              {b.entryCount} {b.entryCount === 1 ? 'entry' : 'entries'}
                              {rejectedCount > 0 && ` · ${rejectedCount} rejected`}
                            </div>
                          </td>
                          <td className="muted" style={{ fontSize: '0.85rem' }}>
                            {b.projects.length === 0
                              ? '(general / overhead)'
                              : b.projects.map((p) => p.name).join(', ')}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatCents(b.totalCents)}
                          </td>
                          <td>
                            <span
                              className={`badge ${b.status === 'approved' ? 'badge-paid' : 'badge-draft'}`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {b.status === 'pending' ? (
                              <button
                                type="button"
                                className="button-small"
                                onClick={() => approveBundle(b)}
                              >
                                Approve
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="button-ghost button-small"
                                onClick={() => unapproveBundle(b)}
                              >
                                Un-approve
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={8} style={{ background: 'var(--surface)' }}>
                              <table className="table" style={{ margin: '0.5rem 0' }}>
                                <thead>
                                  <tr>
                                    <th>Date</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                    <th>Project</th>
                                    <th>Notes</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.entries.map((e) => {
                                    const dateStr = new Date(e.startedAt).toLocaleDateString(
                                      undefined,
                                      { weekday: 'short', month: 'short', day: 'numeric' },
                                    );
                                    const amount = e.dayUnits != null
                                      ? formatDays(e.dayUnits)
                                      : formatHours(e.minutes);
                                    return (
                                      <tr
                                        key={e.id}
                                        style={
                                          e.status === 'rejected'
                                            ? { textDecoration: 'line-through', opacity: 0.55 }
                                            : undefined
                                        }
                                      >
                                        <td>{dateStr}</td>
                                        <td style={{ textAlign: 'right' }}>
                                          {amount}
                                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                                            {formatCents(e.amountCents)}
                                          </div>
                                        </td>
                                        <td className="muted" style={{ fontSize: '0.85rem' }}>
                                          {e.project ? e.project.name : '(general)'}
                                        </td>
                                        <td className="muted" style={{ fontSize: '0.85rem' }}>
                                          {e.notes ?? '—'}
                                          {e.rejectedReason && (
                                            <div style={{ color: 'var(--error)' }}>
                                              Rejected: {e.rejectedReason}
                                            </div>
                                          )}
                                        </td>
                                        <td>
                                          <span
                                            className={`badge ${
                                              e.status === 'approved'
                                                ? 'badge-paid'
                                                : e.status === 'rejected'
                                                  ? 'badge-overdue'
                                                  : 'badge-draft'
                                            }`}
                                          >
                                            {e.status}
                                          </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                          {b.status === 'pending' && e.status !== 'rejected' && (
                                            <button
                                              type="button"
                                              className="button-ghost button-small"
                                              onClick={() => rejectEntry(e.id)}
                                              style={{ textDecoration: 'none' }}
                                            >
                                              Reject
                                            </button>
                                          )}
                                          {b.status === 'pending' && e.status === 'rejected' && (
                                            <button
                                              type="button"
                                              className="button-ghost button-small"
                                              onClick={() => unrejectEntry(e.id)}
                                              style={{ textDecoration: 'none' }}
                                            >
                                              Restore
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        {bills.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                {!isSub && <th>Sub</th>}
                <th>Project</th>
                <th>Their #</th>
                <th>Received</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Paid</th>
                {isAccounting && <th></th>}
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <Fragment key={b.id}>
                <tr>
                  <td>
                    <strong>{b.number}</strong>
                    {b.attachments.length > 0 && (
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => setOpenAttach(openAttach === b.id ? null : b.id)}
                        title="Show attached files"
                      >
                        📎 {b.attachments.length}
                      </button>
                    )}
                    {b.attachments.length === 0 && (isSub || isAccounting) && (
                      <button
                        type="button"
                        className="button-ghost button-small"
                        style={{ marginLeft: '0.4rem' }}
                        onClick={() => setOpenAttach(openAttach === b.id ? null : b.id)}
                      >
                        Attach
                      </button>
                    )}
                  </td>
                  {!isSub && <td>{b.subcontractor.name}</td>}
                  <td>{b.project ? b.project.name : <span className="muted">overhead</span>}</td>
                  <td>{b.externalNumber ?? <span className="muted">—</span>}</td>
                  <td>{formatDate(b.receivedAt)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(b.amountCents)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[b.status]}`}>{b.status.toLowerCase()}</span>
                  </td>
                  <td className="muted" style={{ fontSize: '0.85rem' }}>
                    {b.paidAt
                      ? <>{formatDate(b.paidAt)}{b.paidMethod ? ` · ${METHOD_LABEL[b.paidMethod]}` : ''}{b.paidReference ? ` · ${b.paidReference}` : ''}</>
                      : '—'}
                  </td>
                  {isAccounting && (
                    <td>
                      {b.status === 'PENDING' && (
                        <>
                          <button type="button" className="button-small" onClick={() => approve(b.id)}>
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button-ghost button-small"
                            style={{ marginLeft: '0.4rem' }}
                            onClick={() => voidBill(b.id)}
                          >
                            Void
                          </button>
                        </>
                      )}
                      {b.status === 'APPROVED' && (
                        payingId === b.id ? (
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select
                              value={payMethod}
                              onChange={(e) => setPayMethod(e.target.value as Method)}
                            >
                              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                              ))}
                            </select>
                            <input
                              value={payReference}
                              onChange={(e) => setPayReference(e.target.value)}
                              placeholder="Reference"
                              style={{ width: 140 }}
                            />
                            <button type="button" className="button-small" onClick={() => pay(b.id)}>
                              Confirm pay
                            </button>
                            <button
                              type="button"
                              className="button-ghost button-small"
                              onClick={() => { setPayingId(null); setPayReference(''); }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button type="button" className="button-small" onClick={() => setPayingId(b.id)}>
                              Mark paid
                            </button>
                            <button
                              type="button"
                              className="button-ghost button-small"
                              style={{ marginLeft: '0.4rem' }}
                              onClick={() => voidBill(b.id)}
                            >
                              Void
                            </button>
                          </>
                        )
                      )}
                      {b.status === 'PAID' && b.expense && (
                        <Link to={`/portal/finance/expenses/${b.expense.id}`} className="button-ghost button-small">
                          View expense
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
                {openAttach === b.id && (
                  <tr>
                    <td colSpan={isSub ? 8 : 9} style={{ background: 'var(--surface)' }}>
                      <div style={{ padding: '0.5rem 0' }}>
                        <h4 style={{ margin: '0 0 0.5rem' }}>Attachments</h4>
                        {b.attachments.length === 0 && (
                          <p className="muted" style={{ marginBottom: '0.5rem' }}>
                            No files yet — upload your invoice (PDF) or photos of the work.
                          </p>
                        )}
                        {b.attachments.length > 0 && (
                          <div className="gallery" style={{ marginBottom: '0.75rem' }}>
                            {b.attachments.map((att) => (
                              <figure key={att.id} className="gallery-item">
                                <a href={att.url} target="_blank" rel="noreferrer">
                                  {att.thumbnailUrl ? (
                                    <img src={att.thumbnailUrl} alt={att.filename} loading="lazy" />
                                  ) : (
                                    <div
                                      style={{
                                        width: '100%',
                                        height: 120,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid rgba(95,99,104,0.3)',
                                        borderRadius: 6,
                                      }}
                                    >
                                      <span className="muted">📄 {att.contentType.split('/')[1] || 'file'}</span>
                                    </div>
                                  )}
                                </a>
                                <figcaption>
                                  <div style={{ wordBreak: 'break-all' }}>{att.filename}</div>
                                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                                    {(att.sizeBytes / 1024).toFixed(0)} KB · {att.uploadedBy?.name ?? 'unknown'}
                                  </div>
                                  {(isAccounting || (isSub && b.status === 'PENDING' && att.uploadedBy?.id === user?.id)) && (
                                    <button
                                      type="button"
                                      className="button-ghost button-small"
                                      onClick={() => deleteAttachment(b.id, att.id)}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </figcaption>
                              </figure>
                            ))}
                          </div>
                        )}
                        {((isSub && b.status === 'PENDING') || isAccounting) && (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              ref={openAttach === b.id ? fileInputRef : null}
                              type="file"
                              multiple
                              accept="image/*,.pdf,application/pdf"
                              onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                  uploadAttachments(b.id, e.target.files);
                                }
                              }}
                              disabled={attaching}
                            />
                            {attaching && <span className="muted">uploading…</span>}
                            <span className="muted" style={{ fontSize: '0.85rem' }}>
                              PDF + image, up to 25 MB each.
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No bills{isSub ? ' submitted yet' : ''}.</p>
        )}
      </section>
    </div>
  );
}
