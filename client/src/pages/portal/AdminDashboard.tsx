import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import type { Role } from '../../auth/AuthContext';
import MembershipsAdmin from './MembershipsAdmin';
import SalesFlow from './SalesFlow';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  isSales: boolean;
  isProjectManager: boolean;
  isAccounting: boolean;
  billingMode: 'HOURLY' | 'DAILY';
  dailyRateCents: number;
  hourlyRateCents: number;
  // Optional 1099 fields for subs.
  taxId: string | null;
  mailingAddress: string | null;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

const ROLES: Role[] = ['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR', 'CUSTOMER'];

export default function AdminDashboard() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [u, i] = await Promise.all([
        api<{ users: AdminUser[] }>('/api/admin/users'),
        api<{ invitations: Invitation[] }>('/api/admin/invitations'),
      ]);
      setUsers(u.users);
      setInvitations(i.invitations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load admin data');
    }
  }

  useEffect(() => { load(); }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<{ inviteUrl?: string }>('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      setFeedback(
        res.inviteUrl
          ? `Invite created. Dev link (no email transport configured): ${res.inviteUrl}`
          : `Invite emailed to ${email}`,
      );
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send invite');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function toggleSales(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isSales: !user.isSales }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function togglePm(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isProjectManager: !user.isProjectManager }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function toggleAccounting(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isAccounting: !user.isAccounting }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function editPay(user: AdminUser) {
    const modeRaw = prompt(
      `Billing mode for ${user.name}: enter "hourly" (punch-in/out clock) or "daily" (logs days).`,
      user.billingMode.toLowerCase(),
    );
    if (modeRaw === null) return;
    const mode = modeRaw.trim().toLowerCase();
    if (mode !== 'hourly' && mode !== 'daily') {
      setError('Mode must be "hourly" or "daily"');
      return;
    }
    const billingMode = mode === 'daily' ? 'DAILY' : 'HOURLY';
    const patch: Record<string, unknown> = { billingMode };
    if (billingMode === 'DAILY') {
      const rateRaw = prompt(
        `Day rate for ${user.name} in dollars (e.g. 250 = $250/day).`,
        (user.dailyRateCents / 100).toString(),
      );
      if (rateRaw === null) return;
      const rate = Number(rateRaw);
      if (!Number.isFinite(rate) || rate < 0) {
        setError('Day rate must be a non-negative number');
        return;
      }
      patch.dailyRateCents = Math.round(rate * 100);
    } else {
      const rateRaw = prompt(
        `Hourly rate for ${user.name} in dollars (e.g. 75 = $75/hour).`,
        (user.hourlyRateCents / 100).toString(),
      );
      if (rateRaw === null) return;
      const rate = Number(rateRaw);
      if (!Number.isFinite(rate) || rate < 0) {
        setError('Hourly rate must be a non-negative number');
        return;
      }
      patch.hourlyRateCents = Math.round(rate * 100);
    }
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  // Quick inline editor for 1099 fields. Two prompts is good enough for an
  // infrequent admin task — a richer modal isn't worth the surface area.
  async function editTaxInfo(user: AdminUser) {
    const taxId = prompt(`Tax ID (TIN/EIN) for ${user.name}:`, user.taxId ?? '');
    if (taxId === null) return;
    const mailing = prompt(`Mailing address for ${user.name} (multi-line OK):`, user.mailingAddress ?? '');
    if (mailing === null) return;
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          taxId: taxId.trim() || null,
          mailingAddress: mailing.trim() || null,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Admin</h1>
          <p className="muted">Manage who has access to the portal.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/portal/admin/integrations" className="button button-ghost">
            Integrations checklist…
          </Link>
          <Link to="/portal/admin/settings" className="button button-ghost">
            Company settings…
          </Link>
          <Link to="/portal/admin/portfolio" className="button button-ghost">
            Public portfolio…
          </Link>
          <Link to="/portal/bulk-import" className="button button-ghost">
            Bulk import…
          </Link>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {feedback && <div className="form-success">{feedback}</div>}

      <section className="card">
        <h2>Invite a user</h2>
        <form onSubmit={invite} className="inline-form">
          <input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.toLowerCase()}
              </option>
            ))}
          </select>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Users ({users.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Sales</th>
              <th>PM</th>
              <th>Acct</th>
              <th>Pay</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role.toLowerCase()}</td>
                <td>
                  {u.role === 'EMPLOYEE' ? (
                    <button
                      className={`button-small ${u.isSales ? '' : 'button-ghost'}`}
                      onClick={() => toggleSales(u)}
                      title={u.isSales ? 'Remove sales access' : 'Grant sales access'}
                    >
                      {u.isSales ? 'Sales ✓' : 'Grant'}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {u.role === 'EMPLOYEE' ? (
                    <button
                      className={`button-small ${u.isProjectManager ? '' : 'button-ghost'}`}
                      onClick={() => togglePm(u)}
                      title={u.isProjectManager ? 'Remove PM access' : 'Grant PM access'}
                    >
                      {u.isProjectManager ? 'PM ✓' : 'Grant'}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {u.role === 'EMPLOYEE' ? (
                    <button
                      className={`button-small ${u.isAccounting ? '' : 'button-ghost'}`}
                      onClick={() => toggleAccounting(u)}
                      title={u.isAccounting ? 'Remove accounting access' : 'Grant accounting access'}
                    >
                      {u.isAccounting ? 'Acct ✓' : 'Grant'}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {u.role !== 'CUSTOMER' ? (
                    <button
                      className="button-small button-ghost"
                      onClick={() => editPay(u)}
                      title="Set hourly clock or daily rate billing for this worker"
                    >
                      {u.billingMode === 'DAILY'
                        ? `Daily · $${(u.dailyRateCents / 100).toFixed(0)}/d`
                        : `Hourly · $${(u.hourlyRateCents / 100).toFixed(0)}/h`}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{u.isActive ? 'Active' : 'Disabled'}</td>
                <td>
                  {u.role === 'SUBCONTRACTOR' && (
                    <button
                      className={`button-small ${u.taxId && u.mailingAddress ? '' : 'button-ghost'}`}
                      onClick={() => editTaxInfo(u)}
                      title="Edit 1099 tax info (TIN + mailing address)"
                      style={{ marginRight: '0.4rem' }}
                    >
                      {u.taxId && u.mailingAddress ? 'W-9 ✓' : 'W-9'}
                    </button>
                  )}
                  <button className="button button-ghost button-small" onClick={() => toggleActive(u)}>
                    {u.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SalesFlow />

      <MembershipsAdmin />

      <section className="card">
        <h2>Pending invitations</h2>
        {invitations.length ? (
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Sent</th><th>Status</th></tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.role.toLowerCase()}</td>
                  <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td>
                    {inv.acceptedAt
                      ? 'Accepted'
                      : new Date(inv.expiresAt) < new Date()
                        ? 'Expired'
                        : 'Pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No invitations yet.</p>
        )}
      </section>
    </div>
  );
}
