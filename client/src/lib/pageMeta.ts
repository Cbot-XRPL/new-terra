import { useEffect } from 'react';

interface PageMeta {
  title: string;
  description?: string;
  // Absolute or root-relative path used for og:image. Falls back to the
  // shared logo when omitted.
  image?: string | null;
  // Stringified JSON-LD object (or array). Injected as a single <script>
  // tag and removed when the component unmounts so subsequent pages
  // don't accumulate stale schema.
  jsonLd?: object | object[] | null;
}

const SITE_NAME = 'New Terra Construction';
const DEFAULT_IMAGE = '/media/logo.png';

// Each meta key gets its own data-* tag so we can safely upsert it
// without colliding with the static tags hard-coded into index.html.
const MANAGED_ATTR = 'data-pm';

function upsertMeta(key: string, attr: 'name' | 'property', value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${MANAGED_ATTR}="${key}"]`,
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(MANAGED_ATTR, key);
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

// Tracks the JSON-LD <script> we injected so the cleanup callback can
// remove the right one when the component re-runs or unmounts.
const JSONLD_ID = 'pm-jsonld';

// Hook that updates document.title + meta description + OpenGraph + canonical
// + optional JSON-LD on mount, then strips the JSON-LD on unmount. Static
// meta tags in index.html are left alone.
export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    const fullTitle = meta.title.includes(SITE_NAME)
      ? meta.title
      : `${meta.title} · ${SITE_NAME}`;
    document.title = fullTitle;

    if (meta.description) {
      upsertMeta('description', 'name', meta.description);
      upsertMeta('og:description', 'property', meta.description);
      upsertMeta('twitter:description', 'name', meta.description);
    }
    upsertMeta('og:title', 'property', fullTitle);
    upsertMeta('og:site_name', 'property', SITE_NAME);
    upsertMeta('og:type', 'property', 'website');
    upsertMeta('twitter:card', 'name', 'summary_large_image');
    upsertMeta('twitter:title', 'name', fullTitle);
    const img = meta.image ?? DEFAULT_IMAGE;
    // og:image works best as an absolute URL; resolve against the current
    // origin so previews work whether the path is absolute or root-relative.
    const absImg = /^https?:\/\//.test(img)
      ? img
      : `${window.location.origin}${img.startsWith('/') ? '' : '/'}${img}`;
    upsertMeta('og:image', 'property', absImg);
    upsertMeta('twitter:image', 'name', absImg);

    upsertCanonical(window.location.origin + window.location.pathname);

    let scriptEl: HTMLScriptElement | null = null;
    if (meta.jsonLd) {
      scriptEl = document.createElement('script');
      scriptEl.type = 'application/ld+json';
      scriptEl.id = JSONLD_ID;
      scriptEl.text = JSON.stringify(meta.jsonLd);
      // Remove any prior JSON-LD before appending so navigations don't
      // accumulate them.
      document.head.querySelectorAll(`#${JSONLD_ID}`).forEach((n) => n.remove());
      document.head.appendChild(scriptEl);
    }

    return () => {
      // On unmount, strip just the JSON-LD. Title + OG tags will be
      // overwritten by the next page's hook call, and we leave them
      // pointing at the previous page until then (better than blanking).
      if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
    };
  }, [meta.title, meta.description, meta.image, meta.jsonLd]);
}

// Convenience: a curated baseline JSON-LD LocalBusiness object for the
// company. Consumers can extend with sameAs / address overrides.
export const BUSINESS_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'GeneralContractor',
  name: SITE_NAME,
  description: 'Custom decks, fencing, hardscape, landscaping, and remodeling.',
  telephone: '+1-678-207-9719',
  url: typeof window !== 'undefined' ? window.location.origin : '',
  image: typeof window !== 'undefined' ? `${window.location.origin}/media/logo.png` : '/media/logo.png',
  priceRange: '$$',
};
