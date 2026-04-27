import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/pageMeta';

interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mediumUrl: string | null;
  caption: string | null;
  phase: string | null;
  at: string;
}

interface Detail {
  slug: string;
  title: string;
  serviceCategory: string | null;
  publicSummary: string | null;
  city: string | null;
  state: string | null;
  startedAt: string | null;
  completedAt: string | null;
  photos: Photo[];
  heroImageId: string | null;
  testimonial: { score: number | null; quote: string; attribution: string | null } | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Public portfolio entry — hero shot up top, optional before/after slider
// when the photos are tagged, then the rest as a tap-to-enlarge grid,
// and (optional) the customer testimonial under it. Bottom CTA pushes to
// /start with the service category prefilled.
export default function PortfolioDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`${API_BASE}/api/public/portfolio/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) { setError('That project is not available right now.'); return; }
        if (!res.ok) { setError('Could not load this project.'); return; }
        const body = (await res.json()) as Detail;
        setData(body);
      })
      .catch(() => setError('Could not load this project.'));
  }, [slug]);

  const heroForMeta = data?.photos.find((p) => p.id === data?.heroImageId)
    ?? data?.photos.find((p) => (p.phase ?? '').toLowerCase().includes('after'))
    ?? data?.photos[0];

  usePageMeta({
    title: data?.title ?? 'Project',
    description: data?.publicSummary
      ?? (data ? `A ${data.serviceCategory ?? 'recent'} project completed by New Terra Construction.` : undefined),
    image: heroForMeta?.mediumUrl ?? heroForMeta?.url ?? null,
    jsonLd: data ? {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: data.title,
      description: data.publicSummary ?? undefined,
      image: heroForMeta?.mediumUrl ?? heroForMeta?.url ? [heroForMeta!.mediumUrl ?? heroForMeta!.url] : undefined,
      datePublished: data.completedAt ?? undefined,
      author: { '@type': 'Organization', name: 'New Terra Construction' },
    } : null,
  });

  // Pull a matched before/after pair when both phases exist. We use
  // string includes so 'before-demo' or 'after-touchup' still match.
  const beforeAfter = useMemo(() => {
    if (!data) return null;
    const before = data.photos.find((p) => (p.phase ?? '').toLowerCase().includes('before'));
    const after = [...data.photos].reverse().find((p) => (p.phase ?? '').toLowerCase().includes('after'));
    return before && after ? { before, after } : null;
  }, [data]);

  if (error) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <p className="muted">{error}</p>
        <p style={{ marginTop: '1.5rem' }}>
          <Link to="/portfolio">← back to recent work</Link>
        </p>
      </main>
    );
  }
  if (!data) {
    return <main style={{ padding: '2rem', textAlign: 'center' }}><p className="muted">Loading…</p></main>;
  }

  const hero = data.photos.find((p) => p.id === data.heroImageId)
    ?? data.photos.find((p) => (p.phase ?? '').toLowerCase().includes('after'))
    ?? data.photos[0];

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <p className="muted" style={{ marginBottom: '0.5rem' }}>
        <Link to="/portfolio">← back to recent work</Link>
      </p>
      <header style={{ marginBottom: '1.5rem' }}>
        {data.serviceCategory && <span className="portfolio-tag">{data.serviceCategory}</span>}
        <h1 style={{ margin: '0.25rem 0 0.5rem' }}>{data.title}</h1>
        {data.city && data.state && (
          <p className="muted">{data.city}, {data.state}{data.completedAt && ` · completed ${new Date(data.completedAt).toLocaleDateString()}`}</p>
        )}
      </header>

      {hero && (
        <div className="portfolio-hero">
          <img
            src={hero.mediumUrl ?? hero.url}
            alt={hero.caption ?? data.title}
            onClick={() => setLightbox(hero)}
            style={{ cursor: 'zoom-in' }}
          />
        </div>
      )}

      {data.publicSummary && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <p style={{ fontSize: '1.1rem', margin: 0, lineHeight: 1.6 }}>{data.publicSummary}</p>
        </section>
      )}

      {beforeAfter && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2>Before &amp; after</h2>
          <div className="portfolio-ba">
            <figure>
              <img src={beforeAfter.before.mediumUrl ?? beforeAfter.before.url} alt="Before" loading="lazy" onClick={() => setLightbox(beforeAfter.before)} />
              <figcaption>Before</figcaption>
            </figure>
            <figure>
              <img src={beforeAfter.after.mediumUrl ?? beforeAfter.after.url} alt="After" loading="lazy" onClick={() => setLightbox(beforeAfter.after)} />
              <figcaption>After</figcaption>
            </figure>
          </div>
        </section>
      )}

      {data.photos.length > 0 && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2>Project gallery</h2>
          <div className="portfolio-gallery">
            {data.photos.map((p) => (
              <button key={p.id} type="button" onClick={() => setLightbox(p)} className="portfolio-gallery-item">
                <img src={p.thumbnailUrl ?? p.url} alt={p.caption ?? data.title} loading="lazy" />
                {p.phase && <span className="portfolio-tag-small">{p.phase}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {data.testimonial && (
        <section className="card portfolio-testimonial" style={{ marginTop: '1.5rem' }}>
          <blockquote>
            "{data.testimonial.quote}"
            <cite>
              — {data.testimonial.attribution ?? 'Customer'}
              {data.testimonial.score != null && ` · ${data.testimonial.score}/10`}
            </cite>
          </blockquote>
        </section>
      )}

      <section className="card" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
        <h2>Like what you see?</h2>
        <p className="muted">We&rsquo;d love to talk about your project.</p>
        <Link
          to={`/start${data.serviceCategory ? `?service=${encodeURIComponent(data.serviceCategory)}` : ''}`}
          className="button"
        >
          Get in touch
        </Link>
      </section>

      {lightbox && (
        <div className="portfolio-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <img src={lightbox.url} alt={lightbox.caption ?? data.title} />
          {lightbox.caption && <div className="portfolio-lightbox-caption">{lightbox.caption}</div>}
        </div>
      )}
    </main>
  );
}
