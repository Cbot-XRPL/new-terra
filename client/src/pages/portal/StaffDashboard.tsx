import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import ProjectImageCarousel from './ProjectImageCarousel';
import QuickScheduleModal, { type ExistingSchedule } from './QuickScheduleModal';
import AlertsCard from '../../components/AlertsCard';
import { Hammer, Camera, HandCoins } from 'lucide-react';
import { welcomeMessage } from '../../lib/welcomeMessage';

interface Schedule {
  id: string;
  title: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
  project: { name: string; address?: string | null };
}

interface BoardPost {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: { name: string; role: string };
}

interface Overview {
  schedules: Schedule[];
  board: BoardPost[];
}

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

export default function StaffDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Company-wide calendar widget — re-uses the same /api/schedules endpoint
  // that the full /portal/calendar page uses, so edits made there show up
  // here on next month-cursor render.
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [calSchedules, setCalSchedules] = useState<CalendarSchedule[]>([]);
  const [calError, setCalError] = useState<string | null>(null);
  const [pickedDate, setPickedDate] = useState<Date | null>(null);
  const [editing, setEditing] = useState<ExistingSchedule | null>(null);
  const grid = useMemo(() => daysGrid(cursor), [cursor]);
  const monthLabel = cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const canSchedule =
    user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && (user.isProjectManager || user.isSales));

  useEffect(() => {
    api<Overview>('/api/portal/staff/overview')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  function reloadCalendar() {
    const from = new Date(grid[0]);
    const to = new Date(grid[grid.length - 1]);
    to.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    api<{ schedules: CalendarSchedule[] }>(`/api/schedules?${params}`)
      .then((d) => setCalSchedules(d.schedules))
      .catch((err) =>
        setCalError(err instanceof ApiError ? err.message : 'Failed to load calendar'),
      );
  }

  useEffect(reloadCalendar, [grid]);

  // Bucket each schedule into every day it spans so multi-day jobs
  // show up on every covered cell. Mirrors CalendarPage's logic.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSchedule[]>();
    const startOfDay = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    for (const s of calSchedules) {
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
  }, [calSchedules]);

  const today = new Date();
  // Pick the welcome subtitle once per mount (per page load) so it
  // doesn't re-roll on every state change while the user is on the
  // dashboard. Holiday-aware → falls back to a random fun message.
  const subtitle = useMemo(() => welcomeMessage(), []);

  return (
    <div className="dashboard dashboard-paneled">
      <header>
        <h1>Hello, {user?.name.split(' ')[0]}</h1>
        <p className="muted">{subtitle}</p>
      </header>

      {/* Mobile-only quick actions. Three high-traffic links surfaced
          above the alerts so a PM in the field can reach them in one
          tap without opening the drawer. Hidden on desktop where the
          sidebar is already inline. */}
      <div className="mobile-quick-actions">
        <Link to="/portal/projects" className="mobile-quick-action">
          <Hammer size={16} /> <span>Projects</span>
        </Link>
        <Link to="/portal/job-receipts" className="mobile-quick-action">
          <Camera size={16} /> <span>Receipt</span>
        </Link>
        <Link to="/portal/time" className="mobile-quick-action">
          <HandCoins size={16} /> <span>Pay</span>
        </Link>
      </div>

      <AlertsCard />

      {error && <div className="form-error">{error}</div>}

      <div className="calendar-with-aside">
      <section className="card calendar-card">
        <div className="row-between" style={{ marginBottom: '0.75rem', padding: '1rem 1.25rem 0' }}>
          <h2 style={{ margin: 0 }}>Company calendar</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
            <Link to="/portal/calendar" className="button-ghost button-small">
              Full calendar →
            </Link>
          </div>
        </div>

        {calError && (
          <div className="form-error" style={{ margin: '0 1.25rem 0.75rem' }}>{calError}</div>
        )}

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
                  if ((e.target as HTMLElement).closest('.calendar-event')) return;
                  if (canSchedule) setPickedDate(new Date(day));
                }}
                role={canSchedule ? 'button' : undefined}
                title={canSchedule ? 'Click to add an event on this day' : undefined}
              >
                <div className="calendar-day-num">{day.getDate()}</div>
                {events.slice(0, 3).map((s) => {
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

      <section className="card calendar-aside">
        <h2>Next up</h2>
        {data?.schedules.length ? (
          <ul className="list">
            {data.schedules.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong>
                <div className="muted">
                  {s.project.name}
                  {s.project.address && ` — ${s.project.address}`}
                </div>
                <div className="muted">
                  {new Date(s.startsAt).toLocaleString()} → {new Date(s.endsAt).toLocaleString()}
                </div>
                {s.notes && <p>{s.notes}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing scheduled.</p>
        )}
      </section>
      </div>

      <section className="card">
        <h2>Recent messages</h2>
        {data?.board.length ? (
          <ul className="list">
            {data.board.map((p) => (
              <li key={p.id}>
                <div className="muted">
                  {p.pinned && '📌 '}
                  <strong style={{ color: 'var(--text)' }}>{p.author.name}</strong>
                  {' · '}{new Date(p.createdAt).toLocaleString()}
                </div>
                <p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No messages yet.</p>
        )}
      </section>

      <ProjectImageCarousel />

      {pickedDate && (
        <QuickScheduleModal
          defaultDate={pickedDate}
          onClose={() => setPickedDate(null)}
          onChanged={reloadCalendar}
        />
      )}
      {editing && (
        <QuickScheduleModal
          existing={editing}
          onClose={() => setEditing(null)}
          onChanged={reloadCalendar}
        />
      )}
    </div>
  );
}
