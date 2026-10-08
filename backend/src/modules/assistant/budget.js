// Keeps the AI prompt within the model's context window. Pure. A provider that receives a
// longer prompt silently truncates it, so the model would answer without the data it must be
// grounded in; instead, detail is removed here in a known order, the model is told, and a
// request that still does not fit is refused.
import { shapeContextForTask } from './taskContext.js';

export const REDUCED_NOTE = 'Some details were left out to keep this request small; if something you need is missing, say it is unavailable.';

// Characters available for system prompt + messages.
export function promptBudgetChars({ contextWindowTokens, maxOutputTokens }, config) {
  return (contextWindowTokens - maxOutputTokens - config.promptReserveTokens) * config.charsPerToken;
}


// Places still referenced after a reduction: stops, warnings, recommendation results, focus.
function referencedRefs(ctx, placeRef) {
  return new Set([
    ...(ctx.itinerary?.days ?? []).flatMap((day) => day.stops.map((stop) => stop.place)),
    ...(ctx.itinerary?.warnings ?? []).filter((w) => w.place).map((w) => w.place),
    ...(ctx.recommendations?.results ?? []).map((r) => r.place),
    ...(placeRef ? [placeRef] : []),
  ]);
}

// Applied in order, cumulatively, until the prompt fits. The focus place and day keep their detail.
const REDUCTIONS = [
  // 1. Score breakdowns (the reasons stay).
  (ctx) => {
    for (const result of ctx.recommendations?.results ?? []) delete result.breakdown;
  },
  // 2. Recommended places that are not in the itinerary.
  (ctx, { placeRef }) => {
    if (!ctx.recommendations) return;
    ctx.recommendations.results = ctx.recommendations.results.filter((r) => r.inItinerary || r.place === placeRef);
    const keep = referencedRefs(ctx, placeRef);
    for (const ref of Object.keys(ctx.places)) if (!keep.has(ref)) delete ctx.places[ref];
  },
  // 3. Stop detail on days other than the focus day (names and planned times stay).
  (ctx, { dayNumber }) => {
    for (const day of ctx.itinerary?.days ?? []) {
      if (day.dayNumber === dayNumber) continue;
      day.stops = day.stops.map(({ place, name, plannedStart, plannedEnd }) => ({ place, name, plannedStart, plannedEnd }));
    }
  },
  // 4. Secondary place details (tags, opening hours, visit length), except the focus place.
  (ctx, { placeRef }) => {
    for (const [ref, place] of Object.entries(ctx.places)) {
      if (ref === placeRef) continue;
      delete place.tags;
      delete place.openingHours;
      delete place.typicalVisitMinutes;
    }
  },
  // 5. All other place details (stops keep their names).
  (ctx, { placeRef }) => {
    for (const ref of Object.keys(ctx.places)) if (ref !== placeRef) delete ctx.places[ref];
  },
  // 6. Recommendation results except for the focus place and the focus day's stops.
  (ctx, { placeRef, dayNumber }) => {
    if (!ctx.recommendations) return;
    const focusDay = (ctx.itinerary?.days ?? []).find((day) => day.dayNumber === dayNumber);
    const keep = new Set([placeRef, ...(focusDay?.stops ?? []).map((stop) => stop.place)]);
    ctx.recommendations.results = ctx.recommendations.results.filter((r) => keep.has(r.place));
  },
  // 7. Stops of other days (each day keeps its times, totals and a stop count). Last resort,
  //    so that asking about one day always fits.
  (ctx, { dayNumber }) => {
    for (const day of ctx.itinerary?.days ?? []) {
      if (day.dayNumber === dayNumber || day.stops.length === 0) continue;
      day.stopCount = day.stops.length;
      day.stops = [];
    }
    if (!ctx.itinerary) return;
    // Per-day warnings follow their day; trip-wide ones (e.g. TRAVEL_TIMES_ESTIMATED) stay.
    ctx.itinerary.warnings = ctx.itinerary.warnings.filter((w) => w.dayNumber === undefined || w.dayNumber === dayNumber);
  },
];

/**
 * @param task     assistant task: the context is first reduced to what that task needs (taskContext.js)
 * @param measure  (context) → prompt length in characters
 * @returns { context, reduced } or null when even the smallest form does not fit
 */
export function fitContext(context, { task, placeRef, dayNumber, budgetChars, measure }) {
  const ctx = shapeContextForTask(context, { task, placeRef });
  if (measure(ctx) <= budgetChars) return { context: ctx, reduced: false };

  ctx.notes = [...ctx.notes, REDUCED_NOTE];
  for (const reduce of REDUCTIONS) {
    reduce(ctx, { placeRef, dayNumber });
    if (measure(ctx) <= budgetChars) return { context: ctx, reduced: true };
  }
  return null;
}
