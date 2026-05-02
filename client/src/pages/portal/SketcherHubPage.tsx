// Top-level entry point for the floor + roof sketch tools AND the
// visual estimator. The three feed estimates the same way:
//
//   Floor sketch   → Push → estimate section "<area name>"
//   Roof sketch    → Push → estimate section "<area name>"
//   Visual estim.  → Add  → estimate section "<assembly name>"
//
// Each push tags every appended line with the same sectionTitle so
// the estimate detail can show clean subtotal blocks per area
// (Xactimate-style). Mix-and-match across all three on one estimate.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { Box, Pencil, Layers } from 'lucide-react';

interface EstimateRow {
  id: string;
  number: string;
  title: string;
  status: string;
  customer: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  createdAt: string;
}

interface ListResponse {
  estimates: EstimateRow[];
  total: number;
}

export default function SketcherHubPage() {
  const [estimates, setEstimates] = useState<EstimateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignored = false;
    (async () => {
      try {
        // Estimates list filtered to DRAFT — those are the only rows
        // sketches can attach to (the server enforces this; we just
        // hide non-editable rows from the picker so the user doesn't
        // click into a dead end).
        const r = await api<ListResponse>('/api/estimates?status=DRAFT&pageSize=100');
        if (ignored) return;
        setEstimates(r.estimates);
      } catch (err) {
        if (!ignored) setError(err instanceof ApiError ? err.message : 'Failed to load estimates');
      }
    })();
    return () => {
      ignored = true;
    };
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>Sketcher</h1>
        <p className="muted">
          Three tools, one feed. Floor sketch (room shapes + openings),
          roof sketch (facets + pitch), and the visual estimator (click
          a hotspot, drop a pre-priced assembly) all push their output
          into a Draft estimate as a labeled <strong>section</strong> with
          its own subtotal — so a deck job can land as "Deck demo + Deck
          install + Deck railing" three subtotal blocks instead of one
          flat list.
        </p>
        <p className="muted">
          Pick an estimate below to open its sketches, or jump to the{' '}
          <Link to="/portal/estimator/visual">Visual estimator</Link>{' '}
          / <Link to="/portal/estimates/new">start a new estimate</Link>.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>Tools</h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.75rem',
            marginTop: '0.75rem',
          }}
        >
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.75rem',
            }}
          >
            <strong><Pencil size={14} /> Floor sketch</strong>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
              Draw rooms + openings. Pushes floor SF, wall SF (openings
              subtracted), ceiling SF, perimeter LF.
            </p>
          </div>
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.75rem',
            }}
          >
            <strong><Box size={14} /> Roof sketch</strong>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
              Draw facets + pitch. Pushes shingle SF, drip edge,
              ridge cap, valley flashing, gutter LF.
            </p>
          </div>
          <Link
            to="/portal/estimator/visual"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.75rem',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <strong><Layers size={14} /> Visual estimator</strong>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
              Click a hotspot, drop a pre-built assembly. Each assembly
              becomes a section on the estimate.
            </p>
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Draft estimates</h2>
        {estimates === null ? (
          <p className="muted">Loading…</p>
        ) : estimates.length === 0 ? (
          <p className="muted">
            No drafts to sketch on yet —{' '}
            <Link to="/portal/estimates/new">create an estimate</Link> first.
          </p>
        ) : (
          <ul className="list" style={{ marginTop: '0.75rem' }}>
            {estimates.map((e) => {
              const customer = e.customer?.name ?? e.lead?.name ?? 'No customer';
              return (
                <li key={e.id} style={{ borderBottom: '1px solid var(--border)', padding: '0.75rem 0' }}>
                  <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <Link to={`/portal/estimates/${e.id}`}>
                        <strong>{e.number}</strong> · {e.title}
                      </Link>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>{customer}</div>
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
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
