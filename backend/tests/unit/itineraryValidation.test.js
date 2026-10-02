import { describe, expect, it } from 'vitest';
import { validateItinerary } from '../../src/modules/itineraries/validation.js';
import { buildContext } from '../../src/modules/recommendations/scoring.js';
import { RECOMMENDATION_CONFIG } from '../../src/config/recommendation.js';
import { toMinutes } from '../../src/modules/recommendations/schedule.js';

const MONDAY = '2026-10-05';
const t = toMinutes;

function ctx(overrides = {}) {
  return buildContext(
    {
      searchRadiusKm: 10, interests: [], preferredCategories: [], durationDays: 1,
      dailyStartTime: '09:00', dailyEndTime: '17:00',
      travelingWithPet: false, parkingRequired: false, wheelchairAccessRequired: false,
      ...overrides,
    },
    MONDAY,
  );
}

function place(id, overrides = {}) {
  return {
    id, name: id, category: { slug: 'museum', name: 'Museum' }, distanceMeters: 2000,
    openingHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    rating: { average: 4, count: 3 },
    facilities: { parking: 'YES', petFriendly: 'YES', wheelchairAccessible: 'YES' },
    ...overrides,
  };
}

const stop = (p, start, end, visitMinutes = t(end) - t(start)) => ({ place: p, plannedStart: t(start), plannedEnd: t(end), visitMinutes });
const day = (stops, { departure = '09:00', endTime = '13:00', dayOfWeek = 1 } = {}) => ({
  dayNumber: 1, dayOfWeek, departure: t(departure), schedule: { stops, endTime: t(endTime) },
});
const validate = (days, c = ctx(), options) => validateItinerary(days, c, RECOMMENDATION_CONFIG, options);
const rules = (violations) => violations.map((v) => v.rule);

describe('validateItinerary', () => {
  const a = place('a');
  const b = place('b');

  it('accepts a valid day', () => {
    expect(validate([day([stop(a, '09:30', '10:30'), stop(b, '11:00', '12:00')])])).toEqual([]);
  });

  it('flags a day that starts before or ends after the available time', () => {
    expect(rules(validate([day([stop(a, '09:30', '10:30')], { departure: '08:45' })]))).toContain('STARTS_BEFORE_WINDOW');
    expect(rules(validate([day([stop(a, '09:30', '10:30')], { endTime: '17:20' })]))).toContain('ENDS_AFTER_WINDOW');
  });

  it('flags a visit outside the daily window', () => {
    expect(rules(validate([day([stop(a, '16:30', '17:30')], { endTime: '17:00' })]))).toContain('OUTSIDE_DAILY_WINDOW');
  });

  it('flags overlapping visits and a wrong visit length', () => {
    expect(rules(validate([day([stop(a, '09:30', '10:30'), stop(b, '10:15', '11:15')])]))).toContain('OVERLAPPING_VISITS');
    expect(rules(validate([day([stop(a, '09:30', '10:30', 90)])]))).toContain('VISIT_LENGTH_MISMATCH');
  });

  it('flags a visit outside known opening hours, but not unknown hours', () => {
    const shortHours = place('short', { openingHours: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '11:00' }] });
    const unknown = place('unknown', { openingHours: [] });

    expect(validate([day([stop(shortHours, '10:30', '11:30')])])).toEqual([{ dayNumber: 1, rule: 'OUTSIDE_OPENING_HOURS', placeId: 'short' }]);
    expect(validate([day([stop(unknown, '09:30', '10:30')])])).toEqual([]);
  });

  it('flags a place that is closed on that weekday', () => {
    expect(rules(validate([day([stop(a, '09:30', '10:30')], { dayOfWeek: 2 })]))).toEqual(['OUTSIDE_OPENING_HOURS']);
  });

  it('flags a place scheduled twice and too many stops', () => {
    expect(rules(validate([day([stop(a, '09:30', '10:00'), stop(a, '10:30', '11:00')])]))).toContain('DUPLICATE_PLACE');
    const many = Array.from({ length: 7 }, (_, i) => stop(place(`p${i}`), `${String(9 + i).padStart(2, '0')}:00`, `${String(9 + i).padStart(2, '0')}:30`));
    expect(rules(validate([day(many, { endTime: '16:30' })]))).toContain('TOO_MANY_STOPS');
  });

  it.each([
    ['travelingWithPet', 'petFriendly', 'VIOLATES_petFriendly'],
    ['parkingRequired', 'parking', 'VIOLATES_parking'],
    ['wheelchairAccessRequired', 'wheelchairAccessible', 'VIOLATES_wheelchairAccessible'],
  ])('flags a place breaking a mandatory requirement (%s), including UNKNOWN', (flag, facility, rule) => {
    const unknown = place('u', { facilities: { parking: 'YES', petFriendly: 'YES', wheelchairAccessible: 'YES', [facility]: 'UNKNOWN' } });
    expect(validate([day([stop(unknown, '09:30', '10:30')])], ctx({ [flag]: true }))).toEqual([{ dayNumber: 1, rule, placeId: 'u' }]);
  });

  it('flags places outside the search radius, except ones the user selected', () => {
    const far = place('far', { distanceMeters: 25_000 });
    expect(rules(validate([day([stop(far, '09:30', '10:30')])]))).toEqual(['VIOLATES_searchRadius']);
    expect(validate([day([stop(far, '09:30', '10:30')])], ctx(), { selectedIds: new Set(['far']) })).toEqual([]);
  });

  it('ignores empty days (they are reported separately as insufficient places)', () => {
    expect(validate([day([])])).toEqual([]);
  });
});
