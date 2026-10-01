import { z } from 'zod';

// Reusable building blocks for module request schemas.

export const uuidSchema = z.uuid();

export const idParamSchema = z.object({ id: uuidSchema });

export const MAX_PAGE_LIMIT = 50;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(20),
});

// Query-string numbers. Plain z.coerce.number() turns "" into 0, so "?latitude=" would
// silently mean the equator; an empty value is rejected instead.
export const queryNumber = () => z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number());

export const latitudeSchema = queryNumber().pipe(z.number().min(-90).max(90));
export const longitudeSchema = queryNumber().pipe(z.number().min(-180).max(180));

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export function buildPaginationMeta({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
