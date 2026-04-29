import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

export type DrawStatus = 'PENDING' | 'READY' | 'INVOICED' | 'PAID' | 'VOID';

export interface Draw {
  id: string;
  contractId: string;
  projectId: string | null;
  order: number;
  name: string;
  description: string | null;
  amountCents: number;
  percentBasis: number | null;
  status: DrawStatus;
  invoiceId: string | null;
  invoice: { id: string; number: string; status: string } | null;
  createdAt: string;
}

const STATUS_BADGE: Record<DrawStatus, string> = {
  PENDING: 'badge-draft',
  READY: 'badge-sent',
  INVOICED: 'badge-sent',
  PAID: 'badge-paid',
  VOID: 'badge-void',
};

interface Props {
  /** Either a contract ID (sales/admin builds the schedule) or a project ID
   *  (PM generates invoices). The component decides which API to hit and
   *  which actions to surface. */
  scope: { kind: 'contract'; contractId: string } | { kind: 'project'; projectId: string };
  /** When false, hide all editing controls — used for the customer view. */
  canManage: boolean;
  /** Show the "Generate invoice" action (requires the draw to have a project). */
  canInvoice: boolean;
  /** Optional contract total surfaced to the user when entering percent-based draws. */
  contractTotalCents?: number;
}

export default function DrawSchedule({ scope, canManage, canInvoice, contractTotalCents }: Props) {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // New-draw form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const path =
        scope.kind === 'contract'
          ? `/api/draws/contract/${scope.contractId}`
          : `/api/draws/project/${scope.projectId}`;
      const { draws } = await api<{ draws: Draw[] }>(path);
      setDraws(draws);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load draw schedule');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind === 'contract' ? scope.contractId : scope.projectId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (scope.kind !== 'contract') return; // only adding from contract scope
    setError(null);
    setSubmitting(true);
    try {
      let amountCents: number | null = null;
      let percentBasis: number | null = null;
      if (amount) {
        const dollars = Number(amount);
        if (!Number.isFinite(dollars) || dollars <= 0) throw new Error('Amount must be > 0');
        amountCents = Math.round(dollars * 100);
      } else if (percent && contractTotalCents) {
        const pct = Number(percent);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          throw new Error('Percent must be between 0 and 100');
        }
        amountCents = Math.round((contractTotalCents * pct) / 100);
        percentBasis = pct;
      } else {
        throw new Error('Enter either an amount in $ or a percentage of contract total');
      }
      await api(`/api/draws/contract/${scope.contractId}`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || undefined,
          amountCents,
          percentBasis: percentBasis ?? undefined,
        }),
      });
      setName('');
      setDescription('');
      setAmount('');
      setPercent('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Add failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(d: Draw) {
    if (!confirm(`Delete draw "${d.name}"?`)) return;
    setError(null);
    try {
      await api(`/api/draws/${d.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function generateInvoice(d: Draw) {
    if (!confirm(`Generate a draft invoice for ${d.name} — ${formatCents(d.amountCents)}?`)) return;
    setError(null);
    try {
      await api(`/api/draws/${d.id}/generate-invoice`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generate failed');
    }
  }

  async function setStatus(d: Draw, next: DrawStatus) {
    setError(null);
    try {
      await api(`/api/draws/${d.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  const total = draws.reduce((s, d) => s + d.amountCents, 0);

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2 style={{ margin: 0 }}>Draw schedule</h2>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            {scope.kind === 'contract'
              ? 'Progress-billing milestones. Each draw can be invoiced from the project once that milestone is reached.'
              : 'Milestones from the contract. Generate an invoice on each as the work hits that point.'}
          </p>
        </div>
        {canManage && scope.kind === 'contract' && (
          <button
            type="button"
            className={showForm ? 'button button-ghost' : 'button'}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add draw'}
          </button>
        )}
      </div>

      {error && <div className="form-error" style={{ marginTop: '0.75rem' }}>{error}</div>}

      {canManage && scope.kind === 'contract' && showForm && (
        <form onSubmit={add} style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <label htmlFor="d-name">Milestone</label>
          <input
            id="d-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Foundation poured"
          />
          <label htmlFor="d-desc">Description (optional)</label>
          <input
            id="d-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detail to surface to the customer"
          />
          <div className="form-row">
            <div>
              <label htmlFor="d-amount">Amount ($)</label>
              <input
                id="d-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (e.target.value) setPercent('');
                }}
                placeholder="leave blank to use percent"
              />
            </div>
            {contractTotalCents != null && contractTotalCents > 0 && (
              <div>
                <label htmlFor="d-percent">…or percent of total</label>
                <input
                  id="d-percent"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={percent}
                  onChange={(e) => {
                    setPercent(e.target.value);
                    if (e.target.value) setAmount('');
                  }}
                  placeholder="e.g. 25"
                />
                <p className="muted" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
                  Contract total: {formatCents(contractTotalCents)}
                </p>
              </div>
            )}
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add to schedule'}
          </button>
        </form>
      )}

      {draws.length === 0 ? (
        <p className="muted" style={{ marginTop: '0.75rem' }}>No draws scheduled yet.</p>
      ) : (
        <table className="table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th style={{ width: '2rem' }}>#</th>
              <th>Milestone</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
              <th>Invoice</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {draws.map((d, i) => (
              <tr key={d.id}>
                <td>{i + 1}</td>
                <td>
                  <strong>{d.name}</strong>
                  {d.description && (
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {d.description}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatCents(d.amountCents)}
                  {d.percentBasis != null && (
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      ({d.percentBasis}%)
                    </div>
                  )}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[d.status]}`}>{d.status.toLowerCase()}</span>
                </td>
                <td>
                  {d.invoice ? (
                    <Link to={`/portal/invoices`} title={`Invoice ${d.invoice.number}`}>
                      {d.invoice.number}
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {canManage && (
                  <td style={{ textAlign: 'right' }}>
                    {!d.invoiceId && d.status === 'PENDING' && scope.kind === 'project' && (
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => setStatus(d, 'READY')}
                        title="Mark this milestone as reached and ready to invoice"
                      >
                        Mark ready
                      </button>
                    )}
                    {!d.invoiceId && (d.status === 'READY' || d.status === 'PENDING') && canInvoice && (
                      <button
                        type="button"
                        className="button-small"
                        onClick={() => generateInvoice(d)}
                        style={{ marginLeft: '0.4rem' }}
                      >
                        Generate invoice
                      </button>
                    )}
                    {!d.invoiceId && scope.kind === 'contract' && (
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => remove(d)}
                        style={{ marginLeft: '0.4rem' }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCents(total)}</td>
              <td colSpan={canManage ? 3 : 2} />
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
