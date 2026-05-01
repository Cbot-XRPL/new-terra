// Top-level entry point for the floor + roof sketch tools. The
// sketches themselves live on each estimate; this page just lists
// every Draft estimate the rep can edit and links to its sketches.
//
// Why a hub instead of a free-standing canvas: a sketch is meaningless
// without an estimate to attach the totals to. Forcing the rep to
// pick (or create) one first keeps the data model clean.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { Box, Pencil } from 'lucide-react';

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
          Floor + roof sketches attach to a Draft estimate so totals (square
          footage, perimeter, ridge / eave / valley LF) push back into line
          items. Pick an estimate below or{' '}
          <Link to="/portal/estimates/new">start a new one</Link>.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

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
