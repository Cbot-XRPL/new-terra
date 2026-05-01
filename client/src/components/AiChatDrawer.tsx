import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Sparkles, X, Send, Maximize2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Typewriter "lure" examples that scroll through the empty composer
// to suggest what the assistant can do. Stops after a couple cycles or
// the moment the user clicks in — so it feels like a hint, not a
// distraction during typing.
const EXAMPLES = [
  'list leads stuck in QUOTE_SENT',
  'create a project for Cody Ricketts at 2211 Doc Hughes',
  'DM Matt the foundation pour is moved to Wednesday',
];
const STATIC_PLACEHOLDER = 'Ask the assistant…';
const TYPE_MS = 55;
const DELETE_MS = 28;
const HOLD_MS = 1400;
const MAX_CYCLES = 2;

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
  // Typewriter animation state. animatedPlaceholder is the current
  // partial string; lureStopped flag halts the loop once the user
  // engages (focuses, types, or sends a message).
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState('');
  const [lureStopped, setLureStopped] = useState(false);

  // Customer-facing portal users don't get the assistant.
  const visible = !!user && user.role !== 'CUSTOMER';

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages, busy]);

  // Typewriter effect — runs only while the drawer is open, the user
  // hasn't engaged yet, and there's no input or messages already in
  // play. Cycles through ~MAX_CYCLES examples then settles on the
  // static placeholder. Cancellation flag + cleared timeout in the
  // cleanup so closing/re-opening the drawer resets cleanly.
  useEffect(() => {
    if (!open || lureStopped || input.length > 0 || messages.length > 0) {
      return;
    }
    let cancelled = false;
    let cycle = 0;
    let exampleIdx = 0;
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
  }, [open, lureStopped, input.length, messages.length]);

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
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <Link
                to="/portal/ai"
                className="button-ghost button-small"
                title="Open the full assistant page"
                onClick={() => setOpen(false)}
              >
                <Maximize2 size={12} />
              </Link>
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
              onChange={(e) => {
                setInput(e.target.value);
                if (e.target.value.length > 0) setLureStopped(true);
              }}
              onFocus={() => setLureStopped(true)}
              placeholder={
                lureStopped || messages.length > 0 || input.length > 0
                  ? STATIC_PLACEHOLDER
                  : animatedPlaceholder || STATIC_PLACEHOLDER
              }
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
