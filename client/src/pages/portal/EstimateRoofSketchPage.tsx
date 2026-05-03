// Roof-sketch page — Xactimate-style 2D roof plan editor.
//
// Mirrors EstimateSketchPage.tsx (the floor sketch). Differences:
//   - Tool: "+ Facet" (polygon + pitch) instead of "+ Room".
//   - Sidebar: facet name + integer pitch (0..24) + live area readout.
//   - Edges are color-coded by classification (ridge/hip/valley/rake/eave)
//     using classifyEdges() from roofMath.ts.
//   - Convention: each facet's first edge (points[0]→points[1]) is the
//     eave; we paint a tiny "EAVE" label there so the user knows which
//     way to orient the facet relative to the slope.

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import {
  type EdgeKind,
  type RoofFacet,
  type RoofPoint,
  type RoofSketch,
  classifyEdges,
  facetSurfaceAreaSqIn,
  roofTotals,
} from '../../lib/roofMath';

// Default new facet: 20'×16' rectangle at 6/12 pitch. The first edge
// (top side) becomes the eave by convention.
const DEFAULT_FACET_WIDTH_IN = 20 * 12;
const DEFAULT_FACET_HEIGHT_IN = 16 * 12;
const DEFAULT_PITCH = 6;

// Match EstimateSketchPage's scale (3 px/in) so the floor + roof
// sketches feel the same. A 1-foot grid is 36 px, comfortable for
// click + drag.
const PX_PER_IN = 3;
function ix(n: number) {
  return n * PX_PER_IN;
}

// Edge color palette — matches industry convention (red ridge, blue
// valley, etc.). Solo edges (rake/eave) are deliberately muted so the
// shared-edge classification dominates the eye.
const EDGE_COLOR: Record<EdgeKind, string> = {
  ridge: '#e5484d',   // red
  hip: '#f5a524',     // amber
  valley: '#4cc2ff',  // cyan
  rake: '#a78bfa',    // purple
  eave: '#7ee787',    // green
};

function emptySketch(): RoofSketch {
  return {
    version: 1,
    facets: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

function newFacet(name: string, originIn: RoofPoint): RoofFacet {
  // Vertex order matters: points[0] → points[1] is the eave (lowest
  // edge). We make the eave run along the bottom and walk CCW so
  // downhillUnitVector() in roofMath comes out pointing "into" the
  // polygon from the eave (i.e. away from the eave, up-slope).
  return {
    id: `facet-${Math.random().toString(36).slice(2, 9)}`,
    name,
    pitchOver12: DEFAULT_PITCH,
    points: [
      { x: originIn.x, y: originIn.y + DEFAULT_FACET_HEIGHT_IN },                          // bottom-left  (eave start)
      { x: originIn.x + DEFAULT_FACET_WIDTH_IN, y: originIn.y + DEFAULT_FACET_HEIGHT_IN },// bottom-right (eave end)
      { x: originIn.x + DEFAULT_FACET_WIDTH_IN, y: originIn.y },                          // top-right
      { x: originIn.x, y: originIn.y },                                                    // top-left
    ],
  };
}

interface EstimateRef {
  id: string;
  number: string;
  title: string;
  status: string;
}

export default function EstimateRoofSketchPage() {
  const { id: paramId } = useParams<{ id: string }>();
  const isStandalone = !paramId;
  const navigate = useNavigate();
  const [pickedId, setPickedId] = useState<string>('');
  const targetId = paramId ?? (pickedId || null);
  const [drafts, setDrafts] = useState<EstimateRef[] | null>(null);
  const [estimate, setEstimate] = useState<EstimateRef | null>(null);
  const [sketch, setSketch] = useState<RoofSketch>(emptySketch());
  const [selectedFacetId, setSelectedFacetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Standalone mode loads the draft list once for the picker.
  useEffect(() => {
    if (!isStandalone) return;
    let ignored = false;
    (async () => {
      try {
        const r = await api<{ estimates: EstimateRef[] }>(
          '/api/estimates?status=DRAFT&pageSize=100',
        );
        if (!ignored) setDrafts(r.estimates);
      } catch (err) {
        if (!ignored) setError(err instanceof ApiError ? err.message : 'Failed to load drafts');
      }
    })();
    return () => {
      ignored = true;
    };
  }, [isStandalone]);

  useEffect(() => {
    if (!targetId) {
      setEstimate(null);
      setSketch(emptySketch());
      setSelectedFacetId(null);
      setSavedAt(null);
      return;
    }
    let ignored = false;
    (async () => {
      try {
        const [est, s] = await Promise.all([
          api<{ estimate: EstimateRef }>(`/api/estimates/${targetId}`),
          api<{ sketch: { data: RoofSketch } | null }>(`/api/estimates/${targetId}/roof-sketch`),
        ]);
        if (ignored) return;
        setEstimate(est.estimate);
        setSketch(s.sketch?.data ?? emptySketch());
        setSelectedFacetId(null);
        setSavedAt(null);
      } catch (err) {
        if (!ignored) setError(err instanceof ApiError ? err.message : 'Failed to load roof sketch');
      }
    })();
    return () => {
      ignored = true;
    };
  }, [targetId]);

  const totals = useMemo(() => roofTotals(sketch), [sketch]);
  const classified = useMemo(() => classifyEdges(sketch), [sketch]);
  const selectedFacet = sketch.facets.find((f) => f.id === selectedFacetId) ?? null;

  function patchFacet(facetId: string, patch: Partial<RoofFacet>) {
    setSketch((cur) => ({
      ...cur,
      facets: cur.facets.map((f) => (f.id === facetId ? { ...f, ...patch } : f)),
    }));
  }
  function patchPoint(facetId: string, idx: number, point: RoofPoint) {
    setSketch((cur) => ({
      ...cur,
      facets: cur.facets.map((f) =>
        f.id === facetId
          ? { ...f, points: f.points.map((p, i) => (i === idx ? point : p)) }
          : f,
      ),
    }));
  }
  function addFacet() {
    // Tile new facets diagonally so they don't stack on top of each
    // other when a user clicks the button several times in a row.
    const offset = sketch.facets.length * 24;
    const facet = newFacet(`Facet ${sketch.facets.length + 1}`, { x: 60 + offset, y: 60 + offset });
    setSketch((cur) => ({ ...cur, facets: [...cur.facets, facet] }));
    setSelectedFacetId(facet.id);
  }
  function removeFacet(facetId: string) {
    if (!confirm('Delete this facet?')) return;
    setSketch((cur) => ({ ...cur, facets: cur.facets.filter((f) => f.id !== facetId) }));
    if (selectedFacetId === facetId) setSelectedFacetId(null);
  }

  const dragRef = useRef<{ facetId: string; idx: number } | null>(null);
  function startDrag(facetId: string, idx: number, e: React.PointerEvent) {
    dragRef.current = { facetId, idx };
    (e.target as SVGElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const snap = (n: number) => Math.round(n / 6) * 6;
    patchPoint(drag.facetId, drag.idx, { x: snap(px / PX_PER_IN), y: snap(py / PX_PER_IN) });
  }
  function endDrag() {
    dragRef.current = null;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!targetId) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/estimates/${targetId}/roof-sketch`, {
        method: 'PUT',
        body: JSON.stringify({ data: sketch }),
      });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function pushToEstimate() {
    if (!targetId) return;
    const sectionTitle = prompt(
      'Section name for these line items?\n\nUse one section per area (e.g. "Main roof", "Garage roof", "Porch roof"). The estimate detail will subtotal everything in this section together.',
      'Roof',
    );
    if (sectionTitle === null) return;
    try {
      await save();
      const r = await api<{ added: number; sectionTitle: string }>(
        `/api/estimates/${targetId}/roof-sketch/push-to-estimate`,
        {
          method: 'POST',
          body: JSON.stringify({ sectionTitle: sectionTitle.trim() || undefined }),
        },
      );
      alert(`Added ${r.added} line${r.added === 1 ? '' : 's'} to "${r.sectionTitle}".`);
      navigate(`/portal/estimates/${targetId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Push failed');
    }
  }

  const bounds = useMemo(() => {
    let maxX = 480;
    let maxY = 360;
    for (const f of sketch.facets) {
      for (const p of f.points) {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return { width: ix(maxX + 60), height: ix(maxY + 60) };
  }, [sketch]);

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Roof sketch</h1>
          <p className="muted">
            {estimate ? (
              <>
                <Link to={`/portal/estimates/${estimate.id}`}>← {estimate.number}</Link>
                {' · '}
                <strong>{estimate.title}</strong>
              </>
            ) : isStandalone ? (
              'Pick a draft estimate below to start.'
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        {targetId && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={addFacet}>+ Facet</button>
            <button type="button" className="button-ghost" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save sketch'}
            </button>
            <button type="button" onClick={pushToEstimate}>Push totals to estimate</button>
          </div>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}

      {isStandalone && (
        <section className="card">
          <label htmlFor="roof-sketch-draft-pick">Target draft estimate</label>
          <select
            id="roof-sketch-draft-pick"
            value={pickedId}
            onChange={(e) => setPickedId(e.target.value)}
          >
            <option value="">— Pick a draft —</option>
            {drafts === null && <option disabled>Loading…</option>}
            {drafts?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.number} · {d.title}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Sketch saves and pushed lines land on the selected draft. Switching drafts loads
            that draft's saved roof sketch (or starts blank).{' '}
            <Link to="/portal/estimates/new">Create a new draft →</Link>
          </p>
        </section>
      )}

      {targetId && <>
      <section className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <strong>Surface</strong>
            <div className="muted">{totals.surfaceSqft} sqft</div>
          </div>
          <div>
            <strong>Ridge</strong>
            <div className="muted">{totals.ridgeFeet} lf</div>
          </div>
          <div>
            <strong>Hip</strong>
            <div className="muted">{totals.hipFeet} lf</div>
          </div>
          <div>
            <strong>Valley</strong>
            <div className="muted">{totals.valleyFeet} lf</div>
          </div>
          <div>
            <strong>Rake</strong>
            <div className="muted">{totals.rakeFeet} lf</div>
          </div>
          <div>
            <strong>Eave</strong>
            <div className="muted">{totals.eaveFeet} lf</div>
          </div>
          <div>
            <strong>Facets</strong>
            <div className="muted">{totals.facetCount}</div>
          </div>
          {savedAt && (
            <div className="muted" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
              Saved {savedAt.toLocaleTimeString()}
            </div>
          )}
        </div>
      </section>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        <section
          className="card"
          style={{ flex: '1 1 600px', minWidth: 0, padding: 0, overflow: 'auto' }}
        >
          <svg
            ref={svgRef}
            width={bounds.width}
            height={bounds.height}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ background: 'var(--surface)', display: 'block' }}
          >
            <defs>
              <pattern id="grid-ft-roof" width={ix(12)} height={ix(12)} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${ix(12)} 0 L 0 0 0 ${ix(12)}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-ft-roof)" />

            {sketch.facets.map((facet, fi) => {
              const path = facet.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${ix(p.x)} ${ix(p.y)}`)
                .join(' ') + ' Z';
              const isSelected = facet.id === selectedFacetId;
              const facetEdges = classified.filter((e) => e.facetIndex === fi);
              const eaveEdge = facetEdges.find((e) => e.aIndex === 0 && e.bIndex === 1);
              const eaveLabelAnchor = (() => {
                // Mid-point of the convention-eave edge (points[0]→points[1]).
                const a = facet.points[0]!;
                const b = facet.points[1]!;
                return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              })();
              return (
                <g key={facet.id} onClick={() => setSelectedFacetId(facet.id)} style={{ cursor: 'pointer' }}>
                  <path
                    d={path}
                    fill={isSelected ? 'rgba(245, 165, 36, 0.18)' : 'rgba(245, 165, 36, 0.08)'}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  {/* Color-coded edge overlay. Painting on top of the
                      facet fill so each kind reads cleanly. */}
                  {facetEdges.map((edge) => {
                    const a = facet.points[edge.aIndex]!;
                    const b = facet.points[edge.bIndex]!;
                    return (
                      <line
                        key={`${facet.id}-${edge.aIndex}-${edge.bIndex}`}
                        x1={ix(a.x)}
                        y1={ix(a.y)}
                        x2={ix(b.x)}
                        y2={ix(b.y)}
                        stroke={EDGE_COLOR[edge.kind]}
                        strokeWidth={isSelected ? 3.5 : 2.5}
                        strokeLinecap="round"
                      >
                        <title>{edge.kind}</title>
                      </line>
                    );
                  })}
                  {isSelected &&
                    facet.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={ix(p.x)}
                        cy={ix(p.y)}
                        r={6}
                        fill="var(--accent)"
                        stroke="#fff"
                        strokeWidth={1.5}
                        style={{ cursor: 'grab', touchAction: 'none' }}
                        onPointerDown={(e) => startDrag(facet.id, i, e)}
                      />
                    ))}
                  {/* Facet name + pitch in the center. */}
                  <text
                    x={ix(facet.points.reduce((s, p) => s + p.x, 0) / facet.points.length)}
                    y={ix(facet.points.reduce((s, p) => s + p.y, 0) / facet.points.length)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={12}
                    fill="var(--text)"
                    pointerEvents="none"
                  >
                    {facet.name} · {facet.pitchOver12}/12
                  </text>
                  {/* "EAVE" label on the convention edge so the user
                      learns which direction the facet slopes. Suppress
                      if classification disagrees (means edge is shared,
                      not actually a solo eave) — keeps the canvas honest. */}
                  {eaveEdge && eaveEdge.kind === 'eave' && (
                    <text
                      x={ix(eaveLabelAnchor.x)}
                      y={ix(eaveLabelAnchor.y) + 12}
                      textAnchor="middle"
                      fontSize={9}
                      fill={EDGE_COLOR.eave}
                      pointerEvents="none"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      EAVE
                    </text>
                  )}
                  {/* Pitch direction arrow — runs from the centroid
                      toward the eave (downhill). Skipped on flat roofs
                      because there's no slope to indicate. */}
                  {facet.pitchOver12 > 0 && (() => {
                    const cx = facet.points.reduce((s, p) => s + p.x, 0) / facet.points.length;
                    const cy = facet.points.reduce((s, p) => s + p.y, 0) / facet.points.length;
                    // Direction from centroid → eave midpoint.
                    const tx = eaveLabelAnchor.x - cx;
                    const ty = eaveLabelAnchor.y - cy;
                    const len = Math.hypot(tx, ty) || 1;
                    // Arrow length: 60% of centroid→eave distance, capped.
                    const armIn = Math.min(len * 0.6, 48);
                    const ux = tx / len;
                    const uy = ty / len;
                    const tipX = cx + ux * armIn;
                    const tipY = cy + uy * armIn;
                    // Arrowhead: two short legs at 30° back from the tip.
                    const headLen = 12;
                    const cosT = Math.cos((150 * Math.PI) / 180);
                    const sinT = Math.sin((150 * Math.PI) / 180);
                    const leftX = tipX + headLen * (ux * cosT - uy * sinT);
                    const leftY = tipY + headLen * (uy * cosT + ux * sinT);
                    const rightX = tipX + headLen * (ux * cosT + uy * sinT);
                    const rightY = tipY + headLen * (uy * cosT - ux * sinT);
                    return (
                      <g pointerEvents="none">
                        <line
                          x1={ix(cx)}
                          y1={ix(cy)}
                          x2={ix(tipX)}
                          y2={ix(tipY)}
                          stroke="var(--accent)"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                        <line
                          x1={ix(tipX)}
                          y1={ix(tipY)}
                          x2={ix(leftX)}
                          y2={ix(leftY)}
                          stroke="var(--accent)"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                        <line
                          x1={ix(tipX)}
                          y1={ix(tipY)}
                          x2={ix(rightX)}
                          y2={ix(rightY)}
                          stroke="var(--accent)"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })()}
                </g>
              );
            })}
            {sketch.facets.length === 0 && (
              <text
                x={bounds.width / 2}
                y={bounds.height / 2}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize={14}
              >
                Click "+ Facet" to start
              </text>
            )}
          </svg>
          <div
            style={{
              padding: '0.5rem 0.75rem',
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              borderTop: '1px solid var(--border)',
              fontSize: '0.75rem',
            }}
          >
            {(Object.keys(EDGE_COLOR) as EdgeKind[]).map((k) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 14,
                    height: 3,
                    background: EDGE_COLOR[k],
                    display: 'inline-block',
                    borderRadius: 2,
                  }}
                />
                {k}
              </span>
            ))}
          </div>
        </section>

        <aside className="card" style={{ flex: '0 0 320px', maxWidth: '100%' }}>
          {selectedFacet ? (
            <FacetEditor
              facet={selectedFacet}
              onPatch={(patch) => patchFacet(selectedFacet.id, patch)}
              onRemove={() => removeFacet(selectedFacet.id)}
            />
          ) : (
            <div className="muted">
              <p>Select a facet to rename it or change the pitch.</p>
              {sketch.facets.length === 0 ? (
                <p>
                  Click <strong>+ Facet</strong> to add a 20'×16' starter at 6/12. Drag the
                  corners to reshape; snaps to the nearest 6". The first edge is the
                  <strong> eave</strong> — orient the facet so the eave runs along
                  the gutter line.
                </p>
              ) : (
                <ul style={{ paddingLeft: '1.25rem' }}>
                  {sketch.facets.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => setSelectedFacetId(f.id)}
                        style={{ padding: '2px 6px' }}
                      >
                        {f.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
      </>}
    </div>
  );
}

function FacetEditor({
  facet,
  onPatch,
  onRemove,
}: {
  facet: RoofFacet;
  onPatch: (patch: Partial<RoofFacet>) => void;
  onRemove: () => void;
}) {
  // Per-facet area readout — uses the imported helper so the math
  // matches what the server persists.
  const surfaceSqFt = Math.round(facetSurfaceAreaSqIn(facet) / 144);
  return (
    <div>
      <div className="row-between" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong>Facet</strong>
        <button type="button" className="button-ghost button-small" onClick={onRemove}>
          Delete
        </button>
      </div>
      <label htmlFor="facet-name" style={{ fontSize: '0.85rem' }}>Name</label>
      <input
        id="facet-name"
        value={facet.name}
        onChange={(e) => onPatch({ name: e.target.value })}
        style={{ marginBottom: '0.5rem' }}
      />
      <label htmlFor="facet-pitch" style={{ fontSize: '0.85rem' }}>
        Pitch (rise per 12, integer 0–24)
      </label>
      <input
        id="facet-pitch"
        type="number"
        min={0}
        max={24}
        step={1}
        value={facet.pitchOver12}
        onChange={(e) => {
          const raw = Math.round(Number(e.target.value));
          // Clamp here so the on-disk value always matches the parser's
          // accepted range — prevents a 99 typo from ballooning surface SF.
          const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(24, raw)) : 6;
          onPatch({ pitchOver12: clamped });
        }}
        style={{ marginBottom: '0.75rem' }}
      />
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        Facet area (pitch-corrected): <strong>{surfaceSqFt}</strong> sqft
      </p>
      <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
        Tip: the first edge (corner 1 → corner 2) is the eave. Re-order the
        polygon by editing the JSON directly if you need a different
        orientation; in-app reorder is on the roadmap.
      </p>
    </div>
  );
}
