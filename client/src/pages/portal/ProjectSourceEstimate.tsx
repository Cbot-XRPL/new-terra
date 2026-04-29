import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents, formatDate } from '../../lib/format';

interface EstimateLine {
  id: string;
  description: string;
  quantity: string | number;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
  category: string;
  notes: string | null;
}

interface SourceEstimate {
  id: string;
  number: string;
  title: string;
  status: string;
  totalCents: number;
  acceptedAt: string | null;
  acceptedBySignature: string | null;
  customer: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  lines: EstimateLine[];
}

interface Props {
  projectId: string;
  /** Visible to admin/PM/sales — caller should already gate on this. */
  canSee: boolean;
}

/**
 * Reference card on the project hub showing the originating estimate(s).
 * Renders a compact summary plus a category-grouped breakdown so the PM
 * can see what the sales rep promised and how the budget was set.
 */
export default function ProjectSourceEstimate({ projectId, canSee }: Props) {
  const [estimates, setEstimates] = useState<SourceEstimate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!canSee) return;
    api<{ estimates: SourceEstimate[] }>(`/api/estimates/by-project/${projectId}`)
      .then((r) => setEstimates(r.estimates))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load source estimates'));
  }, [projectId, canSee]);

  if (!canSee || estimates.length === 0) return null;

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2 style={{ margin: 0 }}>Source estimate{estimates.length === 1 ? '' : 's'}</h2>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            What the sales rep priced. Use this as the reference when setting the budget below.
          </p>
        </div>
        <button
          type="button"
          className="button-ghost button-small"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide details' : 'Show line items'}
        </button>
      </div>

      {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}

      {estimates.map((est) => {
        // Group lines by category for the smart breakdown.
        const byCategory = new Map<string, { count: number; cents: number }>();
        for (const l of est.lines) {
          const c = l.category || 'Custom';
          const row = byCategory.get(c) ?? { count: 0, cents: 0 };
          row.count += 1;
          row.cents += l.totalCents;
          byCategory.set(c, row);
        }
        const categoryRows = [...byCategory.entries()].sort((a, b) => b[1].cents - a[1].cents);

        return (
          <div key={est.id} style={{ marginTop: '0.75rem' }}>
            <div className="row-between">
              <div>
                <Link to={`/portal/estimates/${est.id}`}>
                  <strong>
                    {est.number} — {est.title}
                  </strong>
                </Link>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {est.createdBy.name}
                  {est.acceptedAt && ` · accepted ${formatDate(est.acceptedAt)}`}
                  {est.acceptedBySignature && ` by ${est.acceptedBySignature}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{formatCents(est.totalCents)}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>{est.lines.length} lines</div>
              </div>
            </div>

            <table className="table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Lines</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ textAlign: 'right' }}>% of total</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map(([category, row]) => (
                  <tr key={category}>
                    <td><strong>{category}</strong></td>
                    <td style={{ textAlign: 'right' }}>{row.count}</td>
                    <td style={{ textAlign: 'right' }}>{formatCents(row.cents)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {est.totalCents > 0
                        ? `${Math.round((row.cents / est.totalCents) * 100)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {expanded && (
              <table className="table" style={{ marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th>Unit</th>
                    <th style={{ textAlign: 'right' }}>Unit price</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {est.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="muted">{l.category || 'Custom'}</span>
                      </td>
                      <td>{l.description}</td>
                      <td style={{ textAlign: 'right' }}>{l.quantity}</td>
                      <td>{l.unit ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{formatCents(l.unitPriceCents)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCents(l.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}
