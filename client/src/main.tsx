import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { replayQueue } from './lib/offlineQueue';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Register the service worker once the app has mounted. We only do this in
// production builds because Vite dev rewrites assets in flight and a SW would
// happily serve stale ones from cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((err) => console.warn('[sw] registration failed', err));
  });
}

// Replay any queued offline receipt uploads on app boot and whenever the
// browser regains network. The function is idempotent + best-effort.
function tryReplay() {
  replayQueue()
    .then((r) => {
      if (r.sent > 0) console.log(`[offline] replayed ${r.sent} receipt(s)`);
    })
    .catch((err) => console.warn('[offline] replay failed', err));
}
window.addEventListener('online', tryReplay);
// Slight delay on boot so the auth provider has a chance to load the token
// from localStorage before we fire requests that need it.
setTimeout(tryReplay, 500);
