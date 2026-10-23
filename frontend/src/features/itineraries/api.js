import { request } from '../../api/client.js';

// The backend owns planning, feasibility and route ordering; these calls only ask it.

export async function generateItinerary(tripId) {
  return (await request('/itineraries/generate', { method: 'POST', body: { tripId } })).data;
}

export async function getItinerary(id, { signal } = {}) {
  return (await request(`/itineraries/${encodeURIComponent(id)}`, { signal })).data;
}

// days: [{ dayNumber, placeIds, optimizeOrder? }]; each listed day is replaced. Current version only.
export async function updateItinerary(id, days) {
  return (await request(`/itineraries/${encodeURIComponent(id)}`, { method: 'PATCH', body: { days } })).data;
}

// Places to suggest for one day of a trip, under the trip's own requirements (the
// backend never relaxes them). Resolves to [{ place, score, reasons, warnings, ... }].
export async function recommendForDay(trip, date, { signal } = {}) {
  const body = {
    location: trip.startLocation,
    searchRadiusKm: trip.searchRadiusKm,
    interests: trip.interests,
    preferredCategories: trip.preferredCategories,
    startDate: date,
    durationDays: 1,
    dailyStartTime: trip.dailyStartTime,
    dailyEndTime: trip.dailyEndTime,
    travelingWithPet: trip.travelingWithPet,
    parkingRequired: trip.parkingRequired,
    wheelchairAccessRequired: trip.wheelchairAccessRequired,
    limit: 20,
  };
  if (trip.minimumRating !== null) body.minimumRating = trip.minimumRating;
  return (await request('/recommendations', { method: 'POST', body, signal })).data;
}

// Summaries of every version of a trip's itinerary, newest first.
export function listItineraries(tripId, { signal } = {}) {
  return request('/itineraries', { query: { tripId, limit: 50 }, signal });
}

// Deleting the current version makes the newest remaining one current.
export async function deleteItinerary(id) {
  return (await request(`/itineraries/${encodeURIComponent(id)}`, { method: 'DELETE' })).data;
}

export async function regenerateItinerary(id) {
  return (await request(`/itineraries/${encodeURIComponent(id)}/regenerate`, { method: 'POST' })).data;
}

// --- AI Trip Assistant ---
// Read-only explanations of one of the user's itineraries. The answer is AI-generated plain
// text: render it as text (never HTML/Markdown) with the returned disclaimer.

export async function getAssistantStatus({ signal } = {}) {
  return (await request('/ai/trip-assistant/status', { signal })).data;
}

// target: { tripId } or { itineraryId }. task: summarize | explain_itinerary | explain_place
// (needs placeId) | explain_warnings | suggest_adjustments | question (needs question).
export async function askAssistant({ tripId, itineraryId, task, question, placeId, dayNumber }) {
  const body = { task };
  if (itineraryId) body.itineraryId = itineraryId;
  else body.tripId = tripId;
  if (question !== undefined) body.question = question;
  if (placeId !== undefined) body.placeId = placeId;
  if (dayNumber !== undefined) body.dayNumber = dayNumber;
  return (await request('/ai/trip-assistant', { method: 'POST', body })).data;
}
