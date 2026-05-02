// Estimate sketch page — Xactimate-style 2D floor plan editor.
//
// Tools (this build): rectangle room, drag corners, set ceiling height,
// add door/window opening anchored to a wall edge, save/load from the
// server, push derived totals into the estimate as freeform line items.
//
// Roof pitch + freeform polygon rooms are deferred to a later session;
// the data model already supports arbitrary polygons (room.points), the
// UI just doesn't expose corner-add yet.

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
  type Sketch,
  type SketchFixture,
  type SketchOpening,
  type SketchPoint,
  type SketchRoom,
  sketchTotals,
} from '../../lib/sketchMath';
import {
  FIXTURE_CATALOG,
  fixtureBySlug,
  fixtureIconUrl,
  type FixtureDef,
} from '../../lib/fixtureCatalog';

// Default new-room rectangle: 12'×10' (144"×120") at the picked spot.
const DEFAULT_ROOM_WIDTH_IN = 144;
const DEFAULT_ROOM_HEIGHT_IN = 120;
const DEFAULT_CEILING_IN = 96;

// Pixel scale for the SVG: how many pixels represent one inch. At
// 3 px/in a 1-foot grid is 36 px (comfortable click target), and a
// typical 30-foot room is ~1080 px wide — fits on most desktop
// monitors with the sidebar still in view. The card scrolls if the
// sketch outgrows it.
const PX_PER_IN = 3;
function ix(n: number) {
  return n * PX_PER_IN;
}

function emptySketch(): Sketch {
  return {
    version: 1,
    rooms: [],
    fixtures: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

function newFixture(def: FixtureDef, originIn: SketchPoint): SketchFixture {
  return {
    id: `fx-${Math.random().toString(36).slice(2, 9)}`,
    slug: def.slug,
    label: def.label,
    x: originIn.x,
    y: originIn.y,
    widthInches: def.widthIn,
    heightInches: def.heightIn,
    rotationDeg: 0,
  };
}

function newRoom(name: string, originIn: SketchPoint): SketchRoom {
  return {
    id: `room-${Math.random().toString(36).slice(2, 9)}`,
    name,
    ceilingHeightInches: DEFAULT_CEILING_IN,
    points: [
      { x: originIn.x, y: originIn.y },
      { x: originIn.x + DEFAULT_ROOM_WIDTH_IN, y: originIn.y },
      { x: originIn.x + DEFAULT_ROOM_WIDTH_IN, y: originIn.y + DEFAULT_ROOM_HEIGHT_IN },
      { x: originIn.x, y: originIn.y + DEFAULT_ROOM_HEIGHT_IN },
    ],
    openings: [],
  };
}

function inchesToFeetInches(inches: number): string {
  const total = Math.round(inches);
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  if (ft === 0) return `${inch}"`;
  if (inch === 0) return `${ft}'`;
  return `${ft}' ${inch}"`;
}

interface EstimateRef {
  id: string;
  number: string;
  title: string;
  status: string;
}

export default function EstimateSketchPage() {
  const { id: estimateId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [estimate, setEstimate] = useState<EstimateRef | null>(null);
  const [sketch, setSketch] = useState<Sketch>(emptySketch());
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // Selected fixture id is mutually-exclusive with selectedRoomId — the
  // sidebar swaps between room editor and fixture editor.
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load estimate + existing sketch.
  useEffect(() => {
    if (!estimateId) return;
    let ignored = false;
    (async () => {
      try {
        const [est, s] = await Promise.all([
          api<{ estimate: EstimateRef }>(`/api/estimates/${estimateId}`),
          api<{ sketch: { data: Sketch } | null }>(`/api/estimates/${estimateId}/sketch`),
        ]);
        if (ignored) return;
        setEstimate(est.estimate);
        if (s.sketch?.data) {
          // Backfill fixtures[] for sketches saved before the field
          // existed so legacy data still loads cleanly.
          const data = s.sketch.data;
          if (!Array.isArray(data.fixtures)) data.fixtures = [];
          setSketch(data);
        }
      } catch (err) {
        if (!ignored) setError(err instanceof ApiError ? err.message : 'Failed to load sketch');
      }
    })();
    return () => {
      ignored = true;
    };
  }, [estimateId]);

  const totals = useMemo(() => sketchTotals(sketch), [sketch]);
  const selectedRoom = sketch.rooms.find((r) => r.id === selectedRoomId) ?? null;

  function patchRoom(roomId: string, patch: Partial<SketchRoom>) {
    setSketch((cur) => ({
      ...cur,
      rooms: cur.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
    }));
  }
  function patchPoint(roomId: string, idx: number, point: SketchPoint) {
    setSketch((cur) => ({
      ...cur,
      rooms: cur.rooms.map((r) =>
        r.id === roomId
          ? { ...r, points: r.points.map((p, i) => (i === idx ? point : p)) }
          : r,
      ),
    }));
  }
  function addRoom() {
    // Tile new rooms diagonally so they don't stack on top of each other.
    const offset = sketch.rooms.length * 24;
    const room = newRoom(`Room ${sketch.rooms.length + 1}`, { x: 60 + offset, y: 60 + offset });
    setSketch((cur) => ({ ...cur, rooms: [...cur.rooms, room] }));
    setSelectedRoomId(room.id);
  }
  function removeRoom(roomId: string) {
    if (!confirm('Delete this room? Openings on it will also be removed.')) return;
    setSketch((cur) => ({ ...cur, rooms: cur.rooms.filter((r) => r.id !== roomId) }));
    if (selectedRoomId === roomId) setSelectedRoomId(null);
  }
  function addOpening(roomId: string, kind: 'door' | 'window') {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const opening: SketchOpening = {
      id: `op-${Math.random().toString(36).slice(2, 9)}`,
      kind,
      widthInches: kind === 'door' ? 32 : 36,
      heightInches: kind === 'door' ? 80 : 36,
      wallIndex: 0,
      offsetInches: 12,
    };
    patchRoom(roomId, { openings: [...room.openings, opening] });
  }
  function patchOpening(roomId: string, openingId: string, patch: Partial<SketchOpening>) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    patchRoom(roomId, {
      openings: room.openings.map((o) => (o.id === openingId ? { ...o, ...patch } : o)),
    });
  }
  function removeOpening(roomId: string, openingId: string) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    patchRoom(roomId, { openings: room.openings.filter((o) => o.id !== openingId) });
  }

  // ─── Fixtures ───────────────────────────────────────────────────────
  const selectedFixture = sketch.fixtures.find((f) => f.id === selectedFixtureId) ?? null;

  function addFixture(def: FixtureDef) {
    // Stagger drops so a rapid series of clicks lands them in a row
    // rather than stacked on top of each other.
    const baseX = 200 + (sketch.fixtures.length % 4) * 40;
    const baseY = 200 + Math.floor(sketch.fixtures.length / 4) * 40;
    const fx = newFixture(def, { x: baseX, y: baseY });
    setSketch((cur) => ({ ...cur, fixtures: [...cur.fixtures, fx] }));
    setSelectedFixtureId(fx.id);
    setSelectedRoomId(null);
  }
  function patchFixture(id: string, patch: Partial<SketchFixture>) {
    setSketch((cur) => ({
      ...cur,
      fixtures: cur.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }
  function removeFixture(id: string) {
    setSketch((cur) => ({ ...cur, fixtures: cur.fixtures.filter((f) => f.id !== id) }));
    if (selectedFixtureId === id) setSelectedFixtureId(null);
  }

  // Drag — three kinds: room corner, whole room body, or fixture. The
  // handle keeps pointer capture so we don't lose drag state if the
  // cursor briefly leaves the SVG.
  const dragRef = useRef<
    | { kind: 'corner'; roomId: string; idx: number }
    | { kind: 'room'; roomId: string; lastInX: number; lastInY: number }
    | { kind: 'fixture'; fixtureId: string; offsetInX: number; offsetInY: number }
    | null
  >(null);
  function startCornerDrag(roomId: string, idx: number, e: React.PointerEvent) {
    dragRef.current = { kind: 'corner', roomId, idx };
    (e.target as SVGElement).setPointerCapture?.(e.pointerId);
  }
  function startRoomDrag(roomId: string, e: React.PointerEvent) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    dragRef.current = {
      kind: 'room',
      roomId,
      lastInX: (e.clientX - rect.left) / PX_PER_IN,
      lastInY: (e.clientY - rect.top) / PX_PER_IN,
    };
    setSelectedRoomId(roomId);
    setSelectedFixtureId(null);
    (e.target as SVGElement).setPointerCapture?.(e.pointerId);
  }
  function startFixtureDrag(fixture: SketchFixture, e: React.PointerEvent) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cursorInX = (e.clientX - rect.left) / PX_PER_IN;
    const cursorInY = (e.clientY - rect.top) / PX_PER_IN;
    dragRef.current = {
      kind: 'fixture',
      fixtureId: fixture.id,
      offsetInX: cursorInX - fixture.x,
      offsetInY: cursorInY - fixture.y,
    };
    setSelectedFixtureId(fixture.id);
    setSelectedRoomId(null);
    (e.target as SVGElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const snap = (n: number) => Math.round(n / 6) * 6; // 6" grid

    if (drag.kind === 'corner') {
      patchPoint(drag.roomId, drag.idx, { x: snap(px / PX_PER_IN), y: snap(py / PX_PER_IN) });
    } else if (drag.kind === 'room') {
      // Translate every point in the room by the cursor delta. Snap the
      // delta itself (not the absolute position) so the room slides on
      // a 6" grid without "jumping" if the cursor isn't aligned.
      const curInX = px / PX_PER_IN;
      const curInY = py / PX_PER_IN;
      const dx = snap(curInX - drag.lastInX);
      const dy = snap(curInY - drag.lastInY);
      if (dx === 0 && dy === 0) return;
      setSketch((cur) => ({
        ...cur,
        rooms: cur.rooms.map((r) =>
          r.id === drag.roomId
            ? { ...r, points: r.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : r,
        ),
      }));
      drag.lastInX += dx;
      drag.lastInY += dy;
    } else {
      patchFixture(drag.fixtureId, {
        x: snap(px / PX_PER_IN - drag.offsetInX),
        y: snap(py / PX_PER_IN - drag.offsetInY),
      });
    }
  }
  function endDrag() {
    dragRef.current = null;
  }

  // Delete key removes the selected fixture OR room. R rotates the
  // selected fixture 90° clockwise. Skips when typing in form inputs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFixtureId) {
          e.preventDefault();
          removeFixture(selectedFixtureId);
        } else if (selectedRoomId) {
          e.preventDefault();
          removeRoom(selectedRoomId);
        }
      }
      if ((e.key === 'r' || e.key === 'R') && selectedFixtureId) {
        const f = sketch.fixtures.find((x) => x.id === selectedFixtureId);
        if (f) patchFixture(f.id, { rotationDeg: (f.rotationDeg + 90) % 360 });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFixtureId, selectedRoomId, sketch.fixtures]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!estimateId) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/estimates/${estimateId}/sketch`, {
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
    if (!estimateId) return;
    // Prompt for the section label so multiple pushes (e.g. main floor
    // sketch + basement sketch) land in distinct subtotal blocks on
    // the estimate. Cancel = abort. Empty = use the server default
    // ("Floor sketch").
    const sectionTitle = prompt(
      'Section name for these line items?\n\nUse one section per area (e.g. "Kitchen", "Master bath", "Deck"). The estimate detail will subtotal everything in this section together.',
      'Floor sketch',
    );
    if (sectionTitle === null) return;
    try {
      await save();
      const r = await api<{ added: number; sectionTitle: string }>(
        `/api/estimates/${estimateId}/sketch/push-to-estimate`,
        {
          method: 'POST',
          body: JSON.stringify({ sectionTitle: sectionTitle.trim() || undefined }),
        },
      );
      alert(`Added ${r.added} line${r.added === 1 ? '' : 's'} to "${r.sectionTitle}".`);
      navigate(`/portal/estimates/${estimateId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Push failed');
    }
  }

  // Compute the SVG bounds so it fits whatever's drawn plus some
  // padding. Defaults to ~30'×24' if the sketch is empty.
  const bounds = useMemo(() => {
    let maxX = 360;
    let maxY = 288;
    for (const r of sketch.rooms) {
      for (const p of r.points) {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    for (const f of sketch.fixtures) {
      const halfW = f.widthInches / 2;
      const halfH = f.heightInches / 2;
      if (f.x + halfW > maxX) maxX = f.x + halfW;
      if (f.y + halfH > maxY) maxY = f.y + halfH;
    }
    return { width: ix(maxX + 60), height: ix(maxY + 60) };
  }, [sketch]);

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Sketch</h1>
          <p className="muted">
            {estimate ? (
              <>
                <Link to={`/portal/estimates/${estimate.id}`}>← {estimate.number}</Link>
                {' · '}
                <strong>{estimate.title}</strong>
              </>
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={addRoom}>+ Room</button>
          <button type="button" className="button-ghost" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save sketch'}
          </button>
          <button type="button" onClick={pushToEstimate}>Push totals to estimate</button>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <strong>Floor</strong>
            <div className="muted">{totals.floorSqft} sqft</div>
          </div>
          <div>
            <strong>Walls (net)</strong>
            <div className="muted">{totals.wallSqft} sqft</div>
          </div>
          <div>
            <strong>Ceiling</strong>
            <div className="muted">{totals.ceilingSqft} sqft</div>
          </div>
          <div>
            <strong>Perimeter</strong>
            <div className="muted">{totals.perimeterFeet} lf</div>
          </div>
          <div>
            <strong>Openings</strong>
            <div className="muted">{totals.openingCount}</div>
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
            {/* 1-foot grid for visual scale. */}
            <defs>
              <pattern id="grid-ft" width={ix(12)} height={ix(12)} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${ix(12)} 0 L 0 0 0 ${ix(12)}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-ft)" />

            {sketch.rooms.map((room) => {
              const path = room.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${ix(p.x)} ${ix(p.y)}`)
                .join(' ') + ' Z';
              const isSelected = room.id === selectedRoomId;
              return (
                <g
                  key={room.id}
                  onClick={() => {
                    setSelectedRoomId(room.id);
                    setSelectedFixtureId(null);
                  }}
                >
                  <path
                    d={path}
                    fill={isSelected ? 'rgba(88, 166, 255, 0.18)' : 'rgba(88, 166, 255, 0.08)'}
                    stroke="var(--accent)"
                    strokeWidth={isSelected ? 2 : 1.2}
                    style={{ cursor: 'grab', touchAction: 'none' }}
                    onPointerDown={(e) => {
                      // Only the body of the polygon drags the room —
                      // corner handles get their own onPointerDown that
                      // stops propagation, so they win when clicked.
                      startRoomDrag(room.id, e);
                    }}
                  />
                  {/* Corner handles — only render for the selected room
                      to keep the canvas readable when you have ten rooms. */}
                  {isSelected &&
                    room.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={ix(p.x)}
                        cy={ix(p.y)}
                        r={6}
                        fill="var(--accent)"
                        stroke="#fff"
                        strokeWidth={1.5}
                        style={{ cursor: 'grab', touchAction: 'none' }}
                        onPointerDown={(e) => {
                          // Stop the parent path's drag — corner wins.
                          e.stopPropagation();
                          startCornerDrag(room.id, i, e);
                        }}
                      />
                    ))}
                  {/* Room label at the centroid. */}
                  <text
                    x={ix(room.points.reduce((s, p) => s + p.x, 0) / room.points.length)}
                    y={ix(room.points.reduce((s, p) => s + p.y, 0) / room.points.length)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={12}
                    fill="var(--text)"
                    pointerEvents="none"
                  >
                    {room.name}
                  </text>
                  {/* Opening tick marks on the wall they're anchored to. */}
                  {room.openings.map((o) => {
                    const a = room.points[o.wallIndex]!;
                    const b = room.points[(o.wallIndex + 1) % room.points.length]!;
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx / len;
                    const uy = dy / len;
                    const sx = a.x + ux * o.offsetInches;
                    const sy = a.y + uy * o.offsetInches;
                    const ex = sx + ux * o.widthInches;
                    const ey = sy + uy * o.widthInches;
                    return (
                      <line
                        key={o.id}
                        x1={ix(sx)}
                        y1={ix(sy)}
                        x2={ix(ex)}
                        y2={ix(ey)}
                        stroke={o.kind === 'door' ? '#f6c343' : '#7ee787'}
                        strokeWidth={4}
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>
              );
            })}
            {/* Fixtures render on TOP of rooms — they're foreground
                objects sitting in / on the floor plan. Each is a
                draggable group: image + selection ring + label. */}
            {sketch.fixtures.map((f) => {
              const isSelected = f.id === selectedFixtureId;
              const w = f.widthInches;
              const h = f.heightInches;
              return (
                <g
                  key={f.id}
                  transform={`translate(${ix(f.x)}, ${ix(f.y)}) rotate(${f.rotationDeg})`}
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  onPointerDown={(e) => startFixtureDrag(f, e)}
                >
                  <image
                    href={fixtureIconUrl(f.slug)}
                    x={-ix(w) / 2}
                    y={-ix(h) / 2}
                    width={ix(w)}
                    height={ix(h)}
                    preserveAspectRatio="xMidYMid meet"
                  />
                  {isSelected && (
                    <rect
                      x={-ix(w) / 2 - 2}
                      y={-ix(h) / 2 - 2}
                      width={ix(w) + 4}
                      height={ix(h) + 4}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                </g>
              );
            })}
            {sketch.rooms.length === 0 && sketch.fixtures.length === 0 && (
              <text
                x={bounds.width / 2}
                y={bounds.height / 2}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize={14}
              >
                Click "+ Room" to start, or drop a fixture from the palette →
              </text>
            )}
          </svg>
        </section>

        <aside className="card" style={{ flex: '0 0 320px', maxWidth: '100%' }}>
          {selectedFixture ? (
            <FixtureEditor
              fixture={selectedFixture}
              onPatch={(patch) => patchFixture(selectedFixture.id, patch)}
              onRemove={() => removeFixture(selectedFixture.id)}
              onClose={() => setSelectedFixtureId(null)}
            />
          ) : selectedRoom ? (
            <RoomEditor
              room={selectedRoom}
              onPatch={(patch) => patchRoom(selectedRoom.id, patch)}
              onAddOpening={(kind) => addOpening(selectedRoom.id, kind)}
              onPatchOpening={(id, patch) => patchOpening(selectedRoom.id, id, patch)}
              onRemoveOpening={(id) => removeOpening(selectedRoom.id, id)}
              onRemove={() => removeRoom(selectedRoom.id)}
            />
          ) : (
            <FixturePalette
              onAdd={addFixture}
              onSelectRoom={(id) => setSelectedRoomId(id)}
              rooms={sketch.rooms}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function RoomEditor({
  room,
  onPatch,
  onAddOpening,
  onPatchOpening,
  onRemoveOpening,
  onRemove,
}: {
  room: SketchRoom;
  onPatch: (patch: Partial<SketchRoom>) => void;
  onAddOpening: (kind: 'door' | 'window') => void;
  onPatchOpening: (id: string, patch: Partial<SketchOpening>) => void;
  onRemoveOpening: (id: string) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <div className="row-between" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong>Room</strong>
        <button type="button" className="button-ghost button-small" onClick={onRemove}>
          Delete
        </button>
      </div>
      <label htmlFor="room-name" style={{ fontSize: '0.85rem' }}>Name</label>
      <input
        id="room-name"
        value={room.name}
        onChange={(e) => onPatch({ name: e.target.value })}
        style={{ marginBottom: '0.5rem' }}
      />
      <label htmlFor="room-ceiling" style={{ fontSize: '0.85rem' }}>Ceiling height (inches)</label>
      <input
        id="room-ceiling"
        type="number"
        min="48"
        max="240"
        value={room.ceilingHeightInches}
        onChange={(e) => onPatch({ ceilingHeightInches: Number(e.target.value) || 96 })}
        style={{ marginBottom: '0.75rem' }}
      />

      <div style={{ marginBottom: '0.5rem' }}>
        <strong>Openings</strong>{' '}
        <button
          type="button"
          className="button-ghost button-small"
          onClick={() => onAddOpening('door')}
        >
          + Door
        </button>{' '}
        <button
          type="button"
          className="button-ghost button-small"
          onClick={() => onAddOpening('window')}
        >
          + Window
        </button>
      </div>

      {room.openings.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>No openings yet.</p>
      ) : (
        <ul className="list" style={{ paddingLeft: 0 }}>
          {room.openings.map((o) => (
            <li key={o.id} style={{ borderBottom: '1px solid var(--border)', padding: '0.5rem 0' }}>
              <div className="row-between">
                <strong>{o.kind === 'door' ? 'Door' : 'Window'}</strong>
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => onRemoveOpening(o.id)}
                >
                  ×
                </button>
              </div>
              <div className="form-row">
                <div>
                  <label style={{ fontSize: '0.75rem' }}>Width (in)</label>
                  <input
                    type="number"
                    min="1"
                    value={o.widthInches}
                    onChange={(e) =>
                      onPatchOpening(o.id, { widthInches: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem' }}>Height (in)</label>
                  <input
                    type="number"
                    min="1"
                    value={o.heightInches}
                    onChange={(e) =>
                      onPatchOpening(o.id, { heightInches: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label style={{ fontSize: '0.75rem' }}>Wall</label>
                  <select
                    value={o.wallIndex}
                    onChange={(e) =>
                      onPatchOpening(o.id, { wallIndex: Number(e.target.value) })
                    }
                  >
                    {room.points.map((_, i) => (
                      <option key={i} value={i}>
                        Wall {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem' }}>From start (in)</label>
                  <input
                    type="number"
                    min="0"
                    value={o.offsetInches}
                    onChange={(e) =>
                      onPatchOpening(o.id, { offsetInches: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.75rem' }}>
        Floor area: <strong>{Math.round((roomFloorSqIn(room) / 144))}</strong> sqft
        {' · '}
        Perimeter: <strong>{inchesToFeetInches(roomPerimeterIn(room))}</strong>
      </p>
    </div>
  );
}

// Local copies of the math helpers — the imported sketchTotals does
// the whole-sketch rollup, but the room editor wants per-room totals
// without rebuilding a one-room sketch each render.
function roomFloorSqIn(room: SketchRoom): number {
  if (room.points.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i]!;
    const b = room.points[(i + 1) % room.points.length]!;
    acc += a.x * b.y - b.x * a.y;
  }
  return Math.abs(acc) / 2;
}
function roomPerimeterIn(room: SketchRoom): number {
  if (room.points.length < 2) return 0;
  let acc = 0;
  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i]!;
    const b = room.points[(i + 1) % room.points.length]!;
    acc += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return acc;
}

// ─── Fixture palette (default sidebar state) ──────────────────────────
//
// Click any thumbnail to drop the fixture onto the canvas. Each card
// shows its plan-view symbol so a rep can pick by recognizing the
// silhouette rather than reading labels. Categorized for discoverability.
function FixturePalette({
  onAdd,
  onSelectRoom,
  rooms,
}: {
  onAdd: (def: FixtureDef) => void;
  onSelectRoom: (id: string) => void;
  rooms: SketchRoom[];
}) {
  const groups: Array<{ key: string; label: string }> = [
    { key: 'bathroom', label: 'Bathroom' },
    { key: 'kitchen', label: 'Kitchen' },
    { key: 'laundry', label: 'Laundry' },
    { key: 'mechanical', label: 'Mechanical' },
    { key: 'electrical', label: 'Electrical' },
    { key: 'misc', label: 'Other' },
  ];
  return (
    <div>
      <strong>Fixtures</strong>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0.75rem' }}>
        Click to drop. Drag to reposition. Press <kbd>R</kbd> to rotate, <kbd>Delete</kbd> to remove.
      </p>
      {groups.map((g) => {
        const items = FIXTURE_CATALOG.filter((f) => f.category === g.key);
        if (items.length === 0) return null;
        return (
          <div key={g.key} style={{ marginBottom: '0.75rem' }}>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>{g.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {items.map((f) => (
                <button
                  key={f.slug}
                  type="button"
                  onClick={() => onAdd(f)}
                  title={`${f.label} (${f.widthIn}"×${f.heightIn}")`}
                  style={{
                    aspectRatio: '1',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 4,
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={fixtureIconUrl(f.slug)}
                    alt={f.label}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {rooms.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.75rem', paddingTop: '0.5rem' }}>
            <strong>Rooms</strong>
          </div>
          <ul style={{ paddingLeft: '1.25rem' }}>
            {rooms.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => onSelectRoom(r.id)}
                  style={{ padding: '2px 6px' }}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Fixture editor (selection state) ────────────────────────────────
//
// Inline editor for a single placed fixture: rename, resize, rotate,
// delete. Saved values flow back through the parent's `onPatch`.
function FixtureEditor({
  fixture,
  onPatch,
  onRemove,
  onClose,
}: {
  fixture: SketchFixture;
  onPatch: (patch: Partial<SketchFixture>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const def = fixtureBySlug(fixture.slug);
  return (
    <div>
      <div className="row-between" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong>{def?.label ?? 'Fixture'}</strong>
        <button type="button" className="button-ghost button-small" onClick={onClose}>
          ✕
        </button>
      </div>
      <img
        src={fixtureIconUrl(fixture.slug)}
        alt={fixture.label}
        style={{
          width: '100%',
          maxWidth: 120,
          margin: '0 auto 0.75rem',
          display: 'block',
          background: 'var(--surface)',
          borderRadius: 6,
          padding: 4,
        }}
      />
      <label style={{ fontSize: '0.85rem' }}>Label (shown on the estimate line)</label>
      <input
        value={fixture.label}
        onChange={(e) => onPatch({ label: e.target.value })}
        style={{ marginBottom: '0.5rem' }}
      />
      <div className="form-row">
        <div>
          <label style={{ fontSize: '0.75rem' }}>Width (in)</label>
          <input
            type="number"
            min="1"
            value={fixture.widthInches}
            onChange={(e) => onPatch({ widthInches: Number(e.target.value) || 1 })}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem' }}>Depth (in)</label>
          <input
            type="number"
            min="1"
            value={fixture.heightInches}
            onChange={(e) => onPatch({ heightInches: Number(e.target.value) || 1 })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          className="button-ghost button-small"
          onClick={() => onPatch({ rotationDeg: (fixture.rotationDeg + 90) % 360 })}
          title="Rotate 90° clockwise (or press R)"
        >
          ↻ Rotate ({fixture.rotationDeg}°)
        </button>
        <button
          type="button"
          className="button-ghost button-small"
          style={{ marginLeft: 'auto', color: 'var(--danger, #dc2626)' }}
          onClick={onRemove}
        >
          Delete
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.75rem' }}>
        Position: {Math.round(fixture.x / 12)}'{' '}{Math.round(fixture.x % 12)}", {Math.round(fixture.y / 12)}'{' '}{Math.round(fixture.y % 12)}"
      </p>
    </div>
  );
}
