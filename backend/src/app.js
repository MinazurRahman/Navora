import express from 'express';
import { requestContextMiddleware } from './middleware/requestContext.middleware.js';
import { httpLoggerMiddleware } from './middleware/httpLogger.middleware.js';
import { corsMiddleware, securityHeadersMiddleware } from './middleware/security.middleware.js';
import { createAuthMiddleware } from './middleware/auth.middleware.js';
import { createRateLimitMiddleware } from './middleware/rateLimit.middleware.js';
import { RATE_LIMIT_POLICIES, RATE_LIMIT_TIMEOUT_MS } from './config/rateLimits.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { createHealthModule } from './modules/health/index.js';
import { createUsersService } from './modules/users/index.js';
import { createAuthModule, createTokenService } from './modules/auth/index.js';
import { createCategoriesModule } from './modules/categories/index.js';
import { createPlacesModule } from './modules/places/index.js';
import { createReviewsModule } from './modules/reviews/index.js';
import { createRecommendationsModule } from './modules/recommendations/index.js';
import { createTripsModule } from './modules/trips/index.js';
import { createItinerariesModule } from './modules/itineraries/index.js';
import { createRoutingModule } from './modules/routing/index.js';
import { createV1Router } from './routes/v1.js';

// Builds the Express app from its dependencies without listening on a port,
// so tests can create it with fakes. Holds no per-user state: safe to run N copies.
export function createApp({ config, lifecycle, repositories, rateLimiter, cache, mapService }) {
  // Services and modules
  const tokenService = createTokenService(config.auth);
  const { authenticate, optionalAuth, requireRole } = createAuthMiddleware({ tokenService });
  const rateLimit = createRateLimitMiddleware({
    rateLimiter,
    policies: RATE_LIMIT_POLICIES,
    timeoutMs: RATE_LIMIT_TIMEOUT_MS,
    tokenService,
  });
  const usersService = createUsersService({ usersRepository: repositories.users });
  const authModule = createAuthModule({
    usersService,
    refreshTokenRepository: repositories.refreshTokens,
    tokenService,
    authenticate,
    rateLimit,
    config,
  });
  const categoriesModule = createCategoriesModule({ categoriesRepository: repositories.categories });
  const placesModule = createPlacesModule({
    placesRepository: repositories.places,
    categoriesService: categoriesModule.categoriesService,
    transaction: repositories.transaction,
    authenticate,
    optionalAuth,
    requireRole,
    rateLimit,
    cache,
  });
  const reviewsModule = createReviewsModule({
    reviewsRepository: repositories.reviews,
    placesService: placesModule.placesService,
    authenticate,
    optionalAuth,
    rateLimit,
  });

  const recommendationsModule = createRecommendationsModule({
    placesService: placesModule.placesService,
    categoriesService: categoriesModule.categoriesService,
    cache,
    rateLimit,
  });

  const tripsModule = createTripsModule({
    tripsRepository: repositories.trips,
    categoriesService: categoriesModule.categoriesService,
    placesService: placesModule.placesService,
    transaction: repositories.transaction,
    authenticate,
  });
  const itinerariesModule = createItinerariesModule({
    itinerariesRepository: repositories.itineraries,
    tripsService: tripsModule.tripsService,
    placesService: placesModule.placesService,
    transaction: repositories.transaction,
    mapService,
    authenticate,
    rateLimit,
  });

  const routingModule = createRoutingModule({
    mapService,
    placesService: placesModule.placesService,
    authenticate,
    rateLimit,
  });

  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // Order matters: request ID first so every later log line carries it.
  app.use(requestContextMiddleware());
  app.use(httpLoggerMiddleware());
  app.use(securityHeadersMiddleware());
  app.use(corsMiddleware(config.corsOrigins));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  // Probes stay outside /api/v1, so they are never rate limited or authenticated.
  app.use(createHealthModule({ healthRepository: repositories.health, lifecycle, config }).router);

  app.use(
    '/api/v1',
    rateLimit('general'),
    createV1Router({
      authRouter: authModule.router,
      categoriesRouter: categoriesModule.router,
      placesRouter: placesModule.router,
      reviewsRouter: reviewsModule.router,
      tagsRouter: categoriesModule.tagsRouter,
      recommendationsRouter: recommendationsModule.router,
      tripsRouter: tripsModule.router,
      itinerariesRouter: itinerariesModule.router,
      routingRouter: routingModule.router,
    }),
  );

  app.use(notFoundMiddleware());
  app.use(errorMiddleware());

  return app;
}
