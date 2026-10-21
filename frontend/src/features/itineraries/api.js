import { request } from '../../api/client.js';

// The backend owns planning, feasibility and route ordering; these calls only ask it.

export async function generateItinerary(tripId) {
  return (await request('/itineraries/generate', { method: 'POST', body: { tripId } })).data;
}

// tripId and current ('true' = only each trip's current version) are optional filters.
export function listItineraries({ tripId, current, page, limit } = {}, { signal } = {}) {
  return request('/itineraries', { query: { tripId, current, page, limit }, signal });
}

export async function getItinerary(id, { signal } = {}) {
  return (await request(`/itineraries/${encodeURIComponent(id)}`, { signal })).data;
}

// days: [{ dayNumber, placeIds, optimizeOrder? }]; each listed day is replaced. Current version only.
export async function updateItinerary(id, days) {
  return (await request(`/itineraries/${encodeURIComponent(id)}`, { method: 'PATCH', body: { days } })).data;
}

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
