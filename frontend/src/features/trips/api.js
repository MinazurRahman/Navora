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

