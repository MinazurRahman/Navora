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

export const searchPlacesQuerySchema = listPlacesQuerySchema.extend({
  q: z.string().trim().min(1).max(100),
});
