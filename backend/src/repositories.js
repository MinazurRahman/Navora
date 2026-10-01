import { createHealthRepository } from './modules/health/health.repository.js';
import { createUsersRepository } from './modules/users/index.js';
import { createRefreshTokenRepository } from './modules/auth/index.js';

// Every repository in one place: the only code that receives the Knex instance.
// Tests pass in-memory fakes with the same shape instead.
export function createRepositories(db) {
  return {
    health: createHealthRepository(db),
    users: createUsersRepository(db),
    refreshTokens: createRefreshTokenRepository(db),
  };
}
