import { createHealthRepository } from './modules/health/health.repository.js';
import { createUsersRepository } from './modules/users/index.js';
import { createRefreshTokenRepository } from './modules/auth/index.js';
import { createCategoriesRepository } from './modules/categories/index.js';
import { createPlacesRepository } from './modules/places/index.js';
import { createReviewsRepository } from './modules/reviews/index.js';
import { createSavedPlacesRepository } from './modules/savedPlaces/index.js';
import { createTripsRepository } from './modules/trips/index.js';
import { createItinerariesRepository } from './modules/itineraries/index.js';

// Every repository in one place: the only code that receives the Knex instance.
// Tests pass in-memory fakes with the same shape instead.
export function createRepositories(db) {
  return {
    health: createHealthRepository(db),
    users: createUsersRepository(db),
    refreshTokens: createRefreshTokenRepository(db),
    categories: createCategoriesRepository(db),
    places: createPlacesRepository(db),
    reviews: createReviewsRepository(db),
    savedPlaces: createSavedPlacesRepository(db),
    trips: createTripsRepository(db),
    itineraries: createItinerariesRepository(db),
    // Services wrap multi-step writes in this; repositories take the trx as their last argument.
    transaction: (work) => db.transaction(work),
  };
}
