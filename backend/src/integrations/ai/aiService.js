import { getLogger } from '../../shared/logger.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';
import { AI_ERROR, AiProviderError } from './errors.js';

/**
 * The application's only view of AI. Provider contract (see providers/):
 *   name, model
 *   generate({ system, messages: [{ role: 'user' | 'assistant', content }], outputSchema?,
 *              temperature?, maxOutputTokens?, signal? })
 *     → { output (parsed JSON when outputSchema is given, else text), truncated,
 *         usage: { promptTokens, outputTokens }, durationMs }
 *   checkHealth({ signal? }) → resolves when usable
 * Providers throw AiProviderError(kind) on failure.
 *
 * This wrapper turns every failure into 503 AI_UNAVAILABLE with a coarse reason. Provider
 * messages, status codes and model details are logged only. Prompts and outputs are never
 * logged: they contain users' trip details.
 */

// What a client may learn about a failure.
const PUBLIC_REASON = Object.freeze({
  [AI_ERROR.DISABLED]: 'DISABLED',
  [AI_ERROR.TIMEOUT]: 'TIMEOUT',
});
const publicReason = (kind) => PUBLIC_REASON[kind] ?? 'UNAVAILABLE';

// The one client-facing AI failure: 503 AI_UNAVAILABLE with reason DISABLED | TIMEOUT | UNAVAILABLE.
export function aiUnavailableError(reason = 'UNAVAILABLE') {
  return new ServiceUnavailableError('The AI assistant is temporarily unavailable', { reason }, 'AI_UNAVAILABLE');
}

// cache (optional): shared cache-aside (integrations/redis/cache.js). When given, health checks
// are cached for statusTtlSeconds, so a polled status endpoint does not hit the provider each time.
export function createAiService({ provider, cache, statusTtlSeconds }) {
  const enabled = provider.name !== 'disabled';

  function logFailure(err, operation) {
    const context = { provider: provider.name, model: provider.model, operation };
    if (!(err instanceof AiProviderError)) {
      getLogger().error({ ...context, err }, 'AI provider failed unexpectedly');
    } else if (err.kind === AI_ERROR.DISABLED || err.kind === AI_ERROR.ABORTED) {
      getLogger().info({ ...context, kind: err.kind }, 'AI request not completed');
    } else {
      getLogger().warn({ ...context, kind: err.kind, status: err.status, detail: err.message }, 'AI provider failed');
    }
  }

  const kindOf = (err) => (err instanceof AiProviderError ? err.kind : AI_ERROR.UNAVAILABLE);

  // Never throws. Coarse result only, so it is safe to cache and share between users.
  async function checkHealth(signal) {
    try {
      await provider.checkHealth({ signal });
      return { enabled: true, available: true };
    } catch (err) {
      logFailure(err, 'health');
      return { enabled: true, available: false, reason: publicReason(kindOf(err)) };
    }
  }

  return {
    enabled,
    providerName: provider.name,
    model: provider.model,

    async generate(request) {
      try {
        const result = await provider.generate(request);
        getLogger().info(
          { provider: provider.name, model: provider.model, durationMs: result.durationMs, usage: result.usage, truncated: result.truncated },
          'AI response generated',
        );
        return result;
      } catch (err) {
        logFailure(err, 'generate');
        throw aiUnavailableError(publicReason(kindOf(err)));
      }
    },

    // Never throws: { enabled, available, reason? } with a coarse reason only. "available" =
    // provider reachable and model installed (checkHealth); the model is deliberately not run,
    // so it says nothing about whether an answer finishes within the timeout. Unavailable
    // results are cached too: a down provider must not be probed on every poll. If Redis is
    // unreachable, getOrSet falls back to a direct check (bounded by the provider's health timeout).
    async status({ signal } = {}) {
      if (!enabled) return { enabled: false, available: false, reason: 'DISABLED' };
      if (!cache) return checkHealth(signal);
      return cache.getOrSet(`ai:status:${provider.name}:${provider.model}`, statusTtlSeconds, () => checkHealth(signal));
    },
  };
}
