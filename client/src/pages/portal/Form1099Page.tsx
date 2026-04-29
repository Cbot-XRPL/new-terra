import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface Sub {
  id: string;
  name: string;
  email: string;
  taxId: string | null;
  mailingAddress: string | null;
  totalCents: number;
  billCount: number;
}

interface Resp {
  year: number;
  subs: Sub[];
}

export default function Form1099Page() {
  const currentYear = new Date().getFullYear();
  // Default to last year — typical 1099 filing window is Jan/Feb of the
  // *next* year, not a mid-year run.
  const [year, setYear] = useState(currentYear - 1);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await api<Resp>(`/api/finance/1099?year=${year}`);
      setData(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  async function downloadCsv() {
    const apiBase = import.meta.env.VITE_API_URL ?? '';
    const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
    const res = await fetch(`${apiBase}/api/finance/1099.csv?year=${year}`, {
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
    a.download = `1099-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="dashboard">
      <header>
        <h1>1099 totals</h1>
        <p className="muted">
          Total paid (via approved &amp; paid sub bills) per subcontractor in the year. The IRS
          requires a 1099-NEC for any sub paid $600 or more — those rows are flagged below.
          {' '}<Link to="/portal/finance">← back to finance</Link>
          {' · '}<Link to="/portal/admin">Edit sub tax info</Link>
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="row-between">
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div>
              <label>Year</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                style={{ width: 100 }}
              />
            </div>
          </div>
          <button type="button" onClick={downloadCsv}>Download CSV</button>
        </div>
      </section>

      {data && (
        <section className="card">
          {data.subs.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Sub</th>
                  <th>Tax ID</th>
                  <th>Mailing address</th>
                  <th style={{ textAlign: 'right' }}>Bills</th>
                  <th style={{ textAlign: 'right' }}>Total paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.subs.map((s) => {
                  const needs1099 = s.totalCents >= 60000;
                  const incomplete = needs1099 && (!s.taxId || !s.mailingAddress);
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>{s.email}</div>
                      </td>
                      <td>
                        {s.taxId ?? <span className="muted">—</span>}
                      </td>
                      <td className="muted" style={{ whiteSpace: 'pre-wrap', maxWidth: 240 }}>
                        {s.mailingAddress ?? '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{s.billCount}</td>
                      <td style={{ textAlign: 'right' }}>{formatCents(s.totalCents)}</td>
                      <td>
                        {incomplete ? (
                          <span className="badge badge-overdue" title="Sub paid >=$600 but tax info missing">missing W-9</span>
                        ) : needs1099 ? (
                          <span className="badge badge-paid">needs 1099</span>
                        ) : (
                          <span className="badge badge-draft">below threshold</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">No paid sub bills in {data.year}.</p>
          )}
        </section>
      )}
    </div>
  );
}
