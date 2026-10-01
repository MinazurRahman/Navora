import { randomUUID } from 'node:crypto';
import { requestContext } from '../shared/requestContext.js';

// Reuse an upstream ID (e.g. from the load balancer) only if it looks safe to log.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContextMiddleware() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);

    // httpLogger fills in `logger` once the request-scoped child logger exists.
    requestContext.run({ requestId: req.id, logger: undefined }, next);
  };
}
