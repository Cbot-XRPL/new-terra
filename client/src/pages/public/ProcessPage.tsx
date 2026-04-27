import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/pageMeta';

// "How it works" — turns the customer-portal experience into a sales
// asset. Each step references real things the customer will see in the
// portal so it doesn't feel like vapor.
const STEPS = [
  {
    n: 1,
    title: 'Free estimate',
    body: 'Tell us about your project — online, by phone, or at your home. We come out, walk the site, talk through ideas, and give you a clear written estimate within a few business days.',
  },
  {
    n: 2,
    title: 'Design & contract',
    body: 'Once you like the direction, we tighten the scope, lock the materials, and send a contract you can sign online. No mystery line items.',
  },
  {
    n: 3,
    title: 'Schedule & permits',
    body: 'We pull the permits, call utility locates, and put the project on the schedule. You\'ll see start and finish dates in your customer portal from day one.',
  },
  {
    n: 4,
    title: 'Build',
    body: 'Crews show up on time, in uniform, and we keep the site clean. Daily progress photos go straight into your portal so you can check in from anywhere.',
  },
  {
    n: 5,
    title: 'Walkthrough & punch list',
    body: 'Before final invoice, we walk the project together and capture any touch-ups on a punch list. Nothing closes out until you\'re happy with it.',
  },
  {
    n: 6,
    title: 'Final invoice & warranty',
    body: 'Pay online (ACH, Zelle, or card). Workmanship warranty kicks in the day we close out, and we\'re a phone call away after.',
  },
];

export default function ProcessPage() {
  usePageMeta({
    title: 'How it works',
    description: 'From the first call to final walkthrough — here\'s exactly what to expect when you build with New Terra Construction.',
  });

  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <span className="tag">Our process</span>
        <h1>From first call to final walkthrough</h1>
        <p className="muted">
          Building should be a calm, clear experience. Here's exactly what to expect.
        </p>
      </header>

      <ol className="process-steps">
        {STEPS.map((s) => (
          <li key={s.n}>
            <div className="process-num">{s.n}</div>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="card" style={{ marginTop: '2rem', textAlign: 'center' }}>
        <h2>Ready when you are</h2>
        <p className="muted">No-pressure free estimate, usually scheduled within a few business days.</p>
        <Link to="/start" className="button">Start your project</Link>
      </section>
    </main>
  );
}
