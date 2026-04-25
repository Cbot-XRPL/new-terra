import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';

export default function PublicLayout() {
  const { user } = useAuth();
  return (
    <div className="public-shell">
      <nav className="navbar">
        <Link to="/" className="nav-brand">
          <img src="/media/logo.png" alt="New Terra Construction" className="nav-logo" />
        </Link>
        <ul className="nav-menu">
          <li>
            <NavLink to="/" end>
              Home
            </NavLink>
          </li>
          <li>
            <a href="/#services">Services</a>
          </li>
          <li>
            <a href="/#about">About</a>
          </li>
          <li>
            <Link to="/contact" className="button">
              Contact
            </Link>
          </li>
          <li>
            {user ? (
              <Link to="/portal/profile" className="user-chip" title="Open your portal">
                <Avatar
                  name={user.name}
                  url={user.avatarThumbnailUrl ?? user.avatarUrl}
                  size={36}
                />
                <span className="user-chip-meta">
                  <span className="user-chip-name">{user.name.split(' ')[0]}</span>
                  <span className="user-chip-role">{user.role.toLowerCase()}</span>
                </span>
              </Link>
            ) : (
              <Link to="/login" className="button button-ghost">
                Sign in
              </Link>
            )}
          </li>
        </ul>
      </nav>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-cols">
          <div>
            <img src="/media/logo.png" alt="logo" className="footer-logo" />
            <p>
              Whenever you need help with a construction project, our professional contractors can
              offer a helping hand.
            </p>
          </div>
          <div>
            <h4>Quick Links</h4>
            <ul>
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <a href="/#services">Services</a>
              </li>
              <li>
                <a href="/#about">About</a>
              </li>
              <li>
                <Link to="/contact">Contact</Link>
              </li>
            </ul>
          </div>
          <div>
            <h4>Work Hours</h4>
            <p>8:30 AM – 5:30 PM, Mon–Fri</p>
            <p>Schedule your free estimate today.</p>
            <a className="button" href="tel:6782079719">
              Call Today
            </a>
          </div>
        </div>
        <p className="footer-copy">
          &copy; {new Date().getFullYear()} New Terra Construction. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
