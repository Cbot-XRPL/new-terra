import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api';

type Kind = 'project' | 'customer' | 'invoice' | 'lead' | 'estimate';
interface Hit {
  kind: Kind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const KIND_LABEL: Record<Kind, string> = {
  project: 'Project',
  customer: 'Customer',
  invoice: 'Invoice',
  lead: 'Lead',
  estimate: 'Estimate',
};

// ⌘K / Ctrl+K modal that searches projects, customers, invoices, leads,
// and estimates server-side. Results are role-scoped at the API; this
// component just renders. Keyboard-driven: type to search, ↑/↓ to move,
// Enter to navigate, Esc to close.
export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Cmd/Ctrl-K opens the modal anywhere in the app. Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isToggle) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the input on open + reset state on close.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActive(0);
      // Defer focus so the input has actually mounted.
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Debounced search on query change.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ results: Hit[] }>(`/api/search?q=${encodeURIComponent(term)}`);
        setResults(r.results);
        setActive(0);
      } catch (err) {
        // Silent — empty results is fine on error.
        if (err instanceof ApiError && err.status !== 401) console.warn('[search]', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [query, open]);

  function go(hit: Hit) {
    setOpen(false);
    navigate(hit.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit);
    }
  }

  if (!open) return null;

  return (
    <div
      className="global-search-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="global-search-panel" role="dialog" aria-modal="true" aria-label="Global search">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search projects, customers, invoices, leads…"
          autoComplete="off"
        />
        <div className="global-search-results">
          {loading && <div className="muted" style={{ padding: '0.75rem' }}>Searching…</div>}
          {!loading && query.trim() !== '' && results.length === 0 && (
            <div className="muted" style={{ padding: '0.75rem' }}>No matches.</div>
          )}
          {!loading && query.trim() === '' && (
            <div className="muted" style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
              Type to search. Tip: <kbd>⌘K</kbd> opens this from anywhere; <kbd>Esc</kbd> closes.
            </div>
          )}
          {results.map((hit, idx) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              type="button"
              className={`global-search-hit${idx === active ? ' is-active' : ''}`}
              onClick={() => go(hit)}
              onMouseEnter={() => setActive(idx)}
            >
              <span className="global-search-kind">{KIND_LABEL[hit.kind]}</span>
              <span className="global-search-title">{hit.title}</span>
              {hit.subtitle && <span className="global-search-sub muted">{hit.subtitle}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
