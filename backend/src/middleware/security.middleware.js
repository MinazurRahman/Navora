import helmet from 'helmet';
import cors from 'cors';

export function securityHeadersMiddleware() {
  return helmet();
}

// For routers that only ever serve the signed-in user's own data (trips, itineraries):
// neither the browser nor any shared cache may keep a copy. Mounted before authentication,
// so every response from such a router carries it, errors included.
export function privateNoStoreMiddleware() {
  return (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  };
}

// Only allow-listed browser origins get CORS headers. Requests without an Origin header
// (server-to-server, curl, health probes) are unaffected by CORS.
export function corsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, callback) => callback(null, Boolean(origin) && allowed.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    credentials: false, // tokens travel in the Authorization header, not cookies
    maxAge: 600,
  });
}
