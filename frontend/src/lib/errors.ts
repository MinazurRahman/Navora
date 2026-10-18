// Turns an error from the API into words a traveller can act on.
// Branch on error codes (stable), never on the backend's message text (may change).

import { ApiError } from '../api/client';

const MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Could not reach the Navora server. Check that the backend is running and try again.',
  VALIDATION_ERROR: 'Some details are not valid. Check the highlighted fields.',
  INVALID_JSON: 'The request could not be read. Reload the page and try again.',
  UNAUTHORIZED: 'Sign in to continue.',
  INVALID_TOKEN: 'Your sign-in is no longer valid. Sign in again.',
  TOKEN_EXPIRED: 'Your sign-in has expired. Sign in again.',
  INVALID_CREDENTIALS: 'That email and password do not match an account.',
  INVALID_REFRESH_TOKEN: 'Your session has ended. Sign in again.',
  EMAIL_ALREADY_REGISTERED: 'An account with this email already exists. Sign in instead.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find that.',
  PLACE_NOT_FOUND: 'This place does not exist or is not visible to you.',
  REVIEW_NOT_FOUND: 'That review no longer exists.',
  TRIP_NOT_FOUND: 'This trip does not exist or is not yours.',
  ITINERARY_NOT_FOUND: 'This itinerary does not exist or is not yours.',
  REVIEW_ALREADY_EXISTS: 'You have already reviewed this place. Edit your review instead.',
  PLACE_NOT_REVIEWABLE: 'Only approved places can be reviewed.',
  INVALID_STATUS_TRANSITION: 'Only pending submissions can be approved or rejected.',
  ITINERARY_NOT_CURRENT: 'This is an older version and is read-only. Open the current version to edit.',
  INSUFFICIENT_MATCHING_PLACES: 'Not enough places match your requirements to fill every day.',
  SELECTED_PLACES_NOT_FEASIBLE: 'Some of the places you picked cannot fit into this trip.',
  PLACE_VIOLATES_REQUIREMENTS: 'A place in your edit does not meet this trip’s requirements.',
  ITINERARY_DAY_INFEASIBLE: 'An edited day does not fit into the available time.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  RATE_LIMIT_UNAVAILABLE: 'This action is briefly unavailable. Try again in a minute.',
  ROUTING_UNAVAILABLE: 'Route planning is unavailable right now. Try again later.',
  TIMEOUT: 'The server took too long to answer. Try again.',
  INTERNAL_ERROR: 'Something went wrong on the server.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED' && error.retryAfter) {
      return `Too many requests. Try again in ${error.retryAfter} seconds.`;
    }
    return MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Field-level messages from VALIDATION_ERROR details: { location, path, message }[]. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const item of error.details as { path?: string; message?: string }[]) {
    if (item?.path && item.message && !out[item.path]) out[item.path] = item.message;
  }
  return out;
}

export function isApiError(error: unknown, ...codes: string[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.includes(error.code));
}
