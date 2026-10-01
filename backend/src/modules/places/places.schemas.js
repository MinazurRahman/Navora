import { z } from 'zod';
import {
  latitudeSchema,
  longitudeSchema,
  paginationQuerySchema,
  queryNumber,
} from '../../shared/validation/common.schemas.js';

const categorySlug = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,50}$/, 'must be a category slug like "museum"');
const facilityStatus = z.enum(['YES', 'NO', 'UNKNOWN']);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

// Body coordinates are strict numbers (no coercion: "true" or "" must not become 1 or 0).
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const tagSlug = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,50}$/, 'must be an interest slug like "history"');

// "HH:MM", 00:00–24:00. Same format for every time-of-day in the API.
export const timeOfDaySchema = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'must be HH:MM between 00:00 and 24:00');

function sameDayHoursDoNotOverlap(hours) {
  const sorted = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt));
  return sorted.every((h, i) => i === 0 || sorted[i - 1].dayOfWeek !== h.dayOfWeek || sorted[i - 1].closesAt <= h.opensAt);
}

// Weekly schedule. [] = hours unknown (never assumed open). A day with no entry, when
// other days have entries, is closed. Overnight hours: split across two days.
const openingHoursSchema = z
  .array(
    z
      .object({
        dayOfWeek: z.number().int().min(1).max(7), // ISO: 1 = Monday
        opensAt: timeOfDaySchema,
        closesAt: timeOfDaySchema,
      })
      // "HH:MM" strings compare correctly as text, including "24:00".
      .refine((h) => h.opensAt < h.closesAt, 'opensAt must be before closesAt (split overnight hours across two days)'),
  )
  .max(28)
  .refine(sameDayHoursDoNotOverlap, 'opening hours on the same day must not overlap');

// Unknown keys (status, createdBy, rating…) are stripped: clients cannot set them.
const placeFields = {
  name: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  category: categorySlug,
  location: locationSchema,
  address: optionalText(300),
  city: optionalText(100),
  // null = unknown, 0 = free
  entryFee: z.number().min(0).max(1_000_000).nullable().optional(),
  typicalVisitMinutes: z.number().int().min(5).max(720).nullable().optional(),
  parkingAvailable: facilityStatus.optional(),
  petFriendly: facilityStatus.optional(),
  wheelchairAccessible: facilityStatus.optional(),
  accessibilityNotes: optionalText(1000),
  restrictions: optionalText(1000),
  tags: z.array(tagSlug).max(10).transform((slugs) => [...new Set(slugs)]).optional(),
  openingHours: openingHoursSchema.optional(),
};

export const createPlaceSchema = z.object(placeFields);

export const updatePlaceSchema = z
  .object(placeFields)
  .partial()
  .refine((fields) => Object.keys(fields).length > 0, 'provide at least one field to update');

// ?category=museum,park
const categoryList = z
  .string()
  .transform((value) => value.split(',').map((slug) => slug.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(categorySlug).min(1).max(20));

export const listPlacesQuerySchema = paginationQuerySchema.extend({
  category: categoryList.optional(),
  maxEntryFee: queryNumber().pipe(z.number().min(0)).optional(),
  minRating: queryNumber().pipe(z.number().min(1).max(5)).optional(),
});

export const nearbyPlacesQuerySchema = listPlacesQuerySchema.extend({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: queryNumber().pipe(z.number().gt(0).max(50)).default(5),
});

const placeStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED']);

export const moderationQueueQuerySchema = paginationQuerySchema.extend({
  status: placeStatus.default('PENDING'),
});

export const mySubmissionsQuerySchema = paginationQuerySchema.extend({
  status: placeStatus.optional(),
});

export const approvePlaceSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

// The submitter sees this reason, so it is required.
export const rejectPlaceSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const searchPlacesQuerySchema = listPlacesQuerySchema.extend({
  q: z.string().trim().min(1).max(100),
});
