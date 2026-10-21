import { AI_ERROR, AiProviderError } from '../errors.js';

// Ollama HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md). Only this file
// knows its URLs and request/response shapes. Local and free: no API key.

// Non-streaming responses are bounded by num_predict; anything far larger is not ours to parse.
// Enforced while reading, so an oversized body is never held in memory.
const MAX_RESPONSE_BYTES = 1_000_000;
// Health checks must answer quickly even when AI_TIMEOUT_MS is long.
const HEALTH_TIMEOUT_MS = 3_000;
// Provider error text is logged, never sent to clients; keep it short.
const MAX_DETAIL_CHARS = 200;

const ROLES = new Set(['user', 'assistant']);

const tooLarge = (status) => new AiProviderError(AI_ERROR.INVALID_RESPONSE, 'Response too large', { status });

// Reads the body up to MAX_RESPONSE_BYTES. Test doubles without a stream use text().
async function readBody(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > MAX_RESPONSE_BYTES) throw tooLarge(response.status);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw tooLarge(response.status);
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge(response.status);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function assertRequest({ system, messages }) {
  const valid =
    typeof system === 'string' &&
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every((m) => ROLES.has(m?.role) && typeof m.content === 'string');
  // Callers are our own services, so this is a programming error, not a client error.
  if (!valid) throw new Error('AI request needs a system prompt and [{ role: "user" | "assistant", content }] messages');
}

// contextWindowTokens → num_ctx: without it Ollama uses its small default window and silently
// truncates longer prompts. apiKey: for Ollama's cloud API (https://ollama.com); config
// validation guarantees it is only set with an https baseUrl. Never logged.
export function createOllamaProvider({ baseUrl, model, apiKey = null, timeoutMs, maxOutputTokens, contextWindowTokens, fetchImpl = fetch }) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) };

  async function request(path, { method = 'GET', body, signal, timeout = timeoutMs } = {}) {
    const combined = AbortSignal.any(signal ? [AbortSignal.timeout(timeout), signal] : [AbortSignal.timeout(timeout)]);
    const failure = (err) => {
      if (err instanceof AiProviderError) return err;
      if (signal?.aborted) return new AiProviderError(AI_ERROR.ABORTED, 'Request cancelled by the caller');
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        return new AiProviderError(AI_ERROR.TIMEOUT, `No complete response within ${timeout}ms`);
      }
      return new AiProviderError(AI_ERROR.UNAVAILABLE, `Network error: ${err?.cause?.code ?? err?.message ?? 'unknown'}`);
    };

    let response;
    let text;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: combined,
      });
      // The timeout also covers reading the body: a model can stall mid-response.
      text = await readBody(response);
    } catch (err) {
      throw failure(err);
    }

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // handled below; the raw text may contain model output, so it is never put in a message
    }

    if (response.ok) {
      if (payload === null || typeof payload !== 'object') {
        throw new AiProviderError(AI_ERROR.INVALID_RESPONSE, 'Unparseable response', { status: response.status });
      }
      return payload;
    }

    const detail = typeof payload?.error === 'string' ? payload.error.slice(0, MAX_DETAIL_CHARS) : `HTTP ${response.status}`;
    const { status } = response;
    if (status === 404) throw new AiProviderError(AI_ERROR.MODEL_NOT_FOUND, detail, { status });
    if (status >= 500) throw new AiProviderError(AI_ERROR.UNAVAILABLE, detail, { status });
    throw new AiProviderError(AI_ERROR.REJECTED, detail, { status });
  }

  return {
    name: 'ollama',
    model,

    async generate({ system, messages, outputSchema, temperature = 0.2, maxOutputTokens: requested, signal }) {
      assertRequest({ system, messages });
      const started = Date.now();
      const payload = await request('/api/chat', {
        method: 'POST',
        signal,
        body: {
          model,
          stream: false,
          messages: [{ role: 'system', content: system }, ...messages],
          // JSON schema → Ollama structured output.
          ...(outputSchema && { format: outputSchema }),
          options: {
            temperature,
            num_predict: Math.min(requested ?? maxOutputTokens, maxOutputTokens),
            ...(contextWindowTokens && { num_ctx: contextWindowTokens }),
          },
        },
      });

      const content = payload.message?.content;
      if (typeof content !== 'string') {
        throw new AiProviderError(AI_ERROR.INVALID_RESPONSE, 'Response has no message content');
      }
      const truncated = payload.done_reason === 'length';

      let output = content;
      if (outputSchema) {
        try {
          // Some models (e.g. gemma4 on Ollama's cloud) do not enforce `format` and wrap the
          // JSON in a Markdown fence. Unwrap it; the caller still validates the shape.
          output = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        } catch {
          throw new AiProviderError(
            AI_ERROR.INVALID_RESPONSE,
            truncated ? 'Structured output was cut off at the token limit' : 'Structured output is not valid JSON',
          );
        }
      }

      return {
        output,
        truncated,
        usage: { promptTokens: payload.prompt_eval_count ?? null, outputTokens: payload.eval_count ?? null },
        durationMs: Date.now() - started,
      };
    },

    // Resolves when Ollama is reachable and the configured model is installed.
    async checkHealth({ signal } = {}) {
      const payload = await request('/api/tags', { signal, timeout: Math.min(timeoutMs, HEALTH_TIMEOUT_MS) });
      const installed = Array.isArray(payload.models) ? payload.models.map((m) => m?.name) : [];
      // "llama3.2" and "llama3.2:latest" name the same model.
      const wanted = model.includes(':') ? [model] : [model, `${model}:latest`];
      if (!installed.some((name) => wanted.includes(name))) {
        throw new AiProviderError(AI_ERROR.MODEL_NOT_FOUND, `Model ${model} is not installed`);
      }
    },
  };
}
