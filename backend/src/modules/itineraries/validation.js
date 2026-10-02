// Independent final check of a generated itinerary, run before it is saved. The planner is
// designed to satisfy all of this; this catches it if it ever does not (defence in depth).
// Pure: returns a list of violations ([] = valid).
import { PLANNING_CONFIG } from '../../config/planning.js';
import { failedHardConstraints } from '../recommendations/scoring.js';
import { toMinutes } from '../recommendations/schedule.js';

const insideOpeningHours = (place, dayOfWeek, start, end) =>
  place.openingHours.length === 0 || // unknown: allowed, flagged elsewhere, never assumed open
  place.openingHours.some((h) => h.dayOfWeek === dayOfWeek && toMinutes(h.opensAt) <= start && end <= toMinutes(h.closesAt));

/**
 * @param days [{ dayNumber, dayOfWeek, departure, schedule: { stops, endTime } }]
 * @param ctx  scoring context (hard requirements, windowStart/windowEnd)
 * @param selectedIds places the user chose (exempt from the search radius only)
 */
export function validateItinerary(days, ctx, recommendationConfig, { selectedIds = new Set(), config = PLANNING_CONFIG } = {}) {
  const violations = [];
  const seen = new Set();
  const add = (dayNumber, rule, placeId) => violations.push({ dayNumber, rule, ...(placeId && { placeId }) });

  for (const day of days) {
    const { stops } = day.schedule;
    if (stops.length === 0) continue;

    if (day.departure < ctx.windowStart) add(day.dayNumber, 'STARTS_BEFORE_WINDOW');
    if (day.schedule.endTime > ctx.windowEnd) add(day.dayNumber, 'ENDS_AFTER_WINDOW');
    if (stops.length > config.maxStopsPerDay) add(day.dayNumber, 'TOO_MANY_STOPS');

    stops.forEach((stop, i) => {
      const { place } = stop;
      if (seen.has(place.id)) add(day.dayNumber, 'DUPLICATE_PLACE', place.id);
      seen.add(place.id);

      if (stop.plannedEnd - stop.plannedStart !== stop.visitMinutes) add(day.dayNumber, 'VISIT_LENGTH_MISMATCH', place.id);
      if (i > 0 && stop.plannedStart < stops[i - 1].plannedEnd) add(day.dayNumber, 'OVERLAPPING_VISITS', place.id);
      if (stop.plannedStart < ctx.windowStart || stop.plannedEnd > ctx.windowEnd) add(day.dayNumber, 'OUTSIDE_DAILY_WINDOW', place.id);
      if (!insideOpeningHours(place, day.dayOfWeek, stop.plannedStart, stop.plannedEnd)) add(day.dayNumber, 'OUTSIDE_OPENING_HOURS', place.id);

      const ignore = selectedIds.has(place.id) ? ['searchRadius', 'openDuringTrip'] : ['openDuringTrip'];
      for (const requirement of failedHardConstraints(place, ctx, recommendationConfig, { ignore })) {
        add(day.dayNumber, `VIOLATES_${requirement}`, place.id);
      }
    });
  }
  return violations;
}
