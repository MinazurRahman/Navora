// Every backend endpoint the app uses, one small function each.
// Paths, parameters and shapes follow backend/docs/openapi.yaml.

import { request } from './client';
import type {
  Category,
  Deleted,
  Itinerary,
  ItineraryEditDay,
  ItinerarySummary,
  ModerationEvent,
  Page,
  PaginationMeta,
  Place,
  PlaceInput,
  PlaceStatus,
  Recommendation,
  RecommendationMeta,
  RecommendationRequest,
  Review,
  Session,
  Tag,
  Trip,
  TripInput,
  User,
} from './types';

const page = async <T>(promise: Promise<{ data: T[]; meta: PaginationMeta }>): Promise<Page<T>> => {
  const { data, meta } = await promise;
  return { data, meta };
};

// ---------- auth ----------
export const authApi = {
  register: (body: { name: string; email: string; password: string }) =>
    request<Session>('/api/v1/auth/register', { method: 'POST', body, auth: 'none' }).then((r) => r.data),
  login: (body: { email: string; password: string }) =>
    request<Session>('/api/v1/auth/login', { method: 'POST', body, auth: 'none' }).then((r) => r.data),
  logout: (refreshToken: string) =>
    request<{ loggedOut: true }>('/api/v1/auth/logout', { method: 'POST', body: { refreshToken }, auth: 'none' }).then(
      (r) => r.data,
    ),
  me: () => request<{ user: User }>('/api/v1/auth/me').then((r) => r.data.user),
};

// ---------- catalogue ----------
export const catalogueApi = {
  categories: () => request<Category[]>('/api/v1/categories').then((r) => r.data),
  tags: () => request<Tag[]>('/api/v1/tags').then((r) => r.data),
};

// ---------- places ----------
export interface PlaceFilters {
  category?: string[];
  maxEntryFee?: number;
  minRating?: number;
  page?: number;
  limit?: number;
}

export const placesApi = {
  list: (filters: PlaceFilters) =>
    page(request<Place[], PaginationMeta>('/api/v1/places', { query: { ...filters } })),
  nearby: (filters: PlaceFilters & { latitude: number; longitude: number; radiusKm?: number }) =>
    page(request<Place[], PaginationMeta>('/api/v1/places/nearby', { query: { ...filters } })),
  search: (filters: PlaceFilters & { q: string }) =>
    page(request<Place[], PaginationMeta>('/api/v1/places/search', { query: { ...filters } })),
  mine: (filters: { status?: PlaceStatus; page?: number; limit?: number }) =>
    page(request<Place[], PaginationMeta>('/api/v1/places/mine', { query: { ...filters } })),
  get: (id: string) => request<Place>(`/api/v1/places/${id}`).then((r) => r.data),
  create: (body: PlaceInput) => request<Place>('/api/v1/places', { method: 'POST', body }).then((r) => r.data),
  update: (id: string, body: PlaceInput) =>
    request<Place>(`/api/v1/places/${id}`, { method: 'PATCH', body }).then((r) => r.data),
  archive: (id: string) => request<Place>(`/api/v1/places/${id}`, { method: 'DELETE' }).then((r) => r.data),
  history: (id: string) =>
    request<ModerationEvent[]>(`/api/v1/places/${id}/moderation-events`).then((r) => r.data),
};

// ---------- moderation ----------
export const moderationApi = {
  queue: (filters: { status?: PlaceStatus; page?: number; limit?: number }) =>
    page(request<Place[], PaginationMeta>('/api/v1/places/moderation', { query: { ...filters } })),
  approve: (id: string, note?: string) =>
    request<Place>(`/api/v1/places/${id}/approve`, { method: 'POST', body: note ? { note } : {} }).then((r) => r.data),
  reject: (id: string, reason: string) =>
    request<Place>(`/api/v1/places/${id}/reject`, { method: 'POST', body: { reason } }).then((r) => r.data),
};

// ---------- reviews ----------
export const reviewsApi = {
  list: (placeId: string, params: { page?: number; limit?: number }) =>
    page(request<Review[], PaginationMeta>(`/api/v1/places/${placeId}/reviews`, { query: { ...params } })),
  create: (placeId: string, body: { rating: number; comment?: string | null }) =>
    request<Review>(`/api/v1/places/${placeId}/reviews`, { method: 'POST', body }).then((r) => r.data),
  update: (id: string, body: { rating?: number; comment?: string | null }) =>
    request<Review>(`/api/v1/reviews/${id}`, { method: 'PATCH', body }).then((r) => r.data),
  remove: (id: string) => request<Deleted>(`/api/v1/reviews/${id}`, { method: 'DELETE' }).then((r) => r.data),
};

// ---------- recommendations ----------
export const recommendationsApi = {
  recommend: (body: RecommendationRequest) =>
    request<Recommendation[], RecommendationMeta>('/api/v1/recommendations', { method: 'POST', body }),
};

// ---------- trips ----------
export const tripsApi = {
  list: (params: { page?: number; limit?: number }) =>
    page(request<Trip[], PaginationMeta>('/api/v1/trips', { query: { ...params } })),
  get: (id: string) => request<Trip>(`/api/v1/trips/${id}`).then((r) => r.data),
  create: (body: TripInput) => request<Trip>('/api/v1/trips', { method: 'POST', body }).then((r) => r.data),
  update: (id: string, body: TripInput) =>
    request<Trip>(`/api/v1/trips/${id}`, { method: 'PATCH', body }).then((r) => r.data),
  remove: (id: string) => request<Deleted>(`/api/v1/trips/${id}`, { method: 'DELETE' }).then((r) => r.data),
};

// ---------- itineraries ----------
export const itinerariesApi = {
  generate: (tripId: string) =>
    request<Itinerary>('/api/v1/itineraries/generate', { method: 'POST', body: { tripId } }).then((r) => r.data),
  list: (params: { tripId?: string; current?: boolean; page?: number; limit?: number }) =>
    page(
      request<ItinerarySummary[], PaginationMeta>('/api/v1/itineraries', {
        query: { ...params, current: params.current === undefined ? undefined : String(params.current) },
      }),
    ),
  get: (id: string) => request<Itinerary>(`/api/v1/itineraries/${id}`).then((r) => r.data),
  edit: (id: string, days: ItineraryEditDay[]) =>
    request<Itinerary>(`/api/v1/itineraries/${id}`, { method: 'PATCH', body: { days } }).then((r) => r.data),
  regenerate: (id: string) =>
    request<Itinerary>(`/api/v1/itineraries/${id}/regenerate`, { method: 'POST' }).then((r) => r.data),
  remove: (id: string) => request<Deleted>(`/api/v1/itineraries/${id}`, { method: 'DELETE' }).then((r) => r.data),
};
