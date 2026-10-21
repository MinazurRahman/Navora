import { useQuery } from '@tanstack/react-query';
import { request } from '../../api/client.js';

// Categories and interests (the backend calls interests "tags") are different lists:
// categories describe what a place is, interests what a visitor likes.
export async function getCategories({ signal } = {}) {
  return (await request('/categories', { signal })).data;
}

export async function getTags({ signal } = {}) {
  return (await request('/tags', { signal })).data;
}

// Both lists change rarely; keep them for the whole visit.
export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: Infinity });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: getTags, staleTime: Infinity });
}
