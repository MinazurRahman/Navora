import express from 'express';
import { requestContextMiddleware } from './middleware/requestContext.middleware.js';
import { httpLoggerMiddleware } from './middleware/httpLogger.middleware.js';
import { corsMiddleware, securityHeadersMiddleware } from './middleware/security.middleware.js';
import { createAuthMiddleware } from './middleware/auth.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { createHealthModule } from './modules/health/index.js';
import { createUsersService } from './modules/users/index.js';
import { createAuthModule, createTokenService } from './modules/auth/index.js';
import { createV1Router } from './routes/v1.js';

// Builds the Express app from its dependencies without listening on a port,
// so tests can create it with fakes. Holds no per-user state: safe to run N copies.
export function createApp({ config, lifecycle, repositories }) {
  // Services and modules
  const tokenService = createTokenService(config.auth);
  const { authenticate } = createAuthMiddleware({ tokenService });
  const usersService = createUsersService({ usersRepository: repositories.users });
  const authModule = createAuthModule({
    usersService,
    refreshTokenRepository: repositories.refreshTokens,
    tokenService,
    authenticate,
    config,
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

  // Probes stay outside /api/v1 (and, later, outside rate limiting and auth).
  app.use(createHealthModule({ healthRepository: repositories.health, lifecycle, config }).router);

  app.use('/api/v1', createV1Router({ authRouter: authModule.router }));

  app.use(notFoundMiddleware());
  app.use(errorMiddleware());

  return app;
}
