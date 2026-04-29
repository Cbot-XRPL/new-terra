// Click-to-add schedule modal. Triggered by clicking a calendar cell;
// the date prefills the start/end (default 9am–5pm). On submit, posts to
// /api/projects/:id/schedules so the new event lands on both the
// calendar and the project's own Schedule card automatically.

import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

interface ProjectRef { id: string; name: string }
interface StaffRef { id: string; name: string; role: string }

interface Props {
  defaultDate: Date;
  onClose: () => void;
  onCreated: () => void;
}

function toLocalIso(d: Date): string {
  // <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' in local time.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickScheduleModal({ defaultDate, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const canSchedule =
    user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && (user.isProjectManager || user.isSales));

  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [staff, setStaff] = useState<StaffRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  const start = new Date(defaultDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(defaultDate);
  end.setHours(17, 0, 0, 0);

  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(toLocalIso(start));
  const [endsAt, setEndsAt] = useState(toLocalIso(end));
  const [assigneeId, setAssigneeId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ projects: ProjectRef[] }>('/api/projects').catch(() => ({ projects: [] as ProjectRef[] })),
      api<{ users: StaffRef[] }>('/api/portal/staff/users').catch(() => ({ users: [] as StaffRef[] })),
    ])
      .then(([p, s]) => {
        setProjects(p.projects);
        setStaff(s.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load form data'));
  }, []);

  // ESC closes; click outside closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!projectId) {
      setError('Pick a project');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          assigneeId: assigneeId || undefined,
          notes: notes || undefined,
        }),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canSchedule) {
    // Shouldn't happen — caller gates the cell click — but guard anyway.
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="qs-title">
        <div className="row-between" style={{ marginBottom: '0.5rem' }}>
          <h2 id="qs-title" style={{ margin: 0 }}>
            New event on {defaultDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </h2>
          <button type="button" className="button-ghost button-small" onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit}>
          <label htmlFor="qs-project">Project</label>
          <select
            id="qs-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            <option value="">— pick a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <label htmlFor="qs-title-in">Title</label>
          <input
            id="qs-title-in"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pour foundation"
            required
          />

          <div className="form-row">
            <div>
              <label htmlFor="qs-start">Starts</label>
              <input
                id="qs-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="qs-end">Ends</label>
              <input
                id="qs-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>

          <label htmlFor="qs-assignee">Assignee (optional)</label>
          <select id="qs-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role.toLowerCase()})
              </option>
            ))}
          </select>

          <label htmlFor="qs-notes">Notes (optional)</label>
          <textarea
            id="qs-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add to schedule'}
            </button>
            <button type="button" className="button-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
            Will appear on the project's Schedule card and the company calendar.
          </p>
        </form>
      </div>
    </div>
  );
}
