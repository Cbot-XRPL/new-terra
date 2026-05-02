// Image slot used across tool cards (calculator hero, sketcher card,
// visual estimator scene). Two jobs:
//
//   1. If a generated image exists at /uploads/generated/<slug>.json,
//      render it.
//   2. Otherwise fall back to the committed static WebP at
//      /media/tools/<slug-with-underscores>.webp.
//
// Regenerating images is now a script-only flow — see
// scripts/generateToolImages.mjs + scripts/compressToolImages.mjs.

import { useEffect, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

interface SlotIndex {
  url: string;
}

interface Props {
  slug: string;
  alt: string;
  aspect?: string;
}

function indexUrl(slug: string): string {
  return `/uploads/generated/${slug}.json`;
}

export default function ToolImageSlot({ slug, alt, aspect = '16/9' }: Props) {
  const [index, setIndex] = useState<SlotIndex | null>(null);

  useEffect(() => {
    let ignored = false;
    fetch(`${API_BASE}${indexUrl(slug)}?t=${Date.now()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        if (!ignored && j && typeof j.url === 'string') setIndex(j as SlotIndex);
      })
      .catch(() => undefined);
    return () => {
      ignored = true;
    };
  }, [slug]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: aspect,
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--bg-elevated) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {index ? (
        <img
          src={`${API_BASE}${index.url}`}
          alt={alt}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <StaticOrPlaceholder slug={slug} alt={alt} />
      )}
    </div>
  );
}

function StaticOrPlaceholder({ slug, alt }: { slug: string; alt: string }) {
  const flat = slug.replace(/\//g, '_');
  const src = `/media/tools/${flat}.webp`;
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <span className="muted" style={{ fontSize: '0.85rem', textAlign: 'center', padding: '0.5rem' }}>
        {alt}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setMissing(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
