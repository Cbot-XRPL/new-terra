import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; role: Role };
}

export default function ProjectComments({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { comments } = await api<{ comments: Comment[] }>(`/api/projects/${projectId}/comments`);
      setComments(comments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load comments');
    }
  }

  useEffect(() => {
    load();
    // Poll every 20s so customers see PM updates without a manual refresh.
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api(`/api/projects/${projectId}/comments/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="card">
      <h2>Communications</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Project-level thread visible to the customer, the assigned PM, and admin.
      </p>
      {error && <div className="form-error">{error}</div>}

      <div className="message-stream" style={{ maxHeight: 400, padding: 0, marginBottom: '1rem' }}>
        {comments.length ? (
          comments.map((c) => (
            <div
              key={c.id}
              className={`bubble ${c.author.id === user?.id ? 'mine' : 'theirs'}`}
              style={{ alignSelf: c.author.id === user?.id ? 'flex-end' : 'flex-start' }}
            >
              <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: 4 }}>
                {c.author.name} · {c.author.role.toLowerCase()}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              <div className="bubble-time">
                {formatDateTime(c.createdAt)}
                {(c.author.id === user?.id || user?.role === 'ADMIN') && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      marginLeft: 8,
                      padding: 0,
                      fontSize: '0.75rem',
                      opacity: 0.7,
                    }}
                  >
                    delete
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="muted">No messages yet.</p>
        )}
      </div>

      <form onSubmit={add} className="message-composer" style={{ borderTop: 'none', padding: 0 }}>
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a project update or question…"
          required
        />
        <button type="submit" disabled={submitting || !body.trim()}>
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </form>
    </section>
  );
}
