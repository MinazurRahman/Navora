import { describe, expect, it } from 'vitest';
import { shapeContextForTask, TASK_FOCUS_NOTE } from '../../src/modules/assistant/taskContext.js';
import { buildAssistantContext, ENGINE_NOTE } from '../../src/modules/assistant/context.js';
import { ASSISTANT_CONFIG as config } from '../../src/config/assistant.js';
import { entry, id, itinerary, MONDAY, place, recommendations, trip, visible } from '../helpers/assistantFixtures.js';

// Itinerary: P1, P2 (day 1), P3 (day 2, unknown fee, OPENING_HOURS_UNVERIFIED warning).
// Recommendations: P4 (= place 5, not in the itinerary) ranked first, then P1.
function full() {
  return buildAssistantContext({
    trip: trip(),
    startDate: MONDAY,
    startDateAssumed: false,
    itinerary: itinerary(),
    placesById: visible(place(1), place(2), place(3)),
    recommendations: recommendations([entry(place(5), 91), entry(place(1), 88), entry(place(3), 70)]),
    config,
  }).context;
}
const size = (ctx) => JSON.stringify(ctx).length;

describe('shapeContextForTask: shared rules', () => {
  it('never changes its input and never adds data that was not there', () => {
    const input = full();
    const before = JSON.stringify(input);
    for (const task of ['summarize', 'explain_itinerary', 'explain_warnings', 'explain_place', 'question', 'suggest_adjustments']) {
      const shaped = shapeContextForTask(input, { task, placeRef: 'P2' });
      for (const ref of Object.keys(shaped.places)) expect(input.places).toHaveProperty(ref);
      for (const r of shaped.recommendations?.results ?? []) expect(input.recommendations.results.map((x) => x.place)).toContain(r.place);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps the deterministic Navora data it passes on unchanged', () => {
    const input = full();
    for (const task of ['summarize', 'explain_itinerary', 'explain_warnings', 'question']) {
      const shaped = shapeContextForTask(input, { task });
      expect(shaped.trip).toEqual(input.trip);
      expect(shaped.itinerary.cost).toEqual(input.itinerary.cost);
      expect(shaped.itinerary.totals).toEqual(input.itinerary.totals);
    }
  });

  it('tells the model the context was reduced for the task', () => {
    expect(shapeContextForTask(full(), { task: 'summarize' }).notes).toContain(TASK_FOCUS_NOTE);
    expect(shapeContextForTask(full(), { task: 'suggest_adjustments' }).notes).not.toContain(TASK_FOCUS_NOTE);
  });

  it('gives every task a smaller context than suggest_adjustments, summarize the smallest', () => {
    const input = full();
    const sizes = Object.fromEntries(['summarize', 'explain_itinerary', 'explain_warnings', 'explain_place', 'question', 'suggest_adjustments']
      .map((task) => [task, size(shapeContextForTask(input, { task, placeRef: task === 'explain_place' ? 'P2' : undefined }))]));
    for (const task of ['summarize', 'explain_itinerary', 'explain_warnings', 'explain_place', 'question']) {
      expect(sizes[task], task).toBeLessThan(sizes.suggest_adjustments);
    }
    expect(Math.min(...Object.values(sizes))).toBe(sizes.summarize);
  });
});

describe('summarize', () => {
  const ctx = () => shapeContextForTask(full(), { task: 'summarize' });

  it('gets the trip, every day and stop, costs and warnings', () => {
    const shaped = ctx();
    expect(shaped.itinerary.days.flatMap((d) => d.stops.map((s) => s.place))).toEqual(['P1', 'P2', 'P3']);
    expect(shaped.itinerary.days[0].stops[0]).toHaveProperty('visitMinutes');
    expect(shaped.itinerary.cost.totalIsComplete).toBe(false);
    expect(shaped.itinerary.warnings).toHaveLength(1);
  });

  it('gets no recommendation payload and no place details', () => {
    const shaped = ctx();
    expect(shaped.recommendations).toBeNull();
    expect(shaped.places).toEqual({});
    expect(shaped.notes).not.toContain(ENGINE_NOTE);
  });
});

describe('explain_itinerary', () => {
  it('gets days, stops, timing, warnings and the timing facts of its stops only', () => {
    const shaped = shapeContextForTask(full(), { task: 'explain_itinerary' });
    expect(shaped.recommendations).toBeNull();
    expect(Object.keys(shaped.places).sort()).toEqual(['P1', 'P2', 'P3']);
    expect(Object.keys(shaped.places.P1).sort()).toEqual(['category', 'name', 'openingHours', 'typicalVisitMinutes']);
    expect(shaped.itinerary.days[1].stops[0]).toMatchObject({ place: 'P3', travelMinutesFromPrevious: 15, openingHoursVerified: false });
    expect(shaped.itinerary.warnings).toHaveLength(1);
  });
});

describe('explain_warnings', () => {
  it('gets the warnings and the hours/fee facts of the places they name', () => {
    const shaped = shapeContextForTask(full(), { task: 'explain_warnings' });
    expect(shaped.recommendations).toBeNull();
    expect(Object.keys(shaped.places)).toEqual(['P3']);
    expect(Object.keys(shaped.places.P3).sort()).toEqual(['category', 'currency', 'entryFee', 'name', 'openingHours']);
  });

  it('keeps the name of a place a warning mentions that is no longer a stop', () => {
    const input = buildAssistantContext({
      trip: trip(), startDate: MONDAY, startDateAssumed: false,
      itinerary: itinerary({ warnings: [{ code: 'STOP_REMOVED_AFTER_ROUTING', message: 'Removed.', placeId: id(7), dayNumber: 1 }] }),
      placesById: visible(place(1), place(2), place(3), place(7)), recommendations: null, config,
    }).context;
    const shaped = shapeContextForTask(input, { task: 'summarize' });
    expect(shaped.places).toEqual({ P4: { name: 'Place 7' } });
  });
});

describe('explain_place', () => {
  it('gets the focus place in full, its recommendation result and its day; other days compact', () => {
    const shaped = shapeContextForTask(full(), { task: 'explain_place', placeRef: 'P1' });
    expect(Object.keys(shaped.places)).toEqual(['P1']);
    expect(shaped.places.P1).toMatchObject({ description: 'About place 1', rating: { average: 4.5, count: 12 }, facilities: expect.any(Object) });
    expect(shaped.recommendations).toEqual({ results: [expect.objectContaining({ place: 'P1', score: 88, breakdown: expect.any(Object), reasons: expect.any(Array) })] });
    // Day 1 (the focus place's day) keeps full stop detail; day 2 is names and times only.
    expect(shaped.itinerary.days[0].stops[1]).toHaveProperty('visitMinutes');
    expect(Object.keys(shaped.itinerary.days[1].stops[0]).sort()).toEqual(['name', 'place', 'plannedEnd', 'plannedStart']);
    // P3's warning is about another place.
    expect(shaped.itinerary.warnings).toEqual([]);
  });

  it('keeps warnings about the focus place', () => {
    const shaped = shapeContextForTask(full(), { task: 'explain_place', placeRef: 'P3' });
    expect(shaped.itinerary.warnings).toEqual([expect.objectContaining({ code: 'OPENING_HOURS_UNVERIFIED', place: 'P3' })]);
    expect(shaped.recommendations.results.map((r) => r.place)).toEqual(['P3']);
  });

  it('works for a recommended place that is not in the itinerary', () => {
    const shaped = shapeContextForTask(full(), { task: 'explain_place', placeRef: 'P4' });
    expect(shaped.places.P4.name).toBe('Place 5');
    expect(shaped.recommendations.results).toEqual([expect.objectContaining({ place: 'P4', inItinerary: false })]);
    expect(shaped.itinerary.days.every((d) => d.stops.every((s) => !('visitMinutes' in s)))).toBe(true);
  });
});

describe('question', () => {
  it('keeps the itinerary, its places and why each stop was chosen, without alternatives or breakdowns', () => {
    const shaped = shapeContextForTask(full(), { task: 'question' });
    expect(shaped.recommendations.results.map((r) => r.place).sort()).toEqual(['P1', 'P3']);
    expect(shaped.recommendations.results.every((r) => !('breakdown' in r) && r.reasons.length > 0)).toBe(true);
    expect(shaped.recommendations).toMatchObject({ eligiblePlaces: 3, excludedBy: { parking: 3 }, suggestions: [] });
    expect(Object.keys(shaped.places).sort()).toEqual(['P1', 'P2', 'P3']);
    expect(shaped.places.P1).not.toHaveProperty('description');
  });

  it('keeps a focus place even when it is only recommended', () => {
    const shaped = shapeContextForTask(full(), { task: 'question', placeRef: 'P4' });
    expect(shaped.recommendations.results.map((r) => r.place)).toContain('P4');
    expect(shaped.places.P4.description).toBe('About place 5');
  });
});

describe('suggest_adjustments', () => {
  it('keeps the alternatives it may suggest; only descriptions are removed', () => {
    const shaped = shapeContextForTask(full(), { task: 'suggest_adjustments' });
    expect(shaped.recommendations.results.map((r) => r.place)).toContain('P4');
    expect(Object.values(shaped.places).some((p) => 'description' in p)).toBe(false);
    expect(shaped.notes).toContain(ENGINE_NOTE);
  });
});
