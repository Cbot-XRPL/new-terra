import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

interface LogEntry {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; role: Role };
}

export default function LogEntriesSection({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canPost = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE' || user?.role === 'SUBCONTRACTOR';

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { entries } = await api<{ entries: LogEntry[] }>(`/api/projects/${projectId}/logs`);
      setEntries(entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load log');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api(`/api/projects/${projectId}/logs`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Post failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this log entry?')) return;
    try {
      await api(`/api/projects/${projectId}/logs/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="card">
      <h2>Project log</h2>
      {error && <div className="form-error">{error}</div>}

      {canPost && (
        <form onSubmit={add} style={{ marginBottom: '1rem' }}>
          <label htmlFor="log-body">Add an entry</label>
          <textarea
            id="log-body"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Site notes, deliveries, blockers…"
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </form>
      )}

      {entries.length ? (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id}>
              <div className="row-between">
                <div>
                  <strong>{e.author.name}</strong>{' '}
                  <span className="muted">
                    · {e.author.role.toLowerCase()} · {formatDateTime(e.createdAt)}
                  </span>
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>{e.body}</p>
                </div>
                {(e.author.id === user?.id || user?.role === 'ADMIN') && (
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => remove(e.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No log entries yet.</p>
      )}
    </section>
  );
}
