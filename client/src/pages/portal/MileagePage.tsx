import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

interface Entry {
  id: string;
  date: string;
  milesTenths: number;
  rateCentsPerMile: number;
  totalCents: number;
  purpose: string | null;
  notes: string | null;
  user: { id: string; name: string };
  project: { id: string; name: string } | null;
}

interface ListResp {
  entries: Entry[];
  totals: { miles: number; deductibleCents: number; count: number };
}

interface Project { id: string; name: string }

export default function MileagePage() {
  const { user } = useAuth();
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  const [data, setData] = useState<ListResp | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [miles, setMiles] = useState('');
  const [projectId, setProjectId] = useState('');
  const [purpose, setPurpose] = useState('');

  async function load() {
    try {
      const [e, p] = await Promise.all([
        api<ListResp>('/api/mileage'),
        api<{ projects: Project[] }>('/api/projects').catch(() => ({ projects: [] })),
      ]);
      setData(e);
      setProjects(p.projects);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const m = Number(miles);
    if (!Number.isFinite(m) || m <= 0) {
      setError('Enter a positive miles value');
      return;
    }
    try {
      await api('/api/mileage', {
        method: 'POST',
        body: JSON.stringify({
          date: new Date(date).toISOString(),
          miles: m,
          projectId: projectId || null,
          purpose: purpose || null,
        }),
      });
      setMiles('');
      setPurpose('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    }
  }

  async function remove(entry: Entry) {
    if (!confirm('Delete this mileage entry?')) return;
    try {
      await api(`/api/mileage/${entry.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Mileage</h1>
        <p className="muted">
          {isAccounting
            ? 'Every driver\'s trips. Standard IRS rate is set in Company settings.'
            : 'Your trips for deductible mileage. Tag a project when applicable.'}
          {' '}<Link to="/portal/finance">← back to finance</Link>
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <h2>Log a trip</h2>
        <form onSubmit={add}>
          <div className="form-row">
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label>Miles</label>
              <input type="number" step="0.1" min="0" value={miles} onChange={(e) => setMiles(e.target.value)} required />
            </div>
            <div>
              <label>Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Overhead / unassigned</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Purpose</label>
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Supply run, customer site visit, etc." />
            </div>
          </div>
          <button type="submit">+ Log trip</button>
        </form>
      </section>

      <section className="card">
        <h2>Entries</h2>
        {data && (
          <div className="invoice-stats" style={{ marginBottom: '1rem' }}>
            <div>
              <div className="stat-label">Total miles</div>
              <div className="stat-value">{data.totals.miles.toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">Deductible</div>
              <div className="stat-value">{formatCents(data.totals.deductibleCents)}</div>
            </div>
            <div>
              <div className="stat-label">Trips</div>
              <div className="stat-value">{data.totals.count}</div>
            </div>
          </div>
        )}
        {data && data.entries.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                {isAccounting && <th>Driver</th>}
                <th>Project</th>
                <th>Purpose</th>
                <th style={{ textAlign: 'right' }}>Miles</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Deductible</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  {isAccounting && <td>{e.user.name}</td>}
                  <td>{e.project?.name ?? <span className="muted">overhead</span>}</td>
                  <td className="muted">{e.purpose ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{(e.milesTenths / 10).toFixed(1)}</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {(e.rateCentsPerMile / 10).toFixed(1)}¢
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatCents(e.totalCents)}</td>
                  <td>
                    <button type="button" className="button-ghost button-small" onClick={() => remove(e)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No mileage logged yet.</p>
        )}
      </section>
    </div>
  );
}
