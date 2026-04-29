import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface Pl {
  from: string;
  to: string;
  revenue: {
    totalCents: number;
    invoicePaymentsCents: number;
    bankInflowsCents: number;
    byProject: Array<{ projectId: string; name: string; cents: number }>;
  };
  expense: {
    totalCents: number;
    fromExpensesCents: number;
    fromBankCents: number;
    byCategory: Array<{ categoryId: string; name: string; cents: number }>;
  };
  netIncomeCents: number;
}

interface Bs {
  asOf: string;
  assets: {
    totalCents: number;
    cashAccounts: Array<{ id: string; name: string; cents: number }>;
    otherAssets: Array<{ id: string; name: string; category: string | null; cents: number }>;
  };
  liabilities: {
    totalCents: number;
    bankAccounts: Array<{ id: string; name: string; cents: number }>;
    otherLiabilities: Array<{ id: string; name: string; category: string | null; cents: number }>;
  };
  equityCents: number;
}

function ytdDefault(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default function ReportsPage() {
  const [tab, setTab] = useState<'pl' | 'bs'>('pl');
  const [{ from, to }, setRange] = useState(ytdDefault());
  const [pl, setPl] = useState<Pl | null>(null);
  const [bs, setBs] = useState<Bs | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPl() {
    setError(null);
    try {
      const params = new URLSearchParams({
        from: new Date(from).toISOString(),
        to: new Date(`${to}T23:59:59.999Z`).toISOString(),
      });
      const r = await api<Pl>(`/api/finance/pl?${params.toString()}`);
      setPl(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'P&L failed');
    }
  }
  async function loadBs() {
    setError(null);
    try {
      const r = await api<Bs>('/api/finance/balance-sheet');
      setBs(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Balance sheet failed');
    }
  }
  useEffect(() => { if (tab === 'pl') loadPl(); else loadBs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, from, to]);

  // Auth-required CSV download via fetch+blob.
  async function downloadCsv(path: string, filename: string) {
    const apiBase = import.meta.env.VITE_API_URL ?? '';
    const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
    const res = await fetch(`${apiBase}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError('Download failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function setPreset(preset: 'ytd' | 'lastMonth' | 'lastYear') {
    const now = new Date();
    if (preset === 'ytd') {
      setRange(ytdDefault());
    } else if (preset === 'lastMonth') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      setRange({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
    } else {
      const y = now.getUTCFullYear() - 1;
      setRange({ from: `${y}-01-01`, to: `${y}-12-31` });
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            Year-end P&amp;L and balance sheet — both downloadable as CSV for filing or your CPA.
            {' '}<Link to="/portal/finance">← back to finance</Link>
          </p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className={tab === 'pl' ? '' : 'button-ghost'}
          onClick={() => setTab('pl')}
        >
          Profit &amp; Loss
        </button>
        <button
          type="button"
          className={tab === 'bs' ? '' : 'button-ghost'}
          onClick={() => setTab('bs')}
        >
          Balance Sheet
        </button>
      </div>

      {tab === 'pl' && (
        <>
          <section className="card">
            <div className="form-row" style={{ alignItems: 'flex-end' }}>
              <div>
                <label>From</label>
                <input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              </div>
              <div>
                <label>To</label>
                <input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button type="button" className="button-ghost button-small" onClick={() => setPreset('ytd')}>YTD</button>
                <button type="button" className="button-ghost button-small" onClick={() => setPreset('lastMonth')}>Last month</button>
                <button type="button" className="button-ghost button-small" onClick={() => setPreset('lastYear')}>Last year</button>
              </div>
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams({
                    from: new Date(from).toISOString(),
                    to: new Date(`${to}T23:59:59.999Z`).toISOString(),
                  });
                  downloadCsv(`/api/finance/pl.csv?${params.toString()}`, `pl-${from}-${to}.csv`);
                }}
              >
                Download CSV
              </button>
            </div>
          </section>

          {pl && (
            <>
              <section className="card">
                <div className="invoice-stats">
                  <div>
                    <div className="stat-label">Revenue</div>
                    <div className="stat-value">{formatCents(pl.revenue.totalCents)}</div>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {formatCents(pl.revenue.invoicePaymentsCents)} from invoices
                      {pl.revenue.bankInflowsCents > 0 && <> + {formatCents(pl.revenue.bankInflowsCents)} other</>}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Expense</div>
                    <div className="stat-value">{formatCents(pl.expense.totalCents)}</div>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {formatCents(pl.expense.fromExpensesCents)} expenses
                      {pl.expense.fromBankCents > 0 && <> + {formatCents(pl.expense.fromBankCents)} bank</>}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Net income</div>
                    <div
                      className="stat-value"
                      style={{ color: pl.netIncomeCents < 0 ? 'var(--accent)' : undefined }}
                    >
                      {formatCents(pl.netIncomeCents)}
                    </div>
                  </div>
                </div>
              </section>

              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <section className="card" style={{ flex: 1 }}>
                  <h3>Revenue by project</h3>
                  {pl.revenue.byProject.length ? (
                    <table className="table">
                      <thead><tr><th>Project</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                      <tbody>
                        {pl.revenue.byProject.map((r) => (
                          <tr key={r.projectId}>
                            <td>{r.name}</td>
                            <td style={{ textAlign: 'right' }}>{formatCents(r.cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="muted">No revenue in this period.</p>}
                </section>
                <section className="card" style={{ flex: 1 }}>
                  <h3>Expense by category</h3>
                  {pl.expense.byCategory.length ? (
                    <table className="table">
                      <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                      <tbody>
                        {pl.expense.byCategory.map((c) => (
                          <tr key={c.categoryId}>
                            <td>{c.name}</td>
                            <td style={{ textAlign: 'right' }}>{formatCents(c.cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="muted">No expenses in this period.</p>}
                </section>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'bs' && (
        <>
          <section className="card">
            <div className="row-between">
              <p className="muted">
                Balances as of today. Click any value on the Banking or Assets pages to update it.
              </p>
              <button
                type="button"
                onClick={() => downloadCsv('/api/finance/balance-sheet.csv', `balance-sheet-${new Date().toISOString().slice(0, 10)}.csv`)}
              >
                Download CSV
              </button>
            </div>
          </section>

          {bs && (
            <>
              <section className="card">
                <div className="invoice-stats">
                  <div>
                    <div className="stat-label">Total assets</div>
                    <div className="stat-value">{formatCents(bs.assets.totalCents)}</div>
                  </div>
                  <div>
                    <div className="stat-label">Total liabilities</div>
                    <div className="stat-value" style={{ color: 'var(--accent)' }}>
                      {formatCents(bs.liabilities.totalCents)}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Equity</div>
                    <div
                      className="stat-value"
                      style={{ color: bs.equityCents < 0 ? 'var(--accent)' : undefined }}
                    >
                      {formatCents(bs.equityCents)}
                    </div>
                  </div>
                </div>
              </section>

              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <section className="card" style={{ flex: 1 }}>
                  <h3>Assets</h3>
                  <table className="table">
                    <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                    <tbody>
                      {bs.assets.cashAccounts.map((a) => (
                        <tr key={a.id}>
                          <td>{a.name} <span className="muted">(bank)</span></td>
                          <td style={{ textAlign: 'right' }}>{formatCents(a.cents)}</td>
                        </tr>
                      ))}
                      {bs.assets.otherAssets.map((a) => (
                        <tr key={a.id}>
                          <td>{a.name}{a.category && <span className="muted"> ({a.category})</span>}</td>
                          <td style={{ textAlign: 'right' }}>{formatCents(a.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{formatCents(bs.assets.totalCents)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </section>
                <section className="card" style={{ flex: 1 }}>
                  <h3>Liabilities</h3>
                  <table className="table">
                    <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                    <tbody>
                      {bs.liabilities.bankAccounts.map((a) => (
                        <tr key={a.id}>
                          <td>{a.name} <span className="muted">(card / loan)</span></td>
                          <td style={{ textAlign: 'right' }}>{formatCents(a.cents)}</td>
                        </tr>
                      ))}
                      {bs.liabilities.otherLiabilities.map((l) => (
                        <tr key={l.id}>
                          <td>{l.name}{l.category && <span className="muted"> ({l.category})</span>}</td>
                          <td style={{ textAlign: 'right' }}>{formatCents(l.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{formatCents(bs.liabilities.totalCents)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
