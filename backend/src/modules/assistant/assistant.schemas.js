import { z } from 'zod';
import { ASSISTANT_CONFIG } from '../../config/assistant.js';

export const ASSISTANT_TASKS = Object.freeze([
  'summarize',
  'explain_itinerary',
  'explain_place',
  'explain_warnings',
  'suggest_adjustments',
  'question',
]);

// Collapses whitespace and drops control characters: the question goes into a prompt.
const questionText = z
  .string()
  .transform((text) => text.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(3).max(ASSISTANT_CONFIG.maxQuestionChars));

const askFields = {
  task: z.enum(ASSISTANT_TASKS),
  question: questionText.optional(),
  placeId: z.uuid().optional(),
  dayNumber: z.number().int().min(1).max(14).optional(),
};

const withTaskRules = (schema) =>
  schema
    .refine((body) => body.task !== 'question' || body.question !== undefined, {
      message: 'question is required for task "question"',
      path: ['question'],
    })
    .refine((body) => body.task !== 'explain_place' || body.placeId !== undefined, {
      message: 'placeId is required for task "explain_place"',
      path: ['placeId'],
    });

// What to ask, independent of which itinerary it is about.
export const askAssistantSchema = withTaskRules(z.object(askFields));

// POST /ai/trip-assistant: about one itinerary version, or a trip's current itinerary.
export const tripAssistantRequestSchema = withTaskRules(
  z.object({ ...askFields, itineraryId: z.uuid().optional(), tripId: z.uuid().optional() }),
).refine((body) => (body.itineraryId === undefined) !== (body.tripId === undefined), {
  message: 'provide exactly one of itineraryId or tripId',
  path: ['itineraryId'],
});
