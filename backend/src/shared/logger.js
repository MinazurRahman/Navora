import pino from 'pino';
import { env } from '../config/env.js';
import { getRequestContext } from './requestContext.js';

export const logger = pino({
  level: env.logLevel,
  base: { service: 'navora-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
  ...(env.nodeEnv === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } },
  }),
});

// Returns the request-scoped logger (carries requestId) when called inside a request,
// otherwise the base logger. Services and repositories should log through this.
export function getLogger() {
  return getRequestContext()?.logger ?? logger;
}
