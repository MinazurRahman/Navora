// Notices when the API is slow to answer. On free hosting the backend sleeps after a quiet
// period and takes up to a minute to wake, so the app tells the visitor instead of looking frozen.

import { useSyncExternalStore } from 'react';

const SLOW_AFTER_MS = 6000;
let slowRequests = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Call when a request starts; call the returned function when it ends. */
export function trackRequest(): () => void {
  let flagged = false;
  const timer = setTimeout(() => {
    flagged = true;
    slowRequests += 1;
    emit();
  }, SLOW_AFTER_MS);
  return () => {
    clearTimeout(timer);
    if (flagged) {
      slowRequests -= 1;
      emit();
    }
  };
}

export function useServerSlow(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slowRequests > 0,
    () => false,
  );
}
