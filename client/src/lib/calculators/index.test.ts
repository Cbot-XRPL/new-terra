import { describe, expect, it } from 'vitest';
import {
  asphaltSealcoat,
  concreteSlab,
  deckFraming,
  drywall,
  fenceLayout,
  frenchDrain,
  mulchCoverage,
  paintCoverage,
  retainingWall,
  sonotubeFooting,
  tileFloor,
} from './index';

describe('mulchCoverage', () => {
  it('rounds 200 sqft × 3" to 2 cu yd', () => {
    expect(mulchCoverage({ areaSqft: 200, depthInches: 3 }).primary.value).toBe('2.00 cu yd');
  });
  it('zero area is zero', () => {
    expect(mulchCoverage({ areaSqft: 0, depthInches: 3 }).primary.value).toBe('0.00 cu yd');
  });
});

describe('concreteSlab', () => {
  it('10×10 slab at 4" → 1.25 cu yd (rounded up to nearest quarter)', () => {
    expect(concreteSlab({ lengthFt: 10, widthFt: 10, depthInches: 4 }).primary.value).toBe('1.25 cu yd');
  });
});

describe('retainingWall', () => {
  it('20 ft long × 24" tall with 12" × 4" block → 120 blocks (6 courses × 20)', () => {
    expect(retainingWall({ lengthFt: 20, heightInches: 24 }).primary.value).toBe('120 blocks');
  });
});

describe('deckFraming', () => {
  it('16 ft @ 16" o.c. → 13 field + 2 perimeter = 15 joists', () => {
    expect(
      deckFraming({ lengthFt: 16, widthFt: 20, joistSpacingInches: 16, joistLumberLengthFt: 20 })
        .primary.value,
    ).toBe('15 joists');
  });
});

describe('paintCoverage', () => {
  it('800 sqft − 40 openings, 2 coats, 350 sqft/gal → 5 gal', () => {
    expect(
      paintCoverage({ wallSqft: 800, openingsSqft: 40, coats: 2 }).primary.value,
    ).toBe('5 gal');
  });
});

describe('fenceLayout', () => {
  it('100 ft, 8 ft spacing, 1 gate → 13 posts', () => {
    expect(fenceLayout({ lengthFt: 100, postSpacingFt: 8, hasGates: 1 }).primary.value).toBe('13 posts');
  });
});

describe('drywall', () => {
  it('800 sqft → 25 sheets at 32 sqft each', () => {
    expect(drywall({ wallSqft: 800 }).primary.value).toBe('25 sheets');
  });
});

describe('sonotubeFooting', () => {
  it('6 piers × 12" diameter × 3 ft → 0.75 cu yd', () => {
    const r = sonotubeFooting({ diameterInches: 12, depthFt: 3, count: 6 });
    expect(r.primary.value).toBe('0.75 cu yd');
  });
});

describe('tileFloor', () => {
  it('100 sqft × 12" tile + 10% waste → 110 tiles', () => {
    expect(tileFloor({ areaSqft: 100, tileSizeInches: 12 }).primary.value).toBe('110 pcs');
  });
});

describe('asphaltSealcoat', () => {
  it('600 sqft × 2 coats / 80 sqft per gal → 15 gal', () => {
    expect(asphaltSealcoat({ drivewaySqft: 600 }).primary.value).toBe('15 gal');
  });
});

describe('frenchDrain', () => {
  it('50 ft × 12" × 18" trench → about 2 cu yd of gravel', () => {
    const r = frenchDrain({ trenchLengthFt: 50, trenchWidthInches: 12, trenchDepthInches: 18 });
    // Should round up to a quarter yard.
    expect(r.primary.value).toMatch(/^[\d.]+ cu yd$/);
    const value = Number(r.primary.value.replace(/[^\d.]/g, ''));
    expect(value).toBeGreaterThan(2);
    expect(value).toBeLessThan(3);
  });
});
