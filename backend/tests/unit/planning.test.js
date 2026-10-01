import { describe, expect, it } from 'vitest';
import { PLANNING_CONFIG } from '../../src/config/planning.js';
import { INFEASIBLE, simulateDay } from '../../src/modules/itineraries/feasibility.js';
import { planTrip } from '../../src/modules/itineraries/planner.js';
import { nearestNeighbor, optimizeOrder, routeCost, twoOpt } from '../../src/modules/routing/optimizer.js';
import { createEstimatedTravel, haversineMeters } from '../../src/modules/routing/travelEstimator.js';
import { toMinutes } from '../../src/modules/recommendations/schedule.js';

// Deterministic test travel: 1 minute per 0.01° of longitude (stops lie on one line).
const START = { latitude: 23.8, longitude: 90.4 };
const travel = (a, b) => {
  const minutes = Math.round(Math.abs(a.longitude - b.longitude) * 100);
  return { distanceMeters: minutes * 500, durationSeconds: minutes * 60 };
};
const config = { ...PLANNING_CONFIG, bufferMinutesBetweenStops: 0, returnToStart: false };
const MONDAY = 1;

let nextId = 0;
function place(overrides = {}) {
  nextId += 1;
  return {
    id: `p${nextId}`,
    name: `Place ${nextId}`,
    category: { slug: 'museum', name: 'Museum' },
    location: { latitude: 23.8, longitude: 90.4 + 0.1 }, // 10 min from START
    typicalVisitMinutes: 60,
    entryFee: 0,
    openingHours: [],
    ...overrides,
  };
}
const at = (minutesFromStart) => ({ latitude: 23.8, longitude: 90.4 + minutesFromStart / 100 });
const hours = (dayOfWeek, opensAt, closesAt) => ({ dayOfWeek, opensAt, closesAt });

const day = (stops, overrides = {}) =>
  simulateDay({ stops, start: START, dayOfWeek: MONDAY, windowStart: toMinutes('09:00'), windowEnd: toMinutes('20:00'), travel, mode: 'car', config, ...overrides });

describe('simulateDay (feasibility)', () => {
  it('schedules travel then visit, back to back', () => {
    const result = day([place({ location: at(10) }), place({ location: at(30) })]);

    expect(result.feasible).toBe(true);
    expect(result.stops.map((s) => [s.plannedStart, s.plannedEnd])).toEqual([
      [toMinutes('09:10'), toMinutes('10:10')],
      [toMinutes('10:30'), toMinutes('11:30')],
    ]);
    expect(result.totals).toMatchObject({ travelSeconds: 30 * 60, visitMinutes: 120 });
  });

  it('adds the buffer between stops (not before the first)', () => {
    const result = day([place({ location: at(10) }), place({ location: at(10) })], { config: { ...config, bufferMinutesBetweenStops: 15 } });
    expect(result.stops[1].plannedStart).toBe(toMinutes('10:25'));
  });

  it('waits for opening time when arriving early', () => {
    const result = day([place({ location: at(10), openingHours: [hours(MONDAY, '11:00', '17:00')] })]);
    expect(result.stops[0].plannedStart).toBe(toMinutes('11:00'));
    expect(result.stops[0].openingHoursVerified).toBe(true);
  });

  it('is infeasible when the place is closed that weekday', () => {
    const result = day([place({ openingHours: [hours(2, '09:00', '17:00')] })]);
    expect(result).toMatchObject({ feasible: false, reason: INFEASIBLE.CLOSED });
  });

  it('is infeasible when the visit would run past closing time', () => {
    const result = day([place({ location: at(10), typicalVisitMinutes: 90, openingHours: [hours(MONDAY, '08:00', '10:00')] })]);
    expect(result).toMatchObject({ feasible: false, reason: INFEASIBLE.CLOSED });
  });

  it('uses a later opening window on the same day (split hours)', () => {
    const p = place({ location: at(10), typicalVisitMinutes: 90, openingHours: [hours(MONDAY, '08:00', '10:00'), hours(MONDAY, '14:00', '18:00')] });
    expect(day([p]).stops[0].plannedStart).toBe(toMinutes('14:00'));
  });

  it('is infeasible when a stop would end after the daily end time', () => {
    const result = day([place({ location: at(10), typicalVisitMinutes: 60 })], { windowEnd: toMinutes('10:00') });
    expect(result).toMatchObject({ feasible: false, reason: INFEASIBLE.EXCEEDS_DAILY_WINDOW });
  });

  it('requires time to travel back to the start when configured', () => {
    const stop = place({ location: at(30), typicalVisitMinutes: 60 }); // ends 10:30
    const returning = { ...config, returnToStart: true };

    expect(day([stop], { windowEnd: toMinutes('10:45'), config: returning })).toMatchObject({ feasible: false, reason: INFEASIBLE.NO_TIME_TO_RETURN });
    const ok = day([stop], { windowEnd: toMinutes('11:00'), config: returning });
    expect(ok.feasible).toBe(true);
    expect(ok.endTime).toBe(toMinutes('11:00'));
  });

  it('never overloads a day beyond the stop cap, even if the time fits', () => {
    const many = Array.from({ length: config.maxStopsPerDay + 1 }, () => place({ location: at(1), typicalVisitMinutes: 5 }));
    expect(day(many)).toMatchObject({ feasible: false, reason: INFEASIBLE.TOO_MANY_STOPS });
  });

  it('unknown hours: placed inside the window, flagged, never treated as known-open', () => {
    const result = day([place({ openingHours: [] })]);
    expect(result.feasible).toBe(true);
    expect(result.stops[0].openingHoursVerified).toBe(false);
  });

  it('estimates visit length from the category when the place has none', () => {
    const result = day([place({ typicalVisitMinutes: null, category: { slug: 'zoo', name: 'Zoo' } })]);
    expect(result.stops[0].visitMinutes).toBe(PLANNING_CONFIG.visitMinutesByCategory.zoo);
  });
});

describe('route optimisation', () => {
  const cost = (a, b) => travel(a.location ?? a, b.location ?? b).durationSeconds;
  const stops = [at(30), at(10), at(20)].map((location) => place({ location }));

  it('nearest neighbour visits the closest stop next', () => {
    expect(nearestNeighbor(START, stops, cost)).toEqual([stops[1], stops[2], stops[0]]);
  });

  it('2-opt never makes a route worse and fixes a crossing route', () => {
    const crossing = [stops[0], stops[1], stops[2]]; // 30 → 10 → 20
    const improved = twoOpt(START, crossing, cost, false);
    expect(routeCost(START, improved, cost, false)).toBeLessThan(routeCost(START, crossing, cost, false));
    expect(routeCost(START, optimizeOrder(START, stops, cost, { returnToStart: true }), cost, true)).toBe(60 * 60);
  });
});

describe('planTrip (allocation across days)', () => {
  const twoDays = [
    { dayNumber: 1, date: '2026-10-05', dayOfWeek: 1 },
    { dayNumber: 2, date: '2026-10-06', dayOfWeek: 2 },
  ];
  const plan = (args) =>
    planTrip({ days: twoDays, start: START, mode: 'car', windowStart: toMinutes('09:00'), windowEnd: toMinutes('13:00'), travel, config, ...args });

  it('fills days without overloading them: every day stays inside the window', () => {
    const ranked = Array.from({ length: 10 }, () => place({ location: at(10), typicalVisitMinutes: 60 }));
    const result = plan({ ranked });

    for (const d of result.days) {
      expect(d.schedule.stops.length).toBeGreaterThan(0);
      expect(d.schedule.stops.at(-1).plannedEnd).toBeLessThanOrEqual(toMinutes('13:00'));
    }
    const scheduled = result.days.flatMap((d) => d.schedule.stops.map((s) => s.place.id));
    expect(new Set(scheduled).size).toBe(scheduled.length); // no place twice
    expect(scheduled.length).toBeLessThan(10); // the rest did not fit: dropped, not crammed
  });

  it('puts a place on a day it is open', () => {
    const tuesdayOnly = place({ openingHours: [hours(2, '09:00', '17:00')] });
    const result = plan({ ranked: [tuesdayOnly] });
    expect(result.days[0].schedule.stops).toHaveLength(0);
    expect(result.days[1].schedule.stops[0].place.id).toBe(tuesdayOnly.id);
  });

  it('respects the total budget (entry fee × party size); unknown fees are tracked, not assumed free', () => {
    const pricey = place({ entryFee: 300 });
    const cheap = place({ entryFee: 100 });
    const unknown = place({ entryFee: null });
    const result = plan({ ranked: [pricey, cheap, unknown], budgetTotal: 500, partySize: 2 });

    const scheduled = result.days.flatMap((d) => d.schedule.stops.map((s) => s.place.id));
    expect(scheduled).toEqual(expect.arrayContaining([cheap.id, unknown.id]));
    expect(scheduled).not.toContain(pricey.id); // 600 > 500
    expect(result.budget).toMatchObject({ spentKnown: 200, unknownFeePlaceIds: [unknown.id], skippedForBudget: 1 });
  });

  it('schedules selected places first, ahead of higher-ranked ones', () => {
    const fillers = Array.from({ length: 12 }, () => place({ location: at(10) }));
    const selected = place({ location: at(40) });
    const result = plan({ ranked: fillers, mandatory: [selected] });

    expect(result.unscheduledMandatory).toEqual([]);
    expect(result.days.flatMap((d) => d.schedule.stops.map((s) => s.place.id))).toContain(selected.id);
  });

  it('reports why a selected place cannot be scheduled instead of dropping it silently', () => {
    const closed = place({ name: 'Weekend market', openingHours: [hours(6, '09:00', '17:00')] });
    const tooLong = place({ name: 'All-day park', typicalVisitMinutes: 600 });
    const overBudget = place({ name: 'Theme park', entryFee: 5000 });

    const result = plan({ ranked: [], mandatory: [closed, tooLong, overBudget], budgetTotal: 1000 });
    expect(result.unscheduledMandatory).toEqual([
      { placeId: closed.id, name: 'Weekend market', reason: 'CLOSED_ON_TRIP_DAYS' },
      { placeId: tooLong.id, name: 'All-day park', reason: 'NOT_ENOUGH_TIME' },
      { placeId: overBudget.id, name: 'Theme park', reason: 'OVER_BUDGET' },
    ]);
  });

  it('groups nearby places on the same day instead of zig-zagging between clusters', () => {
    // 2-D travel: 1 minute per 0.01° straight-line, round trip back to the start.
    const travel2d = (a, b) => {
      const minutes = Math.round(Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 100);
      return { distanceMeters: minutes * 500, durationSeconds: minutes * 60 };
    };
    const north = [place({ location: { latitude: 23.9, longitude: 90.4 } }), place({ location: { latitude: 23.91, longitude: 90.4 } })];
    const east = [place({ location: { latitude: 23.8, longitude: 91.0 } }), place({ location: { latitude: 23.8, longitude: 91.01 } })];

    const result = plan({
      ranked: [north[0], east[0], north[1], east[1]],
      windowEnd: toMinutes('20:00'),
      travel: travel2d,
      config: { ...config, returnToStart: true, maxStopsPerDay: 2 },
    });

    const byDay = result.days.map((d) => d.schedule.stops.map((s) => s.place.id).sort());
    expect(byDay).toEqual(expect.arrayContaining([[north[0].id, north[1].id].sort(), [east[0].id, east[1].id].sort()]));
  });

  it('leaves a day empty when nothing fits (the caller turns this into a 422)', () => {
    expect(plan({ ranked: [] }).days.every((d) => d.schedule.stops.length === 0)).toBe(true);
  });
});

describe('estimated travel', () => {
  const estimate = createEstimatedTravel(PLANNING_CONFIG);
  const a = { latitude: 23.8103, longitude: 90.4125 };
  const b = { latitude: 23.7189, longitude: 90.3882 }; // ≈ 10.4 km

  it('uses great-circle distance × detour factor', () => {
    expect(haversineMeters(a, b)).toBeGreaterThan(10_300);
    expect(haversineMeters(a, b)).toBeLessThan(10_500);
    expect(estimate(a, b, 'car').distanceMeters).toBe(Math.round(haversineMeters(a, b) * PLANNING_CONFIG.detourFactor));
  });

  it('is slower on foot than by car, and zero for the same point', () => {
    expect(estimate(a, b, 'walking').durationSeconds).toBeGreaterThan(estimate(a, b, 'car').durationSeconds);
    expect(estimate(a, a, 'car')).toEqual({ distanceMeters: 0, durationSeconds: 0 });
  });
});
