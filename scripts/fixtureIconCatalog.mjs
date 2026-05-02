// Plan-view fixture symbol catalog for the floor sketch tool. Each
// entry generates a single-fixture icon meant to overlay on the
// sketch's graph-paper canvas — small, recognizable, transparent
// background so the grid shows through.
//
// Style guardrails: top-down architectural plan-view symbol, line
// art on transparent, single object centered in frame. Mirrors the
// black-and-white symbols a draftsperson would draw, lightly stylized.

const STYLE = [
  'Top-down architectural plan-view symbol icon for a floor plan.',
  'Crisp pale-blue line art on a fully transparent background, 4px stroke, single fixture centered in a 1024x1024 frame with generous padding.',
  'No text, no labels, no dimensions, no logos, no shadow underneath, no perspective — pure flat top-down view.',
  'Style: clean architectural drafting symbol, slightly modernized, consistent stroke weight, no fill except where needed for clarity.',
].join(' ');

function planSymbol(subject) {
  return `${STYLE} Subject: ${subject}`;
}

export const FIXTURES = [
  {
    slug: 'fixtures/toilet',
    label: 'Toilet',
    category: 'bathroom',
    // Default footprint in inches (plan-view bounding box).
    widthIn: 21,
    heightIn: 30,
    prompt: planSymbol(
      'a toilet seen from directly above — oval bowl, tank rectangle behind, mounted against a wall edge.',
    ),
  },
  {
    slug: 'fixtures/vanity',
    label: 'Vanity (single sink)',
    category: 'bathroom',
    widthIn: 30,
    heightIn: 21,
    prompt: planSymbol(
      'a single-sink vanity from directly above — rectangular cabinet outline with a centered round/oval sink basin and two faucet handles indicated by small dots.',
    ),
  },
  {
    slug: 'fixtures/bathtub',
    label: 'Bathtub',
    category: 'bathroom',
    widthIn: 60,
    heightIn: 30,
    prompt: planSymbol(
      'a standard 60-inch alcove bathtub from directly above — rectangular outer rim, inner oval well, drain marked by a small circle at one end.',
    ),
  },
  {
    slug: 'fixtures/shower',
    label: 'Walk-in shower',
    category: 'bathroom',
    widthIn: 36,
    heightIn: 36,
    prompt: planSymbol(
      'a walk-in shower from directly above — square base, drain in the middle marked by a small circle, glass door indicated by a thin line on one side.',
    ),
  },
  {
    slug: 'fixtures/kitchen-sink',
    label: 'Kitchen sink',
    category: 'kitchen',
    widthIn: 33,
    heightIn: 22,
    prompt: planSymbol(
      'a double-bowl kitchen sink from directly above — two equal-size rectangles side by side inside a larger countertop rectangle, faucet circle behind the divider.',
    ),
  },
  {
    slug: 'fixtures/range',
    label: 'Range / stove',
    category: 'kitchen',
    widthIn: 30,
    heightIn: 25,
    prompt: planSymbol(
      'a 30-inch kitchen range from directly above — square outer outline with four circular burners arranged in a 2x2 grid.',
    ),
  },
  {
    slug: 'fixtures/refrigerator',
    label: 'Refrigerator',
    category: 'kitchen',
    widthIn: 36,
    heightIn: 30,
    prompt: planSymbol(
      'a side-by-side refrigerator from directly above — wide rectangle with a vertical center line dividing freezer and fridge sides, hinge dots on the front.',
    ),
  },
  {
    slug: 'fixtures/dishwasher',
    label: 'Dishwasher',
    category: 'kitchen',
    widthIn: 24,
    heightIn: 24,
    prompt: planSymbol(
      'a built-in dishwasher from directly above — square outline with an inner rounded-rectangle door indicator and a small handle line on the front.',
    ),
  },
  {
    slug: 'fixtures/washer-dryer',
    label: 'Washer / dryer',
    category: 'laundry',
    widthIn: 54,
    heightIn: 30,
    prompt: planSymbol(
      'side-by-side washer and dryer from directly above — two squares with circular drum doors centered inside each, small control panel strip across the back.',
    ),
  },
  {
    slug: 'fixtures/water-heater',
    label: 'Water heater',
    category: 'mechanical',
    widthIn: 24,
    heightIn: 24,
    prompt: planSymbol(
      'a vertical tank water heater from directly above — circle inside a square pad outline, small hot/cold pipes indicated as two small circles at the top.',
    ),
  },
  {
    slug: 'fixtures/furnace',
    label: 'Furnace / air handler',
    category: 'mechanical',
    widthIn: 24,
    heightIn: 30,
    prompt: planSymbol(
      'a residential gas furnace / air handler from directly above — rectangular cabinet with a return duct collar (large circle) on one side and supply trunk rectangle on top.',
    ),
  },
  {
    slug: 'fixtures/hvac-condenser',
    label: 'HVAC condenser (outdoor)',
    category: 'mechanical',
    widthIn: 30,
    heightIn: 30,
    prompt: planSymbol(
      'an outdoor AC condenser unit from directly above — square outline with a large central fan grille drawn as concentric circles with radial spokes.',
    ),
  },
  {
    slug: 'fixtures/electrical-panel',
    label: 'Electrical panel',
    category: 'electrical',
    widthIn: 16,
    heightIn: 4,
    prompt: planSymbol(
      'a flush-mounted main electrical panel from directly above — narrow tall rectangle (16 wide × 4 deep), a single hinge line on one long edge.',
    ),
  },
  {
    slug: 'fixtures/fireplace',
    label: 'Fireplace',
    category: 'misc',
    widthIn: 60,
    heightIn: 24,
    prompt: planSymbol(
      'a built-in masonry fireplace from directly above — wide rectangle with an arched firebox opening drawn as a half-circle on the room-facing side, hearth extension in front.',
    ),
  },
];
