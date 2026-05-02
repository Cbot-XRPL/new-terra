// Catalog of every "tool image slot" the portal renders, with the
// generation prompt + size pinned per slot. Keeping prompts here (not
// in the React components) means we can iterate the visual language
// in one file without touching the UI.
//
// Style guardrails — every prompt should ask for:
//   - isometric or front-elevation editorial illustration
//   - warm wood + matte steel + the portal's deep-navy backdrop (#0d1117)
//   - soft directional lighting from upper left
//   - no text, no logos, no people
//   - tight composition, generous negative space
//
// The model rewrites prompts internally; what we send is a hint, not a
// command. Mostly we get a coherent gpt-image-1 isometric icon — the
// smoke test pass produced a hammer-on-2x4s thumbnail that nailed the
// vibe on the first try.

const STYLE = [
  'Warm natural wood + matte steel materials, soft directional studio lighting from upper left.',
  'Deep navy background (#0d1117). No text, no logos, no people.',
  'Tight composition, clean negative space.',
  'Style: digital editorial isometric icon, slightly stylized 3D, photoreal materials.',
].join(' ');

function isoPrompt(subjectLine) {
  return `Isometric editorial illustration of a residential construction icon. Subject: ${subjectLine} ${STYLE}`;
}

function blueprintPrompt(subjectLine) {
  return [
    `Top-down architectural blueprint diagram for a residential GC visual estimator.`,
    `Subject: ${subjectLine}`,
    'Render as a clean schematic on a deep navy background — pale blue lines, subtle drop shadow, faint isometric perspective.',
    'No labels, no callouts, no text, no logos, no people.',
    'Wide aspect ratio, generous margins so SVG hotspot overlays read clearly on top.',
  ].join(' ');
}

export const CATALOG = [
  // ─── Tool cards (Tools hub) ──────────────────────────────────────
  {
    slug: 'tools/floor-sketch',
    size: '1536x1024',
    prompt: isoPrompt(
      'a hand-drawn floor plan sketch on graph paper, with a wood ruler and pencil, faint room outlines visible, framing-square corner peeking in.',
    ),
  },
  {
    slug: 'tools/roof-sketch',
    size: '1536x1024',
    prompt: isoPrompt(
      'a miniature wooden roof model showing two facets meeting at a ridge, with a small square pitch gauge resting against one slope, asphalt-shingle texture on the surface.',
    ),
  },
  {
    slug: 'tools/visual-estimator',
    size: '1536x1024',
    prompt: isoPrompt(
      'a tiny isometric scene of a deck cross-section model — joists, decking boards, a footing pier — like a designer maquette on a workbench.',
    ),
  },
  {
    slug: 'tools/calculators',
    size: '1536x1024',
    prompt: isoPrompt(
      'a vintage carpenter calculator with chunky number keys sitting on a stack of lumber takeoff sheets, a tape measure curled beside it.',
    ),
  },

  // ─── Calculator hero images ──────────────────────────────────────
  {
    slug: 'calculators/mulch',
    size: '1536x1024',
    prompt: isoPrompt(
      'a wheelbarrow of dark mulch beside a freshly-edged garden bed, a steel rake leaning against the wheelbarrow.',
    ),
  },
  {
    slug: 'calculators/concrete',
    size: '1536x1024',
    prompt: isoPrompt(
      'a small rectangular concrete slab being poured, with a screed board across it and a finishing trowel resting on the corner.',
    ),
  },
  {
    slug: 'calculators/wall',
    size: '1536x1024',
    prompt: isoPrompt(
      'a segmental retaining wall mid-build, three courses of textured concrete block stacked with the next course staged beside it.',
    ),
  },
  {
    slug: 'calculators/deck',
    size: '1536x1024',
    prompt: isoPrompt(
      'a deck framing skeleton viewed from above the ground — pressure-treated joists on a beam, ledger board against a stub wall, no decking boards yet.',
    ),
  },
  {
    slug: 'calculators/paint',
    size: '1536x1024',
    prompt: isoPrompt(
      'a paint roller and a 5-gallon paint bucket beside a partially-painted interior wall, drop cloth on the floor, painters tape on the trim.',
    ),
  },
  {
    slug: 'calculators/fence',
    size: '1536x1024',
    prompt: isoPrompt(
      'three wooden fence posts in concrete footings with horizontal stringers, a section of pickets staged to one side, a post-hole digger leaning nearby.',
    ),
  },
  {
    slug: 'calculators/drywall',
    size: '1536x1024',
    prompt: isoPrompt(
      'a stack of drywall sheets next to a partially boarded wall, a screw gun and a small bucket of mud with a knife on top.',
    ),
  },
  {
    slug: 'calculators/sonotube',
    size: '1536x1024',
    prompt: isoPrompt(
      'three round cardboard form tubes (sonotubes) standing in a row in shallow excavated holes, with a level laid across the tops.',
    ),
  },
  {
    slug: 'calculators/tile',
    size: '1536x1024',
    prompt: isoPrompt(
      'a corner of a tile floor mid-install, square ceramic tiles on a thinset bed, a notched trowel and tile spacers in the foreground.',
    ),
  },
  {
    slug: 'calculators/sealcoat',
    size: '1536x1024',
    prompt: isoPrompt(
      'a black asphalt driveway being sealcoated, a long-handled squeegee in mid-stroke leaving a fresh stripe, a 5-gallon sealer bucket beside it.',
    ),
  },
  {
    slug: 'calculators/frenchdrain',
    size: '1536x1024',
    prompt: isoPrompt(
      'a cross-section of a french drain trench — perforated black pipe wrapped in landscape fabric, gravel filling around it, soil layered above.',
    ),
  },
  {
    slug: 'calculators/insulation',
    size: '1536x1024',
    prompt: isoPrompt(
      'a wall stud bay with pink fiberglass batt insulation tucked between two studs, a roll of unused batts to the side and a utility knife on top.',
    ),
  },
  {
    slug: 'calculators/roofing',
    size: '1536x1024',
    prompt: isoPrompt(
      'a partial asphalt shingle roof in mid-install, a few courses of architectural shingles laid, a bundle of wrapped shingles staged on the slope, a roofing nail gun beside it.',
    ),
  },
  {
    slug: 'calculators/lumberbf',
    size: '1536x1024',
    prompt: isoPrompt(
      'a small bundle of rough-sawn hardwood boards stacked on a sawhorse, a steel framing square laid across them, a stubby pencil tucked behind one board.',
    ),
  },

  // ─── Visual estimator scene backdrops ────────────────────────────
  // These render UNDER hand-drawn SVG hotspots, so they need to be
  // diagrammatic — wide aspect, faint, schematic — not photoreal.
  {
    slug: 'estimator/deck-cross-section',
    size: '1536x1024',
    prompt: blueprintPrompt(
      'a deck cross-section diagram — house wall on the left with ledger, joists running to a beam supported by posts on concrete piers. Subtle shadows, schematic line weights.',
    ),
  },
  {
    slug: 'estimator/bathroom-plan',
    size: '1536x1024',
    prompt: blueprintPrompt(
      'a bathroom floor plan top-down — toilet, vanity with sink, walk-in shower, tub. Plumbing rough-in dots faintly visible.',
    ),
  },
  {
    slug: 'estimator/driveway-plan',
    size: '1536x1024',
    prompt: blueprintPrompt(
      'a driveway plan top-down — long rectangular asphalt or paver driveway from a street curb up to a garage door, edge restraints on either side, drainage channel near the garage.',
    ),
  },
];
