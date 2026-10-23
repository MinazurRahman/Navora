import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { byIpAndEmail } from '../../middleware/rateLimit.middleware.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from './auth.schemas.js';

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
  router.patch('/me', authenticate, validate({ body: updateProfileSchema }), authController.updateMe);
  // Checks the current password: same fail-closed guessing protection as sign-in, counted
  // per IP and per signed-in user.
  router.post(
    '/change-password',
    authenticate,
    rateLimit('authIp'),
    rateLimit('authAccount'),
    validate({ body: changePasswordSchema }),
    authController.changePassword,
  );
  // Same limits as sign-in: they also stop the endpoint being used to flood a mailbox.
  router.post('/forgot-password', credentialLimits, validate({ body: forgotPasswordSchema }), authController.forgotPassword);
  // The token cannot be guessed; the IP limit bounds password hashing work.
  router.post('/reset-password', rateLimit('authIp'), validate({ body: resetPasswordSchema }), authController.resetPassword);

  return router;
}
