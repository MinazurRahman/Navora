import { describe, expect, it } from 'vitest';
import { createRoutingService, ROUTE_METADATA } from '../../src/modules/routing/routing.service.js';
import { createMapService } from '../../src/integrations/maps/mapService.js';
import { createEstimateProvider } from '../../src/integrations/maps/providers/estimate.js';
import { MAP_ERROR, MapProviderError } from '../../src/integrations/maps/errors.js';
import { createCache } from '../../src/integrations/redis/cache.js';
import { PLANNING_CONFIG } from '../../src/config/planning.js';
import { createInMemoryRedis } from '../helpers/testApp.js';

// Deterministic "road" provider: 1 minute per 0.01° straight-line, 500 m per minute.
const gridProvider = {
  name: 'grid',
  supportsMode: () => true,
  async getDistanceMatrix(points) {
    const minutes = points.map((a) => points.map((b) => Math.round(Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 100)));
    return { durations: minutes.map((row) => row.map((m) => m * 60)), distances: minutes.map((row) => row.map((m) => m * 500)) };
  },
  async getRoute() {
    return { distanceMeters: 0, durationSeconds: 0, legs: null, geometry: 'grid-polyline' };
  },
};

// No per-leg overhead and no buffers, so every number below can be checked by hand.
const config = { ...PLANNING_CONFIG, legOverheadMinutes: { car: 0, walking: 0, cycling: 0, public_transport: 0 }, bufferMinutesBetweenStops: 0 };
const estimate = createEstimateProvider(PLANNING_CONFIG);

function routingWith(provider = gridProvider) {
  const mapService = createMapService({ provider, fallback: estimate, cache: createCache(createInMemoryRedis()), ttlSeconds: 60 });
  return createRoutingService({ mapService, config });
}

const START = { latitude: 23.8, longitude: 90.4 };
// Points on one east–west line, minutes from START: +1, −2, +3.
const east1 = place('East 1', 23.8, 90.41);
const west2 = place('West 2', 23.8, 90.38);
const east3 = place('East 3', 23.8, 90.43);

function place(name, latitude, longitude, overrides = {}) {
  return { id: name, name, category: { slug: 'museum', name: 'Museum' }, location: { latitude, longitude }, typicalVisitMinutes: 30, openingHours: [], ...overrides };
}

const MONDAY = '2026-10-05';
const day = (places, overrides = {}) => ({ date: MONDAY, dailyStartTime: '09:00', dailyEndTime: '20:00', places, ...overrides });
const optimize = (days, overrides = {}) =>
  routingWith(overrides.provider).optimize({ start: START, travelMode: 'car', returnToStart: true, startDate: MONDAY, days, ...overrides });

describe('route optimisation: nearest neighbour + 2-opt', () => {
  it('improves on nearest neighbour: 26 → 22 minutes on a sample that fools it', async () => {
    // Minutes from START on one line: +2, −3, +8.
    // NN (greedy): 0 → +2 → −3 → +8 → 0 = 2 + 5 + 11 + 8 = 26.
    // 2-opt:       0 → +2 → +8 → −3 → 0 = 2 + 6 + 11 + 3 = 22.
    const sample = [place('East 8', 23.8, 90.48), place('West 3', 23.8, 90.37), place('East 2', 23.8, 90.42)];
    const [d] = (await optimize([day(sample)])).days;

    expect(d.metadata).toMatchObject({ initialTravelMinutes: 26, optimizedTravelMinutes: 22 });
    expect(d.totals.travelMinutes).toBe(22);
    // Two orders tie at 22 minutes; either is a correct answer.
    expect([['East 2', 'East 8', 'West 3'], ['West 3', 'East 2', 'East 8']]).toContainEqual(d.stops.map((s) => s.place.name));
  });

  it('keeps an already-optimal greedy route', async () => {
    // 0 → +1 → +3 → −2 → 0 = 10, which nearest neighbour already finds.
    const [d] = (await optimize([day([west2, east3, east1])])).days;
    expect(d.metadata).toMatchObject({ initialTravelMinutes: 10, optimizedTravelMinutes: 10 });
  });

  it('matches the brute-force optimum on a 5-place sample, and is never worse than nearest neighbour', async () => {
    const sample = [
      place('A', 23.84, 90.40), place('B', 23.84, 90.46), place('C', 23.80, 90.46),
      place('D', 23.82, 90.43), place('E', 23.78, 90.42),
    ];
    const [d] = (await optimize([day(sample)])).days;

    const minutesBetween = (a, b) => Math.round(Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 100);
    const tour = (order) => {
      let total = 0;
      let at = START;
      for (const p of order) { total += minutesBetween(at, p.location); at = p.location; }
      return total + minutesBetween(at, START);
    };
    const permutations = (items) => (items.length <= 1 ? [items] : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest])));
    const optimum = Math.min(...permutations(sample).map(tour));

    expect(d.totals.travelMinutes).toBe(optimum);
    expect(d.metadata.optimizedTravelMinutes).toBeLessThanOrEqual(d.metadata.initialTravelMinutes);
  });

  it('reports each leg, the trip back, and totals that add up', async () => {
    const [d] = (await optimize([day([east1, east3])])).days;

    expect(d.stops.map((s) => s.travelFromPrevious)).toEqual([
      { minutes: 1, distanceMeters: 500 },
      { minutes: 2, distanceMeters: 1000 },
    ]);
    expect(d.returnToStart).toEqual({ minutes: 3, distanceMeters: 1500 });
    expect(d.totals).toMatchObject({ distanceMeters: 3000, travelMinutes: 6, visitMinutes: 60, endTime: '10:06' });
    expect(d.stops.map((s) => [s.order, s.plannedStart, s.plannedEnd])).toEqual([[1, '09:01', '09:31'], [2, '09:33', '10:03']]);
  });

  it('without returning to the start there is no return leg in the totals', async () => {
    const [d] = (await optimize([day([east1, east3])], { returnToStart: false })).days;
    expect(d.returnToStart).toBeNull();
    expect(d.totals).toMatchObject({ distanceMeters: 1500, travelMinutes: 3 });
  });

  it('optimises each day separately', async () => {
    const result = await optimize([day([east3, east1]), day([west2], { date: undefined })]);

    expect(result.days.map((d) => d.stops.map((s) => s.place.name))).toEqual([['East 1', 'East 3'], ['West 2']]);
    expect(result.days.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(result.days[1].date).toBe('2026-10-06'); // default: consecutive days
    expect(result.totals.travelMinutes).toBe(6 + 4);
  });
});

describe('schedule feasibility', () => {
  it('accepts a longer order when the shortest one clashes with opening hours', async () => {
    const lateOpener = place('Late opener', 23.8, 90.41, { openingHours: [{ dayOfWeek: 1, opensAt: '14:00', closesAt: '18:00' }] });
    const morningOnly = place('Morning only', 23.8, 90.70, { openingHours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '11:00' }] });

    const [d] = (await optimize([day([lateOpener, morningOnly])])).days;

    expect(d.feasible).toBe(true);
    expect(d.stops.map((s) => s.place.name)).toEqual(['Morning only', 'Late opener']);
    expect(d.metadata.reorderedForOpeningHours).toBe(true);
    expect(d.stops[1].plannedStart).toBe('14:00');
  });

  it('reports an infeasible day with the reason, keeping every chosen place', async () => {
    const closedMondays = place('Closed Mondays', 23.8, 90.41, { openingHours: [{ dayOfWeek: 2, opensAt: '09:00', closesAt: '17:00' }] });
    const [d] = (await optimize([day([east3, closedMondays])])).days;

    expect(d.feasible).toBe(false);
    expect(d.infeasibility).toEqual({ reason: 'CLOSED', placeId: 'Closed Mondays' });
    expect(d.stops).toHaveLength(2);
    expect(d.stops.every((s) => s.plannedStart === null)).toBe(true);
    expect(d.totals.endTime).toBeNull();
  });

  it('flags a day that does not fit the daily window', async () => {
    const [d] = (await optimize([day([east1, east3], { dailyEndTime: '09:45' })])).days;
    expect(d).toMatchObject({ feasible: false, infeasibility: { reason: 'EXCEEDS_DAILY_WINDOW' } });
  });
});

describe('route metadata', () => {
  it('never claims global optimality', async () => {
    const result = await optimize([day([east1])]);
    expect(result.metadata).toMatchObject({ algorithm: 'nearest-neighbor+2opt', globallyOptimal: false, allDaysFeasible: true });
    expect(ROUTE_METADATA.note).toMatch(/not guaranteed/);
  });

  it('names the provider and includes its road polyline', async () => {
    const [d] = (await optimize([day([east1])])).days;
    expect(d.metadata).toMatchObject({ provider: 'grid', travelTimesEstimated: false });
    expect(d.routePolyline).toBe('grid-polyline');
  });

  it('marks estimated times (and gives no polyline) when the provider fails', async () => {
    const failing = { ...gridProvider, getDistanceMatrix: async () => { throw new MapProviderError(MAP_ERROR.RATE_LIMITED, 'quota'); } };
    const result = await optimize([day([east1, east3])], { provider: failing });

    expect(result.metadata.travelTimesEstimated).toBe(true);
    expect(result.days[0].metadata).toMatchObject({ provider: 'estimate', travelTimesEstimated: true, fallbackReason: MAP_ERROR.RATE_LIMITED });
    expect(result.days[0].routePolyline).toBeNull();
  });

  it('a provider timeout costs one call per request: later days use flagged estimates', async () => {
    let calls = 0;
    const timingOut = {
      ...gridProvider,
      getDistanceMatrix: async () => {
        calls += 1;
        throw new MapProviderError(MAP_ERROR.TIMEOUT, 'no answer');
      },
    };
    const days = Array.from({ length: 14 }, () => day([east1, east3]));
    const result = await optimize(days, { provider: timingOut });

    expect(calls).toBe(1);
    expect(result.days).toHaveLength(14);
    for (const d of result.days) {
      expect(d.feasible).toBe(true);
      expect(d.metadata).toMatchObject({ provider: 'estimate', travelTimesEstimated: true, fallbackReason: MAP_ERROR.TIMEOUT });
    }
    expect(result.metadata.travelTimesEstimated).toBe(true);
  });
});
