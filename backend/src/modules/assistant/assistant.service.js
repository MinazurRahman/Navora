import { UnprocessableError, ValidationError } from '../../shared/errors/AppError.js';
import { getLogger } from '../../shared/logger.js';
import { aiUnavailableError } from '../../integrations/ai/index.js';
import { askAssistantSchema } from './assistant.schemas.js';
import { buildPrompt, OUTPUT_SCHEMA } from './prompt.js';
import { parseAssistantOutput } from './output.js';
import { fitContext } from './budget.js';

export const DISCLAIMER =
  "AI-generated explanation of Navora's plan. The itinerary, times, prices and requirements shown by Navora are authoritative; suggestions are not checked until you apply them.";

const invalid = (path, message) => new ValidationError('Invalid request data', [{ location: 'body', path, message }]);

/**
 * AI Trip Assistant. Provider-independent: talks to `ai` (integrations/ai aiService), never to
 * a specific provider. Read-only: it writes nothing and changes no trip, itinerary or place.
 *
 * Failures: 400 invalid request, 401/404 from the owning services, 422 when the context cannot
 * fit the model's window, and 503 AI_UNAVAILABLE (reason DISABLED | TIMEOUT | UNAVAILABLE) for
 * anything the AI could not deliver, including empty or malformed replies and a busy instance.
 * Never a 200 for an unsuccessful AI request.
 *
 * promptBudgetChars: from the model's context window (budget.js promptBudgetChars).
 * maxConcurrent: AI calls this instance runs at once. Instance-local on purpose: it protects
 * the AI host's capacity; the cross-instance limit is the assistantGlobal rate limit.
 */
export function createAssistantService({ contextLoader, ai, timeoutMs, promptBudgetChars, maxConcurrent, config }) {
  let inFlight = 0;

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

  // loadContext() → { context, refs, itineraryId }, already authorised by the owning services.
  async function answer(loadContext, input, { signal } = {}) {
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
    if (inFlight >= maxConcurrent) {
      getLogger().warn({ task: request.task, maxConcurrent }, 'Assistant busy; request refused');
      throw aiUnavailableError('UNAVAILABLE');
    }
    inFlight += 1;
    try {
      return await answerWithinCapacity(loadContext, request, signal);
    } finally {
      inFlight -= 1;
    }
  }

  async function answerWithinCapacity(loadContext, request, signal) {
    // 2–3. Authorised data (404 for other users' trips/itineraries) → bounded context.
    const { context, refs, itineraryId } = await loadContext();

    const placeRef = request.placeId && Object.keys(refs).find((ref) => refs[ref] === request.placeId);
    if (request.placeId && !placeRef) throw invalid('placeId', 'This place is not part of the itinerary or its recommendations');
    if (request.dayNumber && !context.itinerary.days.some((d) => d.dayNumber === request.dayNumber)) {
      throw invalid('dayNumber', `This itinerary has no day ${request.dayNumber}`);
    }

    // 4. Fit the model's context window (and keep community text out unless asked about).
    const promptFor = (ctx) => buildPrompt(ctx, { ...request, placeRef });
    const fitted = fitContext(context, {
      placeRef,
      dayNumber: request.dayNumber,
      budgetChars: promptBudgetChars,
      measure: (ctx) => {
        const { system, messages } = promptFor(ctx);
        return system.length + messages.reduce((total, m) => total + m.content.length, 0);
      },
    });
    if (!fitted) {
      throw new UnprocessableError(
        'ASSISTANT_CONTEXT_TOO_LARGE',
        'This itinerary is too large to discuss at once; ask about one day (dayNumber) or one place (placeId)',
      );
    }

    // 5–7. Prompt → provider (timeout and failures become 503 AI_UNAVAILABLE).
    const prompt = promptFor(fitted.context);
    const result = await generateWithin({ ...prompt, outputSchema: OUTPUT_SCHEMA, temperature: config.temperature }, signal);

    // 8. Untrusted reply → bounded, grounded response (checked against what the model saw).
    const output = parseAssistantOutput(result.output, {
      context: fitted.context,
      refs,
      allowSuggestions: request.task === 'suggest_adjustments' && context.itinerary.isCurrent,
      config,
    });
    const log = { task: request.task, itineraryId, provider: ai.providerName, model: ai.model };
    if (!output) {
      getLogger().warn(log, 'AI reply unusable (empty or malformed)');
      throw aiUnavailableError('UNAVAILABLE');
    }
    getLogger().info({ ...log, contextReduced: fitted.reduced, truncated: output.truncated, dropped: output.dropped }, 'Assistant answered');

    // Provider and model stay internal (logged above), never part of the API response.
    return {
      task: request.task,
      itinerary: { id: itineraryId, version: context.itinerary.version, isCurrent: context.itinerary.isCurrent },
      answer: output.answer,
      truncated: output.truncated || Boolean(result.truncated),
      places: output.places,
      suggestions: output.suggestions,
      source: { generatedBy: 'ai' },
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * input: { task, question?, placeId?, dayNumber? } (validated here as well)
   * options: { signal } cancels the AI call, e.g. when the client disconnects
   * → { task, itinerary, answer, truncated, places, suggestions, source, disclaimer }
   */
  const askAboutItinerary = (itineraryId, input, user, options) =>
    answer(() => contextLoader.forItinerary(itineraryId, user), input, options);

  // The trip's current itinerary (422 ITINERARY_NOT_GENERATED when there is none).
  const askAboutTrip = (tripId, input, user, options) =>
    answer(() => contextLoader.forCurrentItinerary(tripId, user), input, options);

  return {
    askAboutItinerary,
    askAboutTrip,

    // { itineraryId | tripId, ...input } as accepted by POST /ai/trip-assistant.
    ask({ itineraryId, tripId, ...input }, user, options) {
      return itineraryId ? askAboutItinerary(itineraryId, input, user, options) : askAboutTrip(tripId, input, user, options);
    },

    // { enabled, available, reason? }: no provider, model, host or error details.
    status(options) {
      return ai.status(options);
    },
  };
}
