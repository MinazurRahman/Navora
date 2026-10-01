// Simulates one day minute by minute: travel, buffers, opening hours, visit length,
// the user's daily window and the trip back to the start. Pure (no I/O).
import { PLANNING_CONFIG } from '../../config/planning.js';
import { toMinutes, visitMinutesFor } from '../recommendations/schedule.js';

export const INFEASIBLE = Object.freeze({
  TOO_MANY_STOPS: 'TOO_MANY_STOPS',
  CLOSED: 'CLOSED', // no opening window that fits the arrival + visit on that weekday
  EXCEEDS_DAILY_WINDOW: 'EXCEEDS_DAILY_WINDOW',
  NO_TIME_TO_RETURN: 'NO_TIME_TO_RETURN',
});

function openWindows(place, dayOfWeek) {
  return place.openingHours
    .filter((h) => h.dayOfWeek === dayOfWeek)
    .map((h) => ({ open: toMinutes(h.opensAt), close: toMinutes(h.closesAt) }))
    .sort((a, b) => a.open - b.open);
}

// stops: places in visiting order. travel(from, to, mode) → { distanceMeters, durationSeconds }.
// Returns { feasible: true, stops, endTime, totals } or { feasible: false, reason, placeId }.
// Unknown opening hours never make a day infeasible and are never assumed open: the
// stop is just placed inside the user's window and flagged (openingHoursVerified false).
export function simulateDay({ stops, start, dayOfWeek, windowStart, windowEnd, travel, mode, config = PLANNING_CONFIG }) {
  if (stops.length > config.maxStopsPerDay) return { feasible: false, reason: INFEASIBLE.TOO_MANY_STOPS };

  let time = windowStart;
  let position = start;
  const totals = { distanceMeters: 0, travelSeconds: 0, visitMinutes: 0 };
  const scheduled = [];

  for (const [index, place] of stops.entries()) {
    const leg = travel(position, place.location, mode);
    const travelMinutes = Math.ceil(leg.durationSeconds / 60);
    const arrival = time + travelMinutes + (index > 0 ? config.bufferMinutesBetweenStops : 0);
    const visitMinutes = visitMinutesFor(place, config);
    const hoursKnown = place.openingHours.length > 0;

    let plannedStart = arrival;
    if (hoursKnown) {
      // Earliest window where we can start (waiting for opening if early) and finish in time.
      const window = openWindows(place, dayOfWeek).find((w) => Math.max(arrival, w.open) + visitMinutes <= w.close);
      if (!window) return { feasible: false, reason: INFEASIBLE.CLOSED, placeId: place.id };
      plannedStart = Math.max(arrival, window.open);
    }

    const plannedEnd = plannedStart + visitMinutes;
    if (plannedEnd > windowEnd) return { feasible: false, reason: INFEASIBLE.EXCEEDS_DAILY_WINDOW, placeId: place.id };

    scheduled.push({
      place,
      plannedStart,
      plannedEnd,
      visitMinutes,
      travelSecondsFromPrevious: leg.durationSeconds,
      travelDistanceFromPrevious: leg.distanceMeters,
      openingHoursVerified: hoursKnown,
    });
    totals.distanceMeters += leg.distanceMeters;
    totals.travelSeconds += leg.durationSeconds;
    totals.visitMinutes += visitMinutes;
    time = plannedEnd;
    position = place.location;
  }

  let endTime = time;
  if (config.returnToStart && stops.length > 0) {
    const back = travel(position, start, mode);
    endTime = time + Math.ceil(back.durationSeconds / 60);
    if (endTime > windowEnd) return { feasible: false, reason: INFEASIBLE.NO_TIME_TO_RETURN };
    totals.distanceMeters += back.distanceMeters;
    totals.travelSeconds += back.durationSeconds;
  }

  return { feasible: true, stops: scheduled, endTime, totals };
}
