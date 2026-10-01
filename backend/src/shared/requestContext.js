import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request context (request ID, request-scoped logger) available anywhere in the
// call chain without passing it through every function. Lives only for one request.
export const requestContext = new AsyncLocalStorage();

export function getRequestContext() {
  return requestContext.getStore();
}
