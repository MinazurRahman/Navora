import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { ROLES } from '../../shared/auth/authorization.js';

const ALGORITHM = 'HS256';
const VALID_ROLES = new Set(Object.values(ROLES));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Access tokens: short-lived JWTs verified locally on any instance (no shared state).
export function createTokenService({ jwtSecret, accessTokenTtlSeconds, issuer, audience }) {
  return {
    accessTokenTtlSeconds,

    signAccessToken(user) {
      return jwt.sign({ role: user.role }, jwtSecret, {
        algorithm: ALGORITHM,
        subject: user.id,
        expiresIn: accessTokenTtlSeconds,
        issuer,
        audience,
        jwtid: randomUUID(),
      });
    },

    // Returns the authenticated principal { id, role } or throws 401.
    verifyAccessToken(token) {
      let payload;
      try {
        // Pinning the algorithm blocks "alg: none" and algorithm-confusion attacks.
        payload = jwt.verify(token, jwtSecret, { algorithms: [ALGORITHM], issuer, audience });
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          throw new UnauthorizedError('Access token has expired', 'TOKEN_EXPIRED');
        }
        throw new UnauthorizedError('Invalid access token', 'INVALID_TOKEN');
      }

      if (!UUID.test(payload.sub ?? '') || !VALID_ROLES.has(payload.role)) {
        throw new UnauthorizedError('Invalid access token', 'INVALID_TOKEN');
      }
      return { id: payload.sub, role: payload.role };
    },
  };
}

// Refresh tokens: opaque random values. Only their SHA-256 hash is stored, so a
// database leak does not yield usable tokens.
export function generateRefreshToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
