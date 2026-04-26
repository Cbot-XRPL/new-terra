import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface Row {
  projectId: string;
  name: string;
  customer: string;
  status: string;
  invoicedCents: number;
  collectedCents: number;
  expenseCents: number;
  laborCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
}

interface Resp {
  rows: Row[];
  totals: {
    invoicedCents: number;
    collectedCents: number;
    costCents: number;
    marginCents: number;
    marginPct: number | null;
    projectCount: number;
  };
}

function pctColor(pct: number | null): string | undefined {
  if (pct == null) return undefined;
  if (pct < 0) return 'var(--danger, #d93025)';
  if (pct < 10) return 'var(--accent)';
  return undefined;
}

export default function ProfitabilityPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Resp>('/api/finance/profitability')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  if (error) return <div className="dashboard"><div className="form-error">{error}</div></div>;
  if (!data) return <div className="dashboard"><p className="muted">Loading…</p></div>;

  return (
    <div className="dashboard">
      <header>
        <h1>Profitability</h1>
        <p className="muted">
          Cash-basis margin per project: collected revenue minus actuals (expenses + labor cost from time
          entries). Open projects with $0 collected show '—' for margin %.
          {' '}<Link to="/portal/finance">← back to finance</Link>
        </p>
      </header>

      <section className="card">
        <h2>Portfolio totals</h2>
        <div className="invoice-stats">
          <div>
            <div className="stat-label">Invoiced</div>
            <div className="stat-value">{formatCents(data.totals.invoicedCents)}</div>
          </div>
          <div>
            <div className="stat-label">Collected</div>
            <div className="stat-value">{formatCents(data.totals.collectedCents)}</div>
          </div>
          <div>
            <div className="stat-label">Cost</div>
            <div className="stat-value">{formatCents(data.totals.costCents)}</div>
          </div>
          <div>
            <div className="stat-label">Margin</div>
            <div
              className="stat-value"
              style={{ color: pctColor(data.totals.marginPct) }}
            >
              {formatCents(data.totals.marginCents)}
              {data.totals.marginPct != null && (
                <span className="muted" style={{ fontSize: '0.85rem', marginLeft: '0.4rem' }}>
                  ({data.totals.marginPct}%)
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="stat-label">Projects</div>
            <div className="stat-value">{data.totals.projectCount}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Per project</h2>
        {data.rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Customer</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Invoiced</th>
                <th style={{ textAlign: 'right' }}>Collected</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Margin</th>
                <th style={{ textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.projectId}>
                  <td>
                    <Link to={`/portal/projects/${r.projectId}`}><strong>{r.name}</strong></Link>
                  </td>
                  <td>{r.customer}</td>
                  <td><span className="muted">{r.status.toLowerCase()}</span></td>
                  <td style={{ textAlign: 'right' }}>{formatCents(r.invoicedCents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(r.collectedCents)}</td>
                  <td style={{ textAlign: 'right' }} title={`Expenses ${formatCents(r.expenseCents)} + labor ${formatCents(r.laborCents)}`}>
                    {formatCents(r.costCents)}
                  </td>
                  <td style={{ textAlign: 'right', color: pctColor(r.marginPct) }}>
                    {formatCents(r.marginCents)}
                  </td>
                  <td style={{ textAlign: 'right', color: pctColor(r.marginPct) }}>
                    {r.marginPct == null ? <span className="muted">—</span> : `${r.marginPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No projects yet.</p>
        )}
      </section>
    </div>
  );
}
