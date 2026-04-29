import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';
import EmojiPicker from '../../components/EmojiPicker';
import {
  AttachmentInput,
  AttachmentGallery,
  asAttachments,
} from '../../components/MessageAttachments';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface Comment {
  id: string;
  body: string;
  attachments?: unknown;
  createdAt: string;
  author: { id: string; name: string; role: Role };
}

export default function ProjectComments({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
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
    // SSE for live updates. Server publishes comment.created /
    // comment.deleted on the project topic; we just refetch on any event
    // so attachments + ordering come back consistent. EventSource
    // auto-reconnects so we don't need a poll fallback for transient
    // network blips.
    const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
    if (!token) return;
    const base = import.meta.env.VITE_API_URL ?? '';
    const es = new EventSource(
      `${base}/api/projects/${projectId}/comments/stream?token=${encodeURIComponent(token)}`,
    );
    const refresh = () => load();
    es.addEventListener('comment.created', refresh);
    es.addEventListener('comment.deleted', refresh);
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && files.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      if (body) form.append('body', body);
      for (const f of files) form.append('attachments', f);
      const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error ?? res.statusText, data);
      }
      setBody('');
      setFiles([]);
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
              <AttachmentGallery attachments={asAttachments(c.attachments)} />
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
        />
        <div className="composer-toolbar">
          <EmojiPicker onPick={(e) => setBody((b) => b + e)} />
          <AttachmentInput files={files} onChange={setFiles} disabled={submitting} />
          <div className="toolbar-spacer" />
          <button type="submit" disabled={submitting || (!body.trim() && files.length === 0)}>
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </section>
  );
}
