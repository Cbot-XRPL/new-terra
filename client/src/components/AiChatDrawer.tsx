import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { AI_EXAMPLES } from '../lib/aiExamples';
import { Sparkles, X, Send, Maximize2, Paperclip } from 'lucide-react';

interface AttachedImage {
  // Original filename for display.
  name: string;
  // image/jpeg, image/png, etc.
  mediaType: string;
  // Base64 data URL minus the prefix — what Anthropic's API wants.
  data: string;
  // Local URL for the thumbnail preview.
  preview: string;
}

async function fileToAttached(file: File): Promise<AttachedImage> {
  const buf = await file.arrayBuffer();
  // btoa-friendly base64 conversion in chunks (large files crash naive
  // String.fromCharCode... approaches).
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

// Typewriter "lure" — the example pool lives in lib/aiExamples so the
// corner drawer and the full /portal/ai page share the same set.
const EXAMPLES = AI_EXAMPLES;
const STATIC_PLACEHOLDER = 'Ask the assistant…';
const TYPE_MS = 45;
const DELETE_MS = 22;
const HOLD_MS = 1100;
// Many cycles per load — the drawer stays open while the user reads,
// so a long-running lure keeps suggesting things until they click in.
const MAX_CYCLES = 30;

// Tiny floating-button chat drawer wired to /api/ai/chat. The server
// runs the tool loop (lookup users, create leads, etc.); this UI is
// just the input/output. No streaming yet — the server replies with
// the final text once Claude is done with whatever tool hops it
// needed. Conversations are kept in component state only (no DB
// persistence) so refresh = fresh chat.
export default function AiChatDrawer() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Typewriter animation state. animatedPlaceholder is the current
  // partial string; lureStopped flag halts the loop once the user
  // engages (focuses, types, or sends a message).
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState('');
  const [lureStopped, setLureStopped] = useState(false);

  // Customer-facing portal users don't get the assistant. Also hide
  // it on the dedicated /portal/ai page — the floating FAB would just
  // duplicate what's already on screen.
  const onAiPage = location.pathname.startsWith('/portal/ai');
  const visible = !!user && user.role !== 'CUSTOMER' && !onAiPage;

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
    // Randomize the starting example each open so the user sees a
    // different sequence on every visit instead of the same opener.
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
    if ((!text && images.length === 0) || busy) return;
    setError(null);
    // Build a display-only content string so the bubble shows what was sent.
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
          messages: next,
          // Server attaches these to the latest user message before
          // forwarding to Anthropic. Stripping the preview URL — only
          // mediaType + base64 data are wire-relevant.
          images: sendImages.map((i) => ({ mediaType: i.mediaType, data: i.data })),
        }),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'AI request failed');
    } finally {
      setBusy(false);
    }
  }

  async function pickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: AttachedImage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      // 10 MB hard cap — Anthropic rejects huge images anyway and
      // sending raw 4K phone shots wastes tokens.
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
            <Link
              to="/portal/ai"
              className="button-ghost button-small"
              title="Open the full assistant page"
              onClick={() => setOpen(false)}
            >
              <Maximize2 size={12} />
            </Link>
          </div>
          {(messages.length > 0 || busy || error) && (
            <div className="ai-drawer-stream" ref={streamRef}>
              {messages.map((m, i) => (
                <div key={i} className={`ai-bubble ${m.role}`}>
                  {m.content}
                </div>
              ))}
              {busy && <div className="ai-bubble assistant ai-thinking">Thinking…</div>}
              {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
            </div>
          )}
          {images.length > 0 && (
            <div className="ai-drawer-attachments">
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
          {/* Hidden file input lives outside the form so it can never
              contribute layout / paint as a stray empty box. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => pickImages(e.target.files)}
          />
          <form className="ai-drawer-composer" onSubmit={send}>
            <button
              type="button"
              className="ai-attach"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              title="Attach images"
              aria-label="Attach images"
            >
              <Paperclip size={16} />
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
                lureStopped || messages.length > 0 || input.length > 0
                  ? STATIC_PLACEHOLDER
                  : animatedPlaceholder || STATIC_PLACEHOLDER
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
        </div>
      )}
    </>
  );
}
