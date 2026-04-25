import { Link } from 'react-router-dom';

const services = [
  {
    img: '/media/siding.png',
    title: 'Remodeling & New Construction',
    body: 'From new home builds to interior transformations: framing, electrical, plumbing, HVAC, drywall, roofing, gutters, doors, windows, flooring, kitchens, baths, and basements.',
  },
  {
    img: '/media/deck.png',
    title: 'Custom Decks',
    body: 'Deck renovation, covered decks, screen porches, and under-decking systems built with high-quality materials and modern techniques.',
  },
  {
    img: '/media/fence.png',
    title: 'Fencing',
    body: 'Wood, vinyl, and aluminum fences for security, privacy, and curb appeal — dog-ear, capped, scalloped, Dato post, and railing options.',
  },
  {
    img: '/media/patio2.png',
    title: 'Hardscape Design',
    body: 'Patios, walkways, retaining walls, fire pits, and stone seating using pavers, stamped concrete, and flagstone.',
  },
  {
    img: '/media/garden.jpg',
    title: 'Landscape Design',
    body: 'Irrigation, landscape lighting, design, plant and bed installation — bridging construction and landscaping under one agreement.',
  },
];

const reviews = [
  {
    name: 'Elizabeth Cobleigh',
    body: 'New Terra Construction has completed several jobs for us with beautiful results. Pool surround deck with trex, screen porch, basement remodel, and next up an addition to our home. Cody and Nick are fantastic with communication, always show up on time, and finish on schedule. 100% recommend.',
  },
  {
    name: 'Natalie Carrillo',
    body: 'Great experience with Cody and his team! They installed a privacy fence with multiple gates in a couple of days despite poor weather. The fence turned out perfect — so nice to have a safe space for my dogs. Highly recommend.',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>Providing the ultimate building experience</h1>
      </section>

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
            <article key={s.title} className="service-card">
              <img src={s.img} alt={s.title} />
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="about" className="band band-accent">
        <h2>What customers say</h2>
        <div className="review-grid">
          {reviews.map((r) => (
            <blockquote key={r.name} className="review">
              <p>"{r.body}"</p>
              <cite>— {r.name}</cite>
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
