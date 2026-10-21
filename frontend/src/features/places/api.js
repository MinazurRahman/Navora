import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { request } from '../../api/client.js';
import { exploreRequest } from './exploreParams.js';

// Lists resolve to { data, meta } (meta = pagination); single items to the item.
// Filters: category (array of slugs), maxEntryFee, minRating, page, limit.

export function listPlaces(filters, { signal } = {}) {
  return request('/places', { query: filters, signal });
}

// Approved places, newest first. Keeps the previous page on screen while the next loads.
export function usePlaces(filters) {
  return useQuery({
    queryKey: ['places', 'list', filters],
    queryFn: ({ signal }) => listPlaces(filters, { signal }),
    placeholderData: keepPreviousData,
  });
}

// Results for Explore's URL state: list, text search or nearby, decided by exploreRequest.
// Changing the state cancels the previous request; the old results stay visible meanwhile.
export function useExploreResults(state) {
  const { mode, path, query } = exploreRequest(state);
  const result = useQuery({
    queryKey: ['places', mode, query],
    queryFn: ({ signal }) => request(path, { query, signal }),
    placeholderData: keepPreviousData,
  });
  return { mode, ...result };
}

export function searchPlaces({ q, ...filters }, { signal } = {}) {
  return request('/places/search', { query: { q, ...filters }, signal });
}

// latitude, longitude, radiusKm (default 5, max 50) plus the filters above.
export function nearbyPlaces(params, { signal } = {}) {
  return request('/places/nearby', { query: params, signal });
}

export async function getPlace(id, { signal } = {}) {
  return (await request(`/places/${encodeURIComponent(id)}`, { signal })).data;
}

export function usePlace(id) {
  return useQuery({ queryKey: ['places', 'detail', id], queryFn: ({ signal }) => getPlace(id, { signal }) });
}

// --- Community submissions ---

export function listMyPlaces({ status, page, limit } = {}, { signal } = {}) {
  return request('/places/mine', { query: { status, page, limit }, signal });
}

export async function createPlace(input) {
  return (await request('/places', { method: 'POST', body: input })).data;
}

// Own PENDING places stay pending; own REJECTED places return to PENDING.
export async function updatePlace(id, changes) {
  return (await request(`/places/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes })).data;
}

export async function archivePlace(id) {
  return (await request(`/places/${encodeURIComponent(id)}`, { method: 'DELETE' })).data;
}

export async function getModerationEvents(id, { signal } = {}) {
  return (await request(`/places/${encodeURIComponent(id)}/moderation-events`, { signal })).data;
}

// --- Moderation (moderators and admins) ---

export function getModerationQueue({ status, page, limit } = {}, { signal } = {}) {
  return request('/places/moderation', { query: { status, page, limit }, signal });
}

export async function approvePlace(id, { note } = {}) {
  const body = note ? { note } : {};
  return (await request(`/places/${encodeURIComponent(id)}/approve`, { method: 'POST', body })).data;
}

export async function rejectPlace(id, { reason }) {
  return (await request(`/places/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } })).data;
}

// --- Reviews ---

export function listReviews(placeId, { page, limit } = {}, { signal } = {}) {
  return request(`/places/${encodeURIComponent(placeId)}/reviews`, { query: { page, limit }, signal });
}

// The caller's own review of the place, or null.
export async function getMyReview(placeId, { signal } = {}) {
  return (await request(`/places/${encodeURIComponent(placeId)}/reviews/mine`, { signal })).data;
}

export async function createReview(placeId, { rating, comment }) {
  const body = { rating, comment: comment || null };
  return (await request(`/places/${encodeURIComponent(placeId)}/reviews`, { method: 'POST', body })).data;
}

export async function updateReview(id, changes) {
  return (await request(`/reviews/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes })).data;
}

export async function deleteReview(id) {
  return (await request(`/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })).data;
}
