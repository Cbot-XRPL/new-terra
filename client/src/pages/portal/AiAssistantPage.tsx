import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { Plus, Trash2, Send, Pencil } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface ConversationDetail {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
}

// Full-page Claude-style assistant. Left rail = past conversations, right
// pane = active thread. Conversations persist server-side so the user
// can resume any chat later. The /portal/ai/:id route loads + opens
// that specific conversation; /portal/ai (no id) shows an empty new-chat
// pane until the user sends their first message.
export default function AiAssistantPage() {
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(routeId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  // Reflect URL → state when the user clicks a sidebar item or hits back/forward.
  useEffect(() => {
    setActiveId(routeId ?? null);
  }, [routeId]);

  async function loadConversations() {
    try {
      const r = await api<{ conversations: ConversationSummary[] }>('/api/ai/conversations');
      setConversations(r.conversations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load conversations');
    }
  }
  useEffect(() => { loadConversations(); }, []);

  // Load the active conversation's messages whenever activeId changes.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    api<{ conversation: ConversationDetail }>(`/api/ai/conversations/${activeId}`)
      .then((r) => {
        setMessages(
          r.conversation.messages
            .filter((m): m is { id: string; role: 'user' | 'assistant'; content: string; createdAt: string } =>
              m.role === 'user' || m.role === 'assistant',
            )
            .map((m) => ({ role: m.role, content: m.content })),
        );
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load chat'));
  }, [activeId]);

  // Auto-scroll the stream to the bottom as new messages land.
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages, busy]);

  async function newChat() {
    try {
      const r = await api<{ conversation: ConversationSummary }>('/api/ai/conversations', {
        method: 'POST',
      });
      navigate(`/portal/ai/${r.conversation.id}`);
      setActiveId(r.conversation.id);
      setMessages([]);
      await loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start a new chat');
    }
  }

  async function deleteConversation(id: string) {
    if (!confirm('Delete this chat?')) return;
    try {
      await api(`/api/ai/conversations/${id}`, { method: 'DELETE' });
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        navigate('/portal/ai');
      }
      await loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function renameConversation(c: ConversationSummary) {
    const next = prompt('Rename chat:', c.title);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === c.title) return;
    try {
      await api(`/api/ai/conversations/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: trimmed }),
      });
      await loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rename failed');
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

    // Lazy-create the conversation if the user lands on /portal/ai
    // (no id) and starts typing — same UX as Claude's "first prompt
    // creates the chat".
    let convId = activeId;
    if (!convId) {
      const r = await api<{ conversation: ConversationSummary }>('/api/ai/conversations', {
        method: 'POST',
      });
      convId = r.conversation.id;
      setActiveId(convId);
      navigate(`/portal/ai/${convId}`, { replace: true });
    }

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api<{ reply: string }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId, messages: next }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply }]);
      // Refresh the sidebar so the title (which is auto-set from the
      // first user message) updates and this chat moves to the top.
      await loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-page">
      <aside className="ai-page-rail">
        <button
          type="button"
          className="ai-page-new"
          onClick={newChat}
          title="Start a new chat"
        >
          <Plus size={16} /> <span>New chat</span>
        </button>
        <div className="ai-page-rail-list">
          {conversations.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.85rem', padding: '0.5rem' }}>
              No chats yet.
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`ai-page-rail-item ${activeId === c.id ? 'active' : ''}`}
                onClick={() => navigate(`/portal/ai/${c.id}`)}
              >
                <div className="ai-page-rail-title">{c.title}</div>
                <div className="ai-page-rail-tools">
                  <button
                    type="button"
                    className="button-ghost button-small"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      renameConversation(c);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="ai-page-main">
        <header className="ai-page-header">
          <h1>AI assistant</h1>
          <p className="muted">
            Ask the assistant to find data, draft replies, or run actions across the portal.
          </p>
        </header>

        <div className="ai-page-stream" ref={streamRef}>
          {messages.length === 0 && !busy ? (
            <div className="ai-page-empty">
              <p className="muted">
                Try one of these:
              </p>
              <ul className="muted" style={{ paddingLeft: '1.25rem', lineHeight: 1.7 }}>
                <li><em>"Show me leads stuck in QUOTE_SENT for more than a week"</em></li>
                <li><em>"Draft a follow-up for the lead from the Hughes house"</em></li>
                <li><em>"What's the total amount owed across open invoices?"</em></li>
                <li><em>"Create a project called Smith Deck for Cody Ricketts"</em></li>
              </ul>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`ai-page-bubble ${m.role}`}>
                {m.content}
              </div>
            ))
          )}
          {busy && <div className="ai-page-bubble assistant ai-thinking">Thinking…</div>}
          {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
        </div>

        <form className="ai-page-composer" onSubmit={send}>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the assistant…  (Cmd/Ctrl+Enter to send)"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (input.trim()) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            disabled={busy}
          />
          <button
            type="submit"
            className="ai-send"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </form>
      </main>
    </div>
  );
}
