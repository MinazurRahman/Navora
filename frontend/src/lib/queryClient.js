import { QueryClient } from '@tanstack/react-query';

// Reads retry once, and only for failures that may be temporary (no connection, 5xx).
// 4xx are never retried, nor 503 (the backend is saying "not now"; the user retries), nor 429.
function shouldRetry(failureCount, error) {
  if (failureCount >= 1) return false;
  return error?.status === 0 || error?.status === 500 || error?.status === 502 || error?.status === 504;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
      // Writes are never retried automatically: a retry could submit twice.
      mutations: { retry: false },
    },
  });
}
