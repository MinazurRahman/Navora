import { describe, expect, it } from 'vitest';
import { createPlaceSchema, updatePlaceSchema } from '../../src/modules/places/places.schemas.js';
import { createTripSchema, updateTripSchema } from '../../src/modules/trips/trips.schemas.js';

// Numbers stored in numeric(p, s) columns must not carry more decimals than the column
// keeps: PostgreSQL would round them silently (a fee of 0.004 would be stored as "free").
describe('decimal precision of stored numbers', () => {
  const place = { name: 'Museum', category: 'museum', location: { latitude: 23.7, longitude: 90.4 } };
  const trip = { title: 'Trip', startLocation: { latitude: 23.7, longitude: 90.4 }, durationDays: 1 };

  it.each([0, 10, 12.5, 12.34, 999_999.99, null])('accepts entry fee %s', (entryFee) => {
    expect(createPlaceSchema.safeParse({ ...place, entryFee }).success).toBe(true);
    expect(updatePlaceSchema.safeParse({ entryFee }).success).toBe(true);
  });

  it.each([0.004, 12.345, 0.001])('rejects entry fee %s (more than 2 decimals)', (entryFee) => {
    const result = createPlaceSchema.safeParse({ ...place, entryFee });
    expect(result.success).toBe(false);
    expect(result.error.issues[0]).toMatchObject({ path: ['entryFee'], message: 'must have at most 2 decimal places' });
    expect(updatePlaceSchema.safeParse({ entryFee }).success).toBe(false);
  });

  it.each([1, 4, 4.5, 4.3, 5, null])('accepts minimum rating %s', (minimumRating) => {
    expect(createTripSchema.safeParse({ ...trip, minimumRating }).success).toBe(true);
    expect(updateTripSchema.safeParse({ minimumRating }).success).toBe(true);
  });

  it.each([4.25, 3.99])('rejects minimum rating %s (more than 1 decimal)', (minimumRating) => {
    const result = createTripSchema.safeParse({ ...trip, minimumRating });
    expect(result.success).toBe(false);
    expect(result.error.issues[0]).toMatchObject({ path: ['minimumRating'], message: 'must have at most 1 decimal place' });
    expect(updateTripSchema.safeParse({ minimumRating }).success).toBe(false);
  });
});
