import { NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { getLogger } from '../../shared/logger.js';
import { toTripDto } from '../trips/trips.service.js';
import {
  applyHardConstraints,
  buildContext,
  buildSuggestions,
  failedHardConstraints,
  rankPlaces,
} from '../recommendations/scoring.js';
import { MAX_SEARCH_RADIUS_KM } from '../recommendations/recommendations.service.js';
import { toHHMM, todayIn } from '../recommendations/schedule.js';
import { ROUTE_ALGORITHM } from '../routing/optimizer.js';
import { createMatrixTravel } from '../routing/matrixTravel.js';
import { planTrip, scheduleDay } from './planner.js';
import { toItineraryDto } from './itineraries.mapper.js';

const notFound = () => new NotFoundError('Itinerary not found', 'ITINERARY_NOT_FOUND');

function collectWarnings({ plan, startDate, startDateAssumed, routing }) {
  const warnings = [];
  if (routing.estimated) {
    warnings.push({
      code: 'TRAVEL_TIMES_ESTIMATED',
      message:
        routing.fallbackReasons.length > 0
          ? `Road travel times were unavailable (${routing.fallbackReasons.join(', ')}); travel times are distance-based estimates.`
          : 'Travel times are distance-based estimates, not road routing data.',
    });
  }
  for (const { placeId, dayNumber } of routing.dropped) {
    warnings.push({ code: 'STOP_REMOVED_AFTER_ROUTING', message: 'Removed: actual travel times left no room for this visit.', placeId, dayNumber });
  }
  if (startDateAssumed) {
    warnings.push({ code: 'START_DATE_ASSUMED', message: `No start date was set; the plan starts on ${startDate}.` });
  }
  for (const day of plan.days) {
    for (const stop of day.schedule.stops) {
      if (!stop.openingHoursVerified) {
        warnings.push({ code: 'OPENING_HOURS_UNVERIFIED', message: 'Opening hours could not be verified.', placeId: stop.place.id, dayNumber: day.dayNumber });
      }
      if (stop.place.entryFee === null) {
        warnings.push({ code: 'ENTRY_FEE_UNKNOWN', message: 'Entry fee unknown; not included in the cost estimate.', placeId: stop.place.id, dayNumber: day.dayNumber });
      }
    }
  }
  return warnings;
}

function toRows({ plan, trip, ctx, startDate, startDateAssumed, warnings, recommendationConfig, partySize, routing }) {
  const days = plan.days.map((day) => ({
    route_polyline: day.routePolyline ?? null,
    day_number: day.dayNumber,
    date: day.date,
    start_time: toHHMM(ctx.windowStart),
    end_time: toHHMM(day.schedule.endTime),
    total_distance_m: day.schedule.totals.distanceMeters,
    total_travel_seconds: day.schedule.totals.travelSeconds,
    total_visit_minutes: day.schedule.totals.visitMinutes,
    stops: day.schedule.stops.map((stop, index) => ({
      place_id: stop.place.id,
      visit_order: index + 1,
      planned_start: toHHMM(stop.plannedStart),
      planned_end: toHHMM(stop.plannedEnd),
      visit_minutes: stop.visitMinutes,
      travel_seconds_from_previous: stop.travelSecondsFromPrevious,
      travel_distance_m_from_previous: stop.travelDistanceFromPrevious,
      estimated_cost: stop.place.entryFee === null ? null : stop.place.entryFee * partySize,
      opening_hours_verified: stop.openingHoursVerified,
    })),
  }));
  const sum = (key) => days.reduce((total, day) => total + day[key], 0);

  return {
    itinerary: {
      total_distance_m: sum('total_distance_m'),
      total_travel_seconds: sum('total_travel_seconds'),
      total_visit_minutes: sum('total_visit_minutes'),
      // From the final stops (routing may have removed some after allocation).
      estimated_cost: days.flatMap((day) => day.stops).reduce((total, stop) => total + (stop.estimated_cost ?? 0), 0),
      currency: trip.budget?.currency ?? 'BDT',
      routing_provider: routing.provider,
      travel_times_estimated: routing.estimated,
      algorithm: ROUTE_ALGORITHM,
      // Snapshot: the trip can change later; this records what the plan was built from.
      generation_params: JSON.stringify({ trip, startDate, startDateAssumed, weights: recommendationConfig.weights }),
      warnings: JSON.stringify(warnings),
    },
    days,
  };
}

export function createItinerariesService({
  itinerariesRepository,
  tripsService,
  placesService,
  transaction,
  travel, // fast estimate, used while allocating many candidates
  mapService, // real road data for the final days (provider-agnostic)
  recommendationConfig,
  planningConfig,
  today = () => todayIn(recommendationConfig.timezone),
}) {
  // Selected places must exist, be approved and meet the trip's hard requirements
  // (except the search radius: the user picked them explicitly).
  async function loadSelectedPlaces(trip, ctx, user) {
    const accepted = [];
    const rejected = [];
    for (const placeId of trip.selectedPlaceIds) {
      const place = await placesService.getById(placeId, user).catch(() => null);
      if (!place || place.status !== 'APPROVED') {
        rejected.push({ placeId, reason: 'NOT_AVAILABLE' });
        continue;
      }
      const failed = failedHardConstraints(place, ctx, recommendationConfig, { ignore: ['searchRadius'] });
      if (failed.length > 0) rejected.push({ placeId, name: place.name, reason: 'FAILS_REQUIREMENTS', requirements: failed });
      else accepted.push(place);
    }
    return { accepted, rejected };
  }

  // Re-checks a planned day with the map service's travel times (one small matrix request)
  // and re-orders it. If real times make the day infeasible, drops the lowest-ranked stop
  // the user did not select, until it fits.
  async function refineDay(day, { trip, ctx, rankOf, selectedIds }) {
    let stops = day.schedule.stops.map((s) => s.place);
    const dropped = [];

    while (stops.length > 0) {
      const points = [trip.startLocation, ...stops.map((p) => p.location)];
      const matrix = await mapService.getDistanceMatrix(points, trip.travelMode);
      const travel = createMatrixTravel(points, matrix, trip.travelMode, planningConfig);

      const schedule = scheduleDay({
        stops,
        dayOfWeek: day.dayOfWeek,
        start: trip.startLocation,
        mode: trip.travelMode,
        windowStart: ctx.windowStart,
        windowEnd: ctx.windowEnd,
        travel,
        config: planningConfig,
      });
      if (schedule.feasible) return { schedule, matrix, dropped };

      const droppable = stops.filter((p) => !selectedIds.has(p.id));
      if (droppable.length === 0) {
        throw new UnprocessableError('SELECTED_PLACES_NOT_FEASIBLE', 'Some selected places do not fit into the trip', {
          places: stops.map((p) => ({ placeId: p.id, name: p.name, reason: 'NOT_ENOUGH_TIME', dayNumber: day.dayNumber })),
        });
      }
      const worst = droppable.reduce((a, b) => (rankOf(a.id) >= rankOf(b.id) ? a : b));
      stops = stops.filter((p) => p !== worst);
      dropped.push({ placeId: worst.id, dayNumber: day.dayNumber });
    }
    return { schedule: { stops: [], totals: { distanceMeters: 0, travelSeconds: 0, visitMinutes: 0 } }, matrix: null, dropped };
  }

  // Road geometry for drawing the day on a map; skipped when only estimates are available.
  async function routePolyline(schedule, trip, matrix) {
    if (!matrix || matrix.estimated || schedule.stops.length === 0) return null;
    const points = [trip.startLocation, ...schedule.stops.map((s) => s.place.location)];
    if (planningConfig.returnToStart) points.push(trip.startLocation);
    const route = await mapService.getRoute(points, trip.travelMode);
    return route.estimated ? null : route.geometry;
  }

  return {
    async generate(tripId, user) {
      // 1. Requirements (validated when the trip was saved).
      const trip = toTripDto(await tripsService.findOwnedRow(tripId, user));
      const startDateAssumed = trip.startDate === null;
      const startDate = trip.startDate ?? today();
      const ctx = buildContext(
        {
          searchRadiusKm: trip.searchRadiusKm,
          interests: trip.interests,
          preferredCategories: trip.preferredCategories,
          budget: trip.budget,
          durationDays: trip.durationDays,
          dailyStartTime: trip.dailyStartTime,
          dailyEndTime: trip.dailyEndTime,
          travelingWithPet: trip.travelingWithPet,
          parkingRequired: trip.parkingRequired,
          wheelchairAccessRequired: trip.wheelchairAccessRequired,
          minimumRating: trip.minimumRating ?? undefined,
        },
        startDate,
      );

      // 2–4. Candidates, hard constraints, ranking (same rules as recommendations).
      const selected = await loadSelectedPlaces(trip, ctx, user);
      if (selected.rejected.length > 0) {
        throw new UnprocessableError('SELECTED_PLACES_NOT_FEASIBLE', 'Some selected places cannot be part of this trip', {
          places: selected.rejected,
        });
      }
      const { places, total } = await placesService.findCandidates({
        ...trip.startLocation,
        radiusMeters: ctx.radiusMeters,
        limit: recommendationConfig.maxCandidates,
      });
      const selectedIds = new Set(trip.selectedPlaceIds);
      const { eligible, excludedBy } = applyHardConstraints(places.filter((p) => !selectedIds.has(p.id)), ctx, recommendationConfig);
      const ranked = rankPlaces(eligible, ctx, recommendationConfig)
        .slice(0, planningConfig.maxCandidatesPerDay * trip.durationDays)
        .map((entry) => entry.place);

      // 5–10. Opening hours, visit duration, travel time, allocation, daily feasibility,
      // route order per day.
      const plan = planTrip({
        ranked,
        mandatory: selected.accepted,
        days: ctx.days.map((d, i) => ({ dayNumber: i + 1, date: d.date, dayOfWeek: d.dayOfWeek })),
        start: trip.startLocation,
        mode: trip.travelMode,
        windowStart: ctx.windowStart,
        windowEnd: ctx.windowEnd,
        budgetTotal: ctx.budget?.total ?? null,
        partySize: trip.partySize,
        travel,
        config: planningConfig,
      });

      if (plan.unscheduledMandatory.length > 0) {
        throw new UnprocessableError('SELECTED_PLACES_NOT_FEASIBLE', 'Some selected places do not fit into the trip', {
          places: plan.unscheduledMandatory,
        });
      }

      // 10b. Re-check and re-order each planned day with the map service's travel times.
      const rankIndex = new Map(ranked.map((place, i) => [place.id, i]));
      const rankOf = (id) => rankIndex.get(id) ?? -1;
      const routing = { provider: 'estimate', estimated: false, fallbackReasons: [], dropped: [] };
      for (const day of plan.days) {
        if (day.schedule.stops.length === 0) continue;
        const refined = await refineDay(day, { trip, ctx, rankOf, selectedIds });
        day.schedule = refined.schedule;
        routing.dropped.push(...refined.dropped);
        if (!refined.matrix) continue;
        if (refined.matrix.estimated) {
          routing.estimated = true;
          const reason = refined.matrix.fallbackReason;
          if (reason && !routing.fallbackReasons.includes(reason)) routing.fallbackReasons.push(reason);
        }
        // Provider of record: the real one if it served at least partially, else "estimate".
        if (refined.matrix.provider !== 'estimate') routing.provider = refined.matrix.provider;
        day.routePolyline = await routePolyline(day.schedule, trip, refined.matrix);
      }

      // Every day needs at least one stop; requirements are never relaxed to get there.
      const emptyDays = plan.days.filter((day) => day.schedule.stops.length === 0);
      if (emptyDays.length > 0) {
        const suggestions = buildSuggestions(excludedBy, ctx, MAX_SEARCH_RADIUS_KM);
        if (plan.budget.skippedForBudget > 0) {
          suggestions.unshift(`${plan.budget.skippedForBudget} place(s) did not fit within your budget`);
        }
        throw new UnprocessableError(
          'INSUFFICIENT_MATCHING_PLACES',
          'Not enough places satisfy the trip requirements to fill every day',
          {
            emptyDays: emptyDays.map(({ dayNumber, date }) => ({ dayNumber, date })),
            candidatesInRadius: total,
            eligiblePlaces: eligible.length + selected.accepted.length,
            scheduledPlaces: plan.days.reduce((n, day) => n + day.schedule.stops.length, 0),
            excludedBy,
            suggestions,
          },
        );
      }

      // 11. Save as a new current version.
      const warnings = collectWarnings({ plan, startDate, startDateAssumed, routing });
      const rows = toRows({ plan, trip, ctx, startDate, startDateAssumed, warnings, recommendationConfig, partySize: trip.partySize, routing });
      const id = await transaction((trx) => itinerariesRepository.createVersion({ tripId, ...rows }, trx));
      getLogger().info({ tripId, itineraryId: id, days: rows.days.length }, 'Itinerary generated');

      return toItineraryDto(await itinerariesRepository.findById(id));
    },

    async get(id, user) {
      const found = await itinerariesRepository.findById(id);
      if (!found || found.itinerary.user_id !== user.id) throw notFound();
      return toItineraryDto(found);
    },
  };
}
