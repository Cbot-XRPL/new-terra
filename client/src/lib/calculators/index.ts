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
// --- Drywall sheets ---
//
// Sheets = ceil(area / sheet area). Default sheet is 4×8 (32 sqft). Mud
// + tape + corner bead are estimated per 1000 sqft of board.
export function drywall(input: {
  wallSqft: number;
  sheetSqft?: number;
  cornerLf?: number; // linear feet of inside/outside corners
}): CalcResult {
  const sheetSize = input.sheetSqft ?? 32;
  const sheets = Math.ceil(input.wallSqft / sheetSize);
  // ~3.5 gal of all-purpose mud per 1000 sqft of board, 1 roll tape per 250 sqft.
  const mudGal = Math.ceil((input.wallSqft / 1000) * 3.5);
  const tapeRolls = Math.ceil(input.wallSqft / 250);
  const screws5lb = Math.ceil(input.wallSqft / 1000); // ~1 box per 1000 sqft
  const corner = input.cornerLf ? Math.ceil(input.cornerLf / 8) : 0; // 8' bead pieces
  return {
    primary: { label: 'Drywall sheets', value: `${sheets} sheets` },
    breakdown: [
      { label: 'Sheet size assumed', value: `${sheetSize} sqft (e.g. 4×8)` },
      { label: 'Joint compound', value: `${mudGal} gal` },
      { label: 'Joint tape', value: `${tapeRolls} rolls (250 lf each)` },
      { label: 'Screws (5 lb boxes)', value: `${screws5lb} box(es)` },
      ...(corner ? [{ label: 'Corner bead (8 lf pieces)', value: `${corner} pcs` }] : []),
    ],
    notes: [
      'Coverage rounds up; cuts are figured into the sheet count assumption.',
      'Switch to 4×12 sheets on large open ceilings to reduce seams (set sheetSqft=48).',
    ],
  };
}

// --- Sonotube footings (round concrete pier) ---
//
// Volume per pier = π × r² × depth. Diameter is the most common variable
// for residential decks (10" or 12" common).
export function sonotubeFooting(input: {
  diameterInches: number;
  depthFt: number;
  count: number;
}): CalcResult {
  const r = input.diameterInches / 2 / 12; // ft
  const cuFtPer = Math.PI * r * r * input.depthFt;
  const totalCuFt = cuFtPer * input.count;
  const cuYd = totalCuFt / 27;
  const eightyBags = Math.ceil(totalCuFt / 0.6);
  return {
    primary: { label: 'Concrete', value: `${roundUpTo(cuYd, 0.25).toFixed(2)} cu yd` },
    breakdown: [
      { label: 'Per footing', value: `${cuFtPer.toFixed(2)} cu ft` },
      { label: 'All footings', value: `${totalCuFt.toFixed(1)} cu ft` },
      { label: '80 lb bags', value: `${eightyBags}` },
    ],
    notes: [
      'Local frost depth wins — the depthFt input must clear it (24" GA, 36"+ TN/NC mountains).',
      'Add 5–10% for over-fill at the top.',
    ],
  };
}

// --- Tile floor coverage ---
//
// Tiles = ceil(area / tile area) + 10% waste (more for diagonal layouts).
export function tileFloor(input: {
  areaSqft: number;
  tileSizeInches: number; // square tile, e.g. 12 for 12x12
  wastePct?: number;
}): CalcResult {
  const tileSqft = (input.tileSizeInches * input.tileSizeInches) / 144;
  const waste = (input.wastePct ?? 10) / 100;
  // Round to 6 decimals before ceiling so e.g. 100 × 1.1 = 110.000…0001
  // doesn't push us up to 111 tiles.
  const raw = (input.areaSqft / tileSqft) * (1 + waste);
  const tiles = Math.ceil(Math.round(raw * 1_000_000) / 1_000_000);
  const thinsetBags = Math.ceil(input.areaSqft / 95); // ~95 sqft per 50lb bag of thinset
  const groutLb = Math.ceil(input.areaSqft / 100); // very rough — depends on joint width
  return {
    primary: { label: 'Tiles', value: `${tiles} pcs` },
    breakdown: [
      { label: 'Tile size', value: `${input.tileSizeInches}" × ${input.tileSizeInches}"` },
      { label: 'Waste assumed', value: `${(waste * 100).toFixed(0)}%` },
      { label: 'Thinset (50 lb bags @ ~95 sqft)', value: `${thinsetBags}` },
      { label: 'Grout (rough)', value: `${groutLb} lb` },
    ],
    notes: [
      'Bump waste to 15% for diagonal / herringbone, 20% for mosaics.',
      'Buy from one dye lot — tiles vary across runs.',
    ],
  };
}

// --- Asphalt sealcoat ---
//
// Sealer coverage ≈ 80 sqft/gal for fresh asphalt, less for very rough.
export function asphaltSealcoat(input: {
  drivewaySqft: number;
  coats?: number;
  coverageSqftPerGal?: number;
}): CalcResult {
  const coats = input.coats ?? 2;
  const coverage = input.coverageSqftPerGal ?? 80;
  const gallons = Math.ceil((input.drivewaySqft * coats) / coverage);
  // 5-gal pails are the standard retail format.
  const pails = Math.ceil(gallons / 5);
  return {
    primary: { label: 'Sealer', value: `${gallons} gal` },
    breakdown: [
      { label: 'Coats', value: String(coats) },
      { label: 'Coverage assumption', value: `${coverage} sqft / gal` },
      { label: '5 gal pails', value: `${pails}` },
    ],
    notes: [
      'Rough or porous asphalt drops coverage to ~60 sqft/gal.',
      'Crack filler is separate — measure crack lf and budget ~1 gal per 80 lf.',
    ],
  };
}

// --- Drainage gravel (French drain trench) ---
//
// Trench volume = length × width × depth. Subtract pipe volume so the gravel
// estimate isn't over-stated.
export function frenchDrain(input: {
  trenchLengthFt: number;
  trenchWidthInches: number;
  trenchDepthInches: number;
  pipeDiameterInches?: number; // default 4
}): CalcResult {
  const widthFt = input.trenchWidthInches / 12;
  const depthFt = input.trenchDepthInches / 12;
  const trenchCuFt = input.trenchLengthFt * widthFt * depthFt;
  const pipeR = (input.pipeDiameterInches ?? 4) / 2 / 12;
  const pipeCuFt = Math.PI * pipeR * pipeR * input.trenchLengthFt;
  const gravelCuFt = Math.max(0, trenchCuFt - pipeCuFt);
  const gravelCuYd = gravelCuFt / 27;
  return {
    primary: { label: 'Drainage gravel', value: `${roundUpTo(gravelCuYd, 0.25).toFixed(2)} cu yd` },
    breakdown: [
      { label: 'Trench volume', value: `${trenchCuFt.toFixed(1)} cu ft` },
      { label: 'Pipe displacement', value: `${pipeCuFt.toFixed(1)} cu ft` },
      { label: 'Pipe length', value: `${input.trenchLengthFt} lf` },
      { label: 'Filter fabric', value: `${Math.ceil(input.trenchLengthFt * (widthFt + 1))} sqft` },
    ],
    notes: [
      'Wrap pipe in fabric to keep silt out; the surface area accounts for over-wrap.',
      'Slope at least 1% — every 100 ft drops 12".',
    ],
  };
}

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
