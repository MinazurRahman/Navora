import { RateLimitError, ServiceUnavailableError } from '../shared/errors/AppError.js';
import { getLogger } from '../shared/logger.js';
import { withTimeout } from '../shared/withTimeout.js';

// rateLimit(policyName, identify?) → middleware. `identify(req)` picks the bucket.
export function createRateLimitMiddleware({ rateLimiter, policies, timeoutMs, tokenService }) {
  // Per user when the request carries a valid access token, otherwise per IP.
  // Never rejects: an invalid token is the auth middleware's job, not this one's.
  function identifyRequester(req) {
    if (req.user) return `user:${req.user.id}`;
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      try {
        return `user:${tokenService.verifyAccessToken(token).id}`;
      } catch {
        // fall through to IP
      }
    }
    return `ip:${req.ip}`;
  }

  return function rateLimit(policyName, identify = identifyRequester) {
    const policy = policies[policyName];
    if (!policy) throw new Error(`Unknown rate-limit policy: ${policyName}`);

    return async (req, res, next) => {
      let result;
      try {
        result = await withTimeout(rateLimiter.limit(policyName, identify(req)), timeoutMs);
      } catch (err) {
        getLogger().error({ err, policy: policyName, failOpen: policy.failOpen }, 'Rate limiter unavailable');
        if (policy.failOpen) return next();
        throw new ServiceUnavailableError(
          'Service temporarily unavailable, please retry shortly',
          undefined,
          'RATE_LIMIT_UNAVAILABLE',
        );
      }

      const resetSeconds = Math.max(0, Math.ceil((result.reset - Date.now()) / 1000));
      res.set({
        'RateLimit-Limit': String(result.limit),
        'RateLimit-Remaining': String(Math.max(0, result.remaining)),
        'RateLimit-Reset': String(resetSeconds),
      });

      if (!result.success) {
        res.set('Retry-After', String(resetSeconds));
        getLogger().info({ policy: policyName }, 'Rate limit exceeded');
        throw new RateLimitError();
      }
      next();
    };
  };
}

// For login/register: per IP + email, so one account cannot be brute-forced and one
// user's typos do not lock out everyone behind the same NAT.
export function byIpAndEmail(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `ip:${req.ip}|email:${email}`;
}
