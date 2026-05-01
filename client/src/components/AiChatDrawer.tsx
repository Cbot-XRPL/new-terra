import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Sparkles, X, Send } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Tiny floating-button chat drawer wired to /api/ai/chat. The server
// runs the tool loop (lookup users, create leads, etc.); this UI is
// just the input/output. No streaming yet — the server replies with
// the final text once Claude is done with whatever tool hops it
// needed. Conversations are kept in component state only (no DB
// persistence) so refresh = fresh chat.
export default function AiChatDrawer() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  // Customer-facing portal users don't get the assistant.
  const visible = !!user && user.role !== 'CUSTOMER';

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages, busy]);

  if (!visible) return null;

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api<{ reply: string }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: next }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ai-fab"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Close assistant' : 'Open AI assistant'}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {open && (
        <div className="ai-drawer" role="dialog" aria-label="AI assistant">
          <div className="ai-drawer-header">
            <strong>AI assistant</strong>
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => setMessages([])}
              disabled={busy || messages.length === 0}
              title="Clear conversation"
            >
              Clear
            </button>
          </div>
          <div className="ai-drawer-stream" ref={streamRef}>
            {messages.length === 0 && (
              <div className="muted" style={{ fontSize: '0.85rem', padding: '0.5rem 0' }}>
                Ask anything: <em>"list leads stuck in QUOTE_SENT"</em>,{' '}
                <em>"create a project for Cody Ricketts at 2211 Doc Hughes"</em>,{' '}
                <em>"DM Matt that the foundation pour is moved to Wednesday"</em>.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`ai-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="ai-bubble assistant ai-thinking">Thinking…</div>}
            {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
          </div>
          <form className="ai-drawer-composer" onSubmit={send}>
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the assistant…"
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
        </div>
      )}
    </>
  );
}
