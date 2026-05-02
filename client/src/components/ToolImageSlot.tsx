// Image slot used across tool cards (calculator hero, sketcher card,
// visual estimator scene). Three jobs:
//
//   1. If a generated image exists at /uploads/generated/<slug>.png,
//      render it.
//   2. Otherwise render a styled placeholder.
//   3. If the caller is an admin, expose a "Generate" button that hits
//      the OpenAI image-gen endpoint with a prompt seeded from the
//      slug, saves the result, and refreshes the slot.
//
// The convention: a slot's slug doubles as the folder + filename under
// uploads/generated/, e.g. "tools/floor-sketch" → uploads/generated/
// tools/floor-sketch.png. The /generate endpoint already saves under
// uploads/generated/<folder>/<stamp>-<tag>.png, so the slot also keeps
// a small index file (uploads/generated/<slug>.json) recording the
// chosen filename — that way regenerating the slot updates one
// pointer instead of overwriting the original.

import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

interface SlotIndex {
  url: string;
  prompt?: string;
  generatedAt?: string;
}

interface Props {
  slug: string;            // "tools/floor-sketch", "calculators/concrete", etc.
  alt: string;
  // CSS aspect ratio token, e.g. "16/9" or "1/1".
  aspect?: string;
  // Default prompt seed. Admin can edit before generating.
  defaultPrompt?: string;
}

function indexUrl(slug: string): string {
  return `/uploads/generated/${slug}.json`;
}

export default function ToolImageSlot({
  slug,
  alt,
  aspect = '16/9',
  defaultPrompt,
}: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [index, setIndex] = useState<SlotIndex | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt ?? defaultPromptForSlug(slug));
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  // Load the slot's index file. Use a no-cache fetch so admin sees
  // freshly-generated images without a hard-refresh.
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

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const r = await api<{ url: string; revisedPrompt: string | null }>(
        '/api/integrations/image-gen/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: prompt.trim(),
            // Folder + tag derived from slug so the file lands at
            // uploads/generated/<folder>/<stamp>-<tag>.png.
            folder: slug.includes('/') ? slug.split('/')[0] : 'misc',
            tag: slug.includes('/') ? slug.split('/').slice(-1)[0] : slug,
            size: aspect === '16/9'
              ? '1536x1024'
              : aspect === '9/16'
                ? '1024x1536'
                : '1024x1024',
          }),
        },
      );
      // Pin the chosen image to a small JSON pointer at the slot's
      // index URL so subsequent renders pick it up. We POST to a tiny
      // helper endpoint mounted alongside image-gen.
      await api('/api/integrations/image-gen/slot', {
        method: 'POST',
        body: JSON.stringify({ slug, url: r.url, prompt }),
      });
      setIndex({ url: r.url, prompt, generatedAt: new Date().toISOString() });
      setShowPrompt(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not generate — check OPENAI_API_KEY in .env',
      );
    } finally {
      setGenerating(false);
    }
  }

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
        <StaticOrPlaceholder slug={slug} alt={alt} isAdmin={isAdmin} />
      )}

      {isAdmin && (
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 6,
            display: 'flex',
            gap: 4,
            zIndex: 1,
          }}
          // Stop the parent <Link>'s click from swallowing button taps.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {!showPrompt ? (
            <button
              type="button"
              className="button-ghost button-small"
              style={{ padding: '2px 8px', background: 'rgba(0,0,0,0.45)', color: '#fff' }}
              onClick={() => {
                setShowPrompt(true);
                setTimeout(() => promptRef.current?.focus(), 0);
              }}
            >
              {index ? 'Regenerate' : 'Generate'}
            </button>
          ) : null}
        </div>
      )}

      {showPrompt && isAdmin && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            zIndex: 2,
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <strong style={{ color: '#fff', fontSize: '0.85rem' }}>Prompt</strong>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{ width: '100%', margin: 0, fontSize: '0.8rem' }}
          />
          {error && <div className="form-error" style={{ fontSize: '0.75rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="button-small"
              onClick={generate}
              disabled={generating || !prompt.trim()}
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => setShowPrompt(false)}
              disabled={generating}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Static fallback — every slot has a corresponding committed PNG at
// /media/tools/<slug-with-underscores>.png that ships with the build.
// We try that first; if the file doesn't exist (or 404s), we fall
// through to the muted placeholder copy. The slash→underscore swap is
// because Vite's public/ folder serves files flat per directory and
// we keep all tool images in one bucket.
function StaticOrPlaceholder({
  slug,
  alt,
  isAdmin,
}: {
  slug: string;
  alt: string;
  isAdmin: boolean;
}) {
  const flat = slug.replace(/\//g, '_');
  // Committed assets ship as WebP (~40 KB vs ~2 MB PNG). Same filename
  // pattern, just .webp. The slot's image-gen flow still produces PNGs
  // on demand for admin regens — that path uses the index pointer
  // (above), not this static fallback.
  const src = `/media/tools/${flat}.webp`;
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <span className="muted" style={{ fontSize: '0.85rem', textAlign: 'center', padding: '0.5rem' }}>
        {alt}
        {isAdmin && (
          <>
            <br />
            <em style={{ fontSize: '0.75rem' }}>(admin: generate an illustration)</em>
          </>
        )}
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

// Reasonable default prompt seeded from the slot's slug. Admin can
// freely edit before generating. Style is tight + warm + isometric so
// the whole site shares a visual vocabulary; tweak per slot.
function defaultPromptForSlug(slug: string): string {
  const last = slug.split('/').pop() ?? slug;
  const human = last.replace(/[-_]/g, ' ');
  return [
    `Isometric illustration of a residential construction "${human}" tool icon for a contractor portal.`,
    'Warm wood + matte steel palette, soft studio lighting, deep navy background.',
    'No text, no logos, no people. Tight composition with clean negative space.',
    'Style: digital editorial, slightly stylized, photoreal materials.',
  ].join(' ');
}
