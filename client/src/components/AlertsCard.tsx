import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

interface DashboardAlert {
  level: 'info' | 'warning' | 'urgent';
  message: string;
  href?: string;
}

const LEVEL_STYLES: Record<DashboardAlert['level'], { bg: string; color: string }> = {
  info:    { bg: 'rgba(29, 155, 240, 0.12)',  color: 'var(--accent)' },
  warning: { bg: 'rgba(255, 165, 0, 0.12)',   color: '#e69b00' },
  urgent:  { bg: 'rgba(244, 33, 46, 0.12)',   color: 'var(--error)' },
};

function levelIcon(level: DashboardAlert['level']) {
  if (level === 'urgent') return <AlertCircle size={18} />;
  if (level === 'warning') return <AlertTriangle size={18} />;
  return <Info size={18} />;
}

// Alerts panel surfaced at the top of the home dashboard. Pulls a
// role-aware list from /api/portal/alerts and renders a stack of pill
// rows. If the response is empty we render nothing (no point showing an
// empty card and adding visual noise).
export default function AlertsCard() {
  const [alerts, setAlerts] = useState<DashboardAlert[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ alerts: DashboardAlert[] }>('/api/portal/alerts')
      .then((r) => {
        if (!cancelled) setAlerts(r.alerts);
      })
      .catch((err) => {
        // Swallow — the dashboard shouldn't break if alerts fail.
        if (!(err instanceof ApiError)) console.warn('[alerts] load failed', err);
        if (!cancelled) setAlerts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function clearAll() {
    try {
      await api('/api/portal/alerts/clear', { method: 'POST' });
      setAlerts([]);
    } catch (err) {
      console.warn('[alerts] clear failed', err);
    }
  }

  if (!alerts || alerts.length === 0) return null;

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.5rem',
        }}
      >
        <h2 style={{ margin: 0 }}>Needs your attention</h2>
        <button
          type="button"
          className="button-ghost button-small"
          onClick={clearAll}
          title="Mark these alerts as cleared (doesn't mark messages as read)"
        >
          Clear
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {alerts.map((a, i) => {
          const styles = LEVEL_STYLES[a.level];
          const inner = (
            <>
              <span style={{ color: styles.color, display: 'flex' }}>
                {levelIcon(a.level)}
              </span>
              <span style={{ flex: 1 }}>{a.message}</span>
              {a.href && <span className="muted" style={{ fontSize: '0.85rem' }}>open →</span>}
            </>
          );
          const rowStyle = {
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.6rem 0.75rem',
            background: styles.bg,
            borderRadius: 8,
            color: 'var(--text)',
            textDecoration: 'none',
          } as const;
          return a.href ? (
            <Link key={i} to={a.href} style={rowStyle}>{inner}</Link>
          ) : (
            <div key={i} style={rowStyle}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}
