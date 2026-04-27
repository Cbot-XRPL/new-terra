import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/pageMeta';

// Service detail content lives here (not in the DB) — these pages are
// long-form marketing copy curated by the owner, not user-generated.
// The portfolio projects rendered at the bottom DO come from the DB,
// keyed off matching `categoryFilter` against project.serviceCategory.
interface ServiceContent {
  slug: string;
  title: string;
  tagline: string;
  hero: string;
  // Used to filter /api/public/portfolio?category=... — must match the
  // serviceCategory string admin sets on projects (case-sensitive, free
  // text, but conventionally the same strings shown on the home page).
  categoryFilter: string;
  intro: string;
  bullets: string[];
  faqs: { q: string; a: string }[];
}

const SERVICES: ServiceContent[] = [
  {
    slug: 'remodeling',
    title: 'Remodeling & New Construction',
    tagline: 'Whole-house remodels, additions, and ground-up new builds.',
    hero: '/media/siding.png',
    categoryFilter: 'Remodeling',
    intro:
      'Whether you\'re reimagining a single room, finishing a basement, or building from foundation to finish, we manage the trades, schedule, and permits so you can focus on the result. Every project is run through our customer portal — invoices, schedules, change orders, and progress photos all in one place.',
    bullets: [
      'Framing, drywall, electrical, plumbing, HVAC, roofing',
      'Full kitchen and bath remodels',
      'Basement finishing and additions',
      'Permitted, insured, and licensed in our service area',
      'Fixed-price and time-and-materials options',
    ],
    faqs: [
      { q: 'Do you handle permits?', a: 'Yes. Permit fees are itemized in your estimate and we coordinate inspections.' },
      { q: 'Can I live in the home during the remodel?', a: 'For most projects, yes. We dust-isolate work zones and schedule loud demo for daytime hours.' },
      { q: 'How long does a typical kitchen take?', a: 'Most kitchens run 4–8 weeks once cabinets and countertops are on site. We provide a detailed schedule before demo.' },
    ],
  },
  {
    slug: 'decks',
    title: 'Custom Decks',
    tagline: 'Composite, pressure-treated, and screen-porch builds.',
    hero: '/media/deck.png',
    categoryFilter: 'Decks',
    intro:
      'From a simple back-step deck to multi-level outdoor living spaces with screen rooms, lighting, and under-decking. We use Trex, TimberTech, and PT lumber depending on your budget and design.',
    bullets: [
      'Composite (Trex, TimberTech, AZEK) and PT lumber',
      'Covered decks, screen porches, pergolas',
      'Under-decking systems for dry storage',
      'Built-in benches, planters, and lighting',
      'Engineered for snow load and railing code compliance',
    ],
    faqs: [
      { q: 'How long does a deck take?', a: 'Most decks take 1–3 weeks once materials are on site, weather depending.' },
      { q: 'Do composite decks really not fade?', a: 'Top-line composites (Trex Transcend, TimberTech AZEK) carry 25–50 year fade and stain warranties — we install per spec to keep those active.' },
    ],
  },
  {
    slug: 'fencing',
    title: 'Fencing',
    tagline: 'Wood, vinyl, and aluminum fencing for privacy, pets, and curb appeal.',
    hero: '/media/fence.png',
    categoryFilter: 'Fencing',
    intro:
      'Fence layouts, materials, and gate hardware vary widely — we walk your property, check setbacks and HOA rules, and call in utility locates before any post goes in. Most residential fences are installed in 1–3 days.',
    bullets: [
      'Wood (cedar, PT pine), vinyl, and aluminum',
      'Dog-ear, capped, scalloped, and Dato-post styles',
      'Single, double, and walk gates with self-closing hinges',
      'Utility locates handled (free 811 call)',
      'HOA-compliant designs available',
    ],
    faqs: [
      { q: 'How tall can the fence be?', a: 'Most jurisdictions allow 6\' in back yards and 4\' in front yards. We confirm with your HOA and county before pulling permits.' },
      { q: 'Can you tie into my neighbor\'s existing fence?', a: 'Yes — we coordinate with you on the property line and ensure the post layout works for both sides.' },
    ],
  },
  {
    slug: 'hardscape',
    title: 'Hardscape Design',
    tagline: 'Patios, walkways, retaining walls, fire pits, and stone seating.',
    hero: '/media/patio2.png',
    categoryFilter: 'Hardscape',
    intro:
      'Hardscape transforms an outdoor space year-round. We work with pavers, stamped concrete, flagstone, and natural stone — including drainage, base prep, and edge restraint that holds up to freeze/thaw.',
    bullets: [
      'Paver, flagstone, and stamped concrete patios',
      'Walkways, steps, and driveways',
      'Retaining walls (segmental and natural stone)',
      'Fire pits, fireplaces, and built-in seating',
      'French drains and surface drainage',
    ],
    faqs: [
      { q: 'Will pavers shift over time?', a: 'Not when installed correctly. We compact a 6"+ aggregate base, use proper edge restraint, and polymeric sand to lock joints.' },
      { q: 'Can I add a fire pit later?', a: 'Yes — we design the patio so a fire feature can drop in cleanly down the road.' },
    ],
  },
  {
    slug: 'landscape',
    title: 'Landscape Design',
    tagline: 'Plantings, irrigation, lighting, and mulch / bed install.',
    hero: '/media/garden.jpg',
    categoryFilter: 'Landscape',
    intro:
      'We round out the build by softening hardscape with curated plantings — natives where they thrive, accents where they pop. Drip irrigation and low-voltage lighting are designed in from the start so you\'re not retro-fitting later.',
    bullets: [
      'Foundation plantings and accent beds',
      'Drip irrigation and rotor systems',
      'Low-voltage path and uplight installations',
      'Bed prep, edging, and mulching',
      'Native and pollinator-friendly options',
    ],
    faqs: [
      { q: 'Can you maintain the landscape afterward?', a: 'We focus on installation. We can recommend a maintenance partner once your install is done.' },
      { q: 'Do you handle grading and drainage?', a: 'Yes — drainage is the first thing we check on any landscape project.' },
    ],
  },
];

interface PortfolioCard {
  slug: string;
  title: string;
  serviceCategory: string | null;
  publicSummary: string | null;
  city: string | null;
  state: string | null;
  heroThumbnailUrl: string | null;
  photoCount: number;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export default function ServiceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const service = useMemo(() => SERVICES.find((s) => s.slug === slug), [slug]);
  const [recent, setRecent] = useState<PortfolioCard[]>([]);

  usePageMeta({
    title: service?.title ?? 'Services',
    description: service?.tagline,
    image: service?.hero,
    jsonLd: service ? {
      '@context': 'https://schema.org',
      '@type': 'Service',
      serviceType: service.title,
      provider: { '@type': 'GeneralContractor', name: 'New Terra Construction' },
      description: service.intro,
    } : null,
  });

  useEffect(() => {
    if (!service) return;
    fetch(`${API_BASE}/api/public/portfolio?category=${encodeURIComponent(service.categoryFilter)}`)
      .then((r) => r.ok ? r.json() : { projects: [] })
      .then((b: { projects: PortfolioCard[] }) => setRecent((b.projects ?? []).slice(0, 3)))
      .catch(() => setRecent([]));
  }, [service]);

  if (!service) return <Navigate to="/" replace />;

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <p className="muted" style={{ marginBottom: '0.5rem' }}>
        <Link to="/#services">← all services</Link>
      </p>

      <header className="service-hero">
        <div>
          <span className="tag">{service.tagline}</span>
          <h1>{service.title}</h1>
          <p style={{ fontSize: '1.1rem', lineHeight: 1.6 }}>{service.intro}</p>
          <Link
            to={`/start?service=${encodeURIComponent(service.categoryFilter)}`}
            className="button"
          >
            Get a free estimate
          </Link>
        </div>
        <img src={service.hero} alt={service.title} />
      </header>

      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2>What&rsquo;s included</h2>
        <ul className="service-bullets">
          {service.bullets.map((b) => <li key={b}>{b}</li>)}
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2>Recent {service.title.toLowerCase()} projects</h2>
          <div className="portfolio-grid">
            {recent.map((p) => (
              <Link to={`/portfolio/${p.slug}`} key={p.slug} className="portfolio-card">
                <div className="portfolio-card-img">
                  {p.heroThumbnailUrl
                    ? <img src={p.heroThumbnailUrl} alt={p.title} loading="lazy" />
                    : <div className="portfolio-card-placeholder">📐</div>}
                </div>
                <div className="portfolio-card-body">
                  <h3>{p.title}</h3>
                  {p.publicSummary && <p className="muted">{p.publicSummary}</p>}
                  {p.city && p.state && (
                    <div className="portfolio-meta"><span>{p.city}, {p.state}</span></div>
                  )}
                </div>
              </Link>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to={`/portfolio?category=${encodeURIComponent(service.categoryFilter)}`} className="button-ghost button-small">
              See all {service.title.toLowerCase()}
            </Link>
          </p>
        </section>
      )}

      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Frequently asked</h2>
        <dl className="service-faqs">
          {service.faqs.map((f) => (
            <div key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
        <h2>Ready to talk through your {service.title.toLowerCase()} project?</h2>
        <p className="muted">Free estimate, no obligation. Most callbacks within 24 hours.</p>
        <Link
          to={`/start?service=${encodeURIComponent(service.categoryFilter)}`}
          className="button"
        >
          Start your project
        </Link>
      </section>
    </main>
  );
}
