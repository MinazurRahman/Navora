import { randomUUID } from 'node:crypto';
import { AppError, UnauthorizedError, ValidationError } from '../../shared/errors/AppError.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../shared/auth/password.js';
import { getLogger } from '../../shared/logger.js';
import { withTimeout } from '../../shared/withTimeout.js';
import { toPublicUser } from '../users/users.mapper.js';
import { generateRefreshToken, hashRefreshToken } from './token.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Long enough to open the mail, short enough that an old mailbox is not a key to the account.
const RESET_LINK_TTL_MS = 30 * 60 * 1000;
const MAIL_TIMEOUT_MS = 10_000;

// One message for unknown email, wrong password and disabled account, so responses
// do not reveal which emails are registered.
const invalidCredentials = () => new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
const invalidRefreshToken = () => new UnauthorizedError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
const accountUnavailable = () => new UnauthorizedError('Account is not available');
const invalidResetToken = () => new AppError('INVALID_RESET_TOKEN', 'This reset link is invalid, used or expired', 400);
// A wrong current password is a field error, not a 401: the session itself is fine.
const fieldError = (path, message) => new ValidationError('Invalid request data', [{ location: 'body', path, message }]);

export function createAuthService({
  usersService,
  refreshTokenRepository,
  passwordResetTokenRepository,
  mailService,
  tokenService,
  refreshTokenTtlDays,
  appBaseUrl,
  now = () => new Date(),
}) {
  // familyId groups one login's chain of rotated refresh tokens.
  async function issueSession(user, familyId = randomUUID()) {
    await refreshTokenRepository.deleteExpiredForUser(user.id); // keeps the table from growing forever
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

    // Name changes need no password; an email change does, so a stolen access token alone
    // cannot move the account to another address.
    async updateProfile(userId, { name, email, currentPassword }) {
      const user = await usersService.findCredentialsById(userId);
      if (!user || !user.is_active) throw accountUnavailable();

      const fields = {};
      if (name !== undefined && name !== user.name) fields.name = name;
      if (email !== undefined && email !== user.email.toLowerCase()) {
        if (!currentPassword) throw fieldError('currentPassword', 'Enter your current password to change your email');
        if (!(await verifyPassword(user.password_hash, currentPassword))) {
          throw fieldError('currentPassword', 'Current password is incorrect');
        }
        fields.email = email;
      }
      if (Object.keys(fields).length === 0) return toPublicUser(user);

      const updated = await usersService.updateProfile(userId, fields);
      getLogger().info({ userId, changed: Object.keys(fields) }, 'Profile updated');
      return toPublicUser(updated);
    },

    // Signs out every device (all refresh tokens revoked) and returns a new session for
    // this one, so a stolen session cannot outlive the password it was opened with.
    async changePassword(userId, { currentPassword, newPassword }) {
      const user = await usersService.findCredentialsById(userId);
      if (!user || !user.is_active) throw accountUnavailable();
      if (!(await verifyPassword(user.password_hash, currentPassword))) {
        throw fieldError('currentPassword', 'Current password is incorrect');
      }
      if (newPassword === currentPassword) throw fieldError('newPassword', 'Choose a password different from the current one');

      await usersService.updatePassword(userId, await hashPassword(newPassword));
      await refreshTokenRepository.revokeAllForUser(userId);
      getLogger().info({ userId }, 'Password changed; all sessions revoked');
      return (await issueSession(user)).session;
    },

    // Always resolves the same way, so it cannot be used to find out which emails are
    // registered. The mail is sent in the background: waiting for it would make known
    // emails measurably slower to answer.
    async requestPasswordReset({ email }) {
      const user = await usersService.findCredentialsByEmail(email);
      if (!user || !user.is_active) {
        getLogger().info('Password reset requested for an unknown or disabled account');
        return;
      }

      await passwordResetTokenRepository.deleteForUser(user.id);
      const { token, tokenHash } = generateRefreshToken();
      await passwordResetTokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(now().getTime() + RESET_LINK_TTL_MS),
      });
      // In the fragment, so the token never reaches a server log or a Referer header.
      const link = `${appBaseUrl}/reset-password#token=${token}`;
      const text = [
        `Hello ${user.name},`,
        '',
        `Someone asked to reset the password of your NAVORA account. To choose a new password, open this link within 30 minutes:`,
        link,
        '',
        'If it was not you, ignore this message; your password stays the same.',
      ].join('\n');
      withTimeout(mailService.send({ to: user.email, subject: 'Reset your NAVORA password', text }), MAIL_TIMEOUT_MS).catch((err) =>
        getLogger().error({ userId: user.id, err: err.message }, 'Password reset mail failed'),
      );
      getLogger().info({ userId: user.id }, 'Password reset link issued');
    },

    // The link works once. Every session is signed out, and the user signs in again with
    // the new password.
    async resetPassword({ token, newPassword }) {
      const claimed = await passwordResetTokenRepository.claim(hashRefreshToken(token));
      if (!claimed) throw invalidResetToken();
      const user = await usersService.findById(claimed.user_id);
      if (!user || !user.is_active) throw invalidResetToken();

      await usersService.updatePassword(user.id, await hashPassword(newPassword));
      await refreshTokenRepository.revokeAllForUser(user.id);
      await passwordResetTokenRepository.deleteForUser(user.id);
      getLogger().info({ userId: user.id }, 'Password reset; all sessions revoked');
    },

    async getCurrentUser(userId) {
      const user = await usersService.findById(userId);
      if (!user || !user.is_active) throw new UnauthorizedError('Account is not available');
      return toPublicUser(user);
    },
  };
}
