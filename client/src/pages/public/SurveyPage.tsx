import { type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface Resp {
  project: string;
  customerFirstName: string;
  submitted: boolean;
  score: number | null;
  comments: string | null;
  improvements: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export default function SurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [score, setScore] = useState<number | null>(null);
  const [comments, setComments] = useState('');
  const [improvements, setImprovements] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/public/survey/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) { setError('Survey not found.'); return; }
        if (!res.ok) { setError('Could not load survey.'); return; }
        const body = (await res.json()) as Resp;
        setData(body);
        if (body.submitted) setDone(true);
      })
      .catch(() => setError('Could not load survey.'));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (score == null) {
      setError('Pick a score from 0 to 10');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/public/survey/${encodeURIComponent(token!)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comments: comments || null, improvements: improvements || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Submit failed');
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <main style={{ maxWidth: 600, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <h1>Survey unavailable</h1>
        <p className="muted">{error}</p>
      </main>
    );
  }
  if (!data) {
    return <main style={{ padding: '2rem', textAlign: 'center' }}><p className="muted">Loading…</p></main>;
  }
  if (done) {
    return (
      <main style={{ maxWidth: 600, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <h1>Thanks, {data.customerFirstName}!</h1>
        <p className="muted">
          We got your feedback on <strong>{data.project}</strong>. Means the world.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 0.25rem' }}>How did we do?</h1>
        <p className="muted">{data.project} — quick 30-second survey.</p>
      </header>

      <form onSubmit={submit}>
        <section className="card">
          <label style={{ fontWeight: 600 }}>
            How likely are you to recommend us to a friend? (0 = not at all, 10 = absolutely)
          </label>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={score === n ? '' : 'button-ghost'}
                style={{ minWidth: 44 }}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        <section className="card" style={{ marginTop: '1rem' }}>
          <label htmlFor="comments">What went well? (optional)</label>
          <textarea
            id="comments"
            rows={4}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="The framing crew was great…"
          />
        </section>

        <section className="card" style={{ marginTop: '1rem' }}>
          <label htmlFor="improvements">What could we do better next time? (optional)</label>
          <textarea
            id="improvements"
            rows={4}
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            placeholder="Communication during the rough-in could have been clearer…"
          />
        </section>

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button type="submit" disabled={submitting || score == null}>
            {submitting ? 'Submitting…' : 'Submit feedback'}
          </button>
        </div>
      </form>
    </main>
  );
}
