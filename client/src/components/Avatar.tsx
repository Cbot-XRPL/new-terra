import { useState } from 'react';

interface Props {
  name: string;
  url?: string | null;
  // CSS size in pixels — applied to width and height. Default 36 fits the nav.
  size?: number;
  // Override the className for layout-specific spacing.
  className?: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Stable hue per name so the same person renders the same fallback colour
// across the whole app.
function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export default function Avatar({ name, url, size = 36, className = '' }: Props) {
  const [imageBroken, setImageBroken] = useState(false);
  const initials = initialsOf(name);
  const hue = hueOf(name);
  const showImage = !!url && !imageBroken;
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        // Initials background — soft tinted with a deeper foreground.
        background: showImage ? 'var(--surface)' : `hsl(${hue} 55% 30%)`,
        color: `hsl(${hue} 75% 85%)`,
        fontSize: Math.max(11, Math.round(size * 0.36)),
      }}
      aria-label={name}
      title={name}
    >
      {showImage ? (
        <img
          src={url!}
          alt=""
          onError={() => setImageBroken(true)}
          loading="lazy"
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
