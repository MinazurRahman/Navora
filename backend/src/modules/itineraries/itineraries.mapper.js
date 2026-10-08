const hhmm = (time) => time.slice(0, 5); // pg returns "HH:MM:SS"
const toMinutes = (seconds) => Math.round(seconds / 60);
const clockMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
// Departure to return: travel + visits + buffers + any waiting for opening time. A day the
// user emptied is stored as a 1-minute span (the table requires start < end): 0 planned.
const plannedMinutes = (day, dayStops) => (dayStops.length === 0 ? 0 : clockMinutes(day.end_time) - clockMinutes(day.start_time));

export function toItineraryDto({ itinerary, days, stops }) {
  const stopsOf = (day) => stops.filter((stop) => stop.day_id === day.id);
  return {
    id: itinerary.id,
    tripId: itinerary.trip_id,
    version: itinerary.version,
    isCurrent: itinerary.is_current,
    userModified: itinerary.is_user_modified,
    routing: {
      provider: itinerary.routing_provider,
      algorithm: itinerary.algorithm,
      travelTimesEstimated: itinerary.travel_times_estimated,
    },
    totals: {
      distanceMeters: itinerary.total_distance_m,
      travelMinutes: toMinutes(itinerary.total_travel_seconds),
      visitMinutes: itinerary.total_visit_minutes,
      plannedMinutes: days.reduce((sum, day) => sum + plannedMinutes(day, stopsOf(day)), 0),
      // Known entry fees × party size; places with unknown fees are listed in warnings.
      estimatedCost: itinerary.estimated_cost === null ? null : Number(itinerary.estimated_cost),
      currency: itinerary.currency,
    },
    days: days.map((day) => ({
      dayNumber: day.day_number,
      date: day.date,
      startTime: hhmm(day.start_time),
      endTime: hhmm(day.end_time),
      totals: {
        distanceMeters: day.total_distance_m,
        travelMinutes: toMinutes(day.total_travel_seconds),
        visitMinutes: day.total_visit_minutes,
        plannedMinutes: plannedMinutes(day, stopsOf(day)),
      },
      // Encoded polyline (precision 5) of the road route; null when only estimates exist.
      routePolyline: day.route_polyline,
      stops: stopsOf(day)
        .map((stop) => ({
          order: stop.visit_order,
          place: {
            id: stop.place_id,
            name: stop.place_name,
            category: { slug: stop.category_slug, name: stop.category_name },
            location: { latitude: stop.latitude, longitude: stop.longitude },
          },
          plannedStart: hhmm(stop.planned_start),
          plannedEnd: hhmm(stop.planned_end),
          visitMinutes: stop.visit_minutes,
          travelFromPrevious: {
            minutes: toMinutes(stop.travel_seconds_from_previous),
            distanceMeters: stop.travel_distance_m_from_previous,
          },
          estimatedCost: stop.estimated_cost === null ? null : Number(stop.estimated_cost),
          openingHoursVerified: stop.opening_hours_verified,
        })),
    })),
    warnings: itinerary.warnings,
    generatedFrom: itinerary.generation_params,
    createdAt: itinerary.created_at,
    updatedAt: itinerary.updated_at,
  };
}
