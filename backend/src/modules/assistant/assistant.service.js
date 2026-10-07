import { ValidationError } from '../../shared/errors/AppError.js';
import { getLogger } from '../../shared/logger.js';
import { aiUnavailableError } from '../../integrations/ai/index.js';
import { askAssistantSchema } from './assistant.schemas.js';
import { buildPrompt, OUTPUT_SCHEMA } from './prompt.js';
import { parseAssistantOutput } from './output.js';

export const DISCLAIMER =
  "AI-generated explanation of Navora's plan. The itinerary, times, prices and requirements shown by Navora are authoritative; suggestions are not checked until you apply them.";

const invalid = (path, message) => new ValidationError('Invalid request data', [{ location: 'body', path, message }]);

/**
 * AI Trip Assistant. Provider-independent: talks to `ai` (integrations/ai aiService), never to
 * a specific provider. Read-only: it writes nothing and changes no trip, itinerary or place.
 *
 * Failures: 400 invalid request, 401/404 from the owning services, and 503 AI_UNAVAILABLE
 * (reason DISABLED | TIMEOUT | UNAVAILABLE) for anything the AI could not deliver, including
 * empty or malformed replies. Never a 200 for an unsuccessful AI request.
 */
export function createAssistantService({ contextLoader, ai, timeoutMs, config }) {
  // Backstop: the provider enforces timeoutMs itself; this stops waiting even if a provider
  // ignores cancellation, and cancels it.
  async function generateWithin(request, callerSignal) {
    const controller = new AbortController();
    const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(aiUnavailableError('TIMEOUT'));
      }, timeoutMs + config.timeoutGraceMs);
    });
    try {
      return await Promise.race([ai.generate({ ...request, signal }), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * @param input   { task, question?, placeId?, dayNumber? } (validated here as well)
     * @param options { signal } cancels the AI call, e.g. when the client disconnects
     * @returns { task, itinerary, answer, truncated, places, suggestions, source, disclaimer }
     */
    async askAboutItinerary(itineraryId, input, user, { signal } = {}) {
      // 1. Validate and normalise.
      const parsed = askAssistantSchema.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request data',
          parsed.error.issues.map((issue) => ({ location: 'body', path: issue.path.join('.'), message: issue.message })),
        );
      }
      const request = parsed.data;
      // No point loading data for an assistant that is switched off.
      if (!ai.enabled) throw aiUnavailableError('DISABLED');

      // 2–3. Authorised data (404 for other users' itineraries) → bounded context.
      const { context, refs } = await contextLoader.forItinerary(itineraryId, user);

      const placeRef = request.placeId && Object.keys(refs).find((ref) => refs[ref] === request.placeId);
      if (request.placeId && !placeRef) throw invalid('placeId', 'This place is not part of the itinerary or its recommendations');
      if (request.dayNumber && !context.itinerary.days.some((d) => d.dayNumber === request.dayNumber)) {
        throw invalid('dayNumber', `This itinerary has no day ${request.dayNumber}`);
      }

      // 4–7. Prompt → provider (timeout and failures become 503 AI_UNAVAILABLE).
      const prompt = buildPrompt(context, { ...request, placeRef });
      const result = await generateWithin(
        { ...prompt, outputSchema: OUTPUT_SCHEMA, temperature: config.temperature },
        signal,
      );

      // 8. Untrusted reply → bounded, grounded response.
      const output = parseAssistantOutput(result.output, {
        context,
        refs,
        allowSuggestions: request.task === 'suggest_adjustments' && context.itinerary.isCurrent,
        config,
      });
      const log = { task: request.task, itineraryId, provider: ai.providerName, model: ai.model };
      if (!output) {
        getLogger().warn(log, 'AI reply unusable (empty or malformed)');
        throw aiUnavailableError('UNAVAILABLE');
      }
      getLogger().info({ ...log, truncated: output.truncated, dropped: output.dropped }, 'Assistant answered');

      return {
        task: request.task,
        itinerary: { id: itineraryId, version: context.itinerary.version, isCurrent: context.itinerary.isCurrent },
        answer: output.answer,
        truncated: output.truncated || Boolean(result.truncated),
        places: output.places,
        suggestions: output.suggestions,
        source: { generatedBy: 'ai', provider: ai.providerName, model: ai.model },
        disclaimer: DISCLAIMER,
      };
    },
  };
}
