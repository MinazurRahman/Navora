// Turns an ApiError into text for people. Codes with a generic meaning get our own wording;
// otherwise the backend's message is already written for humans.
export function errorMessage(error) {
  switch (error?.code) {
    case 'NETWORK_ERROR':
      return 'Could not reach NAVORA. Check your connection and try again.';
    case 'RATE_LIMITED':
      return error.retryAfter
        ? `Too many requests. Try again in ${formatWait(error.retryAfter)}.`
        : 'Too many requests. Wait a moment and try again.';
    case 'RATE_LIMIT_UNAVAILABLE':
    case 'TIMEOUT':
      return 'This service is temporarily unavailable. Try again shortly.';
    case 'INTERNAL_ERROR':
    case 'INVALID_RESPONSE':
      return 'Something went wrong on our side. Try again.';
    case 'TOKEN_EXPIRED':
    case 'INVALID_TOKEN':
    case 'INVALID_REFRESH_TOKEN':
      return 'Your session has ended. Sign in again.';
    default:
      return error?.message || 'Something went wrong. Try again.';
  }
}

function formatWait(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// VALIDATION_ERROR details ({ location, path, message }) keyed by body path, for showing
// each message beside its field: { 'location.latitude': 'Too big: ...' }.
export function fieldErrors(error) {
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return {};
  const fields = {};
  for (const { location, path, message } of error.details) {
    if (location === 'body' && path && !fields[path]) fields[path] = message;
  }
  return fields;
}
