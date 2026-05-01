// Click-to-add / click-to-edit schedule modal. Triggered by clicking
// a calendar cell (create) or an existing event pill (edit).
// - Create: posts to /api/projects/:id/schedules with the new fields.
// - Edit: PATCH /api/schedules/:id; project picker is locked since the
//   API doesn't support reparenting events.
// - Edit also exposes a Delete button that hits DELETE /api/schedules/:id.

import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

interface ProjectRef { id: string; name: string }
interface StaffRef { id: string; name: string; role: string }

// Subset of CalendarSchedule we need to prefill the form. Keeping the
// shape minimal so callers don't have to pass more than they have.
export interface ExistingSchedule {
  id: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
}

interface Props {
  // For create mode — the day the user clicked.
  defaultDate?: Date;
  // For edit mode — the event being edited.
  existing?: ExistingSchedule;
  onClose: () => void;
  // Called after a successful create / edit / delete so the parent can
  // refresh its calendar.
  onChanged: () => void;
}

function toLocalIso(d: Date): string {
  // <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' in local time.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickScheduleModal({ defaultDate, existing, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const canSchedule =
    user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && (user.isProjectManager || user.isSales));

  const isEdit = !!existing;
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [staff, setStaff] = useState<StaffRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initial values — for edit mode use the existing event's data; for
  // create mode default to the picked day's 9am–5pm window.
  const seedStart = existing
    ? new Date(existing.startsAt)
    : (() => { const d = new Date(defaultDate ?? new Date()); d.setHours(9, 0, 0, 0); return d; })();
  const seedEnd = existing
    ? new Date(existing.endsAt)
    : (() => { const d = new Date(defaultDate ?? new Date()); d.setHours(17, 0, 0, 0); return d; })();

  const [projectId, setProjectId] = useState(existing?.project.id ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [startsAt, setStartsAt] = useState(toLocalIso(seedStart));
  const [endsAt, setEndsAt] = useState(toLocalIso(seedEnd));
  const [assigneeId, setAssigneeId] = useState(existing?.assignee?.id ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    if (!isEdit && !projectId) {
      setError('Pick a project');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && existing) {
        await api(`/api/schedules/${existing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            assigneeId: assigneeId || null,
            notes: notes || null,
          }),
        });
      } else {
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
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    if (!confirm(`Delete "${existing.title}"? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/schedules/${existing.id}`, { method: 'DELETE' });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  if (!canSchedule) {
    // Shouldn't happen — caller gates the cell click — but guard anyway.
    return null;
  }

  const headerLabel = isEdit
    ? `Edit event — ${existing!.project.name}`
    : `New event on ${defaultDate?.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="qs-title">
        <div className="row-between" style={{ marginBottom: '0.5rem' }}>
          <h2 id="qs-title" style={{ margin: 0 }}>{headerLabel}</h2>
          <button type="button" className="button-ghost button-small" onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit}>
          {!isEdit && (
            <>
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
            </>
          )}

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

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button type="submit" disabled={submitting || deleting}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add to schedule'}
            </button>
            <button type="button" className="button-ghost" onClick={onClose}>
              Cancel
            </button>
            {isEdit && (
              <button
                type="button"
                className="button-ghost"
                style={{ marginLeft: 'auto', color: 'var(--danger, #dc2626)' }}
                onClick={handleDelete}
                disabled={submitting || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
          {isEdit && existing && (
            <p className="muted" style={{ fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
              <Link to={`/portal/projects/${existing.project.id}`} onClick={onClose}>
                Open {existing.project.name} ↗
              </Link>
            </p>
          )}
          {!isEdit && (
            <p className="muted" style={{ fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
              Will appear on the project's Schedule card and the company calendar.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
