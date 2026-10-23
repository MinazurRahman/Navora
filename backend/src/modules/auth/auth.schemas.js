import { z } from 'zod';

// Normalised so "User@Example.com " and "user@example.com" are the same account.
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

// Unknown keys (e.g. "role") are stripped by zod, so clients cannot choose their role.
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  // Upper bound keeps hashing cost bounded; no composition rules (NIST SP 800-63B).
  password: z.string().min(8, 'must be at least 8 characters').max(128),
});

// No password policy on login: old accounts must still be able to sign in.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

// Changing the email needs the current password (checked in the service); changing only
// the name does not. PATCH: no defaults.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: emailSchema.optional(),
    currentPassword: z.string().min(1).max(128).optional(),
  })
  .refine((fields) => fields.name !== undefined || fields.email !== undefined, 'provide name and/or email');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8, 'must be at least 8 characters').max(128),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(256),
});
