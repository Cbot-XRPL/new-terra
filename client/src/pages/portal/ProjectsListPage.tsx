import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

interface ProjectListItem {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  customer: { id: string; name: string; email: string };
  _count: { schedules: number; invoices: number; images: number };
}

interface CustomerOption {
  id: string;
  name: string;
  email: string;
}

export default function ProjectsListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [{ projects }, customerRes] = await Promise.all([
        api<{ projects: ProjectListItem[] }>('/api/projects'),
        isAdmin
          ? api<{ users: CustomerOption[] }>('/api/admin/users?roles=CUSTOMER&active=true')
          : Promise.resolve({ users: [] }),
      ]);
      setProjects(projects);
      setCustomers(customerRes.users);
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
        }),
      });
      setName('');
      setCustomerId('');
      setAddress('');
      setDescription('');
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
        {isAdmin && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New project'}
          </button>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}

      {isAdmin && showForm && (
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
                <th>Customer</th>
                <th>Address</th>
                <th>Start</th>
                <th>Schedules</th>
                <th>Invoices</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.customer.name}</td>
                  <td>{p.address ?? '—'}</td>
                  <td>{formatDate(p.startDate)}</td>
                  <td>{p._count.schedules}</td>
                  <td>{p._count.invoices}</td>
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
