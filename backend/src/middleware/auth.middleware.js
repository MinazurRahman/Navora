import { ForbiddenError, UnauthorizedError } from '../shared/errors/AppError.js';

// Stateless: verifies the JWT signature and claims locally, no database or Redis call,
// so any instance can authenticate any request.
export function createAuthMiddleware({ tokenService }) {
  function readBearerToken(req) {
    const header = req.get('authorization');
    if (!header) return null;

    const [scheme, token, ...rest] = header.split(' ');
    if (scheme.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
      throw new UnauthorizedError('Authorization header must be "Bearer <token>"', 'INVALID_TOKEN');
    }
    return token;
  }

  // Requires a valid access token; sets req.user = { id, role }.
  function authenticate(req, res, next) {
    const token = readBearerToken(req);
    if (!token) throw new UnauthorizedError();
    req.user = tokenService.verifyAccessToken(token);
    next();
  }

  // Attaches req.user when a token is present. An invalid token is still rejected
  // rather than silently treated as anonymous.
  function optionalAuth(req, res, next) {
    const token = readBearerToken(req);
    if (token) req.user = tokenService.verifyAccessToken(token);
    next();
  }

  // Use after authenticate: requireRole('moderator', 'admin').
  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user) throw new UnauthorizedError();
      if (!roles.includes(req.user.role)) throw new ForbiddenError();
      next();
    };
  }

  return { authenticate, optionalAuth, requireRole };
}
