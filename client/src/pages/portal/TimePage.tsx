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
  dayUnits: number | null;
  notes: string | null;
  billable: boolean;
  hourlyRateCents: number;
  dailyRateCents: number;
  user: { id: string; name: string };
  project: { id: string; name: string } | null;
}

interface ListResponse {
  entries: TimeEntry[];
  total: number;
  totalMinutes: number;
  totalDayUnits: number;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatDays(units: number): string {
  // 1 → "1 day", 0.5 → "0.5 day", 2 → "2 days"
  return `${units % 1 === 0 ? units.toFixed(0) : units.toFixed(2)} day${units === 1 ? '' : 's'}`;
}

function todayLocalIso(): string {
  // Default the date input to today, midday local time, so picking it
  // doesn't surprise anyone with timezone shifts at midnight.
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10); // <input type="date"> wants YYYY-MM-DD
}

export default function TimePage() {
  const { user } = useAuth();
  const isAccounting = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isAccounting);

  const [active, setActive] = useState<TimeEntry | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [list, setList] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Both forms are always available; the user's billingMode just picks the
  // default tab. An hourly worker can still log an occasional day-rate
  // entry (and vice versa) without admin flipping their mode.
  const [mode, setMode] = useState<'hourly' | 'daily'>(
    user?.billingMode === 'DAILY' ? 'daily' : 'hourly',
  );

  // Punch-in form (hourly mode)
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [billable, setBillable] = useState(true);

  // Log-a-day form (daily mode)
  const [logDate, setLogDate] = useState<string>(todayLocalIso());
  const [logUnits, setLogUnits] = useState<string>('1'); // string so the
  // dropdown's "custom" option can carry its own input
  const [logCustomUnits, setLogCustomUnits] = useState<string>('1');

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

  async function logDay(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const units =
      logUnits === 'custom' ? Number(logCustomUnits) : Number(logUnits);
    if (!Number.isFinite(units) || units <= 0) {
      setError('Day units must be a positive number');
      return;
    }
    // Anchor to noon local on the picked date so it sorts as "this day"
    // regardless of the user's timezone.
    const at = new Date(`${logDate}T12:00:00`);
    try {
      await api('/api/time/log-day', {
        method: 'POST',
        body: JSON.stringify({
          projectId: projectId || null,
          date: at.toISOString(),
          dayUnits: units,
          notes: notes || undefined,
          billable,
        }),
      });
      setNotes('');
      setLogUnits('1');
      setLogCustomUnits('1');
      setLogDate(todayLocalIso());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Log-day failed');
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
      <header className="row-between">
        <div>
          <h1>Time</h1>
          <p className="muted">
            Punch in/out for hourly work or log days for day-rate work.{' '}
            {isAccounting ? 'You see the whole team.' : 'You see only your own entries.'}
          </p>
        </div>
        {isAccounting && (
          <button
            type="button"
            className="button-ghost button-small"
            onClick={() => {
              // Default to the current month. Accounting can edit the URL
              // before clicking if they want a different range.
              const start = new Date();
              start.setDate(1);
              start.setHours(0, 0, 0, 0);
              const end = new Date();
              end.setHours(23, 59, 59, 999);
              const token = localStorage.getItem('nt_token');
              const params = new URLSearchParams({
                from: start.toISOString(),
                to: end.toISOString(),
              });
              if (token) params.set('token', token);
              window.open(
                `${import.meta.env.VITE_API_URL ?? ''}/api/time/payroll.csv?${params.toString()}`,
                '_blank',
              );
            }}
            title="Per-user / per-project totals for the current month"
          >
            Payroll CSV (this month)
          </button>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        {/* Tabs: pick how you want to record time. Daily is the default for
            users whose admin set their billingMode to DAILY; everyone else
            starts on Hourly. Both are always available regardless. */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={mode === 'hourly' ? 'button button-small' : 'button-ghost button-small'}
            onClick={() => setMode('hourly')}
          >
            Hourly punch
          </button>
          <button
            type="button"
            className={mode === 'daily' ? 'button button-small' : 'button-ghost button-small'}
            onClick={() => setMode('daily')}
          >
            Log a day
          </button>
        </div>

        {mode === 'daily' ? (
          <>
            <h2 style={{ marginTop: 0 }}>Log a day</h2>
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {(user?.dailyRateCents ?? 0) > 0 ? (
                <>Day rate: <strong>${((user?.dailyRateCents ?? 0) / 100).toFixed(2)}/day</strong>. </>
              ) : (
                <>Day rate isn't set on your profile yet — admin can set it from the Admin → Pay column. </>
              )}
              Pick the date you worked and how much of a day it was.
            </p>
            <form onSubmit={logDay}>
              <div className="form-row">
                <div>
                  <label>Date</label>
                  <input
                    type="date"
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label>How much</label>
                  <select value={logUnits} onChange={(e) => setLogUnits(e.target.value)}>
                    <option value="1">1 — full day</option>
                    <option value="0.75">0.75 — three-quarter day</option>
                    <option value="0.5">0.5 — half day</option>
                    <option value="0.25">0.25 — quarter day</option>
                    <option value="custom">Custom…</option>
                  </select>
                </div>
                {logUnits === 'custom' && (
                  <div>
                    <label>Custom units</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      max="7"
                      value={logCustomUnits}
                      onChange={(e) => setLogCustomUnits(e.target.value)}
                    />
                  </div>
                )}
              </div>
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
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you work on?" />
              <button type="submit">Log day</button>
            </form>
          </>
        ) : active ? (
          <>
            <h2 style={{ marginTop: 0 }}>On the clock</h2>
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
            <h2 style={{ marginTop: 0 }}>Punch in</h2>
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
              <strong>{formatHours(list.totalMinutes)}</strong>
              {list.totalDayUnits > 0 && (
                <> + <strong>{formatDays(list.totalDayUnits)}</strong></>
              )}
              {' '}total ({list.total} entries)
            </span>
          )}
        </div>
        {list && list.entries.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                {isAccounting && <th>User</th>}
                <th>Project</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.entries.map((e) => {
                const isDailyEntry = e.dayUnits != null;
                return (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.startedAt)}</td>
                    <td>
                      {isDailyEntry
                        ? 'Daily'
                        : e.endedAt
                          ? 'Hourly'
                          : <em className="muted">in progress</em>}
                    </td>
                    <td>
                      {isDailyEntry
                        ? formatDays(e.dayUnits!)
                        : e.endedAt
                          ? formatHours(e.minutes)
                          : <span className="muted">—</span>}
                    </td>
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
                );
              })}
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
