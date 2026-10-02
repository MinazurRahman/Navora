// Allocates ranked places to trip days, keeping every day feasible. Pure (no I/O).
import { PLANNING_CONFIG } from '../../config/planning.js';
import { optimizeOrder } from '../routing/optimizer.js';
import { INFEASIBLE, simulateDay } from './feasibility.js';
import { toMinutes } from '../recommendations/schedule.js';

const latestClosing = (place, dayOfWeek) => {
  const closes = place.openingHours.filter((h) => h.dayOfWeek === dayOfWeek).map((h) => toMinutes(h.closesAt));
  return closes.length > 0 ? Math.max(...closes) : Infinity;
};

// Orders one day's stops (nearest neighbour + 2-opt) and simulates it. If opening hours
// make that order impossible, tries visiting the places that close earliest first.
export function scheduleDay({ stops, dayOfWeek, start, mode, windowStart, windowEnd, travel, config = PLANNING_CONFIG }) {
  const legSeconds = (a, b) => travel(a.location ?? a, b.location ?? b, mode).durationSeconds;
  const simulate = (ordered) => simulateDay({ stops: ordered, start, dayOfWeek, windowStart, windowEnd, travel, mode, config });

  const optimized = simulate(optimizeOrder(start, stops, legSeconds, { returnToStart: config.returnToStart }));
  if (optimized.feasible) return optimized;
  return simulate([...stops].sort((a, b) => latestClosing(a, dayOfWeek) - latestClosing(b, dayOfWeek)));
}

/**
 * @param ranked     eligible places, best first (already through the hard constraints)
 * @param mandatory  places the user explicitly selected: must all be scheduled
 * @param days       [{ dayNumber, date, dayOfWeek }]
 * @returns { days: [{ dayNumber, date, dayOfWeek, schedule }], unscheduledMandatory, budget }
 */
export function planTrip({
  ranked,
  mandatory = [],
  days,
  start,
  mode,
  windowStart,
  windowEnd,
  budgetTotal = null,
  partySize = 1,
  travel,
  config = PLANNING_CONFIG,
}) {
  // Memoised: allocation evaluates the same legs many times.
  const legCache = new Map();
  const cachedTravel = (from, to, travelMode) => {
    const key = `${from.latitude},${from.longitude}>${to.latitude},${to.longitude}`;
    if (!legCache.has(key)) legCache.set(key, travel(from, to, travelMode));
    return legCache.get(key);
  };
  const simulate = (dayOfWeek, stops) =>
    simulateDay({ stops, start, dayOfWeek, windowStart, windowEnd, travel: cachedTravel, mode, config });
  const scheduleFor = (dayOfWeek, stops) =>
    scheduleDay({ stops, dayOfWeek, start, mode, windowStart, windowEnd, travel: cachedTravel, config });

  const plans = days.map((day) => ({ ...day, stops: [], schedule: { stops: [], totals: { travelSeconds: 0 } } }));
  const used = new Set();
  const budget = { spentKnown: 0, unknownFeePlaceIds: [], skippedForBudget: 0 };

  const cost = (place) => (place.entryFee === null ? null : place.entryFee * partySize);
  const affordable = (place) => budgetTotal === null || cost(place) === null || budget.spentKnown + cost(place) <= budgetTotal;

  // Best insertion: the feasible day where the place adds the least travel time.
  function assign(place) {
    let best = null;
    for (const plan of plans) {
      if (plan.stops.length >= config.maxStopsPerDay) continue;
      const schedule = scheduleFor(plan.dayOfWeek, [...plan.stops, place]);
      if (!schedule.feasible) continue;
      const added =
        plan.stops.length === 0
          ? schedule.totals.travelSeconds * config.newDayCostFactor
          : schedule.totals.travelSeconds - plan.schedule.totals.travelSeconds;
      if (!best || added < best.added) best = { plan, schedule, added };
    }
    if (!best) return false;

    best.plan.stops = best.schedule.stops.map((s) => s.place);
    best.plan.schedule = best.schedule;
    used.add(place.id);
    if (cost(place) === null) budget.unknownFeePlaceIds.push(place.id);
    else budget.spentKnown += cost(place);
    return true;
  }

  // Why a selected place could not be scheduled, as precisely as the data allows.
  function whyNot(place) {
    if (!affordable(place)) return 'OVER_BUDGET';
    const alone = plans.map((plan) => simulate(plan.dayOfWeek, [place]));
    if (alone.every((s) => !s.feasible && s.reason === INFEASIBLE.CLOSED)) return 'CLOSED_ON_TRIP_DAYS';
    if (alone.every((s) => !s.feasible)) return 'NOT_ENOUGH_TIME';
    return 'NO_ROOM_IN_SCHEDULE';
  }

  const unscheduledMandatory = [];
  for (const place of mandatory) {
    if (!affordable(place) || !assign(place)) unscheduledMandatory.push({ placeId: place.id, name: place.name, reason: whyNot(place) });
  }

  for (const place of ranked) {
    if (plans.every((plan) => plan.stops.length >= config.maxStopsPerDay)) break;
    if (used.has(place.id)) continue;
    if (!affordable(place)) {
      budget.skippedForBudget += 1;
      continue;
    }
    assign(place);
  }

  return {
    days: plans.map(({ dayNumber, date, dayOfWeek, schedule }) => ({ dayNumber, date, dayOfWeek, schedule })),
    unscheduledMandatory,
    budget,
  };
}
