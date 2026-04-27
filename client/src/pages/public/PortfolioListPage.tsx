import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/pageMeta';

interface Card {
  slug: string;
  title: string;
  serviceCategory: string | null;
  publicSummary: string | null;
  city: string | null;
  state: string | null;
  completedAt: string | null;
  heroImageUrl: string | null;
  heroThumbnailUrl: string | null;
  photoCount: number;
}

interface Resp {
  projects: Card[];
  categories: string[];
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Public portfolio listing — drives prospects through filterable cards.
// Filter chips + the "no projects yet" empty state are the only
// not-immediately-obvious bits.
export default function PortfolioListPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const category = params.get('category');

  usePageMeta({
    title: category ? `${category} projects` : 'Recent work',
    description: 'A look at recent New Terra Construction projects — decks, fences, patios, remodels, and landscapes built for happy customers.',
  });

  useEffect(() => {
    const url = category
      ? `${API_BASE}/api/public/portfolio?category=${encodeURIComponent(category)}`
      : `${API_BASE}/api/public/portfolio`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load portfolio');
        return (await res.json()) as Resp;
      })
      .then(setData)
      .catch(() => setError('Could not load the portfolio. Please try again.'));
  }, [category]);

  // Always show every category as a filter chip even if the current filter
  // narrows the project list — keeps "category not on this page" reachable.
  const allCategories = useMemo(() => data?.categories ?? [], [data]);

  if (error) {
    return (
      <main style={{ maxWidth: 800, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <p className="muted">{error}</p>
      </main>
    );
  }
  if (!data) {
    return <main style={{ padding: '2rem', textAlign: 'center' }}><p className="muted">Loading…</p></main>;
  }

  return (
    <main style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.5rem' }}>Recent work</h1>
        <p className="muted">
          A handful of projects we&rsquo;ve completed for happy customers. Tap one to see
          before / after photos and the story behind the build.
        </p>
      </header>

      {allCategories.length > 0 && (
        <div className="portfolio-chips">
          <button
            type="button"
            className={`button-ghost button-small${!category ? ' is-active' : ''}`}
            onClick={() => setParams({})}
          >
            All work
          </button>
          {allCategories.map((c) => (
            <button
              key={c}
              type="button"
              className={`button-ghost button-small${category === c ? ' is-active' : ''}`}
              onClick={() => setParams({ category: c })}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {data.projects.length === 0 ? (
        <section className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h2>Portfolio coming soon.</h2>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            We&rsquo;re a busy builder &mdash; new completed projects roll in every few weeks.
          </p>
          <Link to="/start" className="button">Start a project</Link>
        </section>
      ) : (
        <div className="portfolio-grid">
          {data.projects.map((p) => (
            <Link to={`/portfolio/${p.slug}`} key={p.slug} className="portfolio-card">
              <div className="portfolio-card-img">
                {p.heroThumbnailUrl ? (
                  <img src={p.heroThumbnailUrl} alt={p.title} loading="lazy" />
                ) : (
                  <div className="portfolio-card-placeholder">📐</div>
                )}
              </div>
              <div className="portfolio-card-body">
                {p.serviceCategory && (
                  <span className="portfolio-tag">{p.serviceCategory}</span>
                )}
                <h3>{p.title}</h3>
                {p.publicSummary && <p className="muted">{p.publicSummary}</p>}
                <div className="portfolio-meta">
                  {p.city && p.state && <span>{p.city}, {p.state}</span>}
                  {p.photoCount > 0 && <span>{p.photoCount} photo{p.photoCount === 1 ? '' : 's'}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
