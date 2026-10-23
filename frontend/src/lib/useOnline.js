import { useSyncExternalStore } from 'react';

function subscribe(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

// Whether the browser believes it is online. Data requests pause while offline (TanStack
// Query's default) and resume on reconnect, so the UI says so instead of loading forever.
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
