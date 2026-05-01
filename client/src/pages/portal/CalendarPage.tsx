import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import QuickScheduleModal, { type ExistingSchedule } from './QuickScheduleModal';

interface CalendarSchedule {
  id: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  project: { id: string; name: string; address: string | null };
  assignee: { id: string; name: string; role: Role } | null;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function daysGrid(monthStart: Date) {
  // Start the grid on the Sunday of the week containing monthStart.
  const start = new Date(monthStart);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [schedules, setSchedules] = useState<CalendarSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date | null>(null);
  const [editing, setEditing] = useState<ExistingSchedule | null>(null);

  const canSchedule =
    user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && (user.isProjectManager || user.isSales));

  const grid = useMemo(() => daysGrid(cursor), [cursor]);
  const monthLabel = cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  function reload() {
    const from = new Date(grid[0]);
    const to = new Date(grid[grid.length - 1]);
    to.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      ...(mineOnly ? { mine: 'true' } : {}),
    });
    api<{ schedules: CalendarSchedule[] }>(`/api/schedules?${params}`)
      .then((d) => setSchedules(d.schedules))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load calendar'));
  }

  useEffect(reload, [grid, mineOnly]);

  // Bucket each schedule into every day it spans, not just its start
  // day. Multi-day jobs (e.g. "Frame walls — Mon → Wed") now show up
  // on every covered cell so the user can see continuity at a glance.
  // Cap the loop at 31 days so a malformed multi-year row can't
  // explode the map.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSchedule[]>();
    const startOfDay = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    for (const s of schedules) {
      const start = startOfDay(new Date(s.startsAt));
      const end = startOfDay(new Date(s.endsAt));
      const cursor = new Date(start);
      let safety = 0;
      while (cursor.getTime() <= end.getTime() && safety < 31) {
        const key = cursor.toDateString();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(s);
        cursor.setDate(cursor.getDate() + 1);
        safety++;
      }
    }
    return map;
  }, [schedules]);

  const today = new Date();

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Calendar</h1>
          <p className="muted">Schedules across every active project.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              style={{ width: 'auto', marginRight: 6 }}
            />
            Only mine
          </label>
          <button className="button-ghost button-small" onClick={() => setCursor(addMonths(cursor, -1))}>
            ◀
          </button>
          <strong style={{ minWidth: 160, textAlign: 'center' }}>{monthLabel}</strong>
          <button className="button-ghost button-small" onClick={() => setCursor(addMonths(cursor, 1))}>
            ▶
          </button>
          <button className="button-small" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </button>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card calendar-card calendar-card-full">
        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="calendar-dow">{d}</div>
          ))}
          {grid.map((day) => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const events = byDay.get(day.toDateString()) ?? [];
            return (
              <div
                key={day.toISOString()}
                className={`calendar-cell ${inMonth ? '' : 'muted-cell'} ${
                  sameDay(day, today) ? 'today' : ''
                } ${canSchedule ? 'clickable' : ''}`}
                onClick={(e) => {
                  // Ignore clicks on the inner event buttons — those open
                  // the edit modal instead of triggering "new event".
                  if ((e.target as HTMLElement).closest('.calendar-event')) return;
                  if (canSchedule) setPickedDate(new Date(day));
                }}
                role={canSchedule ? 'button' : undefined}
                title={canSchedule ? 'Click to add an event on this day' : undefined}
              >
                <div className="calendar-day-num">{day.getDate()}</div>
                {events.slice(0, 3).map((s) => {
                  // Mark continuation days for multi-day events so
                  // the user can tell "Mon" from "Tue (still Mon's job)".
                  const isStart = sameDay(new Date(s.startsAt), day);
                  const label = isStart ? s.title : `↪ ${s.title}`;
                  return canSchedule ? (
                    <button
                      key={`${s.id}-${day.toDateString()}`}
                      type="button"
                      className={`calendar-event${isStart ? '' : ' is-continuation'}`}
                      title={`${new Date(s.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${s.title} — ${s.project.name}${s.assignee ? ` (${s.assignee.name})` : ''} · click to edit`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setEditing({
                          id: s.id,
                          title: s.title,
                          notes: s.notes,
                          startsAt: s.startsAt,
                          endsAt: s.endsAt,
                          project: { id: s.project.id, name: s.project.name },
                          assignee: s.assignee ? { id: s.assignee.id, name: s.assignee.name } : null,
                        });
                      }}
                    >
                      {label}
                    </button>
                  ) : (
                    <Link
                      key={`${s.id}-${day.toDateString()}`}
                      to={`/portal/projects/${s.project.id}`}
                      className={`calendar-event${isStart ? '' : ' is-continuation'}`}
                      title={`${new Date(s.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${s.title} — ${s.project.name}${s.assignee ? ` (${s.assignee.name})` : ''}`}
                    >
                      {label}
                    </Link>
                  );
                })}
                {events.length > 3 && (
                  <div className="calendar-more muted">+{events.length - 3} more</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {pickedDate && (
        <QuickScheduleModal
          defaultDate={pickedDate}
          onClose={() => setPickedDate(null)}
          onChanged={reload}
        />
      )}
      {editing && (
        <QuickScheduleModal
          existing={editing}
          onClose={() => setEditing(null)}
          onChanged={reload}
        />
      )}

      <section className="card">
        <h2>This month</h2>
        {schedules.length ? (
          <ul className="list">
            {schedules
              .filter((s) => new Date(s.startsAt).getMonth() === cursor.getMonth())
              .map((s) => (
                <li key={s.id}>
                  <Link to={`/portal/projects/${s.project.id}`}>
                    <strong>{s.title}</strong>
                  </Link>
                  <div className="muted">
                    {s.project.name} · {new Date(s.startsAt).toLocaleString()} →{' '}
                    {new Date(s.endsAt).toLocaleString()}
                  </div>
                  {s.assignee && (
                    <div className="muted">
                      Assigned: {s.assignee.name} ({s.assignee.role.toLowerCase()})
                    </div>
                  )}
                </li>
              ))}
          </ul>
        ) : (
          <p className="muted">Nothing scheduled this month{user?.role !== 'ADMIN' && mineOnly ? ' for you' : ''}.</p>
        )}
      </section>
    </div>
  );
}
