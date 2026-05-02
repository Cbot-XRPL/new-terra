import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';
import { SCENES, type Hotspot, type Scene } from './estimator/scenes';
import ToolImageSlot from '../../components/ToolImageSlot';

interface AssemblyRow {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
}

interface PreviewLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
}

interface PreviewResponse {
  lines: PreviewLine[];
  totalCents: number;
}

interface DraftRow {
  id: string;
  number: string;
  title: string;
  status: string;
  customer?: { id: string; name: string } | null;
}

// Pulled hotspot, plus the resolved assembly (if any).
interface ResolvedHotspot {
  hotspot: Hotspot;
  assembly: AssemblyRow | null;
}

function findAssembly(name: string, all: AssemblyRow[]): AssemblyRow | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  // Exact (case-insensitive) wins over contains so two assemblies whose names
  // overlap don't shadow each other.
  const exact = all.find((a) => a.name.trim().toLowerCase() === needle);
  if (exact) return exact;
  return all.find((a) => a.name.toLowerCase().includes(needle)) ?? null;
}

export default function EstimatorVisualPage() {
  const [sceneId, setSceneId] = useState<string>(SCENES[0]?.id ?? '');
  const [assemblies, setAssemblies] = useState<AssemblyRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftId, setDraftId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  // Section label sent with the push so multiple visual-estimator
  // assemblies on one estimate land in their own subtotal blocks (a
  // deck assembly + a kitchen assembly produce two separate sections).
  const [sectionTitle, setSectionTitle] = useState('');

  const scene: Scene = useMemo(
    () => SCENES.find((s) => s.id === sceneId) ?? SCENES[0],
    [sceneId],
  );

  const resolvedHotspots: ResolvedHotspot[] = useMemo(
    () =>
      scene.hotspots.map((h) => ({
        hotspot: h,
        assembly: findAssembly(h.assemblyName, assemblies),
      })),
    [scene, assemblies],
  );

  const activeResolved = activeHotspotId
    ? resolvedHotspots.find((r) => r.hotspot.id === activeHotspotId) ?? null
    : null;

  useEffect(() => {
    Promise.all([
      api<{ assemblies: AssemblyRow[] }>('/api/catalog/assemblies'),
      api<{ estimates: DraftRow[] }>('/api/estimates?status=DRAFT&pageSize=50'),
    ])
      .then(([a, e]) => {
        setAssemblies(a.assemblies);
        setDrafts(e.estimates);
        if (e.estimates.length > 0) setDraftId(e.estimates[0].id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  useEffect(() => {
    setActiveHotspotId(null);
    setPreview(null);
  }, [sceneId]);

  // Whenever the user clicks a hotspot, grab the expanded preview so they
  // can see what the assembly will actually drop into the estimate.
  useEffect(() => {
    if (!activeResolved?.assembly) {
      setPreview(null);
      return;
    }
    setPreview(null);
    setPreviewLoading(true);
    const id = activeResolved.assembly.id;
    api<PreviewResponse>(`/api/catalog/assemblies/${id}/preview`)
      .then((r) => setPreview(r))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Preview failed'))
      .finally(() => setPreviewLoading(false));
  }, [activeResolved?.assembly?.id]);

  async function addToEstimate() {
    if (!activeResolved?.assembly || !draftId) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be a positive number');
      return;
    }
    setAdding(true);
    setError(null);
    setInfo(null);
    try {
      // Default the section to the assembly's name when the rep didn't
      // type one — keeps single-shot pushes labeled without forcing a
      // prompt every time.
      const effectiveSection = sectionTitle.trim() || activeResolved.assembly.name;
      const r = await api<{ addedLines: number; sectionTitle: string | null }>(
        `/api/estimates/${draftId}/add-assembly`,
        {
          method: 'POST',
          body: JSON.stringify({
            assemblyId: activeResolved.assembly.id,
            quantity: qty,
            sectionTitle: effectiveSection,
          }),
        },
      );
      setInfo(
        `Added ${r.addedLines} line${r.addedLines === 1 ? '' : 's'} to "${r.sectionTitle ?? 'Items'}".`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add to estimate');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Visual estimator</h1>
          <p className="muted">
            Pick a scene, click components on the diagram, and drop the matching assembly into a draft estimate.
            Hotspots resolve to assemblies by name — keep your catalog tidy and the picker keeps working.
          </p>
        </div>
        <Link to="/portal/catalog" className="button-ghost button-small">
          Manage catalog
        </Link>
      </header>

      {error && <div className="form-error">{error}</div>}
      {info && <div className="form-success">{info}</div>}

      <section className="card">
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="scene-pick">Scene</label>
            <select
              id="scene-pick"
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
            >
              {SCENES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="draft-pick">Target draft estimate</label>
            <select
              id="draft-pick"
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
            >
              {drafts.length === 0 && <option value="">No drafts — create one first</option>}
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number} · {d.title}
                  {d.customer ? ` · ${d.customer.name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted" style={{ marginTop: '0.5rem' }}>{scene.description}</p>
      </section>

      <div className="estimator-visual">
        <section className="card estimator-canvas">
          {/* Optional generated-image backdrop. Falls back to the
              hand-drawn SVG-only look when no image is pinned for this
              scene. The hotspot SVG renders ON TOP at full opacity. */}
          {scene.imageSlug && (
            <div style={{ marginBottom: '0.5rem' }}>
              <ToolImageSlot
                slug={scene.imageSlug}
                alt={scene.name}
                aspect="8/5"
              />
            </div>
          )}
          <svg
            viewBox="0 0 800 500"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: 'auto', background: '#202124', borderRadius: 8 }}
            // The scene drawing is a compile-time constant defined in this
            // repo (scenes.ts), not user input — safe to inline as markup.
            dangerouslySetInnerHTML={{
              __html:
                scene.drawing +
                resolvedHotspots
                  .map((r) => renderHotspotSvg(r, r.hotspot.id === activeHotspotId))
                  .join(''),
            }}
            onClick={(e) => {
              const target = e.target as SVGElement;
              const id = target.getAttribute('data-hotspot-id');
              if (id) setActiveHotspotId(id);
            }}
          />
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Numbered tags below cover the same hotspots if your touchscreen prefers buttons over the diagram.
          </p>
          <div className="hotspot-list">
            {resolvedHotspots.map((r, idx) => (
              <button
                key={r.hotspot.id}
                type="button"
                className={`button-ghost button-small${
                  r.hotspot.id === activeHotspotId ? ' is-active' : ''
                }`}
                onClick={() => setActiveHotspotId(r.hotspot.id)}
              >
                <strong>{idx + 1}.</strong> {r.hotspot.label}
                {!r.assembly && <span className="muted"> · unmapped</span>}
              </button>
            ))}
          </div>
        </section>

        <aside className="card estimator-side">
          {!activeResolved ? (
            <p className="muted">Click a component on the diagram to see the matching assembly.</p>
          ) : !activeResolved.assembly ? (
            <>
              <h2>{activeResolved.hotspot.label}</h2>
              <p className="form-error">
                No assembly named &ldquo;{activeResolved.hotspot.assemblyName}&rdquo; in the catalog.
                Create one in <Link to="/portal/catalog">Catalog</Link> and the picker will start working
                without any code changes.
              </p>
            </>
          ) : (
            <>
              <h2>{activeResolved.hotspot.label}</h2>
              <p className="muted">
                Resolved to <strong>{activeResolved.assembly.name}</strong>
                {activeResolved.assembly.category && ` · ${activeResolved.assembly.category}`}
              </p>

              {previewLoading && <p className="muted">Loading preview…</p>}
              {preview && (
                <>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th style={{ textAlign: 'right' }}>Qty</th>
                        <th style={{ textAlign: 'right' }}>Each</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l, idx) => (
                        <tr key={idx}>
                          <td>{l.description}</td>
                          <td style={{ textAlign: 'right' }}>
                            {l.quantity}{l.unit ? ` ${l.unit}` : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}>{formatCents(l.unitPriceCents)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCents(l.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'right' }}><strong>Subtotal</strong></td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>{formatCents(preview.totalCents)}</strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className="form-row" style={{ alignItems: 'flex-end' }}>
                    <div style={{ width: 100 }}>
                      <label htmlFor="qty">Quantity</label>
                      <input
                        id="qty"
                        type="number"
                        step="0.01"
                        min="0"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label htmlFor="ve-section">
                        Section <span className="muted" style={{ fontWeight: 'normal' }}>(blank = use assembly name)</span>
                      </label>
                      <input
                        id="ve-section"
                        type="text"
                        value={sectionTitle}
                        onChange={(e) => setSectionTitle(e.target.value)}
                        placeholder={activeResolved?.assembly?.name ?? 'e.g. Deck, Kitchen, Master bath'}
                        title="Lines pushed in one click land in this subtotal block on the estimate."
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addToEstimate}
                      disabled={adding || !draftId}
                      title={draftId ? 'Append this assembly to the selected draft' : 'Pick a draft estimate first'}
                    >
                      {adding ? 'Adding…' : 'Add to estimate'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// Build the overlay SVG markup for a single hotspot. We inline it into the
// scene's dangerouslySetInnerHTML because mixing JSX children with raw SVG
// markup is more friction than it's worth for a static diagram.
function renderHotspotSvg(r: ResolvedHotspot, active: boolean): string {
  const fill = r.assembly ? 'rgba(138,180,248,0.18)' : 'rgba(242,139,130,0.18)';
  const stroke = active
    ? '#f9ab00'
    : r.assembly
      ? '#8ab4f8'
      : '#f28b82';
  const strokeWidth = active ? 3 : 1.5;
  const common = `data-hotspot-id="${r.hotspot.id}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" style="cursor:pointer"`;
  const s = r.hotspot.shape;
  if (s.kind === 'rect') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" ${common} />`;
  }
  if (s.kind === 'circle') {
    return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${common} />`;
  }
  return `<polygon points="${s.points}" ${common} />`;
}
