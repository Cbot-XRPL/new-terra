import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import type { Role } from '../../auth/AuthContext';
import Avatar from '../../components/Avatar';
import { formatDate } from '../../lib/format';

interface AdminUserDetail {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  isSales: boolean;
  isProjectManager: boolean;
  isAccounting: boolean;
  billingMode: 'HOURLY' | 'DAILY';
  dailyRateCents: number;
  hourlyRateCents: number;
  tradeType: string | null;
  avatarUrl: string | null;
  avatarThumbnailUrl: string | null;
  taxId: string | null;
  taxIdType: string | null;
  legalName: string | null;
  taxClassification: string | null;
  mailingAddress: string | null;
  w9SignedAt: string | null;
  driversLicenseUrl: string | null;
  contractorLicenseUrl: string | null;
  businessLicenseUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const TRADES = [
  'Framing', 'Demolition', 'Concrete', 'Roofing', 'Siding', 'Electrical',
  'Plumbing', 'HVAC', 'Drywall', 'Insulation', 'Painting', 'Flooring',
  'Tile', 'Cabinets', 'Countertops', 'Decks', 'Fencing', 'Hardscape',
  'Landscape', 'Excavation', 'Other',
];

// Admin-only deep view for any user. Mirrors the inline edits available
// from the AdminDashboard list (active, sub-flags, billing, W-9) but in a
// single focused page with proper labels + the documents the user has on
// file. Read-only sections at the bottom show pay-history shortcuts.
export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const r = await api<{ user: AdminUserDetail }>(`/api/admin/users/${id}`);
      setUser(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load user');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function patch(body: Record<string, unknown>, label: string) {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { user: updated } = await api<{ user: AdminUserDetail }>(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setUser((prev) => (prev ? { ...prev, ...updated } : updated));
      setSuccess(`${label} saved.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (error && !user) {
    return <div className="dashboard"><div className="form-error">{error}</div></div>;
  }
  if (!user) return <div className="dashboard"><p className="muted">Loading…</p></div>;

  const isEmployee = user.role === 'EMPLOYEE';
  const isContractor = user.role === 'SUBCONTRACTOR';

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/admin" className="muted">← Admin</Link>
        <h1 style={{ marginTop: '0.5rem' }}>{user.name}</h1>
        <p className="muted">
          {user.role.toLowerCase()}
          {user.tradeType ? ` · ${user.tradeType}` : ''}
          {!user.isActive ? ' · disabled' : ''}
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">{success}</div>}

      <section className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <Avatar name={user.name} url={user.avatarUrl} size={120} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <dl className="kv">
            <dt>Email</dt>
            <dd><a href={`mailto:${user.email}`}>{user.email}</a></dd>
            {user.phone && <><dt>Phone</dt><dd><a href={`tel:${user.phone}`}>{user.phone}</a></dd></>}
            <dt>Joined</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </dl>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <Link to={`/portal/messages?with=${user.id}`} className="button">Send message</Link>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => patch({ isActive: !user.isActive }, user.isActive ? 'Disabled' : 'Enabled')}
              disabled={saving}
            >
              {user.isActive ? 'Disable account' : 'Enable account'}
            </button>
          </div>
        </div>
      </section>

      {isEmployee && (
        <section className="card">
          <h2>Capabilities</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Toggle which areas this employee has access to. Admins ignore these.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`button-small ${user.isSales ? '' : 'button-ghost'}`}
              onClick={() => patch({ isSales: !user.isSales }, 'Sales access')}
              disabled={saving}
            >
              Sales {user.isSales ? '✓' : ''}
            </button>
            <button
              type="button"
              className={`button-small ${user.isProjectManager ? '' : 'button-ghost'}`}
              onClick={() => patch({ isProjectManager: !user.isProjectManager }, 'PM access')}
              disabled={saving}
            >
              Project Manager {user.isProjectManager ? '✓' : ''}
            </button>
            <button
              type="button"
              className={`button-small ${user.isAccounting ? '' : 'button-ghost'}`}
              onClick={() => patch({ isAccounting: !user.isAccounting }, 'Accounting access')}
              disabled={saving}
            >
              Accounting {user.isAccounting ? '✓' : ''}
            </button>
          </div>
        </section>
      )}

      {(isEmployee || isContractor) && (
        <section className="card">
          <h2>Billing</h2>
          <div className="form-row">
            <div>
              <label>Billing mode</label>
              <select
                value={user.billingMode}
                onChange={(e) =>
                  patch({ billingMode: e.target.value as 'HOURLY' | 'DAILY' }, 'Billing mode')
                }
                disabled={saving}
              >
                <option value="HOURLY">Hourly</option>
                <option value="DAILY">Daily</option>
              </select>
            </div>
            <div>
              <label>{user.billingMode === 'DAILY' ? 'Daily rate (USD)' : 'Hourly rate (USD)'}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                defaultValue={
                  ((user.billingMode === 'DAILY' ? user.dailyRateCents : user.hourlyRateCents) / 100).toFixed(2)
                }
                onBlur={(e) => {
                  const cents = Math.round(Number(e.target.value) * 100);
                  if (!Number.isFinite(cents) || cents < 0) return;
                  const key = user.billingMode === 'DAILY' ? 'dailyRateCents' : 'hourlyRateCents';
                  if (cents !== (user.billingMode === 'DAILY' ? user.dailyRateCents : user.hourlyRateCents)) {
                    void patch({ [key]: cents }, 'Rate');
                  }
                }}
                disabled={saving}
              />
              <p className="muted" style={{ fontSize: '0.75rem' }}>Saves on blur.</p>
            </div>
          </div>

          {isContractor && (
            <div className="form-row">
              <div>
                <label>Trade</label>
                <select
                  value={user.tradeType ?? ''}
                  onChange={(e) => patch({ tradeType: e.target.value || null }, 'Trade')}
                  disabled={saving}
                >
                  <option value="">No trade set</option>
                  {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Documents</h2>
        <DocStatus label="Driver's licence" url={user.driversLicenseUrl} required />
        {isContractor && (
          <>
            <DocStatus label="Contractor licence" url={user.contractorLicenseUrl} />
            <DocStatus label="Business licence" url={user.businessLicenseUrl} />
          </>
        )}
        {(isEmployee || isContractor) && (
          <div style={{ marginTop: '0.75rem' }}>
            <strong>W-9: </strong>
            {user.w9SignedAt ? (
              <span className="muted">filed {formatDate(user.w9SignedAt)}</span>
            ) : (
              <span style={{ color: 'var(--error)' }}>not on file</span>
            )}
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.75rem' }}>
          Users upload these themselves from their profile. Admin can view but
          can't upload on their behalf.
        </p>
      </section>
    </div>
  );
}

function DocStatus({ label, url, required }: { label: string; url: string | null; required?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <strong>{label}</strong>
        {required && <span style={{ color: 'var(--error)', marginLeft: 4 }}>*</span>}
        <span className="muted" style={{ marginLeft: 8, fontSize: '0.85rem' }}>
          {url ? '· on file' : '· not uploaded'}
        </span>
      </div>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="button button-ghost button-small">
          View
        </a>
      )}
    </div>
  );
}
