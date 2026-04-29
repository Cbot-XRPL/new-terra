import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

type ProjectStatus = 'PLANNING' | 'AWAITING_CONTRACT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETE' | 'CANCELLED';

interface ProjectListItem {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  customer: { id: string; name: string; email: string };
  projectManager: { id: string; name: string; email: string } | null;
  _count: { schedules: number; invoices: number; images: number; contracts: number };
}

interface CustomerOption {
  id: string;
  name: string;
  email: string;
}

interface PmOption {
  id: string;
  name: string;
  email: string;
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  PLANNING: 'badge-draft',
  AWAITING_CONTRACT: 'badge-sent',
  ACTIVE: 'badge-paid',
  ON_HOLD: 'badge-void',
  COMPLETE: 'badge-paid',
  CANCELLED: 'badge-overdue',
};

function humanize(s: string) { return s.toLowerCase().replace(/_/g, ' '); }

export default function ProjectsListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  // Sales-flagged or PM-flagged employees can also create a project — both
  // workflows naturally end up wanting one. Server-side check is in
  // server/src/routes/projects.ts POST.
  const canCreate =
    isAdmin ||
    (user?.role === 'EMPLOYEE' && (user.isSales || user.isProjectManager));

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [pms, setPms] = useState<PmOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [projectManagerId, setProjectManagerId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [{ projects }, customerRes, pmRes] = await Promise.all([
        api<{ projects: ProjectListItem[] }>('/api/projects'),
        canCreate
          ? api<{ users: CustomerOption[] }>('/api/portal/customers')
          : Promise.resolve({ users: [] }),
        canCreate
          ? api<{ users: PmOption[] }>('/api/portal/staff/pms')
          : Promise.resolve({ users: [] }),
      ]);
      setProjects(projects);
      setCustomers(customerRes.users);
      setPms(pmRes.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load projects');
    }
  }

  useEffect(() => { load(); }, []);

  async function createProject(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          customerId,
          address: address || undefined,
          description: description || undefined,
          projectManagerId: projectManagerId || null,
        }),
      });
      setName('');
      setCustomerId('');
      setAddress('');
      setDescription('');
      setProjectManagerId('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Projects</h1>
          <p className="muted">
            {isAdmin ? 'All active projects.' : user?.role === 'CUSTOMER' ? 'Your projects.' : 'All company projects.'}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New project'}
          </button>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}

      {canCreate && showForm && (
        <section className="card">
          <h2>Create project</h2>
          <form onSubmit={createProject}>
            <label htmlFor="p-name">Name</label>
            <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />

            <label htmlFor="p-customer">Customer</label>
            <select
              id="p-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>

            <label htmlFor="p-address">Address</label>
            <input id="p-address" value={address} onChange={(e) => setAddress(e.target.value)} />

            <label htmlFor="p-desc">Description</label>
            <textarea
              id="p-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <label htmlFor="p-pm">Project manager (optional)</label>
            <select id="p-pm" value={projectManagerId} onChange={(e) => setProjectManagerId(e.target.value)}>
              <option value="">Unassigned</option>
              {pms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.email})
                </option>
              ))}
            </select>

            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create project'}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        {projects.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Customer</th>
                <th>PM</th>
                <th>Address</th>
                <th>Schedules</th>
                <th>Invoices</th>
                <th>Contracts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[p.status]}`}>{humanize(p.status)}</span>
                  </td>
                  <td>{p.customer.name}</td>
                  <td>{p.projectManager?.name ?? <span className="muted">unassigned</span>}</td>
                  <td>{p.address ?? '—'}</td>
                  <td>{p._count.schedules}</td>
                  <td>{p._count.invoices}</td>
                  <td>{p._count.contracts}</td>
                  <td>
                    <Link to={`/portal/projects/${p.id}`} className="button button-ghost">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No projects yet.</p>
        )}
      </section>
    </div>
  );
}
