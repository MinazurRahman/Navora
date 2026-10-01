import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { byIpAndEmail } from '../../middleware/rateLimit.middleware.js';
import { loginSchema, refreshTokenSchema, registerSchema } from './auth.schemas.js';

export function createAuthRouter({ authController, authenticate, rateLimit }) {
  const router = Router();

  // Credential guessing protection, fail-closed. Runs before validation so malformed
  // spam is counted too. Refresh/logout carry a 256-bit token that cannot be guessed,
  // so they only get the general limit (frequent refreshes behind a shared NAT).
  const credentialLimits = [rateLimit('authIp'), rateLimit('authAccount', byIpAndEmail)];

  // Responses carry tokens: never let browsers or proxies cache them.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', credentialLimits, validate({ body: registerSchema }), authController.register);
  router.post('/login', credentialLimits, validate({ body: loginSchema }), authController.login);
  router.post('/refresh', validate({ body: refreshTokenSchema }), authController.refresh);
  // Authenticated by possession of the refresh token, so logout works even after the
  // access token has expired.
  router.post('/logout', validate({ body: refreshTokenSchema }), authController.logout);
  router.get('/me', authenticate, authController.me);

  return router;
}
