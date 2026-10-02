import { PLANNING_CONFIG } from '../../config/planning.js';
import { simulateDay } from '../itineraries/feasibility.js';
import { scheduleDay } from '../itineraries/planner.js';
import { toHHMM, toMinutes, tripDays, visitMinutesFor } from '../recommendations/schedule.js';
import { createMatrixTravel } from './matrixTravel.js';
import { nearestNeighbor, ROUTE_ALGORITHM, routeCost, twoOpt } from './optimizer.js';

const minutes = (seconds) => Math.round(seconds / 60);

export const ROUTE_METADATA = Object.freeze({
  algorithm: ROUTE_ALGORITHM,
  globallyOptimal: false,
  note: 'Heuristic ordering (nearest neighbour, improved by 2-opt): usually a short route, not guaranteed to be the shortest possible.',
});

/**
 * Orders each day's destinations separately and checks the day is feasible.
 *
 * @param input { start, travelMode, returnToStart, days: [{ date, dailyStartTime, dailyEndTime, places }] }
 *              places: place DTOs (location, openingHours, typicalVisitMinutes, category)
 */
export function createRoutingService({ mapService, config = PLANNING_CONFIG }) {
  async function optimizeDay(day, { start, travelMode, returnToStart }) {
    const dayConfig = { ...config, returnToStart };
    const points = [start, ...day.places.map((p) => p.location)];

    // 2. Travel distances/times (provider or flagged estimate).
    const matrix = await mapService.getDistanceMatrix(points, travelMode);
    const travel = createMatrixTravel(points, matrix, travelMode, config);
    const legSeconds = (a, b) => travel(a.location ?? a, b.location ?? b).durationSeconds;

    // 3–4. Initial route, then 2-opt.
    const initial = nearestNeighbor(start, day.places, legSeconds);
    let order = twoOpt(start, initial, legSeconds, returnToStart);

    // 5. Schedule feasibility. If the shortest order clashes with opening hours, accept a
    //    longer order that works. Places are never dropped: the caller chose them.
    const window = { windowStart: toMinutes(day.dailyStartTime), windowEnd: toMinutes(day.dailyEndTime) };
    let schedule = simulateDay({ stops: order, start, dayOfWeek: day.dayOfWeek, ...window, travel, mode: travelMode, config: dayConfig });
    let reorderedForOpeningHours = false;
    if (!schedule.feasible) {
      const alternative = scheduleDay({ stops: day.places, dayOfWeek: day.dayOfWeek, start, mode: travelMode, ...window, travel, config: dayConfig });
      if (alternative.feasible) {
        schedule = alternative;
        order = alternative.stops.map((s) => s.place);
        reorderedForOpeningHours = true;
      }
    }

    // 6. Ordered stops with the leg into each one (and back to the start).
    const planned = schedule.feasible ? new Map(schedule.stops.map((s) => [s.place.id, s])) : new Map();
    let previous = start;
    const stops = order.map((place, i) => {
      const leg = travel(previous, place.location);
      previous = place.location;
      const slot = planned.get(place.id);
      return {
        order: i + 1,
        place: { id: place.id, name: place.name, category: place.category, location: place.location },
        travelFromPrevious: { minutes: minutes(leg.durationSeconds), distanceMeters: leg.distanceMeters },
        visitMinutes: visitMinutesFor(place, config),
        plannedStart: slot ? toHHMM(slot.plannedStart) : null,
        plannedEnd: slot ? toHHMM(slot.plannedEnd) : null,
        openingHoursVerified: place.openingHours.length > 0,
      };
    });
    const back = returnToStart ? travel(previous, start) : null;
    const legs = [...stops.map((s) => s.travelFromPrevious), ...(back ? [{ minutes: minutes(back.durationSeconds), distanceMeters: back.distanceMeters }] : [])];

    const route = !matrix.estimated
      ? await mapService.getRoute([start, ...order.map((p) => p.location), ...(returnToStart ? [start] : [])], travelMode)
      : null;

    return {
      dayNumber: day.dayNumber,
      date: day.date,
      feasible: schedule.feasible,
      ...(!schedule.feasible && { infeasibility: { reason: schedule.reason, placeId: schedule.placeId ?? null } }),
      stops,
      returnToStart: back ? { minutes: minutes(back.durationSeconds), distanceMeters: back.distanceMeters } : null,
      totals: {
        distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
        travelMinutes: minutes(routeCost(start, order, legSeconds, returnToStart)),
        visitMinutes: stops.reduce((sum, s) => sum + s.visitMinutes, 0),
        endTime: schedule.feasible ? toHHMM(schedule.endTime) : null,
      },
      routePolyline: route && !route.estimated ? route.geometry : null,
      metadata: {
        initialTravelMinutes: minutes(routeCost(start, initial, legSeconds, returnToStart)),
        optimizedTravelMinutes: minutes(routeCost(start, order, legSeconds, returnToStart)),
        reorderedForOpeningHours,
        provider: matrix.provider,
        travelTimesEstimated: matrix.estimated,
        ...(matrix.fallbackReason && { fallbackReason: matrix.fallbackReason }),
      },
    };
  }

  return {
    async optimize({ start, travelMode, returnToStart, startDate, days }) {
      const calendar = tripDays(startDate, days.length);
      const results = [];
      // 7. Each day separately (sequential: keeps provider request rate low).
      for (const [i, day] of days.entries()) {
        const date = day.date ?? calendar[i].date;
        const [{ dayOfWeek }] = tripDays(date, 1);
        results.push(await optimizeDay({ ...day, dayNumber: i + 1, date, dayOfWeek }, { start, travelMode, returnToStart }));
      }

      return {
        days: results,
        totals: {
          distanceMeters: results.reduce((sum, d) => sum + d.totals.distanceMeters, 0),
          travelMinutes: results.reduce((sum, d) => sum + d.totals.travelMinutes, 0),
        },
        metadata: {
          ...ROUTE_METADATA,
          travelMode,
          returnToStart,
          allDaysFeasible: results.every((d) => d.feasible),
          travelTimesEstimated: results.some((d) => d.metadata.travelTimesEstimated),
        },
      };
    },
  };
}
