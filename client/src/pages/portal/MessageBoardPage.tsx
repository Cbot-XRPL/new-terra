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
import { Hash, Plus, Pencil, Archive, Trash2, Send } from 'lucide-react';
import Avatar from '../../components/Avatar';

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
    <div className="dashboard chat-shell">
      {/* Channel pills — horizontal strip at the top. Tap a pill to switch
          channels; admins get a separate pencil/archive/trash button below
          the active one so the strip itself stays clean. */}
      <nav className="chat-channels" aria-label="Channels">
        {channels.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chat-channel-pill ${activeChannelId === c.id ? 'active' : ''}`}
            onClick={() => setActiveChannelId(c.id)}
            title={c.description ?? c.name}
          >
            <Hash size={14} />
            <span>{c.name}</span>
          </button>
        ))}
        {isAdmin && (
          <button
            type="button"
            className="chat-channel-pill chat-channel-add"
            onClick={createChannel}
            title="Create a new channel"
            aria-label="Create channel"
          >
            <Plus size={14} />
          </button>
        )}
      </nav>

      {activeChannel ? (
        <>
          <header className="chat-header">
            <div>
              <h1>
                <Hash size={18} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {activeChannel.name}
              </h1>
              {activeChannel.description && (
                <p className="muted">{activeChannel.description}</p>
              )}
            </div>
            {isAdmin && (
              <div className="chat-channel-tools">
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => renameChannel(activeChannel)}
                  title="Rename"
                  aria-label="Rename channel"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => archiveChannel(activeChannel)}
                  title="Archive (keeps history)"
                  aria-label="Archive channel"
                >
                  <Archive size={14} />
                </button>
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => deleteChannel(activeChannel)}
                  title="Delete + all posts"
                  aria-label="Delete channel"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </header>

          {error && <div className="form-error">{error}</div>}

          {/* Stream of message bubbles — each post shows the author avatar
              on the left, name + time inline, body below. Hover/long-press
              reveals admin actions on the right. */}
          <div className="chat-stream">
            {posts.length === 0 ? (
              <p className="muted chat-empty">
                No messages in #{activeChannel.name} yet — say hi 👋
              </p>
            ) : (
              posts.map((p) => {
                const mine = p.author.id === user?.id;
                const canDelete = mine || isAdmin;
                return (
                  <article key={p.id} className={`chat-bubble ${mine ? 'mine' : ''}`}>
                    <Avatar name={p.author.name} size={36} />
                    <div className="chat-bubble-body">
                      <div className="chat-bubble-meta">
                        <span className="chat-bubble-author">{p.author.name}</span>
                        <span className="muted chat-bubble-role">
                          {p.author.role.toLowerCase()}
                        </span>
                        <span className="muted chat-bubble-time">
                          {formatDateTime(p.createdAt)}
                        </span>
                        {p.pinned && <span title="Pinned" aria-label="Pinned">📌</span>}
                      </div>
                      <div className="chat-bubble-text">{p.body}</div>
                      <AttachmentGallery attachments={asAttachments(p.attachments)} />
                      {(isAdmin || canDelete) && (
                        <div className="chat-bubble-actions">
                          {isAdmin && (
                            <button
                              type="button"
                              className="button-ghost button-small"
                              onClick={() => togglePin(p)}
                            >
                              {p.pinned ? 'Unpin' : 'Pin'}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              className="button-ghost button-small"
                              onClick={() => removePost(p.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Always-visible composer — sticky at the bottom of the viewport
              on mobile so dropping a message feels like any chat app. */}
          <form className="chat-composer" onSubmit={createPost}>
            <textarea
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Message #${activeChannel.name}`}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter sends; plain Enter still inserts a newline
                // so multi-line posts (e.g. punch-list updates) stay easy.
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (body.trim()) (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
            />
            {isAdmin && (
              <label className="chat-composer-pin">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                />
                Pin
              </label>
            )}
            <div className="chat-composer-tools">
              <EmojiPicker onPick={(em) => setBody((b) => b + em)} />
              <AttachmentInput files={files} onChange={setFiles} disabled={submitting} />
              <button
                type="submit"
                className="chat-composer-send"
                disabled={submitting || (!body.trim() && files.length === 0)}
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">
          {channels.length === 0
            ? isAdmin
              ? 'Create your first channel using the + button to start the conversation.'
              : 'No channels available yet — ask an admin to create one.'
            : 'Select a channel above to read or post.'}
        </p>
      )}
    </div>
  );
}
