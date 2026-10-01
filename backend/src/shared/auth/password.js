import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash, password) {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // Malformed hash in storage: treat as a failed match, never as a success.
    return false;
  }
}

// Verified against when the email is unknown, so "no such user" takes as long as
// "wrong password" and response timing does not reveal which emails are registered.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= hashPassword('navora-timing-equaliser');
  await verifyPassword(await dummyHash, password);
  return false;
}
