import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client.js';

// The signed-in user's saved places (private; cleared from the cache on sign-out).

export function listSavedPlaces({ page, limit } = {}, { signal } = {}) {
  return request('/saved-places', { query: { page, limit }, signal });
}

export async function getSavedStatus(placeId, { signal } = {}) {
  return (await request(`/saved-places/${encodeURIComponent(placeId)}`, { signal })).data;
}

export async function savePlace(placeId) {
  return (await request('/saved-places', { method: 'POST', body: { placeId } })).data;
}

export async function unsavePlace(placeId) {
  return (await request(`/saved-places/${encodeURIComponent(placeId)}`, { method: 'DELETE' })).data;
}

export function useSavedPlaces(page) {
  return useQuery({
    queryKey: ['saved', 'list', page],
    queryFn: ({ signal }) => listSavedPlaces({ page }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useSavedStatus(placeId, { enabled }) {
  return useQuery({
    queryKey: ['saved', 'status', placeId],
    queryFn: ({ signal }) => getSavedStatus(placeId, { signal }),
    enabled,
  });
}

// Save or remove; both are idempotent on the server, so a repeated click cannot corrupt state.
export function useToggleSaved(placeId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (save) => (save ? savePlace(placeId) : unsavePlace(placeId)),
    onSuccess: (status) => {
      queryClient.setQueryData(['saved', 'status', placeId], status);
      queryClient.invalidateQueries({ queryKey: ['saved', 'list'] });
    },
  });
}
