import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { Check, AlertCircle } from 'lucide-react';

interface ChecklistItem {
  key: string;
  label: string;
  status: 'ok' | 'todo';
  detail?: string | null;
  docs?: string;
}

export default function IntegrationsChecklistPage() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: ChecklistItem[] }>('/api/admin/integrations-status')
      .then((r) => setItems(r.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const okCount = items.filter((i) => i.status === 'ok').length;
  const todoCount = items.filter((i) => i.status === 'todo').length;

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/admin" className="muted">← Admin</Link>
        <h1>Integrations checklist</h1>
        <p className="muted">
          What's wired up vs. what still needs configuration before the portal goes live.
          Each row links out to the specific docs / dashboard you'll need.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      {items.length > 0 && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <strong>{okCount}</strong> of {items.length} ready ·{' '}
            <strong>{todoCount}</strong> still to do
          </div>
          <div style={{ flex: 1, minWidth: 200, maxWidth: 400, height: 8, background: 'var(--bg-soft)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${items.length === 0 ? 0 : (okCount / items.length) * 100}%`,
                height: '100%',
                background: 'var(--success)',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((item) => (
          <li
            key={item.key}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: item.status === 'ok' ? 'var(--success)' : 'var(--surface-strong)',
                color: item.status === 'ok' ? '#fff' : 'var(--text-muted)',
              }}
            >
              {item.status === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              {item.detail && (
                <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.15rem' }}>
                  {item.detail}
                </div>
              )}
              {item.docs && (
                <div
                  className="muted"
                  style={{ fontSize: '0.8rem', marginTop: '0.35rem', whiteSpace: 'pre-wrap' }}
                >
                  {item.docs}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
