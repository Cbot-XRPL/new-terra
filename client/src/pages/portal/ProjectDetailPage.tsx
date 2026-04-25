import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDate, formatDateTime, toDatetimeLocal } from '../../lib/format';
import ProjectGallery from './ProjectGallery';
import InvoicesSection from './InvoicesSection';

interface ProjectDetail {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  customer: { id: string; name: string; email: string };
}

interface Schedule {
  id: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  assignee: { id: string; name: string; role: Role } | null;
}

interface StaffOption {
  id: string;
  name: string;
  role: Role;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canAddSchedule = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Schedule form state
  const defaultStart = new Date();
  defaultStart.setMinutes(0, 0, 0);
  defaultStart.setHours(defaultStart.getHours() + 1);
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(defaultStart));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(defaultEnd));
  const [assigneeId, setAssigneeId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const [{ project }, { schedules }, staffRes] = await Promise.all([
        api<{ project: ProjectDetail }>(`/api/projects/${id}`),
        api<{ schedules: Schedule[] }>(`/api/projects/${id}/schedules`),
        canAddSchedule
          ? api<{ users: StaffOption[] }>('/api/portal/staff/users')
          : Promise.resolve({ users: [] }),
      ]);
      setProject(project);
      setSchedules(schedules);
      setStaff(staffRes.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load project');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function addSchedule(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('End time must be after start time');
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/projects/${id}/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          notes: notes || undefined,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          assigneeId: assigneeId || undefined,
        }),
      });
      setTitle('');
      setNotes('');
      setAssigneeId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add schedule');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteSchedule(scheduleId: string) {
    if (!confirm('Delete this schedule entry?')) return;
    try {
      await api(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete');
    }
  }

  if (!project) {
    return (
      <div className="dashboard">
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/projects" className="muted">← All projects</Link>
        <h1>{project.name}</h1>
        <p className="muted">
          Customer: {project.customer.name} · {project.address ?? 'No address'} ·{' '}
          {project.startDate ? `Starts ${formatDate(project.startDate)}` : 'No start date'}
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      {project.description && (
        <section className="card">
          <h2>Overview</h2>
          <p>{project.description}</p>
        </section>
      )}

      <section className="card">
        <h2>Schedule</h2>
        {schedules.length ? (
          <ul className="list">
            {schedules.map((s) => (
              <li key={s.id}>
                <div className="row-between">
                  <div>
                    <strong>{s.title}</strong>
                    <div className="muted">
                      {formatDateTime(s.startsAt)} → {formatDateTime(s.endsAt)}
                    </div>
                    {s.assignee && (
                      <div className="muted">
                        Assigned: {s.assignee.name} ({s.assignee.role.toLowerCase()})
                      </div>
                    )}
                    {s.notes && <p>{s.notes}</p>}
                  </div>
                  {canAddSchedule && (
                    <button
                      type="button"
                      className="button button-ghost"
                      onClick={() => deleteSchedule(s.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing scheduled yet.</p>
        )}
      </section>

      <ProjectGallery projectId={project.id} />

      <InvoicesSection
        projectId={project.id}
        customerId={project.customer.id}
        customerName={project.customer.name}
      />

      {canAddSchedule && (
        <section className="card">
          <h2>Add schedule entry</h2>
          <form onSubmit={addSchedule}>
            <label htmlFor="s-title">Title</label>
            <input
              id="s-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Pour foundation"
            />

            <div className="form-row">
              <div>
                <label htmlFor="s-start">Starts</label>
                <input
                  id="s-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="s-end">Ends</label>
                <input
                  id="s-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  required
                />
              </div>
            </div>

            <label htmlFor="s-assignee">Assignee</label>
            <select
              id="s-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role.toLowerCase()})
                </option>
              ))}
            </select>

            <label htmlFor="s-notes">Notes</label>
            <textarea
              id="s-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add to schedule'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
