import { randomUUID } from 'node:crypto';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../shared/auth/password.js';
import { getLogger } from '../../shared/logger.js';
import { toPublicUser } from '../users/users.mapper.js';
import { generateRefreshToken, hashRefreshToken } from './token.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// One message for unknown email, wrong password and disabled account, so responses
// do not reveal which emails are registered.
const invalidCredentials = () => new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
const invalidRefreshToken = () => new UnauthorizedError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');

export function createAuthService({
  usersService,
  refreshTokenRepository,
  tokenService,
  refreshTokenTtlDays,
  now = () => new Date(),
}) {
  // familyId groups one login's chain of rotated refresh tokens.
  async function issueSession(user, familyId = randomUUID()) {
    const { token, tokenHash } = generateRefreshToken();
    const expiresAt = new Date(now().getTime() + refreshTokenTtlDays * DAY_MS);
    const { id: refreshTokenId } = await refreshTokenRepository.create({
      userId: user.id,
      familyId,
      tokenHash,
      expiresAt,
    });

    return {
      refreshTokenId,
      session: {
        user: toPublicUser(user),
        tokens: {
          tokenType: 'Bearer',
          accessToken: tokenService.signAccessToken(user),
          expiresIn: tokenService.accessTokenTtlSeconds,
          refreshToken: token,
          refreshTokenExpiresAt: expiresAt.toISOString(),
        },
      },
    };
  }

  return {
    async register({ name, email, password }) {
      const passwordHash = await hashPassword(password);
      const user = await usersService.createUser({ name, email, passwordHash });
      getLogger().info({ userId: user.id }, 'User registered');
      return (await issueSession(user)).session;
    },

    async login({ email, password }) {
      const user = await usersService.findCredentialsByEmail(email);
      if (!user) {
        await burnPasswordCheck(password);
        getLogger().info('Login failed: unknown account');
        throw invalidCredentials();
      }

      // Verify before checking is_active so both failure paths take the same time.
      const passwordMatches = await verifyPassword(user.password_hash, password);
      if (!passwordMatches || !user.is_active) {
        getLogger().info({ userId: user.id }, 'Login failed');
        throw invalidCredentials();
      }

      getLogger().info({ userId: user.id }, 'User logged in');
      return (await issueSession(user)).session;
    },

    // Rotation: every refresh token works once. Presenting an already-used token means
    // it was probably stolen, so the whole family (that login session) is revoked.
    async refresh({ refreshToken }) {
      const tokenHash = hashRefreshToken(refreshToken);
      const claimed = await refreshTokenRepository.claim(tokenHash);

      if (!claimed) {
        const existing = await refreshTokenRepository.findByHash(tokenHash);
        if (existing?.revoked_at) {
          await refreshTokenRepository.revokeFamily(existing.family_id);
          getLogger().warn(
            { userId: existing.user_id, familyId: existing.family_id },
            'Refresh token reuse detected; session revoked',
          );
        }
        throw invalidRefreshToken();
      }

      if (claimed.expires_at <= now()) throw invalidRefreshToken();

      const user = await usersService.findById(claimed.user_id);
      if (!user || !user.is_active) throw invalidRefreshToken();

      const { session, refreshTokenId } = await issueSession(user, claimed.family_id);
      await refreshTokenRepository.setReplacedBy(claimed.id, refreshTokenId);
      return session;
    },

    // JWT logout: revoke the session's refresh tokens so no new access tokens can be
    // obtained. The current access token stays valid until it expires (at most
    // JWT_ACCESS_TOKEN_TTL_SECONDS); the client discards it. Always succeeds, so the
    // endpoint cannot be used to probe whether a token exists.
    async logout({ refreshToken }) {
      const existing = await refreshTokenRepository.findByHash(hashRefreshToken(refreshToken));
      if (existing) {
        await refreshTokenRepository.revokeFamily(existing.family_id);
        getLogger().info({ userId: existing.user_id }, 'User logged out');
      }
    },

    async getCurrentUser(userId) {
      const user = await usersService.findById(userId);
      if (!user || !user.is_active) throw new UnauthorizedError('Account is not available');
      return toPublicUser(user);
    },
  };
}
