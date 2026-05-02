// Unified hub for the four estimating tools:
//   - Floor sketch  (per estimate)
//   - Roof sketch   (per estimate)
//   - Visual estim. (assembly drop-in)
//   - Calculators   (math helpers)
//
// All four push their output into a Draft estimate as a labeled
// section with its own subtotal — see /portal/estimates/:id for the
// rendered grouping. This page replaces the standalone Sketcher,
// Visual estimator, and Calculators sidebar entries.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { Box, Calculator, Layers, Pencil, ArrowRight } from 'lucide-react';
import ToolImageSlot from '../../components/ToolImageSlot';

interface EstimateRow {
  id: string;
  number: string;
  title: string;
  status: string;
  customer: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
}

export default function ToolsHubPage() {
  const { user } = useAuth();
  const [estimates, setEstimates] = useState<EstimateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSales = user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && !!user.isSales);

  useEffect(() => {
    let ignored = false;
    if (!isSales) {
      setEstimates([]);
      return;
    }
    (async () => {
      try {
        const r = await api<{ estimates: EstimateRow[] }>(
          '/api/estimates?status=DRAFT&pageSize=100',
        );
        if (!ignored) setEstimates(r.estimates);
      } catch (err) {
        if (!ignored) {
          setError(err instanceof ApiError ? err.message : 'Failed to load estimates');
        }
      }
    })();
    return () => {
      ignored = true;
    };
  }, [isSales]);

  return (
    <div className="dashboard">
      <header>
        <h1>Tools</h1>
        <p className="muted">
          Four ways to build line items, all feeding the same Draft estimate.
          Each push lands as a <strong>section</strong> with its own subtotal —
          a deck job can read as "Deck demo" + "Deck install" + "Deck railing"
          three subtotal blocks instead of one flat list.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Pick a tool</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {/* Floor sketch */}
          {isSales && (
            <ToolCard
              title="Floor sketch"
              description="Draw rooms + openings. Pushes floor SF, wall SF (openings subtracted), ceiling SF, and perimeter LF."
              icon={<Pencil size={18} />}
              imageKey="tools/floor-sketch"
              note="Pick a Draft estimate below to start."
            />
          )}
          {/* Roof sketch */}
          {isSales && (
            <ToolCard
              title="Roof sketch"
              description="Draw facets with pitch. Pushes shingle SF, drip edge, ridge cap, valley flashing, and gutter LF."
              icon={<Box size={18} />}
              imageKey="tools/roof-sketch"
              note="Pick a Draft estimate below to start."
            />
          )}
          {/* Visual estimator */}
          {isSales && (
            <ToolCard
              title="Visual estimator"
              description="Click hotspots on a scene and drop pre-priced assemblies. Each assembly becomes its own section on the estimate."
              icon={<Layers size={18} />}
              imageKey="tools/visual-estimator"
              link={{ to: '/portal/estimator/visual', label: 'Open' }}
            />
          )}
          {/* Calculators — available to staff broadly */}
          <ToolCard
            title="Calculators"
            description="Quick math for concrete, deck framing, paint, drywall, fence, footings, tile, and more — every result drops onto an estimate as a single line."
            icon={<Calculator size={18} />}
            imageKey="tools/calculators"
            link={{ to: '/portal/calculators', label: 'Open' }}
          />
        </div>
      </section>

      {isSales && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Draft estimates</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Each of these has a Floor sketch and a Roof sketch attached to it
            (separate from each other). Add assemblies via the visual estimator
            from the same estimate.
          </p>
          {estimates === null ? (
            <p className="muted">Loading…</p>
          ) : estimates.length === 0 ? (
            <p className="muted">
              No drafts yet —{' '}
              <Link to="/portal/estimates/new">create an estimate</Link> first.
            </p>
          ) : (
            <ul className="list" style={{ marginTop: '0.75rem' }}>
              {estimates.map((e) => {
                const customer = e.customer?.name ?? e.lead?.name ?? 'No customer';
                return (
                  <li
                    key={e.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      padding: '0.75rem 0',
                    }}
                  >
                    <div
                      className="row-between"
                      style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}
                    >
                      <div>
                        <Link to={`/portal/estimates/${e.id}`}>
                          <strong>{e.number}</strong> · {e.title}
                        </Link>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {customer}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <Link
                          to={`/portal/estimates/${e.id}/sketch`}
                          className="button-ghost button-small"
                          title="Floor / room sketch"
                        >
                          <Pencil size={14} /> Floor
                        </Link>
                        <Link
                          to={`/portal/estimates/${e.id}/roof-sketch`}
                          className="button-ghost button-small"
                          title="Roof sketch with pitch"
                        >
                          <Box size={14} /> Roof
                        </Link>
                        <Link
                          to={`/portal/estimates/${e.id}`}
                          className="button-ghost button-small"
                        >
                          Open <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function ToolCard({
  title,
  description,
  icon,
  imageKey,
  link,
  note,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  // Path under uploads/generated/ where this card's hero lives once
  // an admin generates it. ToolImageSlot handles the placeholder when
  // nothing's been generated yet.
  imageKey: string;
  link?: { to: string; label: string };
  note?: string;
}) {
  const card = (
    <>
      <ToolImageSlot slug={imageKey} alt={`${title} illustration`} aspect="16/9" />
      <div style={{ padding: '0.75rem' }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {icon} {title}
        </strong>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          {description}
        </p>
        {note && (
          <p
            className="muted"
            style={{ fontSize: '0.75rem', margin: '0.4rem 0 0', fontStyle: 'italic' }}
          >
            {note}
          </p>
        )}
      </div>
    </>
  );
  const baseStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };
  if (link) {
    return (
      <Link to={link.to} style={{ ...baseStyle, textDecoration: 'none', color: 'inherit' }}>
        {card}
      </Link>
    );
  }
  return <div style={baseStyle}>{card}</div>;
}
