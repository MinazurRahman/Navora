// Flow A ("select places first"): places the traveller collects while browsing.
// They become the trip's `selectedPlaceIds`, which the planner must include (max 30).
// Kept in localStorage so the selection survives reloads and is shared between tabs.

import { useSyncExternalStore } from 'react';
import type { Location } from '../api/types';

export interface DraftPlace {
  id: string;
  name: string;
  category: string;
  location: Location;
}

export const MAX_SELECTED_PLACES = 30;
const KEY = 'navora.tripDraft';
const listeners = new Set<() => void>();

function read(): DraftPlace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let current = read();

function write(next: DraftPlace[]) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: selection lasts this tab only */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      current = read();
      listeners.forEach((l) => l());
    }
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const tripDraft = {
  get: () => current,
  has: (id: string) => current.some((p) => p.id === id),
  add: (place: DraftPlace) => {
    if (current.some((p) => p.id === place.id) || current.length >= MAX_SELECTED_PLACES) return;
    write([...current, place]);
  },
  remove: (id: string) => write(current.filter((p) => p.id !== id)),
  clear: () => write([]),
};

export function useTripDraft(): DraftPlace[] {
  return useSyncExternalStore(subscribe, tripDraft.get, tripDraft.get);
}
