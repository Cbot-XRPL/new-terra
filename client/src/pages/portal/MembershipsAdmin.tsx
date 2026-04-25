import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../../lib/format';

type MembershipTier = 'STANDARD' | 'PRIORITY' | 'PREMIER';

interface Membership {
  id: string;
  tier: MembershipTier;
  active: boolean;
  startedAt: string;
  renewsAt: string | null;
  customer: { id: string; name: string; email: string };
}

interface CustomerOption {
  id: string;
  name: string;
  email: string;
}

const TIERS: MembershipTier[] = ['STANDARD', 'PRIORITY', 'PREMIER'];

export default function MembershipsAdmin() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [tier, setTier] = useState<MembershipTier>('STANDARD');
  const [renewsAt, setRenewsAt] = useState('');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [mem, cust] = await Promise.all([
        api<{ memberships: Membership[] }>('/api/memberships'),
        api<{ users: CustomerOption[] }>('/api/admin/users?roles=CUSTOMER&active=true'),
      ]);
      setMemberships(mem.memberships);
      setCustomers(cust.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load memberships');
    }
  }

  useEffect(() => { load(); }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api(`/api/memberships/${customerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          tier,
          active,
          renewsAt: renewsAt ? new Date(renewsAt).toISOString() : null,
        }),
      });
      setCustomerId('');
      setTier('STANDARD');
      setRenewsAt('');
      setActive(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Cancel this membership?')) return;
    try {
      await api(`/api/memberships/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="card">
      <h2>Memberships</h2>
      {error && <div className="form-error">{error}</div>}

      <form onSubmit={save} style={{ marginBottom: '1.5rem' }}>
        <p className="muted">Assign or update a customer membership.</p>
        <div className="form-row">
          <div>
            <label htmlFor="m-customer">Customer</label>
            <select
              id="m-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="m-tier">Tier</label>
            <select id="m-tier" value={tier} onChange={(e) => setTier(e.target.value as MembershipTier)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>{t.toLowerCase()}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label htmlFor="m-renews">Renews on</label>
            <input
              id="m-renews"
              type="date"
              value={renewsAt}
              onChange={(e) => setRenewsAt(e.target.value)}
            />
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Active
            </label>
          </div>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save membership'}
        </button>
      </form>

      {memberships.length ? (
        <table className="table">
          <thead>
            <tr><th>Customer</th><th>Tier</th><th>Started</th><th>Renews</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.id}>
                <td>{m.customer.name}</td>
                <td>{m.tier.toLowerCase()}</td>
                <td>{formatDate(m.startedAt)}</td>
                <td>{formatDate(m.renewsAt)}</td>
                <td>{m.active ? 'Active' : 'Inactive'}</td>
                <td>
                  <button
                    className="button button-ghost button-small"
                    onClick={() => remove(m.customer.id)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No memberships yet.</p>
      )}
    </section>
  );
}
