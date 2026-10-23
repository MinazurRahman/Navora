import { createAuthService } from './auth.service.js';
import { createAuthController } from './auth.controller.js';
import { createAuthRouter } from './auth.routes.js';

export { createTokenService } from './token.service.js';
export { createRefreshTokenRepository } from './refreshToken.repository.js';
export { createPasswordResetTokenRepository } from './passwordResetToken.repository.js';

export function createAuthModule({
  usersService,
  refreshTokenRepository,
  passwordResetTokenRepository,
  mailService,
  tokenService,
  authenticate,
  rateLimit,
  config,
}) {
  const authService = createAuthService({
    usersService,
    refreshTokenRepository,
    passwordResetTokenRepository,
    mailService,
    tokenService,
    refreshTokenTtlDays: config.auth.refreshTokenTtlDays,
    appBaseUrl: config.appBaseUrl,
  });
  return { router: createAuthRouter({ authController: createAuthController(authService), authenticate, rateLimit }) };
}
