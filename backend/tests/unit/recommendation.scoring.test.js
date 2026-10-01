import { describe, expect, it } from 'vitest';
import { RECOMMENDATION_CONFIG as config } from '../../src/config/recommendation.js';
import {
  applyHardConstraints,
  buildContext,
  buildSuggestions,
  rankPlaces,
  scorePlace,
} from '../../src/modules/recommendations/scoring.js';
import { openDaysCount, todayIn, tripDays } from '../../src/modules/recommendations/schedule.js';

// 2026-10-05 is a Monday.
const MONDAY = '2026-10-05';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '18:00' }));

let nextId = 0;
function place(overrides = {}) {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    name: `Place ${nextId}`,
    category: { slug: 'museum', name: 'Museum' },
    distanceMeters: 2000,
    entryFee: 50,
    currency: 'BDT',
    typicalVisitMinutes: 60,
    tags: [],
    openingHours: ALL_WEEK,
    rating: { average: 4, count: 10 },
    facilities: { parking: 'YES', petFriendly: 'YES', wheelchairAccessible: 'YES' },
    ...overrides,
    facilities: { parking: 'YES', petFriendly: 'YES', wheelchairAccessible: 'YES', ...overrides.facilities },
  };
}

function context(overrides = {}) {
  return buildContext(
    {
      searchRadiusKm: 10,
      interests: [],
      preferredCategories: [],
      durationDays: 1,
      dailyStartTime: '09:00',
      dailyEndTime: '20:00',
      travelingWithPet: false,
      parkingRequired: false,
      wheelchairAccessRequired: false,
      ...overrides,
    },
    overrides.startDate ?? MONDAY,
  );
}

describe('hard constraints', () => {
  it.each([
    ['travelingWithPet', 'petFriendly', 'petFriendly'],
    ['parkingRequired', 'parking', 'parking'],
    ['wheelchairAccessRequired', 'wheelchairAccessible', 'wheelchairAccessible'],
  ])('%s: only an explicit YES qualifies (NO and UNKNOWN are excluded)', (flag, facility, key) => {
    const yes = place({ facilities: { [facility]: 'YES' } });
    const no = place({ facilities: { [facility]: 'NO' } });
    const unknown = place({ facilities: { [facility]: 'UNKNOWN' } });

    const { eligible, excludedBy } = applyHardConstraints([yes, no, unknown], context({ [flag]: true }), config);

    expect(eligible).toEqual([yes]);
    expect(excludedBy).toEqual({ [key]: 2 });
  });

  it('does not apply a requirement the user did not ask for', () => {
    const unknownParking = place({ facilities: { parking: 'UNKNOWN', petFriendly: 'NO' } });
    expect(applyHardConstraints([unknownParking], context(), config).eligible).toHaveLength(1);
  });

  it('a highly rated place that is not pet-friendly never appears when a pet is coming', () => {
    const famous = place({ rating: { average: 5, count: 500 }, tags: ['history'], facilities: { petFriendly: 'NO' } });
    const modest = place({ rating: { average: 3, count: 2 }, facilities: { petFriendly: 'YES' } });

    const ctx = context({ travelingWithPet: true, interests: ['history'] });
    const ranked = rankPlaces(applyHardConstraints([famous, modest], ctx, config).eligible, ctx, config);

    expect(ranked.map((r) => r.place)).toEqual([modest]);
  });

  it('excludes places outside the search radius', () => {
    const inside = place({ distanceMeters: 9_999 });
    const outside = place({ distanceMeters: 10_001 });
    const { eligible, excludedBy } = applyHardConstraints([inside, outside], context(), config);
    expect(eligible).toEqual([inside]);
    expect(excludedBy.searchRadius).toBe(1);
  });

  it('minimum rating: unrated places do not qualify', () => {
    const good = place({ rating: { average: 4.5, count: 3 } });
    const low = place({ rating: { average: 3.9, count: 30 } });
    const unrated = place({ rating: { average: null, count: 0 } });

    const { eligible, excludedBy } = applyHardConstraints([good, low, unrated], context({ minimumRating: 4 }), config);
    expect(eligible).toEqual([good]);
    expect(excludedBy.minimumRating).toBe(2);
  });

  it('excludes a place KNOWN to be closed for the whole trip, but never one with unknown hours', () => {
    const closedMonday = place({ openingHours: [{ dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }] });
    const unknownHours = place({ openingHours: [] });

    const { eligible, excludedBy } = applyHardConstraints([closedMonday, unknownHours], context(), config);
    expect(eligible).toEqual([unknownHours]);
    expect(excludedBy.openDuringTrip).toBe(1);
  });

  it('counts every failed requirement, so the limiting one is visible', () => {
    const both = place({ facilities: { parking: 'UNKNOWN', petFriendly: 'NO' } });
    const { excludedBy } = applyHardConstraints([both], context({ parkingRequired: true, travelingWithPet: true }), config);
    expect(excludedBy).toEqual({ parking: 1, petFriendly: 1 });
  });
});

describe('soft scoring', () => {
  it('returns a 0–100 score with a breakdown, reasons and warnings', () => {
    const result = scorePlace(place(), context(), config);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Object.keys(result.breakdown).sort()).toEqual(['popularity', 'proximity', 'rating', 'schedule']);
    expect(Array.isArray(result.reasons) && Array.isArray(result.warnings)).toBe(true);
  });

  it('interest match: graded by how many requested interests the place has', () => {
    const ctx = context({ interests: ['food', 'history'] });
    const both = scorePlace(place({ tags: ['food', 'history', 'art'] }), ctx, config);
    const one = scorePlace(place({ tags: ['history'] }), ctx, config);
    const none = scorePlace(place({ tags: ['art'] }), ctx, config);

    expect([both.breakdown.interest, one.breakdown.interest, none.breakdown.interest]).toEqual([100, 50, 0]);
    expect(both.score).toBeGreaterThan(one.score);
    expect(one.score).toBeGreaterThan(none.score);
    expect(one.reasons).toContain('Matches your interests: history');
    expect(none.reasons.join()).not.toContain('interests');
  });

  it('preferred category is a separate signal from interests', () => {
    const ctx = context({ preferredCategories: ['park'] });
    const park = scorePlace(place({ category: { slug: 'park', name: 'Park' } }), ctx, config);
    const museum = scorePlace(place(), ctx, config);
    expect(park.breakdown.category).toBe(100);
    expect(museum.breakdown.category).toBe(0);
    expect(park.reasons).toContain('In a preferred category: Park');
  });

  it('proximity: closer scores higher, with the factual distance as a reason', () => {
    const near = scorePlace(place({ distanceMeters: 1_000 }), context(), config);
    const far = scorePlace(place({ distanceMeters: 9_000 }), context(), config);
    expect(near.breakdown.proximity).toBe(90);
    expect(far.breakdown.proximity).toBe(10);
    expect(near.reasons).toContain('1 km away, within your 10 km search radius');
  });

  it('budget: free > affordable > over daily budget > over total budget; unknown fee is low and flagged', () => {
    const ctx = context({ durationDays: 2, budget: { amount: 1000, type: 'total', currency: 'BDT' } }); // 500/day
    const score = (entryFee) => scorePlace(place({ entryFee }), ctx, config);

    expect(score(0).breakdown.budget).toBe(100);
    expect(score(0).reasons).toContain('Free entry');
    expect(score(100).breakdown.budget).toBe(80);
    expect(score(100).reasons).toContain('Entry fee BDT 100 fits your budget');
    expect(score(800).breakdown.budget).toBe(10);
    expect(score(800).warnings).toContain('Entry fee BDT 800 is more than your daily budget');
    expect(score(5000).breakdown.budget).toBe(0);

    const unknown = score(null);
    expect(unknown.breakdown.budget).toBe(25);
    expect(unknown.warnings).toContain('Entry fee unknown');
    expect(unknown.reasons.join()).not.toMatch(/budget|Free/);
  });

  it('budget per day is multiplied by trip length for the total', () => {
    const ctx = context({ durationDays: 3, budget: { amount: 200, type: 'per_day', currency: 'BDT' } });
    expect(ctx.budget).toMatchObject({ total: 600, daily: 200 });
  });

  it('budget is not scored when the user gave none', () => {
    expect(scorePlace(place(), context(), config).breakdown).not.toHaveProperty('budget');
  });

  it('rating: Bayesian, so many good reviews beat one perfect review', () => {
    const proven = scorePlace(place({ rating: { average: 4.6, count: 200 } }), context(), config);
    const single = scorePlace(place({ rating: { average: 5, count: 1 } }), context(), config);
    expect(proven.breakdown.rating).toBeGreaterThan(single.breakdown.rating);
    expect(proven.reasons).toContain('Rated 4.6 from 200 reviews');
  });

  it('no ratings: low neutral score and a warning, never a positive claim', () => {
    const result = scorePlace(place({ rating: { average: null, count: 0 } }), context(), config);
    expect(result.breakdown.rating).toBe(25);
    expect(result.breakdown.popularity).toBe(0);
    expect(result.warnings).toContain('No ratings yet');
    expect(result.reasons.join()).not.toContain('Rated');
  });

  it('popularity grows with review count and saturates', () => {
    const s = (count) => scorePlace(place({ rating: { average: 4, count } }), context(), config).breakdown.popularity;
    expect(s(5)).toBeLessThan(s(20));
    expect(s(50)).toBe(100);
    expect(s(5000)).toBe(100);
  });

  it('schedule: fraction of trip days with time for a visit; unknown hours are flagged', () => {
    const weekdaysOnly = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '18:00' }));
    const ctx = context({ startDate: '2026-10-09', durationDays: 3 }); // Fri, Sat, Sun

    const partial = scorePlace(place({ openingHours: weekdaysOnly }), ctx, config);
    expect(partial.breakdown.schedule).toBe(33);
    expect(partial.reasons).toContain('Open during your daily hours on 1 of 3 trip days');

    const unknown = scorePlace(place({ openingHours: [] }), ctx, config);
    expect(unknown.breakdown.schedule).toBe(25);
    expect(unknown.warnings).toContain('Opening hours could not be verified');
    expect(unknown.reasons.join()).not.toContain('Open during');
  });

  it('confirms only the hard requirements the user actually set', () => {
    const result = scorePlace(place(), context({ parkingRequired: true }), config);
    expect(result.reasons).toContain('Parking available (matches your parking requirement)');
    expect(result.reasons.join()).not.toMatch(/pet|wheelchair/i);
  });

  it('weights are configurable and change the ranking', () => {
    const cheapFar = place({ entryFee: 0, distanceMeters: 9_000 });
    const pricyNear = place({ entryFee: 400, distanceMeters: 500 });
    const ctx = context({ budget: { amount: 500, type: 'total', currency: 'BDT' } });
    const order = (weights) =>
      rankPlaces([cheapFar, pricyNear], ctx, { ...config, weights: { ...config.weights, ...weights } }).map((r) => r.place);

    expect(order({ budget: 100, proximity: 1 })).toEqual([cheapFar, pricyNear]);
    expect(order({ budget: 1, proximity: 100 })).toEqual([pricyNear, cheapFar]);
  });

  it('ranks by score, then distance, deterministically', () => {
    const a = place({ distanceMeters: 3000 });
    const b = place({ distanceMeters: 3000 });
    const ranked = rankPlaces([b, a], context(), config).map((r) => r.place.id);
    expect(ranked).toEqual(rankPlaces([a, b], context(), config).map((r) => r.place.id));
  });
});

describe('suggestions', () => {
  it('lists the most limiting requirement first and offers a wider radius', () => {
    const ctx = context({ parkingRequired: true, travelingWithPet: true });
    expect(buildSuggestions({ petFriendly: 2, parking: 7 }, ctx, 50)).toEqual([
      '7 nearby places are not confirmed to have parking',
      '2 nearby places are not confirmed pet-friendly',
      'Increase the search radius (currently 10 km)',
    ]);
  });

  it('does not suggest a wider radius at the maximum', () => {
    expect(buildSuggestions({}, context({ searchRadiusKm: 50 }), 50)).toEqual([]);
  });
});

describe('schedule helpers', () => {
  it('maps dates to ISO weekdays across month ends', () => {
    expect(tripDays('2026-10-31', 3)).toEqual([
      { date: '2026-10-31', dayOfWeek: 6 },
      { date: '2026-11-01', dayOfWeek: 7 },
      { date: '2026-11-02', dayOfWeek: 1 },
    ]);
  });

  it('needs the overlap with the daily window to fit the whole visit', () => {
    const hours = [{ dayOfWeek: 1, opensAt: '17:30', closesAt: '24:00' }];
    const days = tripDays(MONDAY, 1);
    expect(openDaysCount(hours, days, { windowStart: 9 * 60, windowEnd: 18 * 60, visitMinutes: 60 })).toBe(0);
    expect(openDaysCount(hours, days, { windowStart: 9 * 60, windowEnd: 18 * 60, visitMinutes: 30 })).toBe(1);
    expect(openDaysCount([], days, { windowStart: 0, windowEnd: 1440, visitMinutes: 30 })).toBeNull();
  });

  it('computes "today" in the configured timezone, not the server\'s', () => {
    // 20:00 UTC on Oct 1 is already Oct 2 in Dhaka (UTC+6).
    expect(todayIn('Asia/Dhaka', new Date('2026-10-01T20:00:00Z'))).toBe('2026-10-02');
  });
});

describe('configuration', () => {
  it('has a non-negative weight for every scoring component', () => {
    for (const name of ['interest', 'category', 'proximity', 'budget', 'rating', 'popularity', 'schedule']) {
      expect(config.weights[name], name).toBeGreaterThanOrEqual(0);
    }
  });
});
