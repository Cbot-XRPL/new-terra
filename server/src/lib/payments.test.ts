import { describe, expect, it } from 'vitest';
import { computeTotals } from './payments.js';

describe('computeTotals', () => {
  it('zero payments → full balance, not paid', () => {
    const t = computeTotals(10000, []);
    expect(t).toEqual({
      paidCents: 0,
      balanceCents: 10000,
      isFullyPaid: false,
      isOverpaid: false,
    });
  });

  it('one partial payment → reduces balance, not paid', () => {
    const t = computeTotals(10000, [4000]);
    expect(t.paidCents).toBe(4000);
    expect(t.balanceCents).toBe(6000);
    expect(t.isFullyPaid).toBe(false);
  });

  it('payments summing to exactly amount → fully paid', () => {
    const t = computeTotals(10000, [3000, 7000]);
    expect(t.paidCents).toBe(10000);
    expect(t.balanceCents).toBe(0);
    expect(t.isFullyPaid).toBe(true);
    expect(t.isOverpaid).toBe(false);
  });

  it('overpayment → flagged, balance goes negative', () => {
    const t = computeTotals(10000, [12000]);
    expect(t.paidCents).toBe(12000);
    expect(t.balanceCents).toBe(-2000);
    expect(t.isFullyPaid).toBe(true);
    expect(t.isOverpaid).toBe(true);
  });

  it('zero-amount invoice never reads as fully paid via the helper', () => {
    // A $0 invoice is a degenerate case; we leave the status alone so admin
    // doesn't see a stray "PAID" tag on a draft they haven't priced yet.
    const t = computeTotals(0, []);
    expect(t.isFullyPaid).toBe(false);
  });
});
