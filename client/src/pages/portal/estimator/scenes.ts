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

export const SCENES: Scene[] = [DECK_CROSS_SECTION, BATHROOM_PLAN, DRIVEWAY_PLAN];
