import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';

interface PortfolioProject {
  id: string;
  name: string;
  status: string;
  showOnPortfolio: boolean;
  portfolioSlug: string | null;
  serviceCategory: string | null;
  publicSummary: string | null;
  customer: { id: string; name: string };
}

const SERVICE_CATEGORIES = [
  'Decks',
  'Hardscape',
  'Fencing',
  'Landscaping',
  'Remodeling',
  'Roofing',
  'Additions',
  'Kitchens',
  'Bathrooms',
];

export default function PortfolioAdminPage() {
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'live' | 'off'>('all');

  async function load() {
    try {
      const { projects } = await api<{ projects: PortfolioProject[] }>('/api/projects');
      setProjects(projects);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load projects');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patchProject(id: string, patch: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  const visible = projects.filter((p) =>
    filter === 'all' ? true : filter === 'live' ? p.showOnPortfolio : !p.showOnPortfolio,
  );
  const liveCount = projects.filter((p) => p.showOnPortfolio).length;

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Public portfolio</h1>
          <p className="muted">
            Pick which projects appear at <code>/portfolio</code> on the public site. Off by
            default — opt in deliberately. Live: <strong>{liveCount}</strong> of {projects.length}.
          </p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All projects</option>
          <option value="live">On the public site</option>
          <option value="off">Hidden</option>
        </select>
      </div>

      <section className="card">
        {visible.length === 0 ? (
          <p className="muted">No projects match this filter.</p>
        ) : (
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {visible.map((p) => (
              <li
                key={p.id}
                style={{
                  borderBottom: '1px solid var(--border)',
                  padding: '1rem 0',
                  marginBottom: 0,
                }}
              >
                <div className="row-between">
                  <div>
                    <Link to={`/portal/projects/${p.id}`} style={{ fontWeight: 600 }}>
                      {p.name}
                    </Link>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {p.customer.name} · {p.status.toLowerCase().replace('_', ' ')}
                    </div>
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.9rem',
                      marginBottom: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={p.showOnPortfolio}
                      onChange={(e) =>
                        patchProject(p.id, { showOnPortfolio: e.target.checked })
                      }
                      style={{ width: 'auto' }}
                    />
                    Show on public site
                  </label>
                </div>

                {p.showOnPortfolio && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.75rem',
                      marginTop: '0.75rem',
                    }}
                  >
                    <div>
                      <label style={{ fontSize: '0.85rem' }}>Service category</label>
                      <input
                        list={`svc-${p.id}`}
                        value={p.serviceCategory ?? ''}
                        onChange={(e) =>
                          patchProject(p.id, { serviceCategory: e.target.value || null })
                        }
                        placeholder="Decks, Hardscape, …"
                      />
                      <datalist id={`svc-${p.id}`}>
                        {SERVICE_CATEGORIES.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem' }}>URL slug</label>
                      <input
                        value={p.portfolioSlug ?? ''}
                        onChange={(e) =>
                          patchProject(p.id, { portfolioSlug: e.target.value || null })
                        }
                        pattern="[a-z0-9-]+"
                        placeholder="taylor-backyard-deck"
                      />
                      {p.portfolioSlug && (
                        <p className="muted" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
                          Live at <code>/portfolio/{p.portfolioSlug}</code>
                        </p>
                      )}
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: '0.85rem' }}>Public summary</label>
                      <textarea
                        rows={2}
                        value={p.publicSummary ?? ''}
                        onChange={(e) =>
                          patchProject(p.id, { publicSummary: e.target.value || null })
                        }
                        placeholder="Short marketing description for prospects."
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
