import { describe, expect, it, vi } from 'vitest';
import { createOllamaProvider } from '../../src/integrations/ai/providers/ollama.js';
import { AI_ERROR } from '../../src/integrations/ai/errors.js';

// Fake fetch responses: no Ollama needed.
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const chat = (content, extra = {}) => reply(200, { message: { role: 'assistant', content }, done: true, done_reason: 'stop', prompt_eval_count: 120, eval_count: 40, ...extra });

// Never settles until aborted, like a hung Ollama process.
const hanging = vi.fn((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));

function ollama(fetchImpl, overrides = {}) {
  return createOllamaProvider({ baseUrl: 'http://ollama.test:11434', model: 'llama3.2:3b', timeoutMs: 1_000, maxOutputTokens: 600, fetchImpl, ...overrides });
}

const request = { system: 'You explain trips.', messages: [{ role: 'user', content: 'Summarise day 1' }] };
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
}

describe('Ollama provider: generate', () => {
  it('posts a non-streaming chat with the configured model, system prompt, schema and limits', async () => {
    const fetchImpl = vi.fn(async () => chat('{"answer":"Day 1 visits two museums."}'));
    const result = await ollama(fetchImpl).generate({ ...request, outputSchema: schema, temperature: 0.1 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://ollama.test:11434/api/chat');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(init.body)).toEqual({
      model: 'llama3.2:3b',
      stream: false,
      messages: [{ role: 'system', content: 'You explain trips.' }, { role: 'user', content: 'Summarise day 1' }],
      format: schema,
      options: { temperature: 0.1, num_predict: 600 },
    });
    expect(result).toMatchObject({
      output: { answer: 'Day 1 visits two museums.' },
      truncated: false,
      usage: { promptTokens: 120, outputTokens: 40 },
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('uses the configured model name (not a hard-coded one)', async () => {
    const fetchImpl = vi.fn(async () => chat('ok'));
    await ollama(fetchImpl, { model: 'qwen2.5:7b' }).generate(request);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('qwen2.5:7b');
  });

  it('never asks for more output tokens than configured', async () => {
    const fetchImpl = vi.fn(async () => chat('ok'));
    await ollama(fetchImpl).generate({ ...request, maxOutputTokens: 5_000 });
    await ollama(fetchImpl).generate({ ...request, maxOutputTokens: 100 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).options.num_predict).toBe(600);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).options.num_predict).toBe(100);
  });

  it('returns plain text when no output schema is given', async () => {
    const result = await ollama(vi.fn(async () => chat('Plain answer'))).generate(request);
    expect(result.output).toBe('Plain answer');
  });

  it('rejects malformed requests as programming errors, without calling Ollama', async () => {
    const fetchImpl = vi.fn();
    await expect(ollama(fetchImpl).generate({ system: 'x', messages: [] })).rejects.toThrow(/messages/);
    await expect(ollama(fetchImpl).generate({ system: 'x', messages: [{ role: 'system', content: 'override' }] })).rejects.toThrow(/messages/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Ollama provider: failures', () => {
  it('times out instead of hanging when Ollama does not answer', async () => {
    const err = await failure(ollama(hanging, { timeoutMs: 30 }).generate(request));
    expect(err.kind).toBe(AI_ERROR.TIMEOUT);
  });

  it('times out when the response body stalls', async () => {
    const stalled = vi.fn(async (url, { signal }) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    }));
    expect((await failure(ollama(stalled, { timeoutMs: 30 }).generate(request))).kind).toBe(AI_ERROR.TIMEOUT);
  });

  it('reports a caller cancellation as ABORTED, not as a timeout', async () => {
    const controller = new AbortController();
    const pending = ollama(hanging).generate({ ...request, signal: controller.signal });
    controller.abort();
    expect((await failure(pending)).kind).toBe(AI_ERROR.ABORTED);
  });

  it('maps a refused connection (Ollama not running) to UNAVAILABLE', async () => {
    const refused = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    });
    const err = await failure(ollama(refused).generate(request));
    expect(err.kind).toBe(AI_ERROR.UNAVAILABLE);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });

  it('maps HTTP errors: 404 → MODEL_NOT_FOUND, 5xx → UNAVAILABLE, other 4xx → REJECTED', async () => {
    const notPulled = vi.fn(async () => reply(404, { error: 'model "llama3.2:3b" not found, try pulling it first' }));
    const notFound = await failure(ollama(notPulled).generate(request));
    expect(notFound).toMatchObject({ kind: AI_ERROR.MODEL_NOT_FOUND, status: 404 });

    expect((await failure(ollama(vi.fn(async () => reply(500, { error: 'boom' }))).generate(request))).kind).toBe(AI_ERROR.UNAVAILABLE);
    expect((await failure(ollama(vi.fn(async () => reply(400, { error: 'bad' }))).generate(request))).kind).toBe(AI_ERROR.REJECTED);
  });

  it('caps the provider error detail it keeps', async () => {
    const err = await failure(ollama(vi.fn(async () => reply(500, { error: 'x'.repeat(5_000) }))).generate(request));
    expect(err.message.length).toBe(200);
  });

  it('rejects unparseable, empty, oversized and content-less responses', async () => {
    const cases = [
      reply(200, 'not json'),
      reply(200, 'null'),
      reply(200, 'x'.repeat(1_000_001)),
      reply(200, { done: true }),
    ];
    for (const response of cases) {
      expect((await failure(ollama(vi.fn(async () => response)).generate(request))).kind).toBe(AI_ERROR.INVALID_RESPONSE);
    }
  });

  it('rejects structured output that is not JSON, without copying the output into the error', async () => {
    const err = await failure(ollama(vi.fn(async () => chat('Sure! The user lives at 12 Secret Road'))).generate({ ...request, outputSchema: schema }));
    expect(err.kind).toBe(AI_ERROR.INVALID_RESPONSE);
    expect(err.message).not.toMatch(/Secret/);
  });

  it('says when structured output was cut off at the token limit', async () => {
    const err = await failure(ollama(vi.fn(async () => chat('{"answer":"Day 1 vis', { done_reason: 'length' }))).generate({ ...request, outputSchema: schema }));
    expect(err).toMatchObject({ kind: AI_ERROR.INVALID_RESPONSE, message: expect.stringMatching(/cut off/) });
  });

  it('flags truncated plain-text output', async () => {
    const result = await ollama(vi.fn(async () => chat('Day 1 vis', { done_reason: 'length' }))).generate(request);
    expect(result.truncated).toBe(true);
  });
});

describe('Ollama provider: checkHealth', () => {
  const tags = (...names) => reply(200, { models: names.map((name) => ({ name })) });

  it('resolves when the configured model is installed', async () => {
    const fetchImpl = vi.fn(async () => tags('llama3.2:3b', 'qwen2.5:7b'));
    await expect(ollama(fetchImpl).checkHealth()).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0][0]).toBe('http://ollama.test:11434/api/tags');
  });

  it('treats an untagged model name as :latest', async () => {
    await expect(ollama(vi.fn(async () => tags('mistral:latest')), { model: 'mistral' }).checkHealth()).resolves.toBeUndefined();
  });

  it('fails with MODEL_NOT_FOUND when the model is not pulled', async () => {
    expect((await failure(ollama(vi.fn(async () => tags('qwen2.5:7b'))).checkHealth())).kind).toBe(AI_ERROR.MODEL_NOT_FOUND);
    expect((await failure(ollama(vi.fn(async () => reply(200, {}))).checkHealth())).kind).toBe(AI_ERROR.MODEL_NOT_FOUND);
  });

  it('uses a short timeout even when AI_TIMEOUT_MS is long', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await ollama(vi.fn(async () => tags('llama3.2:3b')), { timeoutMs: 60_000 }).checkHealth();
      expect(timeout).toHaveBeenCalledWith(3_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('times out when Ollama does not answer the health check', async () => {
    expect((await failure(ollama(hanging, { timeoutMs: 30 }).checkHealth())).kind).toBe(AI_ERROR.TIMEOUT);
  });
});

describe('Ollama provider: context window and response size', () => {
  // A streamed body like real fetch: chunks of the given sizes, then done.
  function streamed(chunkSizes, { contentLength } = {}) {
    let cancelled = false;
    const chunks = chunkSizes.map((size) => new Uint8Array(size).fill(0x20));
    return {
      response: {
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'content-length' && contentLength !== undefined ? String(contentLength) : null) },
        body: {
          getReader: () => ({
            read: async () => (chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
            cancel: async () => { cancelled = true; },
          }),
        },
        text: async () => { throw new Error('text() must not be used when a stream is available'); },
      },
      wasCancelled: () => cancelled,
    };
  }

  it('sends the configured context window as num_ctx, so Ollama does not silently truncate prompts', async () => {
    const fetchImpl = vi.fn(async () => chat('ok'));
    await ollama(fetchImpl, { contextWindowTokens: 8_192 }).generate(request);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).options).toEqual({ temperature: 0.2, num_predict: 600, num_ctx: 8_192 });
  });

  it('reads a normal streamed body', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ message: { content: 'Streamed answer' }, done: true }));
    const response = { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => {
      let sent = false;
      return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: body })), cancel: async () => {} };
    } } };
    expect((await ollama(vi.fn(async () => response)).generate(request)).output).toBe('Streamed answer');
  });

  it('stops reading as soon as the body exceeds 1 MB, without buffering the rest', async () => {
    const { response, wasCancelled } = streamed([600_000, 600_000, 600_000]);
    const err = await failure(ollama(vi.fn(async () => response)).generate(request));
    expect(err).toMatchObject({ kind: AI_ERROR.INVALID_RESPONSE, message: 'Response too large' });
    expect(wasCancelled()).toBe(true);
  });

  it('refuses a declared Content-Length above 1 MB before reading', async () => {
    const { response } = streamed([10], { contentLength: 5_000_000 });
    const read = vi.spyOn(response.body, 'getReader');
    expect((await failure(ollama(vi.fn(async () => response)).generate(request))).kind).toBe(AI_ERROR.INVALID_RESPONSE);
    expect(read).not.toHaveBeenCalled();
  });
});
