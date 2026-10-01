import helmet from 'helmet';
import cors from 'cors';

export function securityHeadersMiddleware() {
  return helmet();
}

// Only allow-listed browser origins get CORS headers. Requests without an Origin header
// (server-to-server, curl, health probes) are unaffected by CORS.
export function corsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, callback) => callback(null, Boolean(origin) && allowed.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false, // tokens travel in the Authorization header, not cookies
    maxAge: 600,
  });
}
