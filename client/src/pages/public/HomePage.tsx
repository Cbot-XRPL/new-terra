import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUSINESS_JSON_LD, usePageMeta } from '../../lib/pageMeta';

const services = [
  {
    img: '/media/siding.png',
    slug: 'remodeling',
    title: 'Remodeling & New Construction',
    body: 'From new home builds to interior transformations: framing, electrical, plumbing, HVAC, drywall, roofing, gutters, doors, windows, flooring, kitchens, baths, and basements.',
  },
  {
    img: '/media/deck.png',
    slug: 'decks',
    title: 'Custom Decks',
    body: 'Deck renovation, covered decks, screen porches, and under-decking systems built with high-quality materials and modern techniques.',
  },
  {
    img: '/media/fence.png',
    slug: 'fencing',
    title: 'Fencing',
    body: 'Wood, vinyl, and aluminum fences for security, privacy, and curb appeal — dog-ear, capped, scalloped, Dato post, and railing options.',
  },
  {
    img: '/media/patio2.png',
    slug: 'hardscape',
    title: 'Hardscape Design',
    body: 'Patios, walkways, retaining walls, fire pits, and stone seating using pavers, stamped concrete, and flagstone.',
  },
  {
    img: '/media/garden.jpg',
    slug: 'landscape',
    title: 'Landscape Design',
    body: 'Irrigation, landscape lighting, design, plant and bed installation — bridging construction and landscaping under one agreement.',
  },
];

// Fallback testimonials (shown only on a fresh install before any
// approved customer surveys exist). Once the satisfaction-survey pipeline
// produces approved quotes, those replace these.
const fallbackReviews = [
  {
    quote: 'New Terra Construction has completed several jobs for us with beautiful results. Pool surround deck with trex, screen porch, basement remodel, and next up an addition to our home. Cody and Nick are fantastic with communication, always show up on time, and finish on schedule. 100% recommend.',
    attribution: 'Elizabeth Cobleigh',
    score: null as number | null,
    portfolioSlug: null as string | null,
    projectName: null as string | null,
  },
  {
    quote: 'Great experience with Cody and his team! They installed a privacy fence with multiple gates in a couple of days despite poor weather. The fence turned out perfect — so nice to have a safe space for my dogs. Highly recommend.',
    attribution: 'Natalie Carrillo',
    score: null,
    portfolioSlug: null,
    projectName: null,
  },
];

interface Testimonial {
  score: number | null;
  quote: string;
  attribution: string | null;
  projectName: string | null;
  portfolioSlug: string | null;
}

interface Stats {
  completedProjects: number;
  activeCustomers: number;
  averageScore: number | null;
  surveyResponses: number;
  yearsInBusiness: number | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export default function HomePage() {
  const [testimonials, setTestimonials] = useState<Testimonial[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  usePageMeta({
    title: 'New Terra Construction',
    description: 'Decks, fencing, hardscape, landscaping, and full-service remodels. Free estimates, licensed and insured.',
    image: '/media/patio.jpg',
    jsonLd: BUSINESS_JSON_LD,
  });

  useEffect(() => {
    // Both endpoints are public + cached at the CDN tier — failure is
    // non-fatal, we just fall back to the static copy.
    fetch(`${API_BASE}/api/public/testimonials?limit=3`)
      .then((r) => r.ok ? r.json() : { testimonials: [] })
      .then((b: { testimonials: Testimonial[] }) => setTestimonials(b.testimonials))
      .catch(() => setTestimonials([]));
    fetch(`${API_BASE}/api/public/stats`)
      .then((r) => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  // Use real testimonials when admin has approved at least one; otherwise
  // keep the hand-curated fallback so the page never looks empty.
  const reviews = testimonials && testimonials.length > 0
    ? testimonials
    : fallbackReviews;

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <span className="hero-area">📍 Serving the metro Atlanta area</span>
          <h1>Providing the ultimate building experience</h1>
          <p className="hero-sub">
            Decks, fences, hardscape, landscape, and full-service remodels —
            built clean, on schedule, and inside a portal you actually use.
          </p>
          <div className="hero-ctas">
            <Link to="/start" className="button button-primary">Get a free estimate</Link>
            <a className="button button-ghost-light" href="tel:6782079719">📞 (678) 207-9719</a>
          </div>
          {stats && stats.completedProjects > 0 && (
            <p className="hero-trust">
              {stats.completedProjects}+ projects completed
              {stats.averageScore != null && ` · ${stats.averageScore.toFixed(1)}/10 avg`}
              {stats.yearsInBusiness != null && ` · ${stats.yearsInBusiness}+ years in business`}
            </p>
          )}
        </div>
      </section>

      {stats && (stats.completedProjects > 0 || stats.surveyResponses > 0) && (
        <section className="band band-light trust-band">
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
                <div className="trust-label">Avg customer rating ({stats.surveyResponses})</div>
              </div>
            )}
            {stats.activeCustomers > 0 && (
              <div>
                <div className="trust-value">{stats.activeCustomers}+</div>
                <div className="trust-label">Happy homeowners</div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="band band-dark">
        <div className="two-col">
          <div className="copy">
            <span className="tag">Welcome to New Terra Construction</span>
            <h2>Expert construction services</h2>
            <p>
              We specialize in exceptional craftsmanship and attention to detail. With our team of
              skilled professionals and our commitment to exceeding expectations, we bring your
              vision to life — whether you're building new, remodeling your interior, or expanding
              your outdoor living space.
            </p>
            <a className="button" href="tel:6782079719">Call Now</a>
          </div>
          <img src="/media/patio.jpg" alt="Recent patio install" className="band-image" />
        </div>
      </section>

      <section className="band band-accent">
        <div className="feature-grid">
          <Feature icon="/media/truck.svg" title="Fast Service">
            Always available to provide estimates, book services, and answer questions.
          </Feature>
          <Feature icon="/media/register.svg" title="Secure Payments">
            ACH, Zelle, or credit card (3.5% fee). Cash and checks accepted.
          </Feature>
          <Feature icon="/media/cube.svg" title="Quality Materials">
            Top-quality materials sourced through our trusted vendor network.
          </Feature>
          <Feature icon="/media/people.svg" title="Expert Team">
            Trained, hard-working, and respectful of your home.
          </Feature>
        </div>
      </section>

      <section id="services" className="band band-dark">
        <span className="tag">Our Services</span>
        <h2>What we offer</h2>
        <p className="muted">
          Customer satisfaction is our priority. We guarantee to fulfill the terms of every
          agreement.
        </p>
        <div className="service-grid">
          {services.map((s) => (
            <Link key={s.title} to={`/services/${s.slug}`} className="service-card service-card-link">
              <img src={s.img} alt={s.title} />
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <span className="service-card-cta">Learn more →</span>
            </Link>
          ))}
        </div>
        <p style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <Link to="/portfolio" className="button button-ghost">See recent work →</Link>
        </p>
      </section>

      <section id="about" className="band band-accent">
        <h2>What customers say</h2>
        <div className="review-grid">
          {reviews.map((r, i) => (
            <blockquote key={r.attribution ?? i} className="review">
              <p>"{r.quote}"</p>
              <cite>
                — {r.attribution ?? 'Customer'}
                {r.score != null && ` · ${r.score}/10`}
                {r.portfolioSlug && r.projectName && (
                  <>
                    {' · '}
                    <Link to={`/portfolio/${r.portfolioSlug}`}>{r.projectName}</Link>
                  </>
                )}
              </cite>
            </blockquote>
          ))}
        </div>
      </section>

      <section className="band band-dark">
        <h2>Ready to start your next project?</h2>
        <p className="muted">Schedule your free estimate today.</p>
        <Link to="/contact" className="button">Get in touch</Link>
      </section>
    </>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="feature">
      <img src={icon} alt="" aria-hidden />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
