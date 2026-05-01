import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import Avatar from '../../components/Avatar';

interface PublicProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatarUrl: string | null;
  avatarThumbnailUrl: string | null;
  tradeType: string | null;
  isActive: boolean;
  isSales: boolean;
  isProjectManager: boolean;
  isAccounting: boolean;
}

// Universal user-profile view. Used when an employee/contractor opens
// another user's profile (e.g. from a message thread, project assignment,
// or comment author chip). Read-only — admins go to the admin detail
// page for full edit. Self-view sends them to /portal/profile instead.
export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (me && me.id === id) {
      navigate('/portal/profile', { replace: true });
      return;
    }
    api<{ user: PublicProfile }>(`/api/portal/users/${id}`)
      .then((r) => setUser(r.user))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load profile'));
  }, [id, me, navigate]);

  if (error) return <div className="dashboard"><div className="form-error">{error}</div></div>;
  if (!user) return <div className="dashboard"><p className="muted">Loading…</p></div>;

  const capabilities = [
    user.isSales && 'sales',
    user.isProjectManager && 'project manager',
    user.isAccounting && 'accounting',
  ].filter(Boolean) as string[];

  // Cross-role DM rules: anyone can DM admin/employee; customer↔customer
  // is blocked by the messaging route already, so we only show the DM
  // button when it'll actually work (viewer is staff, OR target is staff).
  const canDM =
    !!me &&
    me.id !== user.id &&
    user.isActive &&
    !(me.role === 'CUSTOMER' && user.role === 'CUSTOMER');

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal" className="muted">← Portal</Link>
        <h1 style={{ marginTop: '0.5rem' }}>{user.name}</h1>
        <p className="muted">
          {user.role.toLowerCase()}
          {user.tradeType ? ` · ${user.tradeType}` : ''}
          {!user.isActive ? ' · disabled' : ''}
        </p>
      </header>

      <section className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <Avatar name={user.name} url={user.avatarUrl} size={120} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <dl className="kv">
            <dt>Email</dt>
            <dd><a href={`mailto:${user.email}`}>{user.email}</a></dd>
            {user.phone && (
              <>
                <dt>Phone</dt>
                <dd><a href={`tel:${user.phone}`}>{user.phone}</a></dd>
              </>
            )}
            <dt>Role</dt>
            <dd>{user.role.toLowerCase()}</dd>
            {user.tradeType && (
              <>
                <dt>Trade</dt>
                <dd>{user.tradeType}</dd>
              </>
            )}
            {capabilities.length > 0 && (
              <>
                <dt>Capabilities</dt>
                <dd>{capabilities.join(', ')}</dd>
              </>
            )}
          </dl>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            {canDM && (
              <Link
                to={`/portal/messages?with=${user.id}`}
                className="button"
              >
                Send message
              </Link>
            )}
            {me?.role === 'ADMIN' && (
              <Link
                to={`/portal/admin/users/${user.id}`}
                className="button button-ghost"
              >
                Admin view
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
