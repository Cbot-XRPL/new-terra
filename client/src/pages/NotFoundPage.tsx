import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// Friendly 404 page. Replaces the silent redirect-to-/ that hid typo'd
// links and stale bookmarks. Sends portal users back to /portal,
// public visitors back to home.
export default function NotFoundPage() {
  const { user } = useAuth();
  const location = useLocation();
  const fallbackHref = user ? '/portal' : '/';
  const fallbackLabel = user ? 'Back to portal' : 'Back to home';

  return (
    <div className="dashboard" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <h1 style={{ fontSize: '4rem', margin: '0 0 0.5rem' }}>404</h1>
      <h2 style={{ marginTop: 0 }}>Page not found</h2>
      <p className="muted" style={{ maxWidth: 440, margin: '0.5rem auto 1.5rem' }}>
        Nothing lives at <code>{location.pathname}</code>. The link may be
        outdated or the page was moved.
      </p>
      <Link to={fallbackHref} className="button">{fallbackLabel}</Link>
    </div>
  );
}
