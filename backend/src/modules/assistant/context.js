// Builds the AI Trip Assistant's context: a small, explicit, structured view of data the
// user may already see. Pure (no I/O): it only selects, renames and rounds values that
// Navora computed; it never scores, plans or fills in missing data.
//
// Allow-list only: every field is copied explicitly, so the start location, address, user
// data and internal IDs cannot leak in by accident. Places are referred to as "P1", "P2", …;
// `refs` maps them back to place IDs for the caller (never part of the context).
import { tripDays } from '../recommendations/schedule.js';

export const CONTEXT_SCHEMA_VERSION = 1;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const km = (meters) => (meters === null || meters === undefined ? null : Math.round(meters / 100) / 10);
const truncate = (text, max) => (typeof text === 'string' && text.length > max ? `${text.slice(0, max - 1)}…` : text ?? null);

function tripContext(trip, startDate, startDateAssumed) {
  return {
    title: trip.title,
    startDate: startDate ?? null,
    startDateAssumed: Boolean(startDateAssumed),
    durationDays: trip.durationDays,
    dailyStartTime: trip.dailyStartTime,
    dailyEndTime: trip.dailyEndTime,
    travelMode: trip.travelMode,
    partySize: trip.partySize,
    searchRadiusKm: trip.searchRadiusKm,
    budget: trip.budget ? { amount: trip.budget.amount, type: trip.budget.type, currency: trip.budget.currency ?? null } : null,
    interests: trip.interests ?? [],
    preferredCategories: trip.preferredCategories ?? [],
    requirements: {
      travelingWithPet: trip.travelingWithPet,
      parkingRequired: trip.parkingRequired,
      wheelchairAccessRequired: trip.wheelchairAccessRequired,
      minimumRating: trip.minimumRating ?? null,
    },
  };
}

// Opening hours for the trip's weekdays only ("unknown" when none are recorded).
function openingHoursContext(openingHours, weekdays) {
  if (!openingHours || openingHours.length === 0) return 'unknown';
  return openingHours
    .filter((h) => !weekdays || weekdays.has(h.dayOfWeek))
    .map((h) => ({ day: WEEKDAYS[h.dayOfWeek - 1], opens: h.opensAt, closes: h.closesAt }));
}

function placeContext(place, { weekdays, maxDescriptionChars }) {
  return {
    name: place.name,
    category: place.category?.name ?? null,
    description: truncate(place.description, maxDescriptionChars),
    tags: place.tags ?? [],
    entryFee: place.entryFee ?? null, // null = unknown, never "free"
    currency: place.currency ?? null,
    typicalVisitMinutes: place.typicalVisitMinutes ?? null,
    rating: { average: place.rating?.count > 0 ? place.rating.average : null, count: place.rating?.count ?? 0 },
    openingHours: openingHoursContext(place.openingHours, weekdays),
    facilities: {
      parking: place.facilities?.parking ?? 'UNKNOWN',
      petFriendly: place.facilities?.petFriendly ?? 'UNKNOWN',
      wheelchairAccessible: place.facilities?.wheelchairAccessible ?? 'UNKNOWN',
    },
  };
}

// Entry costs as Navora knows them. The itinerary's estimatedCost only adds KNOWN fees, so 0
// can mean "every fee is unknown"; the model gets counts and a plain statement instead, so a
// partial sum can never read as the trip's total. entryCost 0 = known to be free.
function costContext(itinerary) {
  const stops = itinerary.days.flatMap((day) => day.stops);
  const known = stops.filter((stop) => stop.estimatedCost !== null && stop.estimatedCost !== undefined);
  const unknownCount = stops.length - known.length;
  const knownTotal = known.reduce((total, stop) => total + stop.estimatedCost, 0);
  const currency = itinerary.totals.currency;

  let explanation;
  if (stops.length === 0) explanation = 'No stops, so no entry costs.';
  else if (unknownCount === 0) {
    explanation = knownTotal === 0
      ? 'Every entry fee is known and all are free: the total entry cost is 0.'
      : `Every entry fee is known: the total entry cost is ${currency} ${knownTotal}.`;
  } else if (known.length === 0) {
    explanation = `No entry fee is known for any of the ${stops.length} stops: the entry cost of the trip is unknown (not free).`;
  } else {
    explanation = `Known entry fees add up to ${currency} ${knownTotal}, but ${unknownCount} of ${stops.length} stops have unknown fees: the real total is higher or unknown.`;
  }

  return {
    currency,
    // null when no fee is known: a sum of nothing is not a cost of 0.
    knownCostTotal: known.length > 0 || stops.length === 0 ? knownTotal : null,
    stopsWithKnownCost: known.length,
    stopsWithUnknownCost: unknownCount,
    totalIsComplete: unknownCount === 0,
    explanation,
  };
}

function itineraryContext(itinerary, refOf, selectedIds) {
  const totals = itinerary.totals;
  return {
    version: itinerary.version,
    isCurrent: itinerary.isCurrent,
    userModified: itinerary.userModified,
    routing: {
      provider: itinerary.routing.provider,
      travelTimesEstimated: itinerary.routing.travelTimesEstimated,
      algorithm: itinerary.routing.algorithm,
    },
    totals: {
      distanceKm: km(totals.distanceMeters),
      travelMinutes: totals.travelMinutes,
      visitMinutes: totals.visitMinutes,
      plannedMinutes: totals.plannedMinutes,
    },
    cost: costContext(itinerary),
    days: itinerary.days.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date,
      startTime: day.startTime,
      endTime: day.endTime,
      distanceKm: km(day.totals.distanceMeters),
      travelMinutes: day.totals.travelMinutes,
      visitMinutes: day.totals.visitMinutes,
      stops: day.stops.map((stop) => ({
        place: refOf(stop.place.id),
        name: stop.place.name,
        category: stop.place.category?.name ?? null,
        plannedStart: stop.plannedStart,
        plannedEnd: stop.plannedEnd,
        visitMinutes: stop.visitMinutes,
        travelMinutesFromPrevious: stop.travelFromPrevious.minutes,
        travelKmFromPrevious: km(stop.travelFromPrevious.distanceMeters),
        entryCost: stop.estimatedCost, // party total; null = unknown (never free), 0 = known free
        openingHoursVerified: stop.openingHoursVerified,
        selectedByUser: selectedIds.has(stop.place.id),
      })),
    })),
    warnings: (itinerary.warnings ?? []).map((w) => ({
      code: w.code,
      message: w.message,
      ...(w.dayNumber !== undefined && { dayNumber: w.dayNumber }),
      ...(w.placeId !== undefined && { place: refOf(w.placeId) }),
    })),
  };
}

export const ENGINE_NOTE = "Scores and reasons come from Navora's rule-based recommendation engine using current place data.";

function notesFor(itinerary, recommendations) {
  const notes = ['null or UNKNOWN means the information is not known; it never means yes, free or open.'];
  if (recommendations) notes.push(ENGINE_NOTE);
  if (itinerary) {
    notes.push('The itinerary was planned when it was generated; place data may have changed since.');
    if (itinerary.routing.travelTimesEstimated) {
      notes.push('Travel times are distance-based estimates, not road routing data.');
    }
  }
  return notes;
}

/**
 * @param trip            trip DTO, or the snapshot stored with an itinerary (generatedFrom.trip)
 * @param startDate       resolved start date ("YYYY-MM-DD") or null
 * @param itinerary       itinerary DTO (already authorised) or null
 * @param placesById      Map id → place DTO the user may see (from placesService.getVisibleByIds)
 * @param recommendations result of recommendationsService.recommend(), or null when unavailable
 * @returns { context, refs: { "P1": placeId, … } }
 */
export function buildAssistantContext({ trip, startDate, startDateAssumed, itinerary = null, placesById = new Map(), recommendations = null, config }) {
  const refs = {};
  const refByPlaceId = new Map();
  const refOf = (placeId) => {
    if (!refByPlaceId.has(placeId)) {
      const ref = `P${refByPlaceId.size + 1}`;
      refByPlaceId.set(placeId, ref);
      refs[ref] = placeId;
    }
    return refByPlaceId.get(placeId);
  };

  // Itinerary places get the first refs, in visiting order.
  const itineraryPlaceIds = new Set();
  for (const day of itinerary?.days ?? []) {
    for (const stop of day.stops) {
      itineraryPlaceIds.add(stop.place.id);
      refOf(stop.place.id);
    }
  }

  // Engine output for itinerary places, plus the best others, in the engine's order.
  const ranked = (recommendations?.recommendations ?? []).map((entry, index) => ({ ...entry, rank: index + 1 }));
  const shown = [
    ...ranked.filter((entry) => itineraryPlaceIds.has(entry.place.id)),
    ...ranked.filter((entry) => !itineraryPlaceIds.has(entry.place.id)).slice(0, config.maxRecommendations),
  ];

  const weekdays = itinerary
    ? new Set(itinerary.days.flatMap((day) => tripDays(day.date, 1).map((d) => d.dayOfWeek)))
    : startDate
      ? new Set(tripDays(startDate, trip.durationDays).map((d) => d.dayOfWeek))
      : null;

  // Details only for places that are currently approved: the user's own visible data, or
  // the engine's (approved-only) results. Anything else stays name-only via the itinerary.
  const places = {};
  const describe = (place) => {
    if (place?.status !== 'APPROVED') return;
    places[refOf(place.id)] = placeContext(place, { weekdays, maxDescriptionChars: config.maxDescriptionChars });
  };
  for (const placeId of itineraryPlaceIds) describe(placesById.get(placeId));
  // e.g. STOP_REMOVED_AFTER_ROUTING names a place that is no longer a stop.
  for (const warning of itinerary?.warnings ?? []) if (warning.placeId) describe(placesById.get(warning.placeId));
  for (const entry of shown) if (!places[refByPlaceId.get(entry.place.id)]) describe(entry.place);

  const selectedIds = new Set(trip.selectedPlaceIds ?? []);
  const meta = recommendations?.meta;

  return {
    context: {
      schemaVersion: CONTEXT_SCHEMA_VERSION,
      trip: tripContext(trip, startDate, startDateAssumed),
      itinerary: itinerary ? itineraryContext(itinerary, refOf, selectedIds) : null,
      places,
      recommendations: recommendations
        ? {
            eligiblePlaces: meta.eligible,
            excludedBy: meta.excludedBy,
            suggestions: meta.suggestions,
            results: shown.map((entry) => ({
              place: refOf(entry.place.id),
              rank: entry.rank,
              score: entry.score,
              breakdown: entry.breakdown,
              reasons: entry.reasons,
              warnings: entry.warnings,
              inItinerary: itineraryPlaceIds.has(entry.place.id),
            })),
          }
        : null,
      notes: notesFor(itinerary, recommendations),
    },
    refs,
  };
}
