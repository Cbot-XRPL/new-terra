// Visual estimator scenes — hand-built SVG diagrams with hotspot regions
// each mapped to an assembly name. The picker page resolves the name to a
// real Assembly row at click time so admin can swap the underlying lines
// without touching this file.
//
// Adding a scene is two things:
//   1. Append to the SCENES array below.
//   2. Make sure the catalog has assemblies whose names match the
//      `assemblyName` strings; the picker will show an "unmapped" hint
//      otherwise so the admin knows what to create.

export interface Hotspot {
  id: string;
  label: string;
  // Free-text name the catalog API will be searched against. Loose match
  // (case-insensitive, contains) so small wording differences ("Composite
  // deck — 16x20" vs "Composite Deck 16x20") still resolve.
  assemblyName: string;
  // SVG-space geometry. We render the scene in a fixed 800×500 viewBox so
  // the page can scale it however it likes without re-doing math here.
  shape:
    | { kind: 'rect'; x: number; y: number; w: number; h: number }
    | { kind: 'circle'; cx: number; cy: number; r: number }
    | { kind: 'polygon'; points: string };
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  // Whatever you draw inside <svg viewBox="0 0 800 500">.
  drawing: string;
  hotspots: Hotspot[];
  // Optional generated-image backdrop. When the admin "Generate"s an
  // image for the slug, the SVG drawing renders on top of the image
  // (semi-transparent diagrammatic overlay). Without an image, only
  // the SVG renders — matches the legacy look.
  imageSlug?: string;
}

// Build a deck cross-section: ledger board, joists, decking, posts, footings.
const DECK_CROSS_SECTION: Scene = {
  id: 'deck-cross-section',
  name: 'Deck cross-section',
  description: 'Click components to add their material assemblies to your estimate.',
  imageSlug: 'estimator/deck-cross-section',
  drawing: `
    <!-- ground line -->
    <line x1="0" y1="430" x2="800" y2="430" stroke="#5f6368" stroke-width="2" />
    <text x="10" y="448" fill="#bdc1c6" font-size="12">grade</text>

    <!-- house wall on the left -->
    <rect x="0" y="40" width="60" height="390" fill="#3c4043" />
    <text x="14" y="80" fill="#e8eaed" font-size="12" transform="rotate(-90, 14, 80)">house</text>

    <!-- ledger board -->
    <rect x="60" y="170" width="20" height="40" fill="#aecbfa" />

    <!-- joists -->
    <g fill="#8ab4f8">
      <rect x="80" y="180" width="500" height="20" />
    </g>

    <!-- decking surface -->
    <rect x="80" y="160" width="600" height="14" fill="#aecbfa" />

    <!-- railing -->
    <line x1="100" y1="160" x2="100" y2="100" stroke="#bdc1c6" stroke-width="3" />
    <line x1="660" y1="160" x2="660" y2="100" stroke="#bdc1c6" stroke-width="3" />
    <line x1="100" y1="100" x2="660" y2="100" stroke="#bdc1c6" stroke-width="3" />

    <!-- post -->
    <rect x="540" y="200" width="20" height="180" fill="#5f6368" />
    <rect x="630" y="200" width="20" height="180" fill="#5f6368" />

    <!-- footings -->
    <ellipse cx="550" cy="430" rx="34" ry="10" fill="#5f6368" />
    <ellipse cx="640" cy="430" rx="34" ry="10" fill="#5f6368" />

    <!-- annotations -->
    <text x="80" y="250" fill="#e8eaed" font-size="12">framing</text>
    <text x="200" y="150" fill="#e8eaed" font-size="12">decking</text>
    <text x="380" y="92" fill="#e8eaed" font-size="12">railing</text>
    <text x="560" y="395" fill="#e8eaed" font-size="12">post + footing</text>
  `,
  hotspots: [
    {
      id: 'decking',
      label: 'Decking surface',
      assemblyName: 'Composite deck',
      shape: { kind: 'rect', x: 80, y: 152, w: 600, h: 22 },
    },
    {
      id: 'framing',
      label: 'Framing',
      assemblyName: 'Rough framing labor',
      shape: { kind: 'rect', x: 80, y: 175, w: 460, h: 30 },
    },
    {
      id: 'railing',
      label: 'Railing',
      assemblyName: 'Deck railing',
      shape: { kind: 'rect', x: 100, y: 95, w: 560, h: 14 },
    },
    {
      id: 'footing',
      label: 'Posts + footings',
      assemblyName: 'Sonotube footing',
      shape: { kind: 'rect', x: 530, y: 195, w: 130, h: 240 },
    },
  ],
};

// Bathroom plan view: tub, toilet, vanity, tile floor.
const BATHROOM_PLAN: Scene = {
  id: 'bathroom-plan',
  name: 'Bathroom plan view',
  description: 'Drop standard fixture rough-ins and finish assemblies.',
  imageSlug: 'estimator/bathroom-plan',
  drawing: `
    <!-- room outline -->
    <rect x="100" y="60" width="600" height="380" fill="#292a2d" stroke="#5f6368" stroke-width="3" />

    <!-- tub -->
    <rect x="120" y="80" width="200" height="100" fill="#3c4043" rx="10" />
    <text x="220" y="138" fill="#e8eaed" font-size="14" text-anchor="middle">tub</text>

    <!-- toilet (back) -->
    <rect x="360" y="80" width="80" height="50" fill="#3c4043" rx="6" />
    <ellipse cx="400" cy="160" rx="32" ry="40" fill="#3c4043" />
    <text x="400" y="168" fill="#e8eaed" font-size="12" text-anchor="middle">toilet</text>

    <!-- vanity -->
    <rect x="520" y="80" width="160" height="100" fill="#3c4043" />
    <text x="600" y="138" fill="#e8eaed" font-size="14" text-anchor="middle">vanity</text>

    <!-- shower? door swing -->
    <line x1="120" y1="180" x2="320" y2="180" stroke="#5f6368" stroke-width="2" stroke-dasharray="4 4" />

    <!-- tile floor area -->
    <text x="400" y="380" fill="#bdc1c6" font-size="14" text-anchor="middle">tile floor</text>
    <pattern id="tile" patternUnits="userSpaceOnUse" width="40" height="40">
      <rect width="40" height="40" fill="none" stroke="#5f6368" stroke-width="1" />
    </pattern>
    <rect x="100" y="240" width="600" height="200" fill="url(#tile)" opacity="0.4" />
  `,
  hotspots: [
    {
      id: 'tub',
      label: 'Tub install',
      assemblyName: 'Tub rough-in',
      shape: { kind: 'rect', x: 120, y: 80, w: 200, h: 100 },
    },
    {
      id: 'toilet',
      label: 'Toilet rough-in',
      assemblyName: 'Toilet rough-in',
      shape: { kind: 'circle', cx: 400, cy: 130, r: 60 },
    },
    {
      id: 'vanity',
      label: 'Vanity install',
      assemblyName: 'Vanity install',
      shape: { kind: 'rect', x: 520, y: 80, w: 160, h: 100 },
    },
    {
      id: 'tile',
      label: 'Tile floor',
      assemblyName: 'Tile floor',
      shape: { kind: 'rect', x: 100, y: 240, w: 600, h: 200 },
    },
  ],
};

// Driveway / hardscape: base, edging, surface, drainage.
const DRIVEWAY_PLAN: Scene = {
  id: 'driveway-plan',
  name: 'Driveway / hardscape plan',
  description: 'Layered scopes — base prep, edging, surface, and drainage.',
  imageSlug: 'estimator/driveway-plan',
  drawing: `
    <rect x="60" y="60" width="680" height="380" fill="#292a2d" stroke="#5f6368" stroke-width="3" />

    <!-- base layer -->
    <rect x="80" y="80" width="640" height="80" fill="#5f6368" />
    <text x="400" y="124" fill="#e8eaed" font-size="14" text-anchor="middle">compacted base</text>

    <!-- surface (paver) -->
    <rect x="80" y="180" width="640" height="160" fill="#aecbfa" opacity="0.5" />
    <text x="400" y="266" fill="#e8eaed" font-size="14" text-anchor="middle">paver / concrete surface</text>

    <!-- edging -->
    <rect x="60" y="80" width="20" height="340" fill="#8ab4f8" />
    <rect x="720" y="80" width="20" height="340" fill="#8ab4f8" />
    <text x="32" y="240" fill="#bdc1c6" font-size="12" text-anchor="middle">edge</text>

    <!-- drain channel along the bottom -->
    <rect x="80" y="380" width="640" height="40" fill="#3c4043" />
    <text x="400" y="406" fill="#e8eaed" font-size="14" text-anchor="middle">French drain</text>
  `,
  hotspots: [
    {
      id: 'base',
      label: 'Base prep',
      assemblyName: 'Driveway base prep',
      shape: { kind: 'rect', x: 80, y: 80, w: 640, h: 80 },
    },
    {
      id: 'surface',
      label: 'Surface install',
      assemblyName: 'Paver surface',
      shape: { kind: 'rect', x: 80, y: 180, w: 640, h: 160 },
    },
    {
      id: 'edging',
      label: 'Edging',
      assemblyName: 'Hardscape edging',
      shape: { kind: 'polygon', points: '60,80 80,80 80,420 60,420 720,420 740,420 740,80 720,80' },
    },
    {
      id: 'drain',
      label: 'French drain',
      assemblyName: 'French drain',
      shape: { kind: 'rect', x: 80, y: 380, w: 640, h: 40 },
    },
  ],
};

// Kitchen plan view: cabinets, island, range, fridge, sink.
const KITCHEN_PLAN: Scene = {
  id: 'kitchen-plan',
  name: 'Kitchen plan view',
  description: 'Cabinets, island, and rough-ins for a kitchen remodel.',
  imageSlug: 'estimator/kitchen-plan',
  drawing: `
    <!-- room outline -->
    <rect x="80" y="60" width="640" height="380" fill="#292a2d" stroke="#5f6368" stroke-width="3" />

    <!-- perimeter cabinets (top + right run) -->
    <rect x="80" y="60" width="640" height="60" fill="#3c4043" />
    <rect x="640" y="120" width="80" height="240" fill="#3c4043" />

    <!-- range -->
    <rect x="320" y="60" width="80" height="60" fill="#5f6368" />
    <text x="360" y="98" fill="#e8eaed" font-size="12" text-anchor="middle">range</text>

    <!-- fridge -->
    <rect x="120" y="60" width="80" height="60" fill="#5f6368" />
    <text x="160" y="98" fill="#e8eaed" font-size="12" text-anchor="middle">fridge</text>

    <!-- sink in the perimeter run -->
    <rect x="500" y="74" width="100" height="36" fill="#3c4043" stroke="#aecbfa" stroke-width="2" />
    <text x="550" y="98" fill="#e8eaed" font-size="12" text-anchor="middle">sink</text>

    <!-- island -->
    <rect x="240" y="220" width="320" height="100" fill="#3c4043" />
    <text x="400" y="278" fill="#e8eaed" font-size="14" text-anchor="middle">island</text>

    <!-- floor -->
    <text x="400" y="400" fill="#bdc1c6" font-size="14" text-anchor="middle">flooring</text>
    <pattern id="kitchen-floor" patternUnits="userSpaceOnUse" width="40" height="40">
      <rect width="40" height="40" fill="none" stroke="#5f6368" stroke-width="1" />
    </pattern>
    <rect x="80" y="340" width="640" height="100" fill="url(#kitchen-floor)" opacity="0.4" />
  `,
  hotspots: [
    {
      id: 'cabinets',
      label: 'Cabinets',
      assemblyName: 'Kitchen cabinets',
      shape: { kind: 'polygon', points: '80,60 720,60 720,360 640,360 640,120 80,120' },
    },
    {
      id: 'island',
      label: 'Island',
      assemblyName: 'Kitchen island',
      shape: { kind: 'rect', x: 240, y: 220, w: 320, h: 100 },
    },
    {
      id: 'range',
      label: 'Range rough-in',
      assemblyName: 'Range rough-in',
      shape: { kind: 'rect', x: 320, y: 60, w: 80, h: 60 },
    },
    {
      id: 'sink',
      label: 'Sink rough-in',
      assemblyName: 'Sink rough-in',
      shape: { kind: 'rect', x: 500, y: 74, w: 100, h: 36 },
    },
    {
      id: 'flooring',
      label: 'Flooring',
      assemblyName: 'Kitchen flooring',
      shape: { kind: 'rect', x: 80, y: 340, w: 640, h: 100 },
    },
  ],
};

// Wood fence side elevation: posts, rails, pickets, gate.
const FENCE_ELEVATION: Scene = {
  id: 'fence-elevation',
  name: 'Wood fence elevation',
  description: 'Side elevation of a privacy fence run with a gate.',
  imageSlug: 'estimator/fence-elevation',
  drawing: `
    <!-- ground -->
    <line x1="0" y1="400" x2="800" y2="400" stroke="#5f6368" stroke-width="2" />
    <text x="10" y="420" fill="#bdc1c6" font-size="12">grade</text>

    <!-- posts -->
    <rect x="80"  y="120" width="20" height="280" fill="#5f6368" />
    <rect x="260" y="120" width="20" height="280" fill="#5f6368" />
    <rect x="440" y="120" width="20" height="280" fill="#5f6368" />
    <rect x="620" y="120" width="20" height="280" fill="#5f6368" />

    <!-- pickets between posts -->
    <g fill="#aecbfa">
      <rect x="100" y="160" width="160" height="240" />
      <rect x="280" y="160" width="160" height="240" />
      <rect x="460" y="160" width="160" height="240" />
    </g>

    <!-- top + bottom rails (just the visible faces) -->
    <rect x="80" y="160" width="560" height="10" fill="#8ab4f8" />
    <rect x="80" y="380" width="560" height="10" fill="#8ab4f8" />

    <!-- gate (middle bay rendered slightly separated) -->
    <rect x="280" y="170" width="160" height="220" fill="none" stroke="#f9ab00" stroke-width="3" stroke-dasharray="6 4" />
    <text x="360" y="280" fill="#e8eaed" font-size="14" text-anchor="middle">gate</text>

    <!-- footings under the posts -->
    <ellipse cx="90"  cy="400" rx="22" ry="6" fill="#5f6368" />
    <ellipse cx="270" cy="400" rx="22" ry="6" fill="#5f6368" />
    <ellipse cx="450" cy="400" rx="22" ry="6" fill="#5f6368" />
    <ellipse cx="630" cy="400" rx="22" ry="6" fill="#5f6368" />

    <text x="180" y="148" fill="#e8eaed" font-size="12" text-anchor="middle">pickets</text>
    <text x="640" y="148" fill="#e8eaed" font-size="12" text-anchor="middle">post</text>
  `,
  hotspots: [
    {
      id: 'posts',
      label: 'Posts + footings',
      assemblyName: 'Fence post',
      shape: { kind: 'rect', x: 70, y: 120, w: 580, h: 290 },
    },
    {
      id: 'pickets',
      label: 'Pickets + rails',
      assemblyName: 'Fence pickets',
      shape: { kind: 'rect', x: 100, y: 160, w: 540, h: 240 },
    },
    {
      id: 'gate',
      label: 'Gate',
      assemblyName: 'Fence gate',
      shape: { kind: 'rect', x: 280, y: 170, w: 160, h: 220 },
    },
  ],
};

// Hardscape patio plan: patio surface, walkway, fire pit, seating wall.
const PATIO_PLAN: Scene = {
  id: 'patio-plan',
  name: 'Patio / hardscape plan',
  description: 'Paver patio with walkway, fire pit, and seating wall.',
  imageSlug: 'estimator/patio-plan',
  drawing: `
    <rect x="60" y="60" width="680" height="380" fill="#292a2d" stroke="#5f6368" stroke-width="3" />

    <!-- patio slab -->
    <rect x="180" y="100" width="440" height="240" fill="#aecbfa" opacity="0.5" />
    <text x="400" y="226" fill="#e8eaed" font-size="14" text-anchor="middle">paver patio</text>

    <!-- walkway leading off to the right edge -->
    <rect x="620" y="220" width="120" height="60" fill="#aecbfa" opacity="0.4" />
    <text x="680" y="256" fill="#e8eaed" font-size="12" text-anchor="middle">walkway</text>

    <!-- fire pit (circle) -->
    <circle cx="320" cy="220" r="38" fill="#3c4043" stroke="#aecbfa" stroke-width="2" />
    <text x="320" y="226" fill="#e8eaed" font-size="12" text-anchor="middle">fire pit</text>

    <!-- seating wall along the back edge -->
    <rect x="180" y="100" width="440" height="20" fill="#5f6368" />
    <text x="400" y="92" fill="#bdc1c6" font-size="12" text-anchor="middle">seat wall</text>

    <!-- edge restraints -->
    <rect x="170" y="100" width="10" height="240" fill="#8ab4f8" />
    <rect x="620" y="100" width="10" height="240" fill="#8ab4f8" />
    <rect x="180" y="340" width="440" height="10" fill="#8ab4f8" />
  `,
  hotspots: [
    {
      id: 'patio',
      label: 'Paver patio',
      assemblyName: 'Paver patio',
      shape: { kind: 'rect', x: 180, y: 120, w: 440, h: 220 },
    },
    {
      id: 'walkway',
      label: 'Walkway',
      assemblyName: 'Paver walkway',
      shape: { kind: 'rect', x: 620, y: 220, w: 120, h: 60 },
    },
    {
      id: 'firepit',
      label: 'Fire pit',
      assemblyName: 'Fire pit',
      shape: { kind: 'circle', cx: 320, cy: 220, r: 44 },
    },
    {
      id: 'seatwall',
      label: 'Seating wall',
      assemblyName: 'Seating wall',
      shape: { kind: 'rect', x: 180, y: 100, w: 440, h: 20 },
    },
    {
      id: 'edging',
      label: 'Edge restraints',
      assemblyName: 'Hardscape edging',
      shape: { kind: 'polygon', points: '170,100 180,100 180,350 170,350 630,350 630,100 620,100 620,340 180,340 180,340' },
    },
  ],
};

// Basement remodel plan: framed walls, bathroom, family room, mechanical.
const BASEMENT_PLAN: Scene = {
  id: 'basement-plan',
  name: 'Basement remodel plan',
  description: 'Framed-out basement with bath, family room, and mechanical.',
  imageSlug: 'estimator/basement-plan',
  drawing: `
    <!-- foundation outline -->
    <rect x="60" y="60" width="680" height="380" fill="#292a2d" stroke="#5f6368" stroke-width="3" />

    <!-- partition walls -->
    <rect x="60"  y="240" width="320" height="6" fill="#5f6368" />
    <rect x="380" y="60"  width="6"   height="200" fill="#5f6368" />
    <rect x="380" y="240" width="360" height="6" fill="#5f6368" />

    <!-- bathroom -->
    <rect x="80" y="80" width="160" height="140" fill="#3c4043" />
    <rect x="100" y="100" width="60" height="40" fill="#5f6368" />
    <ellipse cx="200" cy="130" rx="16" ry="22" fill="#5f6368" />
    <text x="160" y="200" fill="#e8eaed" font-size="12" text-anchor="middle">bath</text>

    <!-- bedroom -->
    <rect x="260" y="80" width="100" height="140" fill="#3c4043" />
    <text x="310" y="158" fill="#e8eaed" font-size="12" text-anchor="middle">bedroom</text>

    <!-- family room -->
    <rect x="400" y="80" width="320" height="140" fill="#3c4043" />
    <text x="560" y="158" fill="#e8eaed" font-size="14" text-anchor="middle">family room</text>

    <!-- mechanical / utility -->
    <rect x="80" y="260" width="220" height="160" fill="#3c4043" />
    <text x="190" y="346" fill="#e8eaed" font-size="12" text-anchor="middle">mechanical</text>

    <!-- finished flooring (rest of basement) -->
    <pattern id="basement-floor" patternUnits="userSpaceOnUse" width="40" height="40">
      <rect width="40" height="40" fill="none" stroke="#5f6368" stroke-width="1" />
    </pattern>
    <rect x="320" y="260" width="400" height="160" fill="url(#basement-floor)" opacity="0.35" />
    <text x="520" y="346" fill="#bdc1c6" font-size="12" text-anchor="middle">flooring</text>
  `,
  hotspots: [
    {
      id: 'framing',
      label: 'Wall framing',
      assemblyName: 'Basement framing',
      shape: { kind: 'rect', x: 60, y: 60, w: 680, h: 380 },
    },
    {
      id: 'bath',
      label: 'Basement bath',
      assemblyName: 'Basement bath',
      shape: { kind: 'rect', x: 80, y: 80, w: 160, h: 140 },
    },
    {
      id: 'bedroom',
      label: 'Bedroom',
      assemblyName: 'Basement bedroom',
      shape: { kind: 'rect', x: 260, y: 80, w: 100, h: 140 },
    },
    {
      id: 'familyroom',
      label: 'Family room',
      assemblyName: 'Basement family room',
      shape: { kind: 'rect', x: 400, y: 80, w: 320, h: 140 },
    },
    {
      id: 'mechanical',
      label: 'Mechanical',
      assemblyName: 'Basement mechanical',
      shape: { kind: 'rect', x: 80, y: 260, w: 220, h: 160 },
    },
    {
      id: 'flooring',
      label: 'Finished flooring',
      assemblyName: 'Basement flooring',
      shape: { kind: 'rect', x: 320, y: 260, w: 400, h: 160 },
    },
  ],
};

// Roof framing plan: ridge, hips, valleys, rafters.
const ROOF_PLAN: Scene = {
  id: 'roof-plan',
  name: 'Roof framing plan',
  description: 'Top-down hip roof with ridge, hips, and rafter layout.',
  imageSlug: 'estimator/roof-plan',
  drawing: `
    <!-- house footprint -->
    <rect x="120" y="80" width="560" height="340" fill="#292a2d" stroke="#5f6368" stroke-width="3" />

    <!-- hip lines from corners to ridge -->
    <line x1="120" y1="80"  x2="280" y2="200" stroke="#aecbfa" stroke-width="2" />
    <line x1="680" y1="80"  x2="520" y2="200" stroke="#aecbfa" stroke-width="2" />
    <line x1="120" y1="420" x2="280" y2="300" stroke="#aecbfa" stroke-width="2" />
    <line x1="680" y1="420" x2="520" y2="300" stroke="#aecbfa" stroke-width="2" />

    <!-- ridge -->
    <line x1="280" y1="250" x2="520" y2="250" stroke="#f9ab00" stroke-width="3" />
    <text x="400" y="240" fill="#e8eaed" font-size="12" text-anchor="middle">ridge</text>

    <!-- hip end seams -->
    <line x1="280" y1="200" x2="280" y2="300" stroke="#aecbfa" stroke-width="2" />
    <line x1="520" y1="200" x2="520" y2="300" stroke="#aecbfa" stroke-width="2" />

    <!-- rafters (faint) -->
    <g stroke="#5f6368" stroke-width="1">
      <line x1="160" y1="80"  x2="160" y2="420" />
      <line x1="200" y1="80"  x2="200" y2="420" />
      <line x1="240" y1="80"  x2="240" y2="420" />
      <line x1="320" y1="80"  x2="320" y2="420" />
      <line x1="360" y1="80"  x2="360" y2="420" />
      <line x1="400" y1="80"  x2="400" y2="420" />
      <line x1="440" y1="80"  x2="440" y2="420" />
      <line x1="480" y1="80"  x2="480" y2="420" />
      <line x1="560" y1="80"  x2="560" y2="420" />
      <line x1="600" y1="80"  x2="600" y2="420" />
      <line x1="640" y1="80"  x2="640" y2="420" />
    </g>

    <!-- shingle areas (the four slopes) -->
    <text x="400" y="124" fill="#bdc1c6" font-size="12" text-anchor="middle">front slope</text>
    <text x="400" y="380" fill="#bdc1c6" font-size="12" text-anchor="middle">back slope</text>
    <text x="180" y="254" fill="#bdc1c6" font-size="12" text-anchor="middle">end</text>
    <text x="620" y="254" fill="#bdc1c6" font-size="12" text-anchor="middle">end</text>

    <!-- gutters along the eaves -->
    <rect x="120" y="416" width="560" height="6" fill="#8ab4f8" />
    <rect x="120" y="78"  width="560" height="6" fill="#8ab4f8" />
  `,
  hotspots: [
    {
      id: 'shingles',
      label: 'Shingles',
      assemblyName: 'Asphalt shingles',
      shape: { kind: 'rect', x: 120, y: 80, w: 560, h: 340 },
    },
    {
      id: 'framing',
      label: 'Roof framing',
      assemblyName: 'Roof framing',
      shape: { kind: 'rect', x: 120, y: 80, w: 560, h: 340 },
    },
    {
      id: 'ridge',
      label: 'Ridge + hips',
      assemblyName: 'Ridge cap',
      shape: { kind: 'rect', x: 280, y: 240, w: 240, h: 20 },
    },
    {
      id: 'gutters',
      label: 'Gutters',
      assemblyName: 'Gutters',
      shape: { kind: 'polygon', points: '120,76 680,76 680,90 120,90 120,416 680,416 680,430 120,430' },
    },
  ],
};

export const SCENES: Scene[] = [
  DECK_CROSS_SECTION,
  BATHROOM_PLAN,
  DRIVEWAY_PLAN,
  KITCHEN_PLAN,
  FENCE_ELEVATION,
  PATIO_PLAN,
  BASEMENT_PLAN,
  ROOF_PLAN,
];
