import { describe, expect, it } from 'vitest';
import { formatDistance, formatEntryFee, formatMinutes, formatRating } from './format.js';

describe('format', () => {
  it('never presents an unknown fee or rating as known', () => {
    expect(formatEntryFee(null)).toBe('Entry fee unknown');
    expect(formatEntryFee(0)).toBe('Free entry');
    expect(formatEntryFee(1500, 'BDT')).toBe('BDT 1,500');
    expect(formatRating({ average: null, count: 0 })).toBe('No reviews yet');
    expect(formatRating({ average: 4.25, count: 1 })).toBe('4.3 (1 review)');
  });

  it('formats distances and durations', () => {
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(842)).toBe('840 m');
    expect(formatDistance(10420)).toBe('10.4 km');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
  });
});
