import { request } from '../../api/client.js';

// Trip fields follow the backend's TripFields schema exactly (title, startLocation,
// startDate or null for "today", durationDays 1-14, interests, preferredCategories,
// travelMode, travelingWithPet, parkingRequired, ...). The backend validates everything.

export async function createTrip(fields) {
  return (await request('/trips', { method: 'POST', body: fields })).data;
}

export function listTrips({ page, limit } = {}, { signal } = {}) {
  return request('/trips', { query: { page, limit }, signal });
}

export async function getTrip(id, { signal } = {}) {
  return (await request(`/trips/${encodeURIComponent(id)}`, { signal })).data;
}

export async function updateTrip(id, changes) {
  return (await request(`/trips/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes })).data;
}

export async function deleteTrip(id) {
  return (await request(`/trips/${encodeURIComponent(id)}`, { method: 'DELETE' })).data;
}

// Ranked places for a set of preferences (no sign-in needed). Resolves to { data, meta };
// an empty data list comes with meta.suggestions naming the limiting requirements.
export function getRecommendations(preferences, { signal } = {}) {
  return request('/recommendations', { method: 'POST', body: preferences, signal });
}
