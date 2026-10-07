// What went wrong with an AI provider, independent of which provider it was. Internal:
// clients only ever see the coarse reason from aiService.js.
export const AI_ERROR = Object.freeze({
  DISABLED: 'DISABLED', // AI_ENABLED=false
  TIMEOUT: 'TIMEOUT', // no complete response within AI_TIMEOUT_MS
  ABORTED: 'ABORTED', // the caller cancelled (e.g. the client disconnected)
  UNAVAILABLE: 'UNAVAILABLE', // network failure, connection refused, 5xx
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND', // configured model is not installed on the provider
  REJECTED: 'REJECTED', // provider refused the request (4xx other than 404)
  INVALID_RESPONSE: 'INVALID_RESPONSE', // unparseable, oversized, truncated or missing output
});

export class AiProviderError extends Error {
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.kind = kind;
    this.status = status;
  }
}
