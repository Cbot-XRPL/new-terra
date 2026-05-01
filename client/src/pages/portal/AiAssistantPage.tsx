import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { AI_EXAMPLES } from '../../lib/aiExamples';
import { Plus, Trash2, Send, Pencil, Paperclip } from 'lucide-react';

interface AttachedImage {
  name: string;
  mediaType: string;
  data: string;
  preview: string;
}

async function fileToAttached(file: File): Promise<AttachedImage> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return {
    name: file.name,
    mediaType: file.type || 'image/jpeg',
    data: btoa(binary),
    preview: URL.createObjectURL(file),
  };
}

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

// Typewriter "lure" — shared example pool with the corner drawer.
const EXAMPLES = AI_EXAMPLES;
// Kept short so it doesn't wrap inside the single-row textarea and
// flash mid-animation. The Cmd+Enter shortcut hint moves to the
// header copy / aria attributes instead.
const STATIC_PLACEHOLDER = 'Ask the assistant…';
const TYPE_MS = 45;
const DELETE_MS = 22;
const HOLD_MS = 1100;
// Long-running on the dedicated page — user is more likely to sit on
// it for a moment, so we keep cycling through suggestions.
const MAX_CYCLES = 60;

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
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState('');
  const [lureStopped, setLureStopped] = useState(false);
  // True only when the typewriter has run its full cycle budget. Until
  // then we render the in-progress (possibly empty) animated value
  // verbatim — falling back to the static placeholder between examples
  // would flash "Ask the assistant…" every ~250ms.
  const [lureFinished, setLureFinished] = useState(false);

  async function pickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: AttachedImage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} is over 10 MB`);
        continue;
      }
      next.push(await fileToAttached(f));
    }
    setImages((prev) => [...prev, ...next]);
    setLureStopped(true);
  }
  function removeImage(idx: number) {
    setImages((prev) => {
      const dropped = prev[idx];
      if (dropped) URL.revokeObjectURL(dropped.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  // Reflect URL → state when the user clicks a sidebar item or hits back/forward.
  useEffect(() => {
    setActiveId(routeId ?? null);
    // Restart the typewriter lure on every chat switch so a freshly
    // opened empty thread shows the same animated hint as a cold load.
    setLureStopped(false);
    setLureFinished(false);
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

  // Typewriter lure — runs only when the thread is empty and the user
  // hasn't engaged the composer. Matches the corner drawer so both
  // empty states feel like the same product.
  useEffect(() => {
    if (lureStopped || lureFinished || input.length > 0 || messages.length > 0) {
      return;
    }
    let cancelled = false;
    let cycle = 0;
    let exampleIdx = Math.floor(Math.random() * EXAMPLES.length);
    let charIdx = 0;
    let phase: 'typing' | 'pausing' | 'deleting' = 'typing';
    let timer: ReturnType<typeof setTimeout> | null = null;
    function tick() {
      if (cancelled) return;
      const ex = EXAMPLES[exampleIdx]!;
      if (phase === 'typing') {
        if (charIdx < ex.length) {
          charIdx++;
          setAnimatedPlaceholder(ex.slice(0, charIdx));
          timer = setTimeout(tick, TYPE_MS + Math.random() * 25);
        } else {
          phase = 'pausing';
          timer = setTimeout(tick, HOLD_MS);
        }
      } else if (phase === 'pausing') {
        phase = 'deleting';
        timer = setTimeout(tick, 0);
      } else if (phase === 'deleting') {
        if (charIdx > 0) {
          charIdx--;
          setAnimatedPlaceholder(ex.slice(0, charIdx));
          timer = setTimeout(tick, DELETE_MS);
        } else {
          cycle++;
          if (cycle >= MAX_CYCLES) {
            setAnimatedPlaceholder('');
            setLureFinished(true);
            return;
          }
          exampleIdx = (exampleIdx + 1) % EXAMPLES.length;
          phase = 'typing';
          timer = setTimeout(tick, 250);
        }
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lureStopped, lureFinished, input.length, messages.length]);

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
    if ((!text && images.length === 0) || busy) return;
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

    const display = text + (images.length > 0 ? `\n[${images.length} image${images.length === 1 ? '' : 's'} attached]` : '');
    const next: ChatMessage[] = [...messages, { role: 'user', content: display || '(image)' }];
    setMessages(next);
    const sendImages = images;
    setInput('');
    setImages([]);
    if (fileRef.current) fileRef.current.value = '';
    setBusy(true);
    try {
      const r = await api<{ reply: string }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: convId,
          messages: next,
          images: sendImages.map((i) => ({ mediaType: i.mediaType, data: i.data })),
        }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply }]);
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

        {(messages.length > 0 || busy || error) && (
          <div className="ai-page-stream" ref={streamRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ai-page-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="ai-page-bubble assistant ai-thinking">Thinking…</div>}
            {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
          </div>
        )}

        {images.length > 0 && (
          <div className="ai-drawer-attachments" style={{ padding: '0.5rem 0.75rem 0' }}>
            {images.map((img, i) => (
              <div key={i} className="ai-attached">
                <img src={img.preview} alt={img.name} />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  title="Remove"
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
          onChange={(e) => pickImages(e.target.files)}
        />
        <form className="ai-page-composer" onSubmit={send}>
          <button
            type="button"
            className="ai-attach"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Attach images"
            aria-label="Attach images"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.length > 0) setLureStopped(true);
            }}
            onFocus={() => setLureStopped(true)}
            placeholder={
              lureStopped || lureFinished || messages.length > 0 || input.length > 0
                ? STATIC_PLACEHOLDER
                : animatedPlaceholder
            }
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (input.trim() || images.length > 0) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            disabled={busy}
          />
          <button
            type="submit"
            className="ai-send"
            disabled={busy || (!input.trim() && images.length === 0)}
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </form>
      </main>
    </div>
  );
}
