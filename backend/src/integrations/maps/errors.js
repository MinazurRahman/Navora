// What went wrong with a routing provider, independent of which provider it was.
export const MAP_ERROR = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED', // the provider's quota, not ours
  UNAVAILABLE: 'UNAVAILABLE', // network failure, 5xx, unparseable response
  INVALID_ROUTE: 'INVALID_ROUTE', // no route / point not near a road
  MISSING_DATA: 'MISSING_DATA', // response lacks the expected values
  UNSUPPORTED_MODE: 'UNSUPPORTED_MODE',
});

export class MapProviderError extends Error {
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'MapProviderError';
    this.kind = kind;
    this.status = status;
  }
}
