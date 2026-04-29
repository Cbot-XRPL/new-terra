import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';

// Small fixed set covering the common social-media reactions. Keeping the
// list tight so the popover stays compact and doesn't need a search box.
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '✅', '❓', '💯'];

interface Props {
  onPick: (emoji: string) => void;
}

export default function EmojiPicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="emoji-picker" ref={containerRef}>
      <button
        type="button"
        className="button-ghost button-small emoji-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label="Insert emoji"
        title="Insert emoji"
      >
        <Smile size={16} />
      </button>
      {open && (
        <div className="emoji-popover" role="menu">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="emoji-option"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              role="menuitem"
              aria-label={`Insert ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
