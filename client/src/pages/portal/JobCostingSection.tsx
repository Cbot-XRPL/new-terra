import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents } from '../../lib/format';

interface CostLine {
  categoryId: string | null;
  categoryName: string | null;
  budgetCents: number;
  actualCents: number;
  expenseCount: number;
}

interface JobCost {
  projectId: string;
  totalBudgetCents: number;
  linesBudgetCents: number;
  actualCents: number;
  // Optional — only present when at least one closed time entry exists on
  // this project. Used to render a separate "Labor" stat at the top.
  laborCents?: number;
  laborEntryCount?: number;
  varianceCents: number;
  lines: CostLine[];
}

interface CategoryRef {
  id: string;
  name: string;
  parent: { id: string; name: string } | null;
}

interface Props {
  projectId: string;
  // True when the caller can edit the project (admin or assigned PM) OR
  // is accounting. Used to gate the budget editor; reads are open to anyone
  // with project access.
  canEditBudget: boolean;
  // Whether the project is currently set to expose the budget to its
  // customer. Admin sees a checkbox to flip it; everyone else gets a
  // small read-only badge so they can tell at a glance.
  showBudgetToCustomer?: boolean;
  onShowBudgetToCustomerChange?: (next: boolean) => void;
}

function variancePill(varianceCents: number, hasBudget: boolean) {
  if (!hasBudget) {
    return <span className="badge badge-draft">no budget</span>;
  }
  if (varianceCents >= 0) {
    return <span className="badge badge-paid">{formatCents(varianceCents)} under</span>;
  }
  return <span className="badge badge-overdue">{formatCents(-varianceCents)} over</span>;
}

function progressBar(actualCents: number, budgetCents: number) {
  if (budgetCents <= 0) return null;
  const pct = Math.min(200, Math.round((actualCents / budgetCents) * 100));
  const overBudget = actualCents > budgetCents;
  return (
    <div className="job-cost-bar" title={`${pct}% of budget used`}>
      <div
        className={`job-cost-bar-fill ${overBudget ? 'over' : ''}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
      {overBudget && (
        <div className="job-cost-bar-overflow" style={{ width: `${Math.min(100, pct - 100)}%` }} />
      )}
    </div>
  );
}

export default function JobCostingSection({
  projectId,
  canEditBudget,
  showBudgetToCustomer,
  onShowBudgetToCustomerChange,
}: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [data, setData] = useState<JobCost | null>(null);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // Editor state — single line at a time. Categories that already have a
  // line auto-fill when picked.
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The accounting user reads this section even if canEditBudget is false
  // for the project itself. Suppress the editor for them only when they have
  // no project-write access; they still see the rollup.
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  async function load() {
    try {
      const [{ ...d }, cats] = await Promise.all([
        api<JobCost>(`/api/projects/${projectId}/job-cost`),
        canEditBudget || isAccounting
          ? api<{ categories: CategoryRef[] }>('/api/finance/categories').catch(() => ({ categories: [] }))
          : Promise.resolve({ categories: [] }),
      ]);
      setData(d);
      setCategories(cats.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load job costing');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function saveLine(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(editBudget) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a valid budget amount');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/budget-lines`, {
        method: 'POST',
        body: JSON.stringify({
          categoryId: editCategoryId || null,
          budgetCents: cents,
        }),
      });
      setEditCategoryId('');
      setEditBudget('');
      setShowEditor(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLine(line: CostLine) {
    // The server keys lines by id, but we only have category info. Look up
    // via the rollup — if a line has any expense activity we keep the row
    // visible (with budget=0) instead of refetching the bare line list.
    if (line.budgetCents === 0) return;
    if (!confirm(`Remove the ${line.categoryName ?? 'uncategorised'} budget line?`)) return;
    try {
      // We don't expose the line id in the rollup — request the bare list
      // to find the matching id, then DELETE it.
      const lines = await api<{ lines: Array<{ id: string; categoryId: string | null }> }>(
        `/api/projects/${projectId}/budget-lines`,
      ).catch(() => ({ lines: [] }));
      const found = lines.lines.find((l) => l.categoryId === line.categoryId);
      if (!found) {
        // Fallback: refetch and bail; the next save overwrites anyway.
        await load();
        return;
      }
      await api(`/api/projects/${projectId}/budget-lines/${found.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  if (!data) {
    return (
      <section className="card">
        <h2>Job costing</h2>
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  const hasBudget = data.totalBudgetCents > 0;

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2>Job costing</h2>
          <p className="muted" style={{ marginBottom: '0.5rem' }}>
            Budget vs. actual by category. Add expenses with a project tag to populate the
            actuals — see <Link to="/portal/finance/expenses/new">add receipt</Link>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {isAdmin && onShowBudgetToCustomerChange && (
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
              title="When checked, this project's customer can see the budget + this rollup. Default off."
            >
              <input
                type="checkbox"
                checked={!!showBudgetToCustomer}
                onChange={(e) => onShowBudgetToCustomerChange(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Visible to customer
            </label>
          )}
          {!isAdmin && showBudgetToCustomer && (
            <span className="badge badge-sent" title="Budget is visible to the customer for this project">
              shared with customer
            </span>
          )}
          {(canEditBudget || isAccounting) && (
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => setShowEditor((v) => !v)}
            >
              {showEditor ? 'Close editor' : 'Edit budget'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="invoice-stats" style={{ marginBottom: '1rem' }}>
        <div>
          <div className="stat-label">Budget</div>
          <div className="stat-value">{hasBudget ? formatCents(data.totalBudgetCents) : '—'}</div>
        </div>
        <div>
          <div className="stat-label">Actual</div>
          <div className="stat-value">{formatCents(data.actualCents)}</div>
        </div>
        {data.laborCents !== undefined && data.laborCents > 0 && (
          <div>
            <div className="stat-label">of which labor</div>
            <div className="stat-value">{formatCents(data.laborCents)}</div>
          </div>
        )}
        <div>
          <div className="stat-label">Variance</div>
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {variancePill(data.varianceCents, hasBudget)}
          </div>
        </div>
      </div>

      {showEditor && (canEditBudget || isAccounting) && (
        <form onSubmit={saveLine} style={{ marginBottom: '1rem' }}>
          <div className="form-row">
            <div>
              <label htmlFor="bl-cat">Category</label>
              <select
                id="bl-cat"
                value={editCategoryId}
                onChange={(e) => {
                  setEditCategoryId(e.target.value);
                  const existing = data.lines.find((l) => (l.categoryId ?? '') === e.target.value);
                  if (existing) setEditBudget((existing.budgetCents / 100).toFixed(2));
                  else setEditBudget('');
                }}
              >
                <option value="">Uncategorised / general</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? `${c.parent.name} › ` : ''}{c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="bl-amt">Budget (USD)</label>
              <input
                id="bl-amt"
                type="number"
                min="0"
                step="100"
                value={editBudget}
                onChange={(e) => setEditBudget(e.target.value)}
                required
              />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save line'}
          </button>
        </form>
      )}

      {data.lines.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Budget</th>
              <th>Actual</th>
              <th>Variance</th>
              <th>Progress</th>
              <th>#</th>
              {(canEditBudget || isAccounting) && <th></th>}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const variance = l.budgetCents - l.actualCents;
              return (
                <tr key={l.categoryId ?? '__uncat__'}>
                  <td>{l.categoryName ?? <span className="muted">uncategorised</span>}</td>
                  <td>{l.budgetCents > 0 ? formatCents(l.budgetCents) : <span className="muted">—</span>}</td>
                  <td>{formatCents(l.actualCents)}</td>
                  <td>{variancePill(variance, l.budgetCents > 0)}</td>
                  <td style={{ minWidth: 140 }}>{progressBar(l.actualCents, l.budgetCents)}</td>
                  <td>{l.expenseCount}</td>
                  {(canEditBudget || isAccounting) && (
                    <td>
                      {l.budgetCents > 0 && (
                        <button
                          type="button"
                          className="button-ghost button-small"
                          onClick={() => removeLine(l)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">No expenses tagged to this project yet.</p>
      )}
    </section>
  );
}
