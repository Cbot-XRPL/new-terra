import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';

export default function PortalLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      try {
        const { count } = await api<{ count: number }>('/api/messages/unread-count');
        if (!cancelled) setUnread(count);
      } catch {
        // Ignore — endpoint may be unavailable; nav badge is non-critical.
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user]);

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <Link to="/" className="portal-brand">
          <img src="/media/logo.png" alt="New Terra" />
          <span>New Terra</span>
        </Link>
        <nav>
          {user?.role === 'CUSTOMER' && (
            <NavLink to="/portal/customer">Overview</NavLink>
          )}
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && <NavLink to="/portal/staff">Staff</NavLink>}
          <NavLink to="/portal/projects">Projects</NavLink>
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && <NavLink to="/portal/calendar">Calendar</NavLink>}
          <NavLink to="/portal/invoices">Invoices</NavLink>
          <NavLink to="/portal/messages">
            Messages
            {unread > 0 && <span className="unread-dot" style={{ marginLeft: 8 }}>{unread}</span>}
          </NavLink>
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && <NavLink to="/portal/board">Message board</NavLink>}
          {(user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/leads">Leads</NavLink>
          )}
          {(user?.role === 'ADMIN' ||
            user?.role === 'CUSTOMER' ||
            (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/estimates">Estimates</NavLink>
          )}
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && <NavLink to="/portal/calculators">Calculators</NavLink>}
          {(user?.role === 'ADMIN' ||
            (user?.role === 'EMPLOYEE' && (user.isAccounting || user.isProjectManager))) && (
            <NavLink to="/portal/finance">Finance</NavLink>
          )}
          {(user?.role === 'ADMIN' ||
            user?.role === 'CUSTOMER' ||
            (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/contracts">Contracts</NavLink>
          )}
          {user?.role === 'ADMIN' && (
            <NavLink to="/portal/contract-templates">Templates</NavLink>
          )}
          {user?.role === 'ADMIN' && <NavLink to="/portal/admin">Admin</NavLink>}
        </nav>
        <div className="portal-user">
          <Link to="/portal/profile" className="user-chip" style={{ marginBottom: '0.5rem' }}>
            <Avatar
              name={user?.name ?? ''}
              url={user?.avatarThumbnailUrl ?? user?.avatarUrl}
              size={44}
            />
            <span className="user-chip-meta">
              <span className="user-chip-name">{user?.name}</span>
              <span className="user-chip-role">{user?.role.toLowerCase()}</span>
            </span>
          </Link>
          <button onClick={handleLogout} className="button button-ghost">
            Sign out
          </button>
        </div>
      </aside>
      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
