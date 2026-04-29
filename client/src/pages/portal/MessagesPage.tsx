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

interface Thread {
  otherUser: { id: string; name: string; role: Role };
  latest: { id: string; body: string; createdAt: string; fromMe: boolean };
  unread: number;
}

interface Recipient {
  id: string;
  name: string;
  role: Role;
}

interface ConvMessage {
  id: string;
  body: string;
  subject: string | null;
  attachments?: unknown;
  createdAt: string;
  fromUser: { id: string; name: string; role: Role };
}

interface Conversation {
  otherUser: { id: string; name: string; role: Role };
  messages: ConvMessage[];
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);

  async function loadThreads() {
    try {
      const [{ threads }, { users }] = await Promise.all([
        api<{ threads: Thread[] }>('/api/messages/threads'),
        api<{ users: Recipient[] }>('/api/messages/recipients'),
      ]);
      setThreads(threads);
      setRecipients(users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load messages');
    }
  }

  async function loadConversation(otherId: string) {
    try {
      const { conversation } = await api<{ conversation: Conversation }>(
        `/api/messages/conversation?with=${encodeURIComponent(otherId)}`,
      );
      setConversation(conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load conversation');
    }
  }

  useEffect(() => {
    loadThreads();
    // Subscribe to push events; refresh threads / active conversation when
    // anything involving us arrives. Falls back to manual reloads if the
    // EventSource fails (older proxies, locked-down networks).
    const token = localStorage.getItem('nt_token');
    if (!token) return;
    const base = import.meta.env.VITE_API_URL ?? '';
    const es = new EventSource(`${base}/api/messages/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('message.created', () => {
      loadThreads();
      // Re-fetch the active conversation only when it involves the new
      // message (cheap to just re-fetch — server returns full thread).
      if (active) loadConversation(active);
    });
    es.onerror = () => {
      // Browser auto-reconnects; we don't need to do anything here. Log so
      // it's discoverable while debugging connectivity.
      console.warn('[messages SSE] connection bounced');
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Load the conversation pane whenever the user switches threads (or
  // starts a new one from the picker). Clears the previous conversation
  // first so the UI doesn't briefly show the wrong thread's messages.
  useEffect(() => {
    if (!active) {
      setConversation(null);
      return;
    }
    setConversation(null);
    loadConversation(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!active || (!body.trim() && files.length === 0)) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('toUserId', active);
      if (body) form.append('body', body);
      for (const f of files) form.append('attachments', f);
      const token = localStorage.getItem('nt_token');
      const res = await fetch(`${API_BASE}/api/messages`, {
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
      await loadConversation(active);
      await loadThreads();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  function startConversation(userId: string) {
    setActive(userId);
    setShowNew(false);
  }

  return (
    <div className="messages-page">
      <aside className="messages-sidebar">
        <div className="row-between" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Messages</h2>
          <button className="button-small" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Cancel' : 'New'}
          </button>
        </div>

        {showNew && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <p className="muted" style={{ marginBottom: '0.5rem' }}>Start a conversation</p>
            <ul className="list">
              {recipients.map((r) => (
                <li key={r.id}>
                  <button
                    className="link-button"
                    onClick={() => startConversation(r.id)}
                  >
                    {r.name} <span className="muted">({r.role.toLowerCase()})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {threads.length ? (
          <ul className="thread-list">
            {threads.map((t) => (
              <li key={t.otherUser.id}>
                <button
                  type="button"
                  className={`thread-item ${active === t.otherUser.id ? 'active' : ''}`}
                  onClick={() => setActive(t.otherUser.id)}
                >
                  <div className="row-between">
                    <strong>{t.otherUser.name}</strong>
                    {t.unread > 0 && <span className="unread-dot">{t.unread}</span>}
                  </div>
                  <div className="muted thread-preview">
                    {t.latest.fromMe ? 'You: ' : ''}{t.latest.body}
                  </div>
                  <div className="muted thread-time">{formatDateTime(t.latest.createdAt)}</div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No conversations yet.</p>
        )}
      </aside>

      <section className="messages-main">
        {error && <div className="form-error">{error}</div>}
        {conversation ? (
          <>
            <header className="messages-header">
              <h2>{conversation.otherUser.name}</h2>
              <span className="muted">{conversation.otherUser.role.toLowerCase()}</span>
            </header>
            <div className="message-stream">
              {conversation.messages.map((m) => (
                <div
                  key={m.id}
                  className={`bubble ${m.fromUser.id === user?.id ? 'mine' : 'theirs'}`}
                >
                  <div>{m.body}</div>
                  <AttachmentGallery attachments={asAttachments(m.attachments)} />
                  <div className="bubble-time">{formatDateTime(m.createdAt)}</div>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="message-composer">
              <textarea
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a message…"
              />
              <div className="composer-toolbar">
                <EmojiPicker onPick={(e) => setBody((b) => b + e)} />
                <AttachmentInput files={files} onChange={setFiles} disabled={sending} />
                <div className="toolbar-spacer" />
                <button type="submit" disabled={sending || (!body.trim() && files.length === 0)}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="messages-empty muted">
            Select a conversation, or start a new one with the "New" button.
          </div>
        )}
      </section>
    </div>
  );
}
