// Geometry helpers for the EstimateSketch model. Imported by both the
// server (validation + persisted totals) and the client (live preview)
// so the math always agrees. Inches in, inches/sqft out.
//
// Coordinate system: SVG-style — origin at top-left, +x right, +y down.
// All measurements live in inches so we never accumulate float drift.
// Display layer converts to feet at render time.

export interface SketchPoint {
  x: number; // inches
  y: number; // inches
}

export interface SketchOpening {
  id: string;
  kind: 'door' | 'window';
  widthInches: number;
  heightInches: number;
  // Index into the room's `points` array; the opening sits on the edge
  // from points[wallIndex] to points[(wallIndex + 1) % points.length].
  wallIndex: number;
  // Distance along that wall from the start vertex, in inches.
  offsetInches: number;
}

export interface SketchRoom {
  id: string;
  name: string;
  ceilingHeightInches: number;
  points: SketchPoint[];
  openings: SketchOpening[];
}

// A placed fixture symbol on the sketch — toilet, sink, range, etc.
// Each entry references one of the catalog slugs (e.g. "fixtures/toilet")
// and carries its plan-view position + rotation in inches/degrees.
// Width and height inches default to the catalog's footprint but the
// rep can override per-instance (e.g. a 72" custom vanity).
export interface SketchFixture {
  id: string;
  // Catalog slug; the client renders the matching webp from
  // /media/sketcher/<slug-with-underscores>.webp.
  slug: string;
  // Free-form display label (defaults to the catalog label, but the
  // rep can rename "Toilet" → "ADA toilet" for the line item that
  // gets pushed to the estimate).
  label: string;
  // Plan-view center, in inches (same coordinate system as room points).
  x: number;
  y: number;
  // Footprint — drawn axis-aligned. Rotation pivots around the center.
  widthInches: number;
  heightInches: number;
  rotationDeg: number; // 0, 90, 180, 270 — UI snaps to 90°.
}

export interface Sketch {
  version: 1;
  rooms: SketchRoom[];
  // Fixtures live at the sketch level (not per-room) so the rep can
  // place them freely — a kitchen island sink doesn't have to belong
  // to a "kitchen" room polygon.
  fixtures: SketchFixture[];
  viewport?: { x: number; y: number; scale: number };
}

export interface SketchTotals {
  floorSqft: number;
  ceilingSqft: number;
  wallSqft: number;
  perimeterFeet: number;
  openingCount: number;
  // Per-fixture-type counts (e.g. { toilet: 2, vanity: 1 }). Keyed by
  // the catalog slug's last segment so the consumer doesn't have to
  // parse "fixtures/toilet" itself. Empty object when no fixtures.
  fixtureCounts: Record<string, number>;
}

// Polygon area via the shoelace formula. Returns square inches.
function polygonAreaSquareInches(points: SketchPoint[]): number {
  if (points.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    acc += a.x * b.y - b.x * a.y;
  }
  return Math.abs(acc) / 2;
}

function distanceInches(a: SketchPoint, b: SketchPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function perimeterInches(points: SketchPoint[]): number {
  if (points.length < 2) return 0;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    acc += distanceInches(points[i]!, points[(i + 1) % points.length]!);
  }
  return acc;
}

// Per-room math. Wall area is the perimeter × ceiling height, minus
// the silhouette area of every opening. Doors and windows count the
// same way for now — both are subtractions; a future refinement could
// track door rough-out vs. trim separately.
export function roomTotals(room: SketchRoom): {
  floorSqIn: number;
  ceilingSqIn: number;
  wallSqIn: number;
  perimeterIn: number;
  openingCount: number;
} {
  const floorSqIn = polygonAreaSquareInches(room.points);
  const perimeterIn = perimeterInches(room.points);
  const ceilingHeight = Math.max(0, room.ceilingHeightInches || 0);
  const grossWallSqIn = perimeterIn * ceilingHeight;
  const openingsSqIn = room.openings.reduce(
    (s, o) => s + Math.max(0, o.widthInches) * Math.max(0, o.heightInches),
    0,
  );
  const wallSqIn = Math.max(0, grossWallSqIn - openingsSqIn);
  return {
    floorSqIn,
    ceilingSqIn: floorSqIn,
    wallSqIn,
    perimeterIn,
    openingCount: room.openings.length,
  };
}

// Roll the whole sketch up to the totals we persist. All values are
// rounded to the nearest whole foot / sqft on output so totals match
// what the user sees in the estimator.
export function sketchTotals(sketch: Sketch): SketchTotals {
  let floorSqIn = 0;
  let ceilingSqIn = 0;
  let wallSqIn = 0;
  let perimeterIn = 0;
  let openingCount = 0;
  for (const room of sketch.rooms) {
    const t = roomTotals(room);
    floorSqIn += t.floorSqIn;
    ceilingSqIn += t.ceilingSqIn;
    wallSqIn += t.wallSqIn;
    perimeterIn += t.perimeterIn;
    openingCount += t.openingCount;
  }
  const fixtureCounts: Record<string, number> = {};
  for (const f of sketch.fixtures ?? []) {
    const key = f.slug.split('/').pop() ?? f.slug;
    fixtureCounts[key] = (fixtureCounts[key] ?? 0) + 1;
  }
  // 144 sq inches per sqft, 12 inches per foot.
  return {
    floorSqft: Math.round(floorSqIn / 144),
    ceilingSqft: Math.round(ceilingSqIn / 144),
    wallSqft: Math.round(wallSqIn / 144),
    perimeterFeet: Math.round(perimeterIn / 12),
    openingCount,
    fixtureCounts,
  };
}

// Defensive validator — accepts arbitrary JSON, returns a normalized
// Sketch or throws. Used on the server before persistence so a bad
// payload from a (compromised or buggy) client can't poison the model.
export function parseSketch(raw: unknown): Sketch {
  if (!raw || typeof raw !== 'object') throw new Error('Sketch must be an object');
  const obj = raw as Record<string, unknown>;
  const version = obj.version === 1 ? 1 : null;
  if (version !== 1) throw new Error('Unsupported sketch version');
  const rawRooms = Array.isArray(obj.rooms) ? obj.rooms : [];
  const rooms: SketchRoom[] = rawRooms.map((r, idx) => {
    const ro = r as Record<string, unknown>;
    if (!ro || typeof ro !== 'object') {
      throw new Error(`Room ${idx} is not an object`);
    }
    const points = Array.isArray(ro.points) ? ro.points : [];
    if (points.length < 3) throw new Error(`Room ${idx} needs at least 3 points`);
    const normalizedPoints: SketchPoint[] = points.map((p, pi) => {
      const po = p as Record<string, unknown>;
      const x = Number(po?.x);
      const y = Number(po?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Room ${idx} point ${pi} has bad coords`);
      }
      return { x, y };
    });
    const openings = Array.isArray(ro.openings) ? ro.openings : [];
    const normalizedOpenings: SketchOpening[] = openings.map((o, oi) => {
      const oo = o as Record<string, unknown>;
      const wallIndex = Number(oo?.wallIndex);
      if (!Number.isInteger(wallIndex) || wallIndex < 0 || wallIndex >= normalizedPoints.length) {
        throw new Error(`Opening ${oi} on room ${idx} has bad wallIndex`);
      }
      return {
        id: typeof oo?.id === 'string' ? (oo.id as string) : `op-${idx}-${oi}`,
        kind: oo?.kind === 'window' ? 'window' : 'door',
        widthInches: Math.max(0, Number(oo?.widthInches) || 0),
        heightInches: Math.max(0, Number(oo?.heightInches) || 0),
        wallIndex,
        offsetInches: Math.max(0, Number(oo?.offsetInches) || 0),
      };
    });
    return {
      id: typeof ro.id === 'string' ? (ro.id as string) : `room-${idx}`,
      name: typeof ro.name === 'string' ? (ro.name as string).slice(0, 60) : `Room ${idx + 1}`,
      ceilingHeightInches: Math.max(0, Number(ro.ceilingHeightInches) || 96),
      points: normalizedPoints,
      openings: normalizedOpenings,
    };
  });
  const rawFixtures = Array.isArray(obj.fixtures) ? obj.fixtures : [];
  const fixtures: SketchFixture[] = rawFixtures.map((f, fi) => {
    const fo = f as Record<string, unknown>;
    if (!fo || typeof fo !== 'object') throw new Error(`Fixture ${fi} is not an object`);
    const slug = typeof fo.slug === 'string' ? (fo.slug as string) : '';
    if (!/^fixtures\/[a-z0-9-]+$/.test(slug)) {
      throw new Error(`Fixture ${fi} has bad slug: ${slug}`);
    }
    const x = Number(fo.x);
    const y = Number(fo.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Fixture ${fi} has bad coords`);
    }
    return {
      id: typeof fo.id === 'string' ? (fo.id as string) : `fx-${fi}`,
      slug,
      label: typeof fo.label === 'string' ? (fo.label as string).slice(0, 60) : slug.split('/').pop() ?? 'Fixture',
      x,
      y,
      widthInches: Math.max(1, Number(fo.widthInches) || 24),
      heightInches: Math.max(1, Number(fo.heightInches) || 24),
      rotationDeg: ((Number(fo.rotationDeg) || 0) % 360 + 360) % 360,
    };
  });
  const viewport = obj.viewport as { x?: unknown; y?: unknown; scale?: unknown } | undefined;
  return {
    version: 1,
    rooms,
    fixtures,
    viewport: viewport
      ? {
          x: Number(viewport.x) || 0,
          y: Number(viewport.y) || 0,
          scale: Number(viewport.scale) || 1,
        }
      : { x: 0, y: 0, scale: 1 },
  };
}
