import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';

export const ROLES = Object.freeze({ USER: 'user', MODERATOR: 'moderator', ADMIN: 'admin' });

export function isModerator(user) {
  return user?.role === ROLES.MODERATOR || user?.role === ROLES.ADMIN;
}

// Ownership checks live in services (they are business rules). `user` is always
// req.user from the verified token, never an ID sent by the client.
export function isOwnerOrHasRole(user, ownerId, roles = []) {
  if (!user) return false;
  return user.id === ownerId || roles.includes(user.role);
}

export function assertOwnerOrRole(user, ownerId, ...roles) {
  if (!user) throw new UnauthorizedError();
  if (!isOwnerOrHasRole(user, ownerId, roles)) throw new ForbiddenError();
}
