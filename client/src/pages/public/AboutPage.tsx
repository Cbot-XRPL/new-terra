import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/pageMeta';

interface Stats {
  completedProjects: number;
  yearsInBusiness: number | null;
  averageScore: number | null;
  surveyResponses: number;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export default function AboutPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  usePageMeta({
    title: 'About New Terra',
    description: 'Locally-owned and operated. We build decks, fences, patios, and remodels with the same care we\'d give our own homes.',
  });

  useEffect(() => {
    fetch(`${API_BASE}/api/public/stats`)
      .then((r) => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <span className="tag">About</span>
        <h1>Built locally. Built right.</h1>
      </header>

      <section className="card">
        <p style={{ fontSize: '1.1rem', lineHeight: 1.7 }}>
          New Terra Construction is a locally-owned general contractor specializing in
          custom decks, fencing, hardscape, landscape, and full-service remodels.
          Every project &mdash; from a backyard fence to a finished basement &mdash; gets the
          same attention to materials, schedule, and craftsmanship.
        </p>
        <p style={{ fontSize: '1.05rem', lineHeight: 1.7, marginTop: '1rem' }}>
          We run our jobs through a customer portal so you always know what's
          scheduled, what's been done, and what's invoiced. No black box,
          no chasing for updates &mdash; you have the same view we do.
        </p>
      </section>

      {stats && (stats.completedProjects > 0 || stats.surveyResponses > 0) && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2>By the numbers</h2>
          <div className="trust-stats">
            {stats.completedProjects > 0 && (
              <div>
                <div className="trust-value">{stats.completedProjects}+</div>
                <div className="trust-label">Projects completed</div>
              </div>
            )}
            {stats.yearsInBusiness != null && (
              <div>
                <div className="trust-value">{stats.yearsInBusiness}+</div>
                <div className="trust-label">Years in business</div>
              </div>
            )}
            {stats.averageScore != null && (
              <div>
                <div className="trust-value">{stats.averageScore.toFixed(1)}/10</div>
                <div className="trust-label">Avg customer rating</div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2>What we believe</h2>
        <ul className="service-bullets">
          <li>Show up when we say we will</li>
          <li>Use materials we'd put in our own homes</li>
          <li>Keep the job site clean every single day</li>
          <li>Keep the customer informed in real time</li>
          <li>Stand behind the work after the final invoice</li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
        <h2>Want to see how it works?</h2>
        <p className="muted">
          Walk through our <Link to="/process">process</Link> or jump straight to a{' '}
          <Link to="/start">free estimate</Link>.
        </p>
      </section>
    </main>
  );
}
