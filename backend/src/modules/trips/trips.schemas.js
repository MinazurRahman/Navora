import { z } from 'zod';
import { timeOfDaySchema } from '../places/places.schemas.js';

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,50}$/, 'must be a slug like "history"');
const uniqueSlugs = z.array(slug).max(10).transform((slugs) => [...new Set(slugs)]);

// Fields shared by create and update. No defaults here: on PATCH a default would
// silently overwrite what the user saved.
const tripFields = {
  title: z.string().trim().min(1).max(150),
  startLocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  startAddress: z.string().trim().max(300).nullable(),
  startDate: z.iso.date().nullable(), // null = the planner uses "today"
  durationDays: z.number().int().min(1).max(14),
  dailyStartTime: timeOfDaySchema,
  dailyEndTime: timeOfDaySchema,
  searchRadiusKm: z.number().min(0.5).max(50),
  budget: z
    .object({
      amount: z.number().min(0).max(100_000_000),
      type: z.enum(['total', 'per_day']),
    })
    .nullable(),
  travelMode: z.enum(['car', 'walking', 'cycling', 'public_transport']),
  // Hard requirements: only places explicitly marked YES qualify.
  travelingWithPet: z.boolean(),
  parkingRequired: z.boolean(),
  wheelchairAccessRequired: z.boolean(),
  partySize: z.number().int().min(1).max(50),
  minimumRating: z.number().min(1).max(5).nullable(),
  interests: uniqueSlugs,
  preferredCategories: uniqueSlugs,
  // Places the user picked: the planner must include them or explain why it cannot.
  selectedPlaceIds: z.array(z.uuid()).max(30).transform((ids) => [...new Set(ids)]),
};

const windowIsValid = (trip) =>
  trip.dailyStartTime === undefined || trip.dailyEndTime === undefined || trip.dailyStartTime < trip.dailyEndTime;
const windowError = { message: 'dailyStartTime must be before dailyEndTime', path: ['dailyEndTime'] };

export const createTripSchema = z
  .object({
    ...tripFields,
    startAddress: tripFields.startAddress.optional(),
    startDate: tripFields.startDate.optional(),
    dailyStartTime: tripFields.dailyStartTime.default('09:00'),
    dailyEndTime: tripFields.dailyEndTime.default('20:00'),
    searchRadiusKm: tripFields.searchRadiusKm.default(10),
    budget: tripFields.budget.optional(),
    travelMode: tripFields.travelMode.default('car'),
    travelingWithPet: tripFields.travelingWithPet.default(false),
    parkingRequired: tripFields.parkingRequired.default(false),
    wheelchairAccessRequired: tripFields.wheelchairAccessRequired.default(false),
    partySize: tripFields.partySize.default(1),
    minimumRating: tripFields.minimumRating.optional(),
    interests: uniqueSlugs.default([]),
    preferredCategories: uniqueSlugs.default([]),
    selectedPlaceIds: tripFields.selectedPlaceIds.default([]),
  })
  .refine(windowIsValid, windowError);

export const updateTripSchema = z
  .object(tripFields)
  .partial()
  .refine((fields) => Object.keys(fields).length > 0, 'provide at least one field to update')
  .refine(windowIsValid, windowError);
