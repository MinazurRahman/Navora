// Per-task context: each task gets only the parts of the (already authorised, already bounded)
// context it needs. Pure. Structured removal only — no Navora value is changed or recomputed,
// and the budget trimming in budget.js still runs afterwards.
//
// Measured on a real 1-day itinerary, a full context is ~4,000 prompt tokens, most of it
// recommendation reasons and alternatives that only suggest_adjustments uses; on CPU every
// prompt token costs time.
import { ENGINE_NOTE } from './context.js';

export const TASK_FOCUS_NOTE = 'Only the data needed for this request is included; if something you need is missing, say it is unavailable.';

const stopRefs = (ctx) => new Set((ctx.itinerary?.days ?? []).flatMap((day) => day.stops.map((stop) => stop.place)));
const warningRefs = (ctx) => new Set((ctx.itinerary?.warnings ?? []).filter((w) => w.place).map((w) => w.place));

const pick = (object, keys) => Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));

// Keeps place details only for `refs`, each reduced to `keys` (all keys when omitted). Places a
// warning names but that are no longer stops keep their name, so the warning stays explainable.
function keepPlaces(ctx, refs, keys) {
  const stops = stopRefs(ctx);
  const warned = warningRefs(ctx);
  const kept = {};
  for (const [ref, place] of Object.entries(ctx.places)) {
    if (refs.has(ref)) kept[ref] = keys ? pick(place, keys) : place;
    else if (warned.has(ref) && !stops.has(ref)) kept[ref] = { name: place.name };
  }
  ctx.places = kept;
}

function dropRecommendations(ctx) {
  ctx.recommendations = null;
  ctx.notes = ctx.notes.filter((note) => note !== ENGINE_NOTE);
}

// Days other than `keepDay` keep their times and totals; their stops keep names and times only.
function compactOtherDays(ctx, keepDay) {
  for (const day of ctx.itinerary?.days ?? []) {
    if (day.dayNumber === keepDay) continue;
    day.stops = day.stops.map(({ place, name, plannedStart, plannedEnd }) => ({ place, name, plannedStart, plannedEnd }));
  }
}

const SHAPES = {
  // Trip, days, stops, timing, costs and warnings. No place details or recommendation payload.
  summarize(ctx) {
    dropRecommendations(ctx);
    keepPlaces(ctx, new Set());
  },

  // Everything about how the days are built: stops, times, travel, warnings, and the place
  // facts that explain timing (opening hours, visit length).
  explain_itinerary(ctx) {
    dropRecommendations(ctx);
    keepPlaces(ctx, stopRefs(ctx), ['name', 'category', 'openingHours', 'typicalVisitMinutes']);
  },

  // Warnings with their days and stops, plus the facts behind them (hours, fees).
  explain_warnings(ctx) {
    dropRecommendations(ctx);
    keepPlaces(ctx, warningRefs(ctx), ['name', 'category', 'openingHours', 'entryFee', 'currency']);
  },

  // The focus place in full (details, recommendation result) and its day; the rest compact.
  explain_place(ctx, { placeRef }) {
    const focusDay = (ctx.itinerary?.days ?? []).find((day) => day.stops.some((stop) => stop.place === placeRef));
    compactOtherDays(ctx, focusDay?.dayNumber);
    if (ctx.itinerary) {
      ctx.itinerary.warnings = ctx.itinerary.warnings.filter((w) => w.place === placeRef || (w.place === undefined && w.dayNumber === undefined));
    }
    keepPlaces(ctx, new Set([placeRef]));
    if (ctx.recommendations) {
      ctx.recommendations = { results: ctx.recommendations.results.filter((r) => r.place === placeRef) };
    }
  },

  // Open questions: the itinerary and its places, why each stop was chosen (reasons, warnings),
  // and what limited the results. Not the alternatives or score breakdowns.
  question(ctx, { placeRef }) {
    if (!ctx.recommendations) return;
    const keep = new Set([...stopRefs(ctx), ...(placeRef ? [placeRef] : [])]);
    ctx.recommendations.results = ctx.recommendations.results
      .filter((r) => keep.has(r.place))
      .map(({ breakdown: _breakdown, ...rest }) => rest);
    keepPlaces(ctx, new Set([...keep, ...warningRefs(ctx)]));
  },

  // suggest_adjustments needs the alternatives (ADD_RECOMMENDED_PLACE): full context.
};

/**
 * @param context  from buildAssistantContext (not modified)
 * @param task     assistant task; unknown or absent → no task-specific reduction
 * @param placeRef focus place ("P3"), when the request names one
 * @returns a reduced copy. Community-written descriptions are always removed except for the focus place.
 */
export function shapeContextForTask(context, { task, placeRef } = {}) {
  const ctx = structuredClone(context);
  for (const [ref, place] of Object.entries(ctx.places)) if (ref !== placeRef) delete place.description;
  const shape = SHAPES[task];
  if (shape) {
    shape(ctx, { placeRef });
    ctx.notes = [...ctx.notes, TASK_FOCUS_NOTE];
  }
  return ctx;
}
