import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiService } from '../../src/integrations/ai/aiService.js';
import { createAiServiceFromConfig } from '../../src/integrations/ai/index.js';
import { createDisabledProvider } from '../../src/integrations/ai/providers/disabled.js';
import { AI_ERROR, AiProviderError } from '../../src/integrations/ai/errors.js';
import { ServiceUnavailableError } from '../../src/shared/errors/AppError.js';
import { logger } from '../../src/shared/logger.js';
import { createCache } from '../../src/integrations/redis/cache.js';
import { CACHE_TTL } from '../../src/config/cache.js';
import { buildTestConfig, createInMemoryRedis } from '../helpers/testApp.js';

// Fake provider: no Ollama needed.
function fakeProvider({ generate, checkHealth } = {}) {
  return {
    name: 'fake',
    model: 'fake-model:1b',
    generate: vi.fn(generate ?? (async () => ({ output: { answer: 'ok' }, truncated: false, usage: { promptTokens: 10, outputTokens: 2 }, durationMs: 5 }))),
    checkHealth: vi.fn(checkHealth ?? (async () => {})),
  };
}

const request = { system: 'You explain trips.', messages: [{ role: 'user', content: 'Trip to 12 Secret Road' }] };

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
}

afterEach(() => vi.restoreAllMocks());

describe('AI service: generate', () => {
  it('passes the request to the provider and returns its result', async () => {
    const provider = fakeProvider();
    const ai = createAiService({ provider });
    expect(await ai.generate(request)).toMatchObject({ output: { answer: 'ok' } });
    expect(provider.generate).toHaveBeenCalledWith(request);
    expect(ai).toMatchObject({ enabled: true, providerName: 'fake', model: 'fake-model:1b' });
  });

  it.each([
    [AI_ERROR.TIMEOUT, 'TIMEOUT'],
    [AI_ERROR.UNAVAILABLE, 'UNAVAILABLE'],
    [AI_ERROR.MODEL_NOT_FOUND, 'UNAVAILABLE'],
    [AI_ERROR.REJECTED, 'UNAVAILABLE'],
    [AI_ERROR.INVALID_RESPONSE, 'UNAVAILABLE'],
    [AI_ERROR.ABORTED, 'UNAVAILABLE'],
  ])('turns provider error %s into 503 AI_UNAVAILABLE (reason %s)', async (kind, reason) => {
    const provider = fakeProvider({
      generate: async () => {
        throw new AiProviderError(kind, 'model "llama3.2:3b" not found at http://10.0.0.5:11434', { status: 404 });
      },
    });
    const err = await failure(createAiService({ provider }).generate(request));

    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err).toMatchObject({ status: 503, code: 'AI_UNAVAILABLE', details: { reason } });
    // Nothing internal reaches the client-facing error.
    expect(JSON.stringify({ message: err.message, details: err.details })).not.toMatch(/llama|10\.0\.0\.5|404/);
  });

  it('turns an unexpected provider bug into 503 too, and logs it as an error', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const provider = fakeProvider({
      generate: async () => {
        throw new TypeError('cannot read properties of undefined');
      },
    });
    const err = await failure(createAiService({ provider }).generate(request));
    expect(err).toMatchObject({ code: 'AI_UNAVAILABLE', details: { reason: 'UNAVAILABLE' } });
    expect(error).toHaveBeenCalledOnce();
  });

  it('logs failures and successes without the prompt or the output', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});

    await createAiService({ provider: fakeProvider() }).generate(request);
    await failure(
      createAiService({
        provider: fakeProvider({
          generate: async () => {
            throw new AiProviderError(AI_ERROR.TIMEOUT, 'No complete response within 30000ms');
          },
        }),
      }).generate(request),
    );

    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).toMatch(/TIMEOUT/);
    expect(logged).not.toMatch(/Secret Road|You explain trips|"answer"/);
  });
});

describe('AI service: status', () => {
  it('reports available when the provider is healthy', async () => {
    expect(await createAiService({ provider: fakeProvider() }).status()).toEqual({ enabled: true, available: true });
  });

  it('reports unavailable with a coarse reason, never throwing', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const down = fakeProvider({
      checkHealth: async () => {
        throw new AiProviderError(AI_ERROR.MODEL_NOT_FOUND, 'Model llama3.2:3b is not installed');
      },
    });
    expect(await createAiService({ provider: down }).status()).toEqual({ enabled: true, available: false, reason: 'UNAVAILABLE' });

    const slow = fakeProvider({
      checkHealth: async () => {
        throw new AiProviderError(AI_ERROR.TIMEOUT, 'No complete response within 3000ms');
      },
    });
    expect(await createAiService({ provider: slow }).status()).toEqual({ enabled: true, available: false, reason: 'TIMEOUT' });
  });
});

describe('AI service: cached status', () => {
  const cached = (provider, redis = createInMemoryRedis()) =>
    createAiService({ provider, cache: createCache(redis), statusTtlSeconds: CACHE_TTL.aiStatus });

  it('checks the provider once per TTL however often status is polled', async () => {
    const provider = fakeProvider();
    const ai = cached(provider);
    for (let i = 0; i < 5; i += 1) expect(await ai.status()).toEqual({ enabled: true, available: true });
    expect(provider.checkHealth).toHaveBeenCalledOnce();
  });

  it('caches an unavailable result too, so a down provider is not probed on every poll', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const provider = fakeProvider({
      checkHealth: async () => {
        throw new AiProviderError(AI_ERROR.UNAVAILABLE, 'Network error: ECONNREFUSED 10.0.0.5:11434');
      },
    });
    const ai = cached(provider);
    await ai.status();
    expect(await ai.status()).toEqual({ enabled: true, available: false, reason: 'UNAVAILABLE' });
    expect(provider.checkHealth).toHaveBeenCalledOnce();
  });

  it('stores only the coarse result, with the short status TTL, shared across instances', async () => {
    const redis = createInMemoryRedis();
    const set = vi.spyOn(redis, 'set');
    const first = fakeProvider();
    const second = fakeProvider();
    await cached(first, redis).status();
    await cached(second, redis).status(); // another instance, same Redis

    expect(second.checkHealth).not.toHaveBeenCalled();
    const [[key, value, options]] = set.mock.calls;
    expect(key).toMatch(/ai:status:fake:fake-model:1b$/);
    expect(value).toEqual({ enabled: true, available: true });
    expect(options).toEqual({ ex: CACHE_TTL.aiStatus });
    expect(CACHE_TTL.aiStatus).toBeLessThanOrEqual(60);
  });

  it('still answers when Redis is down, by checking the provider directly', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const broken = { get: async () => { throw new Error('fetch failed'); }, set: async () => { throw new Error('fetch failed'); }, incr: async () => 1, del: async () => 0 };
    const provider = fakeProvider();
    expect(await cached(provider, broken).status()).toEqual({ enabled: true, available: true });
    expect(provider.checkHealth).toHaveBeenCalledOnce();
  });

  it('never touches the cache when AI is disabled', async () => {
    const redis = createInMemoryRedis();
    const get = vi.spyOn(redis, 'get');
    expect(await cached(createDisabledProvider(), redis).status()).toEqual({ enabled: false, available: false, reason: 'DISABLED' });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('AI disabled', () => {
  it('refuses generation with reason DISABLED and makes no calls', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    const ai = createAiService({ provider: createDisabledProvider() });
    expect(ai).toMatchObject({ enabled: false, providerName: 'disabled', model: null });
    expect(await failure(ai.generate(request))).toMatchObject({ status: 503, code: 'AI_UNAVAILABLE', details: { reason: 'DISABLED' } });
    expect(await ai.status()).toEqual({ enabled: false, available: false, reason: 'DISABLED' });
  });
});

describe('createAiServiceFromConfig', () => {
  it('is disabled by default', () => {
    expect(createAiServiceFromConfig(buildTestConfig(), { cache: createCache(createInMemoryRedis()) })).toMatchObject({ enabled: false, providerName: 'disabled' });
  });

  it('uses Ollama with the configured model when enabled', () => {
    const ai = createAiServiceFromConfig(buildTestConfig({ AI_ENABLED: 'true', OLLAMA_MODEL: 'qwen2.5:7b' }), { cache: createCache(createInMemoryRedis()) });
    expect(ai).toMatchObject({ enabled: true, providerName: 'ollama', model: 'qwen2.5:7b' });
  });
});
