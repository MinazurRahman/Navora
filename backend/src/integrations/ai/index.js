import { CACHE_TTL } from '../../config/cache.js';
import { createAiService } from './aiService.js';
import { createDisabledProvider } from './providers/disabled.js';
import { createOllamaProvider } from './providers/ollama.js';

export { aiUnavailableError, createAiService } from './aiService.js';
export { createDisabledProvider } from './providers/disabled.js';
export { AI_ERROR, AiProviderError } from './errors.js';

// Picks the provider from configuration. Adding a provider = one adapter file + one case.
export function createAiServiceFromConfig(config, { cache }) {
  const { ai } = config;
  let provider = createDisabledProvider();
  if (ai.enabled && ai.provider === 'ollama') {
    provider = createOllamaProvider({
      baseUrl: ai.ollama.baseUrl,
      model: ai.ollama.model,
      timeoutMs: ai.timeoutMs,
      maxOutputTokens: ai.maxOutputTokens,
    });
  }
  return createAiService({ provider, cache, statusTtlSeconds: CACHE_TTL.aiStatus });
}
