import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { sendSuccess } from '../../shared/http/response.js';
import { ASSISTANT_CONFIG } from '../../config/assistant.js';
import { createAssistantContextLoader } from './contextLoader.js';
import { createAssistantService } from './assistant.service.js';
import { promptBudgetChars } from './budget.js';
import { tripAssistantRequestSchema } from './assistant.schemas.js';

// Cancels the AI call when the client goes away before the answer is sent.
function abortOnDisconnect(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function createAssistantModule({
  itinerariesService,
  tripsService,
  placesService,
  recommendationsService,
  aiService,
  aiConfig, // config.ai: timeoutMs, contextWindowTokens, maxOutputTokens, maxConcurrent
  authenticate,
  rateLimit,
  config = ASSISTANT_CONFIG,
}) {
  const contextLoader = createAssistantContextLoader({ itinerariesService, tripsService, placesService, recommendationsService, config });
  const assistantService = createAssistantService({
    contextLoader,
    ai: aiService,
    timeoutMs: aiConfig.timeoutMs,
    promptBudgetChars: promptBudgetChars(aiConfig, config),
    maxConcurrent: aiConfig.maxConcurrent,
    config,
  });
  const router = Router();
  router.use(authenticate); // answers are about the user's own trips

  // Runs a local model: per-user minute and daily limits, then one limit shared by all users
  // (many accounts must not saturate the AI host). All fail closed.
  router.post(
    '/trip-assistant',
    rateLimit('assistant'),
    rateLimit('assistantDaily'),
    rateLimit('assistantGlobal', () => 'all'),
    validate({ body: tripAssistantRequestSchema }),
    async (req, res) => {
      sendSuccess(res, await assistantService.ask(req.validated.body, req.user, { signal: abortOnDisconnect(res) }));
    },
  );

  router.get('/trip-assistant/status', async (req, res) => {
    sendSuccess(res, await assistantService.status());
  });

  return { router, assistantService };
}
