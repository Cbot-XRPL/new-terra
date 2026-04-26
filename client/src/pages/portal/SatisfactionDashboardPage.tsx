import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface Survey {
  id: string;
  sentAt: string | null;
  submittedAt: string | null;
  score: number | null;
  comments: string | null;
  improvements: string | null;
  project: { id: string; name: string };
  customer: { id: string; name: string; email: string };
}

interface Summary {
  total: number;
  sent: number;
  submitted: number;
  avgScore: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
}

interface Resp {
  surveys: Survey[];
  summary: Summary;
}

function npsBucket(score: number | null): 'promoter' | 'passive' | 'detractor' | null {
  if (score == null) return null;
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

export default function SatisfactionDashboardPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function load() {
    try {
      const r = await api<Resp>('/api/admin/satisfaction-surveys');
      setData(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function runCron() {
    if (!confirm('Run the satisfaction-survey cron now? Emails any project that completed >14 days ago without a survey.')) return;
    setRunning(true);
    try {
      const r = await api<{ emailed: number; considered: number }>(
        '/api/admin/satisfaction-surveys/_run',
        { method: 'POST' },
      );
      alert(`Considered ${r.considered}; emailed ${r.emailed}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  if (!data) return <div className="dashboard"><p className="muted">Loading…</p></div>;

  const { summary } = data;

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Customer satisfaction</h1>
          <p className="muted">
            Auto-emailed surveys 2 weeks after a project completes. NPS = promoters (9–10) − detractors
            (0–6) over total responses.
            {' '}<Link to="/portal/finance">← back to finance</Link>
          </p>
        </div>
        <button type="button" className="button-ghost" onClick={runCron} disabled={running}>
          {running ? 'Sending…' : 'Run survey cron now'}
        </button>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="invoice-stats">
          <div>
            <div className="stat-label">Surveys</div>
            <div className="stat-value">{summary.total}</div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {summary.sent} sent · {summary.submitted} returned
            </div>
          </div>
          <div>
            <div className="stat-label">Average score</div>
            <div className="stat-value">
              {summary.avgScore != null ? summary.avgScore.toFixed(1) : '—'}
            </div>
          </div>
          <div>
            <div className="stat-label">NPS</div>
            <div
              className="stat-value"
              style={{
                color: summary.nps == null
                  ? undefined
                  : summary.nps < 0
                    ? 'var(--accent)'
                    : summary.nps >= 50
                      ? 'var(--paid, #0f9d58)'
                      : undefined,
              }}
            >
              {summary.nps != null ? summary.nps : '—'}
            </div>
          </div>
          <div>
            <div className="stat-label">Promoters / Passives / Detractors</div>
            <div className="stat-value" style={{ fontSize: '1rem' }}>
              {summary.promoters} / {summary.passives} / {summary.detractors}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>All surveys</h2>
        {data.surveys.length === 0 ? (
          <p className="muted">No surveys yet — projects don&rsquo;t auto-survey until 14 days after completion.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Customer</th>
                <th>Sent</th>
                <th>Submitted</th>
                <th>Score</th>
                <th>NPS</th>
                <th>Comments</th>
                <th>Improvements</th>
              </tr>
            </thead>
            <tbody>
              {data.surveys.map((s) => {
                const bucket = npsBucket(s.score);
                return (
                  <tr key={s.id}>
                    <td><Link to={`/portal/projects/${s.project.id}`}>{s.project.name}</Link></td>
                    <td>{s.customer.name}</td>
                    <td className="muted">{s.sentAt ? formatDate(s.sentAt) : '—'}</td>
                    <td className="muted">{s.submittedAt ? formatDate(s.submittedAt) : <em>pending</em>}</td>
                    <td style={{ fontWeight: 600 }}>{s.score ?? '—'}</td>
                    <td>
                      {bucket && (
                        <span className={`badge ${
                          bucket === 'promoter' ? 'badge-paid'
                          : bucket === 'detractor' ? 'badge-overdue'
                          : 'badge-sent'
                        }`}>
                          {bucket}
                        </span>
                      )}
                    </td>
                    <td className="muted" style={{ maxWidth: 240 }}>{s.comments ?? '—'}</td>
                    <td className="muted" style={{ maxWidth: 240 }}>{s.improvements ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
