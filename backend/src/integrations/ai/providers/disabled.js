import { AI_ERROR, AiProviderError } from '../errors.js';

// Used when AI_ENABLED=false: no network calls, every request is refused.
export function createDisabledProvider() {
  const disabled = () => new AiProviderError(AI_ERROR.DISABLED, 'AI is disabled by configuration');
  return {
    name: 'disabled',
    model: null,
    async generate() {
      throw disabled();
    },
    async checkHealth() {
      throw disabled();
    },
  };
}
