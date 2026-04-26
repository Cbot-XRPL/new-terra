import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

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

  async function load() {
    try {
      const [b, s, p] = await Promise.all([
        api<{ bills: Bill[] }>('/api/subcontractor-bills'),
        isAccounting
          ? api<{ users: SubOption[] }>('/api/admin/users?role=SUBCONTRACTOR').catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] }),
        api<{ projects: ProjectOption[] }>('/api/projects').catch(() => ({ projects: [] })),
      ]);
      setBills(b.bills);
      setSubs(s.users);
      setProjects(p.projects);
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

  async function voidBill(id: string) {
    if (!confirm('Void this bill?')) return;
    try {
      await api(`/api/subcontractor-bills/${id}/void`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Void failed');
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
                <tr key={b.id}>
                  <td>{b.number}</td>
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
