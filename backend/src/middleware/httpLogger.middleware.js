import { pinoHttp } from 'pino-http';
import { logger } from '../shared/logger.js';
import { getRequestContext } from '../shared/requestContext.js';

const PROBE_PATHS = new Set(['/health', '/ready']);

export function httpLoggerMiddleware() {
  const middleware = pinoHttp({
    logger,
    genReqId: (req) => req.id,
    // req.log carries only the requestId binding, not the whole request on every line.
    quietReqLogger: true,
    customAttributeKeys: { reqId: 'requestId' },
    // Evaluated again when the response finishes, after authentication has run.
    customProps: (req) => (req.user ? { userId: req.user.id } : {}),
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Load-balancer probes would otherwise flood the logs.
    autoLogging: { ignore: (req) => PROBE_PATHS.has(req.url) },
    serializers: {
      // Path only: query strings can carry user coordinates and search terms.
      req: (req) => ({ method: req.method, path: req.url.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });

  return (req, res, next) => {
    middleware(req, res, () => {
      const context = getRequestContext();
      if (context) context.logger = req.log;
      next();
    });
  };
}
