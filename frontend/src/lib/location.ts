// Where the traveller is exploring from: their device location, a point they picked on the
// map, or central Dhaka as a fallback. Remembered between visits.

import { useSyncExternalStore } from 'react';
import type { Location } from '../api/types';

export interface ExploreLocation extends Location {
  label: string;
  source: 'device' | 'map' | 'default';
}

export const DHAKA_CENTER: ExploreLocation = {
  latitude: 23.8103,
  longitude: 90.4125,
  label: 'Central Dhaka',
  source: 'default',
};

const KEY = 'navora.location';
const listeners = new Set<() => void>();

function read(): ExploreLocation {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed && typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') return parsed;
  } catch {
    /* ignore */
  }
  return DHAKA_CENTER;
}

let current = read();

export function setExploreLocation(next: ExploreLocation) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useExploreLocation(): ExploreLocation {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** Asks the browser for the device position. Rejects with a readable message. */
export function requestDeviceLocation(): Promise<ExploreLocation> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser cannot share your location. Pick a point on the map instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(5)),
          longitude: Number(pos.coords.longitude.toFixed(5)),
          label: 'Your location',
          source: 'device',
        }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location access was blocked. Allow it in your browser, or pick a point on the map.'
              : 'Your location could not be found. Pick a point on the map instead.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  });
}
