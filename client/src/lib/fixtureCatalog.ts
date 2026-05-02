// Plan-view fixture catalog used by the floor sketch palette. Mirrors
// scripts/fixtureIconCatalog.mjs (the build-time generation source) so
// the palette UI shows the same labels + default footprints the icon
// art was drawn for.

export interface FixtureDef {
  slug: string;          // e.g. "fixtures/toilet"
  label: string;         // human label shown in the palette
  category: 'bathroom' | 'kitchen' | 'laundry' | 'mechanical' | 'electrical' | 'misc';
  widthIn: number;       // default plan-view footprint, inches
  heightIn: number;
}

export const FIXTURE_CATALOG: FixtureDef[] = [
  { slug: 'fixtures/toilet',           label: 'Toilet',              category: 'bathroom',  widthIn: 21, heightIn: 30 },
  { slug: 'fixtures/vanity',           label: 'Vanity',              category: 'bathroom',  widthIn: 30, heightIn: 21 },
  { slug: 'fixtures/bathtub',          label: 'Bathtub',             category: 'bathroom',  widthIn: 60, heightIn: 30 },
  { slug: 'fixtures/shower',           label: 'Walk-in shower',      category: 'bathroom',  widthIn: 36, heightIn: 36 },
  { slug: 'fixtures/kitchen-sink',     label: 'Kitchen sink',        category: 'kitchen',   widthIn: 33, heightIn: 22 },
  { slug: 'fixtures/range',            label: 'Range / stove',       category: 'kitchen',   widthIn: 30, heightIn: 25 },
  { slug: 'fixtures/refrigerator',     label: 'Refrigerator',        category: 'kitchen',   widthIn: 36, heightIn: 30 },
  { slug: 'fixtures/dishwasher',       label: 'Dishwasher',          category: 'kitchen',   widthIn: 24, heightIn: 24 },
  { slug: 'fixtures/washer-dryer',     label: 'Washer / dryer',      category: 'laundry',   widthIn: 54, heightIn: 30 },
  { slug: 'fixtures/water-heater',     label: 'Water heater',        category: 'mechanical', widthIn: 24, heightIn: 24 },
  { slug: 'fixtures/furnace',          label: 'Furnace / air handler', category: 'mechanical', widthIn: 24, heightIn: 30 },
  { slug: 'fixtures/hvac-condenser',   label: 'HVAC condenser',      category: 'mechanical', widthIn: 30, heightIn: 30 },
  { slug: 'fixtures/electrical-panel', label: 'Electrical panel',    category: 'electrical', widthIn: 16, heightIn: 4 },
  { slug: 'fixtures/fireplace',        label: 'Fireplace',           category: 'misc',      widthIn: 60, heightIn: 24 },
];

export function fixtureBySlug(slug: string): FixtureDef | undefined {
  return FIXTURE_CATALOG.find((f) => f.slug === slug);
}

// Image URL pattern matches the WebP files committed under
// client/public/media/sketcher/.
export function fixtureIconUrl(slug: string): string {
  return `/media/sketcher/${slug.replace(/\//g, '_')}.webp`;
}
