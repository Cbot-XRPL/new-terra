import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate, formatDateTime } from '../../lib/format';

interface ProjectRef { id: string; name: string }

interface TimeEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  notes: string | null;
  billable: boolean;
  hourlyRateCents: number;
  user: { id: string; name: string };
  project: { id: string; name: string } | null;
}

interface ListResponse {
  entries: TimeEntry[];
  total: number;
  totalMinutes: number;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function TimePage() {
  const { user } = useAuth();
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  const [active, setActive] = useState<TimeEntry | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [list, setList] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Punch-in form
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [billable, setBillable] = useState(true);

  async function load() {
    try {
      const [a, p, l] = await Promise.all([
        api<{ entry: TimeEntry | null }>('/api/time/active'),
        api<{ projects: ProjectRef[] }>('/api/projects'),
        api<ListResponse>('/api/time?pageSize=20'),
      ]);
      setActive(a.entry);
      setProjects(p.projects);
      setList(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }

  useEffect(() => { load(); }, []);

  // Live elapsed clock when punched in.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  async function punchIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/time/punch-in', {
        method: 'POST',
        body: JSON.stringify({
          projectId: projectId || null,
          notes: notes || undefined,
          billable,
        }),
      });
      setNotes('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Punch-in failed');
    }
  }

  async function punchOut() {
    if (!confirm('End this time entry?')) return;
    try {
      await api('/api/time/punch-out', { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Punch-out failed');
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this time entry?')) return;
    try {
      await api(`/api/time/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  const elapsedMinutes = active
    ? Math.max(0, Math.round((now - new Date(active.startedAt).getTime()) / 60_000))
    : 0;

  return (
    <div className="dashboard">
      <header>
        <h1>Time</h1>
        <p className="muted">
          Punch in / out per project. {isAccounting ? 'You see the whole team.' : 'You see only your own entries.'}
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        {active ? (
          <>
            <h2>On the clock</h2>
            <p>
              Started {formatDateTime(active.startedAt)}
              {active.project && <> on <strong>{active.project.name}</strong></>}
              {' · '}
              <strong style={{ fontSize: '1.5rem' }}>{formatHours(elapsedMinutes)}</strong>
            </p>
            {active.notes && <p className="muted">{active.notes}</p>}
            <button onClick={punchOut}>Punch out</button>
          </>
        ) : (
          <>
            <h2>Punch in</h2>
            <form onSubmit={punchIn}>
              <div className="form-row">
                <div>
                  <label>Project</label>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">— general / overhead —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ alignSelf: 'end' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={billable}
                      onChange={(e) => setBillable(e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    Billable
                  </label>
                </div>
              </div>
              <label>Notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What are you working on?" />
              <button type="submit">Punch in</button>
            </form>
          </>
        )}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Recent entries</h2>
          {list && (
            <span className="muted">
              <strong>{formatHours(list.totalMinutes)}</strong> total ({list.total} entries)
            </span>
          )}
        </div>
        {list && list.entries.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                {isAccounting && <th>User</th>}
                <th>Project</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.startedAt)}</td>
                  <td>{e.endedAt ? formatDateTime(e.endedAt) : <em className="muted">in progress</em>}</td>
                  <td>{e.endedAt ? formatHours(e.minutes) : <span className="muted">—</span>}</td>
                  {isAccounting && <td>{e.user.name}</td>}
                  <td>{e.project?.name ?? <span className="muted">general</span>}</td>
                  <td className="muted" style={{ maxWidth: 280 }}>
                    {e.notes ?? '—'}{!e.billable && ' · non-billable'}
                  </td>
                  <td>
                    <button className="button-ghost button-small" onClick={() => deleteEntry(e.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No time entries yet.</p>
        )}
        {list && list.entries.length > 0 && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
            Showing {list.entries.length} of {list.total}. Date filtering + payroll export are on the roadmap.
            Last updated {formatDate(new Date().toISOString())}.
          </p>
        )}
      </section>
    </div>
  );
}
