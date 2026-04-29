import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';
import EmojiPicker from '../../components/EmojiPicker';
import {
  AttachmentInput,
  AttachmentGallery,
  asAttachments,
} from '../../components/MessageAttachments';
import { Hash, Plus, Pencil, Archive, Trash2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface Channel {
  id: string;
  name: string;
  description: string | null;
  position: number;
  archivedAt: string | null;
  _count?: { posts: number };
}

interface Post {
  id: string;
  channelId: string;
  body: string;
  pinned: boolean;
  attachments?: unknown;
  createdAt: string;
  author: { id: string; name: string; role: Role };
}

export default function MessageBoardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Compose form
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function loadChannels() {
    try {
      const { channels } = await api<{ channels: Channel[] }>('/api/channels');
      setChannels(channels);
      // Pick the first channel by default once loaded.
      if (!activeChannelId && channels.length > 0) {
        setActiveChannelId(channels[0]!.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load channels');
    }
  }

  async function loadPosts(channelId: string) {
    try {
      const { posts } = await api<{ posts: Post[] }>(
        `/api/board?channelId=${encodeURIComponent(channelId)}`,
      );
      setPosts(posts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load posts');
    }
  }

  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeChannelId) loadPosts(activeChannelId);
  }, [activeChannelId]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  // ----- Channel admin -----

  // Discord-style slug: lowercase, spaces/underscores → dashes, strip
  // anything else, collapse runs of dashes, trim leading/trailing.
  // "Field Updates 2024" → "field-updates-2024"
  function slugifyChannelName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async function createChannel() {
    setError(null);
    const raw = prompt('New channel name (e.g. "Field Updates" or "safety"):');
    if (raw === null) return;
    const name = slugifyChannelName(raw);
    if (!name) {
      setError('Channel name needs at least one letter or digit.');
      return;
    }
    const description =
      prompt(`Optional description for #${name} (or leave blank):`) ?? '';
    try {
      const { channel } = await api<{ channel: Channel }>('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined }),
      });
      await loadChannels();
      setActiveChannelId(channel.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create channel');
    }
  }

  async function renameChannel(c: Channel) {
    setError(null);
    const raw = prompt(`Rename #${c.name} to:`, c.name);
    if (raw === null) return;
    const name = slugifyChannelName(raw);
    if (!name) {
      setError('Channel name needs at least one letter or digit.');
      return;
    }
    if (name === c.name) return;
    try {
      await api(`/api/channels/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      await loadChannels();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rename failed');
    }
  }

  async function archiveChannel(c: Channel) {
    if (!confirm(`Archive #${c.name}? Past posts stay readable; no new posts allowed.`)) return;
    try {
      await api(`/api/channels/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      await loadChannels();
      if (activeChannelId === c.id) setActiveChannelId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Archive failed');
    }
  }

  async function deleteChannel(c: Channel) {
    if (!confirm(`Delete #${c.name} and ALL its posts? This cannot be undone.`)) return;
    try {
      await api(`/api/channels/${c.id}`, { method: 'DELETE' });
      await loadChannels();
      if (activeChannelId === c.id) setActiveChannelId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  // ----- Posts -----

  async function createPost(e: FormEvent) {
    e.preventDefault();
    if (!activeChannelId) return;
    setError(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('channelId', activeChannelId);
      form.append('body', body);
      if (isAdmin && pinned) form.append('pinned', 'true');
      for (const f of files) form.append('attachments', f);
      const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
      const res = await fetch(`${API_BASE}/api/board`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error ?? res.statusText, data);
      }
      setBody('');
      setPinned(false);
      setFiles([]);
      setShowForm(false);
      await loadPosts(activeChannelId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Post failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function togglePin(p: Post) {
    try {
      await api(`/api/board/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !p.pinned }),
      });
      if (activeChannelId) await loadPosts(activeChannelId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pin failed');
    }
  }

  async function removePost(id: string) {
    if (!confirm('Delete this post?')) return;
    try {
      await api(`/api/board/${id}`, { method: 'DELETE' });
      if (activeChannelId) await loadPosts(activeChannelId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="dashboard channels-shell">
      <aside className="channels-sidebar card">
        <div className="row-between" style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Channels</h2>
          {isAdmin && (
            <button
              type="button"
              className="button-ghost button-small"
              onClick={createChannel}
              title="Create a new channel"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
        {channels.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            No channels yet.
            {isAdmin && ' Click + to add one.'}
          </p>
        ) : (
          <ul className="channel-list">
            {channels.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`channel-link ${activeChannelId === c.id ? 'active' : ''}`}
                  onClick={() => setActiveChannelId(c.id)}
                  title={c.description ?? c.name}
                >
                  <Hash size={14} />
                  <span>{c.name}</span>
                </button>
                {isAdmin && activeChannelId === c.id && (
                  <div className="channel-admin-row">
                    <button
                      type="button"
                      className="button-ghost button-small"
                      onClick={() => renameChannel(c)}
                      title="Rename"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="button-ghost button-small"
                      onClick={() => archiveChannel(c)}
                      title="Archive (keeps history)"
                    >
                      <Archive size={12} />
                    </button>
                    <button
                      type="button"
                      className="button-ghost button-small"
                      onClick={() => deleteChannel(c)}
                      title="Delete + all posts"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="channels-main">
        {activeChannel ? (
          <>
            <header className="row-between" style={{ marginBottom: '0.5rem' }}>
              <div>
                <h1 style={{ margin: 0 }}>
                  <Hash size={20} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                  {activeChannel.name}
                </h1>
                {activeChannel.description && (
                  <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                    {activeChannel.description}
                  </p>
                )}
              </div>
              <button onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : 'New post'}
              </button>
            </header>

            {error && <div className="form-error">{error}</div>}

            {showForm && (
              <section className="card">
                <form onSubmit={createPost}>
                  <label htmlFor="b-body">Message</label>
                  <textarea
                    id="b-body"
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    required
                    placeholder={`Message #${activeChannel.name}`}
                  />
                  {isAdmin && (
                    <label>
                      <input
                        type="checkbox"
                        checked={pinned}
                        onChange={(e) => setPinned(e.target.checked)}
                        style={{ width: 'auto', marginRight: 8 }}
                      />
                      Pin to top of #{activeChannel.name}
                    </label>
                  )}
                  <div className="composer-toolbar">
                    <EmojiPicker onPick={(em) => setBody((b) => b + em)} />
                    <AttachmentInput files={files} onChange={setFiles} disabled={submitting} />
                    <div className="toolbar-spacer" />
                    <button type="submit" disabled={submitting || !body.trim()}>
                      {submitting ? 'Posting…' : 'Post'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {posts.length ? (
              <div className="chat-stream">
                {posts.map((p) => (
                  <div key={p.id} className="chat-msg">
                    <div className="chat-msg-meta">
                      {p.pinned && <span title="Pinned">📌</span>}
                      <span className="chat-msg-author">{p.author.name}</span>
                      <span className="muted chat-msg-role">
                        {p.author.role.toLowerCase()}
                      </span>
                      <span className="muted chat-msg-time">{formatDateTime(p.createdAt)}</span>
                      <span className="chat-msg-actions">
                        {isAdmin && (
                          <button
                            type="button"
                            className="button-ghost button-small"
                            onClick={() => togglePin(p)}
                          >
                            {p.pinned ? 'Unpin' : 'Pin'}
                          </button>
                        )}
                        {(p.author.id === user?.id || isAdmin) && (
                          <button
                            type="button"
                            className="button-ghost button-small"
                            onClick={() => removePost(p.id)}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="chat-msg-body">{p.body}</div>
                    <AttachmentGallery attachments={asAttachments(p.attachments)} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No messages in #{activeChannel.name} yet.</p>
            )}
          </>
        ) : (
          <p className="muted">
            {channels.length === 0
              ? isAdmin
                ? 'Create your first channel using the + button to start the conversation.'
                : 'No channels available yet — ask an admin to create one.'
              : 'Select a channel from the left to read or post.'}
          </p>
        )}
      </main>
    </div>
  );
}
