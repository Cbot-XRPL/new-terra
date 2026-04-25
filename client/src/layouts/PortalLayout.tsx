import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function PortalLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
          {user?.role === 'ADMIN' && <NavLink to="/portal/admin">Admin</NavLink>}
        </nav>
        <div className="portal-user">
          <div className="portal-user-name">{user?.name}</div>
          <div className="portal-user-role">{user?.role.toLowerCase()}</div>
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
