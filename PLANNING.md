# Planning notes — deferred Xactimate-parity work

This file captures the design for two big builds I scoped but did not
ship in the sketch+image-gen session. Treat it as the brief for whoever
picks them up next. Keep it short — long planning docs rot.

## 1. Roof sketch with pitch math

The 2D estimate sketch lives at `EstimateSketch` and tracks rooms as
flat polygons. Roofs need different math because they live in 3-space
projected onto a 2D plan. The line-of-thinking:

### Schema

Add a sibling `EstimateRoofSketch` model (or extend `EstimateSketch`
with a `kind: 'floor' | 'roof'` enum and a `pitches` blob — extending
is cheaper but couples the rendering code).

```prisma
model EstimateRoofSketch {
  id            String   @id @default(cuid())
  estimateId    String   @unique
  estimate      Estimate @relation(...)
  data          Json     // { facets: [{ points, pitchOver12 }] }
  surfaceSqft   Int      // true area, pitch-corrected
  ridgeFeet     Int
  hipFeet       Int
  valleyFeet    Int
  rakeFeet      Int
  eaveFeet      Int
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

A `facet` is a polygon plus its pitch (rise per 12" run, integer):
`pitchOver12: 6` means a 6/12 pitch.

### Math

Plan area `Aₚ` of a facet is the polygon area in the floor plan view.
True surface area: `A = Aₚ × √(1 + (pitch/12)²)`.

Edge classification by adjacency:

- **Ridge** — shared by two facets sloping in opposite directions, both
  inclined; horizontal in 3-space.
- **Hip** — shared by two facets sloping outward; goes from a corner
  downward.
- **Valley** — shared by two facets sloping inward.
- **Rake** — outer edge of a single facet that runs along the slope
  (i.e. NOT horizontal in plan view).
- **Eave** — outer edge of a single facet that's horizontal in plan
  view (where the gutter goes).

True length of a sloped edge: `L = Lₚ × √(1 + (pitch/12)²)` if the edge
slopes; horizontal edges (eaves, ridges) keep plan length.

### UI

Reuse the SVG shell from `EstimateSketchPage`. Each facet gets a
trapezoid+pitch picker. Adjacency detection runs every render: for
each shared edge between facets, classify by their pitches.

### Push-to-estimate

Roof line items naturally map to:

- Shingles / underlayment — `surfaceSqft`
- Drip edge — `eaveFeet + rakeFeet`
- Ridge cap — `ridgeFeet + hipFeet`
- Valley flashing — `valleyFeet`
- Gutter — `eaveFeet`

## 2. Public pricing data feed

There's no truly free Xactware-equivalent. What we *can* assemble:

### Labor adjustment factors (free)

Bureau of Labor Statistics publishes the **OEWS** (Occupational
Employment & Wage Statistics) dataset: average wage per occupation per
metro area, updated annually.

- Endpoint: <https://www.bls.gov/oes/current/oes_nat.htm>
  (machine-readable XLSX downloads)
- Codes we care about (SOC):
  - 47-2031 Carpenters
  - 47-2061 Construction laborers
  - 47-2111 Electricians
  - 47-2152 Plumbers
  - 47-2141 Painters
  - 47-2181 Roofers
  - 47-2073 Operating engineers / heavy equipment

Build a quarterly-ish ingest script:

1. Download the latest `oesm_research_*.xlsx`.
2. Parse mean hourly wage per metro area per SOC.
3. Compute a national average per SOC.
4. Per-metro multiplier = (metro mean) / (national mean).
5. Persist to a new `LaborWageRegion` table keyed by ZIP-prefix → metro.

### Material price tracking (free-ish)

Two paths:

- **Home Depot affiliate API** — free with developer signup. Pull
  product prices for a curated list of SKUs (drywall sheet, 2×4×8,
  romex, 30-yr shingle, etc.) per ZIP. Use the resulting price as the
  catalog `defaultMaterialCents` baseline.
- **BLS Producer Price Index (PPI)** — index, not absolute prices.
  Useful for tracking material inflation over time but doesn't give
  the per-unit dollar number we need on day one.

### Schema

```prisma
model LaborWageRegion {
  id            String  @id @default(cuid())
  zipPrefix     String  // first 3 digits of ZIP, e.g. "303" for Atlanta
  socCode       String  // BLS occupation code
  meanHourlyCents Int
  metroName     String
  source        String  // 'BLS-OEWS-2025' etc.
  fetchedAt     DateTime @default(now())
  @@unique([zipPrefix, socCode, source])
}

model MaterialPriceSample {
  id            String  @id @default(cuid())
  productId     String
  product       Product @relation(...)
  zipPrefix     String
  unitPriceCents Int
  source        String  // 'home-depot-api' | 'manual' | 'rsmeans-csv'
  fetchedAt     DateTime @default(now())
  @@index([productId, zipPrefix])
}
```

### Estimator integration

When the estimator sets a project's ZIP (or pulls from the customer
address), it looks up:

1. The labor wage multiplier per SOC for that ZIP prefix.
2. Material price samples for the line's product, ranked newest first.

The line's `unitPriceCents` defaults to:

```
laborPortion = product.defaultLaborCents × wageMultiplier(soc, zip)
materialPortion = latestMaterialSample(product, zip)?.unitPriceCents ?? product.defaultMaterialCents
```

Sales rep can override per-line; the auto-derived number is just the
seed.

### CSV importer fallback

If the public APIs prove unreliable, the same schema accepts a CSV
upload (admin-only). User pastes a Xactware export, RSMeans CSV, or
their own historical pricing — we parse and store as
`source: 'manual-csv'`.

## 3. OpenAI image-gen build loop

The server endpoint `/api/integrations/image-gen/generate` is live.
Future work: automate the judge-and-regen loop from a Claude session.

```
1. Claude writes a prompt for "kitchen calculator hero, isometric,
   warm wood + stainless, 24-bit".
2. Claude calls /api/integrations/image-gen/generate.
3. Server saves PNG to uploads/generated/calculators/<stamp>-kitchen.png
   and returns the URL.
4. Claude reads the image (Read tool against the disk path).
5. Claude judges fit. If wrong vibe, refines prompt + reruns.
6. Once chosen, Claude moves the file to client/public/media/...
   and references it from the calculator page.
```

The loop runs at build time (in a Claude Code session), not at
runtime. The site only ever serves the chosen file.
