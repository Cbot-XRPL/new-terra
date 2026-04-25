import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

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
    const id = setInterval(loadThreads, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (active) {
      loadConversation(active);
      const id = setInterval(() => loadConversation(active), 10_000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [active]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!active || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ toUserId: active, body }),
      });
      setBody('');
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
                required
              />
              <button type="submit" disabled={sending || !body.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
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
