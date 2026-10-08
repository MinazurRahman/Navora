import { describe, expect, it } from 'vitest';
import { fitContext, promptBudgetChars, REDUCED_NOTE } from '../../src/modules/assistant/budget.js';
import { buildAssistantContext } from '../../src/modules/assistant/context.js';
import { buildPrompt } from '../../src/modules/assistant/prompt.js';
import { ASSISTANT_CONFIG as config } from '../../src/config/assistant.js';
import { entry, itinerary, MONDAY, place, recommendations, stop, trip, visible } from '../helpers/assistantFixtures.js';

const measure = (ctx) => {
  const { system, messages } = buildPrompt(ctx, { task: 'summarize' });
  return system.length + messages[0].content.length;
};

// Small context: itinerary P1, P2 (day 1), P3 (day 2); recommended-only P4 (= place 5).
function small() {
  return buildAssistantContext({
    trip: trip(),
    startDate: MONDAY,
    startDateAssumed: false,
    itinerary: itinerary(),
    placesById: visible(place(1), place(2), place(3)),
    recommendations: recommendations([entry(place(5), 91), entry(place(1), 88)]),
    config,
  }).context;
}

// The largest itinerary Navora allows: 14 days × 6 stops, long names, 10 alternatives.
function largest() {
  const named = (n) => place(n, { name: `Place ${n} `.padEnd(120, 'x'), description: 'd'.repeat(5_000), tags: ['history', 'art', 'food'] });
  const days = Array.from({ length: 14 }, (_, d) => ({
    dayNumber: d + 1,
    date: `2026-10-${String(5 + d).padStart(2, '0')}`,
    startTime: '09:00',
    endTime: '18:00',
    totals: { distanceMeters: 20_000, travelMinutes: 90, visitMinutes: 360, plannedMinutes: 540 },
    routePolyline: null,
    stops: Array.from({ length: 6 }, (_, s) => {
      const n = d * 6 + s + 1;
      return stop(n, s + 1, { place: { ...stop(n, 1).place, name: named(n).name } });
    }),
  }));
  const places = Array.from({ length: 84 }, (_, i) => named(i + 1));
  return buildAssistantContext({
    trip: trip({ durationDays: 14 }),
    startDate: MONDAY,
    startDateAssumed: false,
    itinerary: itinerary({ days, warnings: [] }),
    placesById: new Map(places.map((p) => [p.id, p])),
    recommendations: recommendations([...places.slice(0, 40), ...Array.from({ length: 10 }, (_, i) => named(200 + i))].map((p, i) => entry(p, 90 - i))),
    config,
  }).context;
}

const DEFAULT_BUDGET = promptBudgetChars({ contextWindowTokens: 8_192, maxOutputTokens: 600 }, config);

describe('promptBudgetChars', () => {
  it('leaves room for the answer and a reserve, in characters', () => {
    expect(DEFAULT_BUDGET).toBe((8_192 - 600 - config.promptReserveTokens) * config.charsPerToken);
  });
});

describe('fitContext: community text', () => {
  it('always drops place descriptions, except for the focus place', () => {
    const { context, reduced } = fitContext(small(), { placeRef: 'P2', budgetChars: Infinity, measure });
    expect(reduced).toBe(false);
    expect(context.places.P1).not.toHaveProperty('description');
    expect(context.places.P2.description).toBe('About place 2');
    expect(context.places.P3).not.toHaveProperty('description');
  });

  it('drops all descriptions when there is no focus place, and does not change its input', () => {
    const input = small();
    const before = JSON.stringify(input);
    const { context } = fitContext(input, { budgetChars: Infinity, measure });
    expect(Object.values(context.places).some((p) => 'description' in p)).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('fitContext: prompt budget', () => {
  it('leaves a context that fits untouched (apart from descriptions)', () => {
    const { context, reduced } = fitContext(small(), { budgetChars: DEFAULT_BUDGET, measure });
    expect(reduced).toBe(false);
    expect(context.notes).not.toContain(REDUCED_NOTE);
    expect(context.recommendations.results[0]).toHaveProperty('breakdown');
  });

  it('removes detail in order: breakdowns, then recommendations outside the itinerary', () => {
    const input = small();
    const full = measure(fitContext(input, { budgetChars: Infinity, measure }).context);
    // Just too small: removing breakdowns (step 1) is not enough, step 2 is.
    const { context, reduced } = fitContext(input, { budgetChars: full - 80, measure });
    expect(reduced).toBe(true);
    expect(context.notes).toContain(REDUCED_NOTE);
    expect(context.recommendations.results.every((r) => r.inItinerary && !('breakdown' in r))).toBe(true);
    expect(context.places).not.toHaveProperty('P4');
    // Itinerary detail is still complete.
    expect(context.itinerary.days[0].stops[0]).toHaveProperty('visitMinutes');
    expect(measure(context)).toBeLessThanOrEqual(full - 80);
  });

  it('fits the largest allowed itinerary into the default window, keeping the focus day and place', () => {
    const input = largest();
    expect(measure(input)).toBeGreaterThan(DEFAULT_BUDGET); // the problem being fixed
    const fitted = fitContext(input, { placeRef: 'P8', dayNumber: 2, budgetChars: DEFAULT_BUDGET, measure });

    expect(fitted.reduced).toBe(true);
    expect(measure(fitted.context)).toBeLessThanOrEqual(DEFAULT_BUDGET);
    const [day1, day2] = fitted.context.itinerary.days;
    // Other days keep their times and totals; the focus day keeps full stop detail.
    expect(day1).toMatchObject({ dayNumber: 1, startTime: '09:00', endTime: '18:00', travelMinutes: 90, stopCount: 6, stops: [] });
    expect(day2.stops).toHaveLength(6);
    expect(day2.stops[1]).toMatchObject({ place: 'P8', visitMinutes: 60, travelMinutesFromPrevious: 15 });
    expect(fitted.context.places.P8).toMatchObject({ name: expect.stringMatching(/^Place 8/), description: 'd'.repeat(config.maxDescriptionChars - 1) + '…' });
    expect(fitted.context.itinerary.days).toHaveLength(14);
  });

  it('fits the largest itinerary with realistic names while keeping every stop listed by name', () => {
    const input = largest();
    for (const day of input.itinerary.days) for (const s of day.stops) s.name = s.name.slice(0, 30);
    const fitted = fitContext(input, { budgetChars: DEFAULT_BUDGET, measure });
    expect(measure(fitted.context)).toBeLessThanOrEqual(DEFAULT_BUDGET);
    expect(fitted.context.itinerary.days.flatMap((d) => d.stops)).toHaveLength(84);
  });

  it('keeps a recommended (not yet scheduled) focus place and its result', () => {
    const fitted = fitContext(small(), { placeRef: 'P4', budgetChars: 4_500, measure });
    expect(fitted.context.places.P4.name).toBe('Place 5');
    expect(fitted.context.recommendations.results.map((r) => r.place)).toContain('P4');
  });

  it('returns null when even the smallest form does not fit', () => {
    expect(fitContext(small(), { budgetChars: 500, measure })).toBeNull();
  });

  it('never leaves a dangling reference: every place ref in the context is a stop, warning, result or detail', () => {
    const fitted = fitContext(largest(), { budgetChars: DEFAULT_BUDGET, measure });
    const stopRefs = new Set(fitted.context.itinerary.days.flatMap((d) => d.stops.map((s) => s.place)));
    for (const result of fitted.context.recommendations.results) expect(stopRefs.has(result.place) || result.place in fitted.context.places).toBe(true);
  });
});
