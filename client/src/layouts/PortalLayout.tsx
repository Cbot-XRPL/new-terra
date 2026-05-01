import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Hammer,
  Target,
  ClipboardList,
  Receipt,
  FileSignature,
  Calendar,
  Megaphone,
  MessageSquare,
  HandCoins,
  TrendingUp,
  Landmark,
  Files,
  Package,
  Box,
  Calculator,
  Shield,
  Settings,
  Wrench,
  Camera,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import GlobalSearch from '../components/GlobalSearch';
import AiChatDrawer from '../components/AiChatDrawer';

const ICON_SIZE = 18;

export default function PortalLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  // Mobile nav drawer state. Ignored on desktop via CSS (the toggle and
  // closed state apply only at <=900px). Auto-closes when the route
  // changes so tapping a link doesn't leave the menu hovering open.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

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
      <aside className={`portal-sidebar${navOpen ? ' is-open' : ''}`}>
        <Link to="/" className="portal-brand">
          <img src="/media/logo.png" alt="New Terra Construction" />
          <span>New Terra</span>
        </Link>
        <button
          type="button"
          className="portal-nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
        >
          {navOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav onClick={() => setNavOpen(false)}>
          {user?.role === 'CUSTOMER' && (
            <NavLink to="/portal/customer">
              <LayoutDashboard size={ICON_SIZE} /> <span>Overview</span>
            </NavLink>
          )}
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && (
            <NavLink to="/portal/staff">
              <LayoutDashboard size={ICON_SIZE} /> <span>Overview</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/leads">
              <Target size={ICON_SIZE} /> <span>Leads</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' ||
            user?.role === 'CUSTOMER' ||
            (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/estimates">
              <ClipboardList size={ICON_SIZE} /> <span>Estimates</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' ||
            user?.role === 'CUSTOMER' ||
            (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/contracts">
              <FileSignature size={ICON_SIZE} /> <span>Contracts</span>
            </NavLink>
          )}
          <NavLink to="/portal/projects">
            <Hammer size={ICON_SIZE} /> <span>Projects</span>
          </NavLink>
          <NavLink to="/portal/invoices">
            <Receipt size={ICON_SIZE} /> <span>Invoices</span>
          </NavLink>
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && (
            <NavLink to="/portal/calendar">
              <Calendar size={ICON_SIZE} /> <span>Calendar</span>
            </NavLink>
          )}
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && (
            <NavLink to="/portal/board">
              <Megaphone size={ICON_SIZE} /> <span>Message board</span>
            </NavLink>
          )}
          <NavLink to="/portal/messages">
            <MessageSquare size={ICON_SIZE} /> <span>Messages</span>
            {unread > 0 && <span className="unread-dot" style={{ marginLeft: 8 }}>{unread}</span>}
          </NavLink>
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && (
            <NavLink to="/portal/time">
              <HandCoins size={ICON_SIZE} /> <span>Request pay</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN'
            || (user?.role === 'EMPLOYEE' && user.isAccounting)
            || user?.role === 'SUBCONTRACTOR') && (
            <NavLink to="/portal/subcontractor-bills">
              <Wrench size={ICON_SIZE} />{' '}
              <span>{user?.role === 'SUBCONTRACTOR' ? 'My bills' : 'Sub bills'}</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN'
            || (user?.role === 'EMPLOYEE'
              && (user.isProjectManager || user.isAccounting))) && (
            <NavLink to="/portal/job-receipts">
              <Camera size={ICON_SIZE} /> <span>Job receipts</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' ||
            (user?.role === 'EMPLOYEE' && user.isAccounting)) && (
            <NavLink to="/portal/banking">
              <Landmark size={ICON_SIZE} /> <span>Banking</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' ||
            (user?.role === 'EMPLOYEE' && (user.isAccounting || user.isProjectManager))) && (
            <NavLink to="/portal/finance">
              <TrendingUp size={ICON_SIZE} /> <span>Finance</span>
            </NavLink>
          )}
          {user?.role === 'ADMIN' && (
            <NavLink to="/portal/contract-templates">
              <Files size={ICON_SIZE} /> <span>Templates</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/catalog">
              <Package size={ICON_SIZE} /> <span>Catalog</span>
            </NavLink>
          )}
          {(user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales)) && (
            <NavLink to="/portal/estimator/visual">
              <Box size={ICON_SIZE} /> <span>Visual estimator</span>
            </NavLink>
          )}
          {(user?.role === 'EMPLOYEE' ||
            user?.role === 'SUBCONTRACTOR' ||
            user?.role === 'ADMIN') && (
            <NavLink to="/portal/calculators">
              <Calculator size={ICON_SIZE} /> <span>Calculators</span>
            </NavLink>
          )}
          {user?.role === 'ADMIN' && (
            <NavLink to="/portal/admin">
              <Shield size={ICON_SIZE} /> <span>Admin</span>
            </NavLink>
          )}
        </nav>
        <div className="portal-user">
          <div className="user-chip-row" style={{ marginBottom: '0.5rem' }}>
            <Link to="/portal/profile" className="user-chip">
              <Avatar
                name={user?.name ?? ''}
                url={user?.avatarUrl ?? user?.avatarThumbnailUrl}
                size={56}
              />
              <span className="user-chip-meta">
                <span className="user-chip-name">{user?.name}</span>
                <span className="user-chip-role">{user?.role.toLowerCase()}</span>
              </span>
            </Link>
            <Link
              to="/portal/profile#settings"
              className="user-chip-settings"
              aria-label="Profile settings"
              title="Profile & settings"
            >
              <Settings size={18} />
            </Link>
          </div>
          <button onClick={handleLogout} className="button button-ghost">
            Sign out
          </button>
        </div>
      </aside>
      <main className="portal-main">
        <Outlet />
      </main>
      <GlobalSearch />
      <AiChatDrawer />
    </div>
  );
}
