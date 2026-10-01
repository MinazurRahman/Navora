import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { loginSchema, refreshTokenSchema, registerSchema } from './auth.schemas.js';

// TODO(Phase: Redis): put rateLimit('auth') (fail-closed) first on register/login/refresh/logout.
export function createAuthRouter({ authController, authenticate }) {
  const router = Router();

  // Responses carry tokens: never let browsers or proxies cache them.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', validate({ body: registerSchema }), authController.register);
  router.post('/login', validate({ body: loginSchema }), authController.login);
  router.post('/refresh', validate({ body: refreshTokenSchema }), authController.refresh);
  // Authenticated by possession of the refresh token, so logout works even after the
  // access token has expired.
  router.post('/logout', validate({ body: refreshTokenSchema }), authController.logout);
  router.get('/me', authenticate, authController.me);

  return router;
}
