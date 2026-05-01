import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import type { Role } from '../../auth/AuthContext';
import MembershipsAdmin from './MembershipsAdmin';
import SalesFlow from './SalesFlow';
import GoogleDriveCard from '../../components/GoogleDriveCard';

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

const ROLES: Role[] = ['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR', 'PHOTOGRAPHER', 'CUSTOMER'];

export default function AdminDashboard() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER');
  const [isSales, setIsSales] = useState(false);
  const [isProjectManager, setIsProjectManager] = useState(false);
  const [isAccounting, setIsAccounting] = useState(false);
  const [tradeType, setTradeType] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const COMMON_TRADES = [
    'Framing', 'Demolition', 'Concrete', 'Roofing', 'Siding', 'Electrical',
    'Plumbing', 'HVAC', 'Drywall', 'Insulation', 'Painting', 'Flooring',
    'Tile', 'Cabinets', 'Countertops', 'Decks', 'Fencing', 'Hardscape',
    'Landscape', 'Excavation', 'Other',
  ];

  // Sortable column state for the user list. Default is by name asc.
  type UserSortKey = 'name' | 'email' | 'role' | 'status' | 'pay';
  const [userSort, setUserSort] = useState<UserSortKey>('name');
  const [userDir, setUserDir] = useState<'asc' | 'desc'>('asc');
  function toggleUserSort(k: UserSortKey) {
    if (userSort === k) setUserDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setUserSort(k); setUserDir('asc'); }
  }
  function userSortIcon(k: UserSortKey) {
    return userSort === k ? (userDir === 'asc' ? ' ▲' : ' ▼') : '';
  }
  const sortedUsers = useMemo(() => {
    const dir = userDir === 'asc' ? 1 : -1;
    const cmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...users].sort((a, b) => {
      switch (userSort) {
        case 'name':   return dir * cmp(a.name, b.name);
        case 'email':  return dir * cmp(a.email, b.email);
        case 'role':   return dir * cmp(a.role, b.role);
        case 'status': return dir * (Number(b.isActive) - Number(a.isActive));
        case 'pay': {
          const ap = a.billingMode === 'DAILY' ? a.dailyRateCents : a.hourlyRateCents;
          const bp = b.billingMode === 'DAILY' ? b.dailyRateCents : b.hourlyRateCents;
          return dir * (ap - bp);
        }
        default: return 0;
      }
    });
  }, [users, userSort, userDir]);

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
        body: JSON.stringify({
          email,
          role,
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          ...(role === 'EMPLOYEE' ? { isSales, isProjectManager, isAccounting } : {}),
          ...(role === 'SUBCONTRACTOR' && tradeType ? { tradeType } : {}),
        }),
      });
      setFeedback(
        res.inviteUrl
          ? `Invite created. Dev link (no email transport configured): ${res.inviteUrl}`
          : `Invite emailed to ${email}`,
      );
      setEmail('');
      setName('');
      setPhone('');
      setIsSales(false);
      setIsProjectManager(false);
      setIsAccounting(false);
      setTradeType('');
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
          <Link to="/portal/admin/pricing" className="button button-ghost">
            Pricing data…
          </Link>
          <Link to="/portal/bulk-import" className="button button-ghost">
            Bulk import…
          </Link>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {feedback && <div className="form-success">{feedback}</div>}

      <GoogleDriveCard />

      <section className="card">
        <h2>Invite a user</h2>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          The user appears in our dropdowns immediately and can claim their account
          via the invitation email when ready.
        </p>
        <form onSubmit={invite}>
          <div className="form-row">
            <div>
              <label>Email</label>
              <input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.toLowerCase()}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Name (optional, prefills their profile)</label>
              <input
                type="text"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label>Phone (optional)</label>
              <input
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          {role === 'EMPLOYEE' && (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', fontWeight: 'normal', margin: 0 }}>
                <input type="checkbox" checked={isSales} onChange={(e) => setIsSales(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                Sales
              </label>
              <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', fontWeight: 'normal', margin: 0 }}>
                <input type="checkbox" checked={isProjectManager} onChange={(e) => setIsProjectManager(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                Project Manager
              </label>
              <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', fontWeight: 'normal', margin: 0 }}>
                <input type="checkbox" checked={isAccounting} onChange={(e) => setIsAccounting(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                Accounting
              </label>
            </div>
          )}

          {role === 'SUBCONTRACTOR' && (
            <div style={{ marginBottom: '1rem' }}>
              <label>Trade</label>
              <select value={tradeType} onChange={(e) => setTradeType(e.target.value)} required>
                <option value="">Pick a trade…</option>
                {COMMON_TRADES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Create + send invite'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Users ({users.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleUserSort('name')}>Name{userSortIcon('name')}</th>
              <th className="sortable" onClick={() => toggleUserSort('email')}>Email{userSortIcon('email')}</th>
              <th className="sortable" onClick={() => toggleUserSort('role')}>Role{userSortIcon('role')}</th>
              <th>Sales</th>
              <th>PM</th>
              <th>Acct</th>
              <th className="sortable" onClick={() => toggleUserSort('pay')}>Pay{userSortIcon('pay')}</th>
              <th className="sortable" onClick={() => toggleUserSort('status')}>Status{userSortIcon('status')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((u) => (
              <tr key={u.id}>
                <td data-label="Name">
                  <Link to={`/portal/admin/users/${u.id}`} title="Open detail">{u.name}</Link>
                </td>
                <td data-label="Email">{u.email}</td>
                <td data-label="Role">{u.role.toLowerCase()}</td>
                <td data-label="Sales">
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
                <td data-label="PM">
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
                <td data-label="Acct">
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
                <td data-label="Pay">
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
                <td data-label="Status">{u.isActive ? 'Active' : 'Disabled'}</td>
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
