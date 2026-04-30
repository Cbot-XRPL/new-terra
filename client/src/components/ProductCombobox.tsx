import { useEffect, useMemo, useRef, useState } from 'react';

export interface ComboProduct {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  defaultUnitPriceCents: number;
  kind?: string;
}

interface Props {
  products: ComboProduct[];
  selectedId: string | null;
  onSelect: (productId: string | null) => void;
  // Custom row stays at the top of the dropdown so the rep can fall back
  // to a hand-typed line without leaving the picker.
  allowCustom?: boolean;
  placeholder?: string;
  // Optional disable (e.g. when an estimate is sent and locked).
  disabled?: boolean;
}

// Dollars formatter — duplicated here so the component is self-contained.
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ProductCombobox({
  products,
  selectedId,
  onSelect,
  allowCustom = true,
  placeholder = 'Type a product, category, or unit…',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  // Match against name + category + unit. Numeric-aware compare so things
  // like "2x4 8ft" rank predictably. Cap the visible list at 50 — past
  // that the rep should narrow their query.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? products
      : products.filter((p) => {
          if (p.name.toLowerCase().includes(q)) return true;
          if (p.category?.toLowerCase().includes(q)) return true;
          if (p.unit?.toLowerCase().includes(q)) return true;
          return false;
        });
    return list.slice(0, 50);
  }, [products, query]);

  // Reset highlight when matches change so arrow-keying always starts at top.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function pick(p: ComboProduct | null) {
    onSelect(p?.id ?? null);
    setQuery('');
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    // +1 row when allowCustom (the "Custom — type your own" entry).
    const total = matches.length + (allowCustom ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (total === 0 ? 0 : (h + 1) % total));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (total === 0 ? 0 : (h - 1 + total) % total));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allowCustom && highlight === 0) pick(null);
      else {
        const idx = allowCustom ? highlight - 1 : highlight;
        const p = matches[idx];
        if (p) pick(p);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // What's shown in the input when the popover is closed: the selected
  // product's name, OR placeholder. When opened we clear it so the rep
  // can type a fresh query without first manually erasing.
  const displayValue = open ? query : selected ? selected.name : '';

  return (
    <div className="combobox" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        className="combobox-input"
        value={displayValue}
        placeholder={selected ? selected.name : placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
      />
      {selected && !open && (
        <button
          type="button"
          className="combobox-clear"
          onClick={(e) => {
            e.preventDefault();
            pick(null);
            inputRef.current?.focus();
          }}
          aria-label="Clear selection"
          title="Clear"
        >
          ×
        </button>
      )}
      {open && (
        <ul className="combobox-list" role="listbox">
          {allowCustom && (
            <li
              role="option"
              aria-selected={highlight === 0}
              className={`combobox-item ${highlight === 0 ? 'active' : ''}`}
              onMouseEnter={() => setHighlight(0)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(null);
              }}
            >
              <span className="combobox-item-name">Custom — type your own</span>
              <span className="combobox-item-meta muted">free-form line</span>
            </li>
          )}
          {matches.length === 0 && !allowCustom && (
            <li className="combobox-empty muted">No matches.</li>
          )}
          {matches.map((p, i) => {
            const idx = i + (allowCustom ? 1 : 0);
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={highlight === idx}
                className={`combobox-item ${highlight === idx ? 'active' : ''}`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <span className="combobox-item-name">{p.name}</span>
                <span className="combobox-item-meta muted">
                  {p.category ?? '—'}
                  {' · '}
                  {dollars(p.defaultUnitPriceCents)}
                  {p.unit ? `/${p.unit}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
