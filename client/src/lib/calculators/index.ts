// Quick estimating calculators — pure functions so they're trivially unit-
// testable later, and so the calculator page can re-use them without round-
// tripping to the server.
//
// All inputs are plain numbers in obvious units (feet, inches, square feet,
// cubic yards). The UI layer is responsible for unit-converting before the
// call. We round outputs in a way each trade actually orders — e.g. mulch
// rounds up to 0.25 cubic yards because that's the smallest delivery unit.

export interface CalcResult {
  primary: { label: string; value: string }; // headline answer
  breakdown: Array<{ label: string; value: string }>;
  notes?: string[];
}

function roundUpTo(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}

// --- Mulch / gravel coverage ---
//
// Coverage = areaSqft * (depthInches/12) ÷ 27 cu ft/cu yd.
// Bagged mulch is typically 2 cu ft per bag.
export function mulchCoverage(input: { areaSqft: number; depthInches: number }): CalcResult {
  const cuyd = (input.areaSqft * (input.depthInches / 12)) / 27;
  const cuydRounded = roundUpTo(cuyd, 0.25);
  const bags = Math.ceil((cuyd * 27) / 2); // 2 cu ft bags
  return {
    primary: {
      label: 'Bulk mulch',
      value: `${cuydRounded.toFixed(2)} cu yd`,
    },
    breakdown: [
      { label: 'Exact volume', value: `${cuyd.toFixed(2)} cu yd` },
      { label: 'In cubic feet', value: `${(cuyd * 27).toFixed(0)} cu ft` },
      { label: 'Bagged equivalent (2 cu ft bags)', value: `${bags} bags` },
    ],
    notes: [
      'Bulk delivery rounds up to the nearest quarter yard.',
      'Add ~10% for settling on rough beds; this calculation assumes a level surface.',
    ],
  };
}

// --- Concrete (slab / pad) ---
//
// Volume = length * width * depth in feet, ÷ 27 = cu yd. Bagged concrete
// (60 lb yields 0.45 cu ft, 80 lb yields 0.60 cu ft) is shown for small jobs.
export function concreteSlab(input: {
  lengthFt: number;
  widthFt: number;
  depthInches: number;
}): CalcResult {
  const cuft = input.lengthFt * input.widthFt * (input.depthInches / 12);
  const cuyd = cuft / 27;
  const sixty = Math.ceil(cuft / 0.45);
  const eighty = Math.ceil(cuft / 0.6);
  return {
    primary: { label: 'Concrete', value: `${roundUpTo(cuyd, 0.25).toFixed(2)} cu yd` },
    breakdown: [
      { label: 'Cubic feet', value: cuft.toFixed(1) },
      { label: 'Exact cubic yards', value: cuyd.toFixed(2) },
      { label: '60 lb bags (~0.45 cu ft each)', value: `${sixty} bags` },
      { label: '80 lb bags (~0.60 cu ft each)', value: `${eighty} bags` },
    ],
    notes: [
      'Order ~10% over for spillage / over-fill on small pours.',
      'Trucks have a 1 cu yd minimum; bag up jobs under that.',
    ],
  };
}

// --- Retaining wall (stackable block) ---
//
// Assumes a standard concrete block face of 12" wide × 4" tall (most basic
// segmental units). Capstone rounds the top course. Buried first course is
// recommended for stability; we surface that as a note.
export function retainingWall(input: {
  lengthFt: number;
  heightInches: number;
  blockWidthInches?: number; // default 12
  blockHeightInches?: number; // default 4
}): CalcResult {
  const blockW = input.blockWidthInches ?? 12;
  const blockH = input.blockHeightInches ?? 4;
  const lengthIn = input.lengthFt * 12;
  const courses = Math.ceil(input.heightInches / blockH);
  const blocksPerCourse = Math.ceil(lengthIn / blockW);
  const blocks = courses * blocksPerCourse;
  const capstone = blocksPerCourse;
  const baseGravelCuyd = roundUpTo(
    (input.lengthFt * 1 * (4 / 12)) / 27, // 1ft wide × 4" deep base trench
    0.25,
  );
  return {
    primary: { label: 'Wall blocks', value: `${blocks} blocks` },
    breakdown: [
      { label: 'Courses tall', value: String(courses) },
      { label: 'Blocks per course', value: String(blocksPerCourse) },
      { label: 'Capstone (top course)', value: `${capstone} caps` },
      { label: 'Base gravel (1 ft wide × 4" deep)', value: `${baseGravelCuyd.toFixed(2)} cu yd` },
    ],
    notes: [
      `Block size assumed: ${blockW}" wide × ${blockH}" tall. Adjust if your block is different.`,
      'Bury the first course halfway for stability; add a course to the count if you do.',
      'Walls over 4 ft tall typically need engineered drainage + permits — check local code.',
    ],
  };
}

// --- Deck framing (joists + beams) ---
//
// Joist count = length / spacing + 1, plus 2 perimeter joists.
// Beam count is just 1 for a free-standing rim, 2 for a span layout.
export function deckFraming(input: {
  lengthFt: number; // along the joists
  widthFt: number; // perpendicular (the span)
  joistSpacingInches: number; // 16 or 12
  joistLumberLengthFt: number; // typically nearest 2ft increment
}): CalcResult {
  const spacingFt = input.joistSpacingInches / 12;
  // Field joists across the deck length, plus perimeter (rim) joists.
  const fieldJoists = Math.ceil(input.lengthFt / spacingFt) + 1;
  const perimeterJoists = 2;
  const totalJoists = fieldJoists + perimeterJoists;
  // Beams ≈ 2 (front and back), each made of 2 plies of dimensional lumber.
  const beamPlies = 2 * Math.ceil(input.lengthFt / 16); // assume 16ft beam stock
  const decking = input.lengthFt * input.widthFt;
  const decksLf = Math.ceil((decking / (5.5 / 12)) * 1.05); // 5.5" board face + 5% waste
  return {
    primary: { label: 'Field joists', value: `${totalJoists} joists` },
    breakdown: [
      { label: 'Joist spacing', value: `${input.joistSpacingInches}" o.c.` },
      { label: 'Joist length stock', value: `${input.joistLumberLengthFt} ft each` },
      { label: 'Beam plies (16 ft stock, 2x assumption)', value: `${beamPlies} plies` },
      { label: 'Decking surface', value: `${decking} sqft` },
      { label: 'Decking lf (5.5" board, +5% waste)', value: `${decksLf} lf` },
    ],
    notes: [
      'Joist count includes 2 perimeter rim joists on top of the field count.',
      'Beam estimate assumes 2 ply 2x10/2x12 with 16 ft stock. Re-run if your design uses LVLs or longer spans.',
    ],
  };
}

// --- Paint coverage ---
//
// One gallon = ~350 sqft single coat. Two coats is the realistic default.
// Subtract openings (doors/windows). Round up to the nearest gallon.
export function paintCoverage(input: {
  wallSqft: number;
  openingsSqft?: number;
  coats?: number; // default 2
  coveragePerGallonSqft?: number; // default 350
}): CalcResult {
  const opening = input.openingsSqft ?? 0;
  const coats = input.coats ?? 2;
  const coverage = input.coveragePerGallonSqft ?? 350;
  const paintable = Math.max(0, input.wallSqft - opening);
  const gallons = Math.ceil((paintable * coats) / coverage);
  const quartsForTouchup = Math.ceil(paintable / coverage / 4); // ~1 qt extra per 4 gallons
  return {
    primary: { label: 'Paint', value: `${gallons} gal` },
    breakdown: [
      { label: 'Paintable area', value: `${paintable.toFixed(0)} sqft` },
      { label: 'Coats', value: String(coats) },
      { label: 'Coverage assumption', value: `${coverage} sqft / gal` },
      { label: 'Touch-up extra (qts)', value: `${quartsForTouchup} qt` },
    ],
    notes: [
      'Coverage drops on raw drywall, dark colours, and rough textures — bump by 25% if any apply.',
      'Trim, doors, and ceilings are not included; calculate separately.',
    ],
  };
}

// --- Fence post + panel count ---
//
// Posts = ceil(length / spacing) + 1. Panels = posts - 1 (if linear; closed
// loops would differ but residential fences are almost always linear).
export function fenceLayout(input: {
  lengthFt: number;
  postSpacingFt: number;
  hasGates?: number; // count of single 4ft gate openings
}): CalcResult {
  const usableLength = Math.max(0, input.lengthFt - (input.hasGates ?? 0) * 4);
  const sections = Math.ceil(usableLength / input.postSpacingFt);
  const posts = sections + 1;
  const concreteBags = posts * 2; // 2 bags per post hole, fast-set 50lb
  return {
    primary: { label: 'Posts', value: `${posts} posts` },
    breakdown: [
      { label: 'Sections', value: `${sections} sections` },
      { label: 'Section spacing', value: `${input.postSpacingFt} ft` },
      { label: 'Concrete (~2 bags/post)', value: `${concreteBags} bags` },
      ...(input.hasGates ? [{ label: 'Gate posts (extra-deep)', value: `${(input.hasGates ?? 0) * 2} posts` }] : []),
    ],
    notes: [
      'Doubles up posts on either side of each gate — already counted in the post total.',
      'Local frost depth determines hole depth. Standard rural Georgia is 24", colder zones 36"+.',
    ],
  };
}
