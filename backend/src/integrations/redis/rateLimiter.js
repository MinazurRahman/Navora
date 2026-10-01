import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';

// Redis-backed, so limits hold across every instance behind the load balancer.
export function createUpstashRateLimiter(redis, policies) {
  const limiters = Object.fromEntries(
    Object.entries(policies).map(([name, policy]) => [
      name,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(policy.limit, policy.window),
        prefix: `nv:rl:${name}`,
        timeout: 0, // see RATE_LIMIT_TIMEOUT_MS
        analytics: false,
      }),
    ]),
  );

  return {
    // Returns { success, limit, remaining, reset (epoch ms) }; throws if Redis fails.
    async limit(policyName, identifier) {
      // Identifiers contain IPs/emails: store only a hash in the third-party service.
      const key = createHash('sha256').update(identifier).digest('base64url');
      const { success, limit, remaining, reset } = await limiters[policyName].limit(key);
      return { success, limit, remaining, reset };
    },
  };
}
