// Roof geometry helpers. A facet is a polygon in plan view + a pitch
// (rise per 12" run). All measurements are inches in / inches&sqft out
// of internal helpers; the public rollup returns whole feet/sqft.
//
// Edge classification at the boundary between two facets:
//   - both pitches > 0, sloping AWAY from each other  → RIDGE
//     (shared edge sits at the highest point of both)
//   - both pitches > 0, sloping TOWARD each other     → VALLEY
//     (water collects in the seam)
//   - both pitches > 0, perpendicular slopes          → HIP
//     (corner that comes off the ridge)
//
// The simple-and-good-enough heuristic: classify by the cross product
// of the two facets' downhill directions. Two opposing downhill
// directions → ridge or valley (decided by edge direction relative to
// downhill); perpendicular → hip.
//
// Solo edges (only one facet touches them) classify by their plan
// orientation relative to the facet's downhill direction:
//   - parallel to downhill → RAKE (slopes up)
//   - perpendicular to downhill → EAVE (gutter line)

export interface RoofPoint {
  x: number; // inches
  y: number; // inches
}

export interface RoofFacet {
  id: string;
  name: string;
  // Rise per 12" run. Integer pitch is the construction-industry
  // norm (4/12, 6/12, 12/12). 0 means a flat / membrane roof.
  pitchOver12: number;
  // Polygon vertices in plan view, oriented counter-clockwise. The
  // facet's downhill direction is encoded by the first edge — the
  // facet slopes downward from points[0]→points[1] in the plan-view
  // perpendicular. (Convention: first edge is the eave / lowest edge.)
  points: RoofPoint[];
}

export interface RoofSketch {
  version: 1;
  facets: RoofFacet[];
  viewport?: { x: number; y: number; scale: number };
}

export type EdgeKind = 'ridge' | 'hip' | 'valley' | 'rake' | 'eave';

export interface RoofTotals {
  surfaceSqft: number;
  ridgeFeet: number;
  hipFeet: number;
  valleyFeet: number;
  rakeFeet: number;
  eaveFeet: number;
  facetCount: number;
}

function polyAreaSqIn(points: RoofPoint[]): number {
  if (points.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    acc += a.x * b.y - b.x * a.y;
  }
  return Math.abs(acc) / 2;
}

function edgeLengthIn(a: RoofPoint, b: RoofPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Pitch multiplier: a roof with 6/12 pitch has a true length 12 / 12
// = 1.118 × the plan-view length along the direction of slope.
// Horizontal edges (eaves, ridges) keep plan length.
function slopeMultiplier(pitchOver12: number): number {
  return Math.sqrt(1 + (pitchOver12 / 12) * (pitchOver12 / 12));
}

// Per-facet true surface area = plan area × slope multiplier.
export function facetSurfaceAreaSqIn(f: RoofFacet): number {
  return polyAreaSqIn(f.points) * slopeMultiplier(f.pitchOver12);
}

// Facet's downhill direction in plan view. By convention the first
// edge is the eave (horizontal at the bottom of the slope), so the
// downhill direction is the inward perpendicular to that edge.
function downhillUnitVector(f: RoofFacet): { dx: number; dy: number } {
  if (f.points.length < 2) return { dx: 0, dy: 1 };
  const a = f.points[0]!;
  const b = f.points[1]!;
  // Edge runs a→b. Inward perpendicular (counter-clockwise polygon)
  // is (-(by-ay), (bx-ax)) — but we want INWARD which depends on
  // winding. For CCW, inward = ( (by-ay), -(bx-ax) ). Normalize.
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  return { dx: ey / len, dy: -ex / len };
}

// Are two unit vectors roughly opposite? (cosθ < -0.7 ≈ angles >135°)
function areOpposite(a: { dx: number; dy: number }, b: { dx: number; dy: number }): boolean {
  return a.dx * b.dx + a.dy * b.dy < -0.7;
}

// Edges canonicalized as a sorted-pair key so we can look up shared
// edges between facets without depending on direction. Round to 1"
// to absorb floating-point drift between vertex placements.
function edgeKey(a: RoofPoint, b: RoofPoint): string {
  const ax = Math.round(a.x);
  const ay = Math.round(a.y);
  const bx = Math.round(b.x);
  const by = Math.round(b.y);
  if (ax < bx || (ax === bx && ay <= by)) {
    return `${ax},${ay}|${bx},${by}`;
  }
  return `${bx},${by}|${ax},${ay}`;
}

// Classify a single edge between two facets, given the edge endpoints
// (already shared) and the two facets' downhill vectors.
function classifyShared(
  edgeStart: RoofPoint,
  edgeEnd: RoofPoint,
  fA: RoofFacet,
  fB: RoofFacet,
): 'ridge' | 'hip' | 'valley' {
  const dA = downhillUnitVector(fA);
  const dB = downhillUnitVector(fB);
  if (areOpposite(dA, dB)) {
    // Two slopes diving away from each other → ridge.
    // Two slopes diving toward each other → valley. Differentiate by
    // which side of the edge each facet sits on.
    // Vector along the edge:
    const ex = edgeEnd.x - edgeStart.x;
    const ey = edgeEnd.y - edgeStart.y;
    // Outward normal (right-hand) of the edge:
    const nx = ey;
    const ny = -ex;
    const len = Math.hypot(nx, ny) || 1;
    const nux = nx / len;
    const nuy = ny / len;
    // facet A's centroid relative to edge start
    const cA = facetCentroid(fA);
    const cAx = cA.x - edgeStart.x;
    const cAy = cA.y - edgeStart.y;
    const aSide = cAx * nux + cAy * nuy; // positive if A is on the +n side
    // dA is downhill of A — if dA points TOWARD the edge (i.e. opposite
    // to A-side normal), A drains toward the edge → valley.
    const aDrainsToEdge = (dA.dx * -nux + dA.dy * -nuy) > 0 ? aSide > 0 : aSide < 0;
    return aDrainsToEdge ? 'valley' : 'ridge';
  }
  // Otherwise (perpendicular-ish) → hip.
  return 'hip';
}

// Classify a solo edge by its orientation relative to the facet's
// downhill direction.
function classifySolo(
  a: RoofPoint,
  b: RoofPoint,
  facet: RoofFacet,
): 'rake' | 'eave' {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  const eu = { dx: ex / len, dy: ey / len };
  const d = downhillUnitVector(facet);
  // If the edge is perpendicular to downhill, it's an eave (or ridge,
  // but ridges always have a partner facet so they're caught earlier).
  // If the edge is parallel-ish to downhill, it's a rake.
  return Math.abs(eu.dx * d.dx + eu.dy * d.dy) > 0.5 ? 'rake' : 'eave';
}

function facetCentroid(f: RoofFacet): RoofPoint {
  const n = f.points.length || 1;
  const sx = f.points.reduce((s, p) => s + p.x, 0);
  const sy = f.points.reduce((s, p) => s + p.y, 0);
  return { x: sx / n, y: sy / n };
}

export function roofTotals(sketch: RoofSketch): RoofTotals {
  let surfaceSqIn = 0;
  let ridgeIn = 0;
  let hipIn = 0;
  let valleyIn = 0;
  let rakeIn = 0;
  let eaveIn = 0;

  // Pre-compute facet edges + an index keyed by edgeKey so we can find
  // the partner facet (if any) for every edge in O(n).
  const edgeIndex = new Map<string, Array<{ facetIdx: number; a: RoofPoint; b: RoofPoint }>>();
  sketch.facets.forEach((f, fi) => {
    surfaceSqIn += facetSurfaceAreaSqIn(f);
    for (let i = 0; i < f.points.length; i++) {
      const a = f.points[i]!;
      const b = f.points[(i + 1) % f.points.length]!;
      const key = edgeKey(a, b);
      const arr = edgeIndex.get(key) ?? [];
      arr.push({ facetIdx: fi, a, b });
      edgeIndex.set(key, arr);
    }
  });

  for (const [, list] of edgeIndex) {
    if (list.length === 0) continue;
    const first = list[0]!;
    const len = edgeLengthIn(first.a, first.b);
    if (list.length === 1) {
      const f = sketch.facets[first.facetIdx]!;
      const kind = classifySolo(first.a, first.b, f);
      // Solo edges keep plan length unless it's a rake (slopes up the
      // pitch). Eave is horizontal in plan view → keep plan length.
      const trueLen = kind === 'rake' ? len * slopeMultiplier(f.pitchOver12) : len;
      if (kind === 'rake') rakeIn += trueLen;
      else eaveIn += trueLen;
    } else if (list.length >= 2) {
      // Shared edge: classify and add length once.
      const fA = sketch.facets[list[0]!.facetIdx]!;
      const fB = sketch.facets[list[1]!.facetIdx]!;
      const kind = classifyShared(first.a, first.b, fA, fB);
      // Ridge stays horizontal → plan length. Hip & valley follow the
      // average slope of the adjacent facets to a first approximation.
      let trueLen = len;
      if (kind === 'hip' || kind === 'valley') {
        const avgPitch = (fA.pitchOver12 + fB.pitchOver12) / 2;
        // Hip/valley travel diagonally — true length combines the
        // horizontal run + the rise. √(1 + (pitch/12)²) is the slope
        // multiplier; for a hip running diagonally across the roof we
        // approximate it as the same multiplier applied to the plan
        // edge. Good enough for material estimation; survey-grade math
        // would require triangulating in 3-space.
        trueLen = len * slopeMultiplier(avgPitch);
      }
      if (kind === 'ridge') ridgeIn += trueLen;
      else if (kind === 'hip') hipIn += trueLen;
      else valleyIn += trueLen;
    }
  }

  return {
    surfaceSqft: Math.round(surfaceSqIn / 144),
    ridgeFeet: Math.round(ridgeIn / 12),
    hipFeet: Math.round(hipIn / 12),
    valleyFeet: Math.round(valleyIn / 12),
    rakeFeet: Math.round(rakeIn / 12),
    eaveFeet: Math.round(eaveIn / 12),
    facetCount: sketch.facets.length,
  };
}

// Public helper — used by the client for color-coding edges in the SVG
// view without forcing it to re-implement the classifier. Returns one
// row per facet edge (so a shared edge appears twice — once per facet)
// so renderers can paint each facet's contribution independently.
//
// `aIndex` / `bIndex` reference indices into the facet's points array.
export interface ClassifiedEdge {
  facetIndex: number;
  aIndex: number;
  bIndex: number;
  kind: EdgeKind;
}

export function classifyEdges(sketch: RoofSketch): ClassifiedEdge[] {
  // Same edgeIndex bucketing as roofTotals — kept separate (not refactored
  // into a shared helper) because roofTotals also wants the side-effect of
  // accumulating edge lengths, and the cost of running this twice for a
  // sketch with a few dozen facets is negligible.
  const edgeIndex = new Map<string, Array<{ facetIdx: number; aIdx: number; bIdx: number; a: RoofPoint; b: RoofPoint }>>();
  sketch.facets.forEach((f, fi) => {
    for (let i = 0; i < f.points.length; i++) {
      const aIdx = i;
      const bIdx = (i + 1) % f.points.length;
      const a = f.points[aIdx]!;
      const b = f.points[bIdx]!;
      const key = edgeKey(a, b);
      const arr = edgeIndex.get(key) ?? [];
      arr.push({ facetIdx: fi, aIdx, bIdx, a, b });
      edgeIndex.set(key, arr);
    }
  });

  const out: ClassifiedEdge[] = [];
  for (const [, list] of edgeIndex) {
    if (list.length === 0) continue;
    const first = list[0]!;
    if (list.length === 1) {
      const f = sketch.facets[first.facetIdx]!;
      const kind = classifySolo(first.a, first.b, f);
      out.push({ facetIndex: first.facetIdx, aIndex: first.aIdx, bIndex: first.bIdx, kind });
    } else {
      const fA = sketch.facets[list[0]!.facetIdx]!;
      const fB = sketch.facets[list[1]!.facetIdx]!;
      const kind = classifyShared(first.a, first.b, fA, fB);
      // Emit one row per participating facet so client renderers can
      // color the edge from each side cleanly.
      for (const entry of list) {
        out.push({ facetIndex: entry.facetIdx, aIndex: entry.aIdx, bIndex: entry.bIdx, kind });
      }
    }
  }
  return out;
}

// Defensive parser — same pattern as parseSketch in sketchMath.ts.
export function parseRoofSketch(raw: unknown): RoofSketch {
  if (!raw || typeof raw !== 'object') throw new Error('Roof sketch must be an object');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new Error('Unsupported roof sketch version');
  const rawFacets = Array.isArray(obj.facets) ? obj.facets : [];
  const facets: RoofFacet[] = rawFacets.map((f, i) => {
    const fo = f as Record<string, unknown>;
    if (!fo || typeof fo !== 'object') throw new Error(`Facet ${i} is not an object`);
    const points = Array.isArray(fo.points) ? fo.points : [];
    if (points.length < 3) throw new Error(`Facet ${i} needs at least 3 points`);
    const normalizedPoints: RoofPoint[] = points.map((p, pi) => {
      const po = p as Record<string, unknown>;
      const x = Number(po?.x);
      const y = Number(po?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Facet ${i} point ${pi} has bad coords`);
      }
      return { x, y };
    });
    const pitch = Number(fo.pitchOver12);
    return {
      id: typeof fo.id === 'string' ? (fo.id as string) : `facet-${i}`,
      name: typeof fo.name === 'string' ? (fo.name as string).slice(0, 60) : `Facet ${i + 1}`,
      pitchOver12: Number.isFinite(pitch) && pitch >= 0 && pitch <= 24 ? pitch : 6,
      points: normalizedPoints,
    };
  });
  const vp = obj.viewport as { x?: unknown; y?: unknown; scale?: unknown } | undefined;
  return {
    version: 1,
    facets,
    viewport: vp
      ? {
          x: Number(vp.x) || 0,
          y: Number(vp.y) || 0,
          scale: Number(vp.scale) || 1,
        }
      : { x: 0, y: 0, scale: 1 },
  };
}
