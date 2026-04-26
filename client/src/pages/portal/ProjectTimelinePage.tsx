import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface TimelineImage {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  caption: string | null;
  phase: string | null;
  takenAt: string | null;
  createdAt: string;
  at: string;
  uploadedBy: { id: string; name: string };
}

interface TimelineMonth {
  month: string; // YYYY-MM
  items: TimelineImage[];
}

interface TimelineResponse {
  months: TimelineMonth[];
  total: number;
  phaseCounts: Record<string, number>;
}

interface ProjectStub {
  id: string;
  name: string;
  customer: { name: string };
}

// Auth-required zip download — fetch as blob and click an anchor so the
// browser saves it with the right filename.
async function downloadZip(projectId: string, projectName: string) {
  const apiBase = import.meta.env.VITE_API_URL ?? '';
  const token = localStorage.getItem('nt_token');
  const res = await fetch(`${apiBase}/api/projects/${projectId}/photos.zip`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    alert('Could not download photos zip');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = projectName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';
  a.download = `${slug}-photos.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function monthLabel(ym: string): string {
  // ym is "YYYY-MM" — render as "April 2026" without timezone gymnastics.
  const [y, m] = ym.split('-').map((n) => Number(n));
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export default function ProjectTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [project, setProject] = useState<ProjectStub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api<TimelineResponse>(`/api/projects/${id}/images/timeline`),
      api<{ project: ProjectStub }>(`/api/projects/${id}`),
    ])
      .then(([t, p]) => {
        setData(t);
        setProject(p.project);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load timeline'));
  }, [id]);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!phaseFilter) return data;
    const next: TimelineMonth[] = data.months
      .map((m) => ({ ...m, items: m.items.filter((i) => (i.phase ?? '') === phaseFilter) }))
      .filter((m) => m.items.length > 0);
    return { ...data, months: next };
  }, [data, phaseFilter]);

  if (error) return <div className="dashboard"><div className="form-error">{error}</div></div>;
  if (!data || !project) return <div className="dashboard"><p className="muted">Loading…</p></div>;

  const phaseChips = Object.entries(data.phaseCounts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Photo timeline · {project.name}</h1>
          <p className="muted">
            {data.total} photo{data.total === 1 ? '' : 's'} for {project.customer.name}.
            {' '}<Link to={`/portal/projects/${id}`}>← back to project</Link>
          </p>
        </div>
        {data.total > 0 && (
          <button
            type="button"
            className="button-ghost"
            onClick={() => downloadZip(id!, project.name)}
            title="Bundle every photo on this project into a single zip"
          >
            Download all (.zip)
          </button>
        )}
      </header>

      {phaseChips.length > 0 && (
        <section className="card">
          <div className="row-between">
            <h2>Filter by phase</h2>
            {phaseFilter && (
              <button
                type="button"
                className="button-ghost button-small"
                onClick={() => setPhaseFilter(null)}
              >
                Clear
              </button>
            )}
          </div>
          <div className="phase-chips">
            {phaseChips.map(([key, count]) => {
              const label = key === '__unphased__' ? '(unphased)' : key;
              const active = phaseFilter === (key === '__unphased__' ? '' : key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`button-ghost button-small${active ? ' is-active' : ''}`}
                  onClick={() => setPhaseFilter(active ? null : key === '__unphased__' ? '' : key)}
                >
                  {label} <span className="muted">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {filtered!.months.length === 0 ? (
        <p className="muted">No photos yet — upload some on the project page.</p>
      ) : (
        filtered!.months.map((m) => (
          <section className="card" key={m.month}>
            <h2 style={{ marginBottom: '0.5rem' }}>{monthLabel(m.month)}</h2>
            <p className="muted" style={{ marginBottom: '0.75rem' }}>
              {m.items.length} photo{m.items.length === 1 ? '' : 's'}
            </p>
            <div className="gallery">
              {m.items.map((img) => (
                <figure key={img.id} className="gallery-item">
                  <a href={img.url} target="_blank" rel="noreferrer">
                    <img
                      src={img.thumbnailUrl ?? img.url}
                      alt={img.caption ?? img.filename}
                      loading="lazy"
                    />
                  </a>
                  <figcaption>
                    {img.caption && <div>{img.caption}</div>}
                    <div className="muted">
                      {img.phase && <span className="badge badge-sent" style={{ marginRight: '0.4rem' }}>{img.phase}</span>}
                      {formatDate(img.at)} · {img.uploadedBy.name}
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
