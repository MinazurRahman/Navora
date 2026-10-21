import { describe, expect, it } from 'vitest';
import { decodePolyline } from './polyline.js';

describe('decodePolyline', () => {
  it('decodes the reference example from the format specification', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('returns no points for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});
