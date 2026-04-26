import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDate, formatDateTime, toDatetimeLocal } from '../../lib/format';
import ProjectGallery from './ProjectGallery';
import ProjectDocuments from './ProjectDocuments';
import PunchListSection from './PunchListSection';
import InvoicesSection from './InvoicesSection';
import SelectionsSection from './SelectionsSection';
import LogEntriesSection from './LogEntriesSection';
import ProjectComments from './ProjectComments';
import JobCostingSection from './JobCostingSection';
import ChangeOrdersSection from './ChangeOrdersSection';

type ProjectStatus = 'PLANNING' | 'AWAITING_CONTRACT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETE' | 'CANCELLED';

const STATUSES: ProjectStatus[] = ['PLANNING', 'AWAITING_CONTRACT', 'ACTIVE', 'ON_HOLD', 'COMPLETE', 'CANCELLED'];
const STATUS_BADGE: Record<ProjectStatus, string> = {
  PLANNING: 'badge-draft',
  AWAITING_CONTRACT: 'badge-sent',
  ACTIVE: 'badge-paid',
  ON_HOLD: 'badge-void',
  COMPLETE: 'badge-paid',
  CANCELLED: 'badge-overdue',
};
function humanize(s: string) { return s.toLowerCase().replace(/_/g, ' '); }

interface ProjectDetail {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  // Optional — only included for staff or for customers when admin has
  // flipped showBudgetToCustomer on the project.
  budgetCents?: number | null;
  showBudgetToCustomer?: boolean;
  reviewRequestSentAt?: string | null;
  customer: { id: string; name: string; email: string };
  projectManager: { id: string; name: string; email: string } | null;
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

interface ProjectContract {
  id: string;
  templateNameSnapshot: string;
  status: string;
  sentAt: string | null;
  signedAt: string | null;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const canAddSchedule = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [contracts, setContracts] = useState<ProjectContract[]>([]);
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

      // Fetch contracts that mention this project. The contracts endpoint is
      // role-scoped server-side (customers see their own; staff see all),
      // so we just filter the page slice by projectId on the client.
      try {
        const cRes = await api<{ contracts: Array<ProjectContract & { project: { id: string } | null }> }>(
          `/api/contracts?pageSize=100`,
        );
        setContracts(cRes.contracts.filter((c) => c.project?.id === project.id));
      } catch {
        // Customers without contract access (e.g. drafts only) just see no list.
        setContracts([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load project');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function setStatus(next: ProjectStatus) {
    if (!project) return;
    try {
      await api(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status update failed');
    }
  }

  async function toggleBudgetVisibility(next: boolean) {
    if (!project) return;
    try {
      await api(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ showBudgetToCustomer: next }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

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

  const isPmOrAdmin = isAdmin || (user?.role === 'EMPLOYEE' && user.isProjectManager && project.projectManager?.id === user.id);

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/projects" className="muted">← All projects</Link>
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{project.name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              <span className={`badge ${STATUS_BADGE[project.status]}`}>{humanize(project.status)}</span>
              {' · '}Customer: <strong>{project.customer.name}</strong>
              {' · '}PM:{' '}
              {project.projectManager ? (
                <strong>{project.projectManager.name}</strong>
              ) : (
                <span className="muted">unassigned</span>
              )}
              {project.address && <> · {project.address}</>}
              {project.startDate && <> · starts {formatDate(project.startDate)}</>}
            </p>
          </div>
          {isPmOrAdmin && (
            <select
              value={project.status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              style={{ marginBottom: 0, minWidth: 200 }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {isPmOrAdmin && project.status === 'COMPLETE' && (
        <section className="card">
          <div className="row-between">
            <p className="muted" style={{ margin: 0 }}>
              {project.reviewRequestSentAt
                ? <>Review request sent {formatDate(project.reviewRequestSentAt)}.</>
                : 'No review request sent yet.'}
            </p>
            <button
              type="button"
              className="button-ghost"
              onClick={async () => {
                try {
                  await api(`/api/projects/${project.id}/request-review`, { method: 'POST' });
                  alert('Review request emailed.');
                  load();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Send failed');
                }
              }}
            >
              {project.reviewRequestSentAt ? 'Re-send review request' : 'Send review request'}
            </button>
          </div>
        </section>
      )}

      {project.description && (
        <section className="card">
          <h2>Overview</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{project.description}</p>
        </section>
      )}

      <ProjectComments projectId={project.id} />

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
                      className="button button-ghost button-small"
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
      <ProjectDocuments projectId={project.id} />
      <PunchListSection projectId={project.id} />

      <SelectionsSection projectId={project.id} />

      {/* Contracts attached to this project — visible to anyone who can read
          the project, since the server scopes the underlying contracts list. */}
      <section className="card">
        <h2>Contracts</h2>
        {contracts.length ? (
          <ul className="list">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link to={`/portal/contracts/${c.id}`}>
                  <strong>{c.templateNameSnapshot}</strong>
                </Link>
                <div className="muted">
                  {c.status.toLowerCase()}
                  {c.sentAt && ` · sent ${formatDate(c.sentAt)}`}
                  {c.signedAt && ` · signed ${formatDate(c.signedAt)}`}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No contracts on this project.</p>
        )}
      </section>

      <InvoicesSection
        projectId={project.id}
        customerId={project.customer.id}
        customerName={project.customer.name}
      />

      <ChangeOrdersSection
        projectId={project.id}
        customerName={project.customer.name}
      />

      {(isAdmin
        || (user?.role === 'EMPLOYEE' && (user.isProjectManager || user.isAccounting))
        || (user?.role === 'CUSTOMER' && project.showBudgetToCustomer)) && (
        <JobCostingSection
          projectId={project.id}
          canEditBudget={!!isPmOrAdmin}
          showBudgetToCustomer={!!project.showBudgetToCustomer}
          onShowBudgetToCustomerChange={isAdmin ? toggleBudgetVisibility : undefined}
        />
      )}

      <LogEntriesSection projectId={project.id} />

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
