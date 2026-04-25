import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

interface Post {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: { id: string; name: string; role: Role };
}

export default function MessageBoardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { posts } = await api<{ posts: Post[] }>('/api/board');
      setPosts(posts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load board');
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api('/api/board', {
        method: 'POST',
        body: JSON.stringify({ title, body, pinned: isAdmin ? pinned : undefined }),
      });
      setTitle('');
      setBody('');
      setPinned(false);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Post failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePin(post: Post) {
    try {
      await api(`/api/board/${post.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !post.pinned }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pin failed');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this post?')) return;
    try {
      await api(`/api/board/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Company message board</h1>
          <p className="muted">Announcements, updates, and notes for the team.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'New post'}
        </button>
      </header>

      {error && <div className="form-error">{error}</div>}

      {showForm && (
        <section className="card">
          <form onSubmit={create}>
            <label htmlFor="b-title">Title</label>
            <input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} required />

            <label htmlFor="b-body">Message</label>
            <textarea
              id="b-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />

            {isAdmin && (
              <label>
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  style={{ width: 'auto', marginRight: 8 }}
                />
                Pin to top
              </label>
            )}

            <button type="submit" disabled={submitting}>
              {submitting ? 'Posting…' : 'Post'}
            </button>
          </form>
        </section>
      )}

      {posts.length ? (
        posts.map((p) => (
          <article key={p.id} className="card">
            <div className="row-between">
              <div>
                <h2>
                  {p.pinned && <span title="Pinned">📌 </span>}
                  {p.title}
                </h2>
                <div className="muted">
                  {p.author.name} · {p.author.role.toLowerCase()} · {formatDateTime(p.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {isAdmin && (
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => togglePin(p)}
                  >
                    {p.pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                {(p.author.id === user?.id || isAdmin) && (
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => remove(p.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>{p.body}</p>
          </article>
        ))
      ) : (
        <p className="muted">No posts yet.</p>
      )}
    </div>
  );
}
