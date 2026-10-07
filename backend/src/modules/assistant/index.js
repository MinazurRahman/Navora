import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { sendSuccess } from '../../shared/http/response.js';
import { ASSISTANT_CONFIG } from '../../config/assistant.js';
import { createAssistantContextLoader } from './contextLoader.js';
import { createAssistantService } from './assistant.service.js';
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
  aiTimeoutMs,
  authenticate,
  rateLimit,
  config = ASSISTANT_CONFIG,
}) {
  const contextLoader = createAssistantContextLoader({ itinerariesService, tripsService, placesService, recommendationsService, config });
  const assistantService = createAssistantService({ contextLoader, ai: aiService, timeoutMs: aiTimeoutMs, config });
  const router = Router();
  router.use(authenticate); // answers are about the user's own trips

  // Runs a local model: per-minute and daily limits, both fail-closed.
  router.post(
    '/trip-assistant',
    rateLimit('assistant'),
    rateLimit('assistantDaily'),
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
