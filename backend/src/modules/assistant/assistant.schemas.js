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

export const askAssistantSchema = z
  .object({
    task: z.enum(ASSISTANT_TASKS),
    question: questionText.optional(),
    placeId: z.uuid().optional(),
    dayNumber: z.number().int().min(1).max(14).optional(),
  })
  .refine((body) => body.task !== 'question' || body.question !== undefined, {
    message: 'question is required for task "question"',
    path: ['question'],
  })
  .refine((body) => body.task !== 'explain_place' || body.placeId !== undefined, {
    message: 'placeId is required for task "explain_place"',
    path: ['placeId'],
  });
