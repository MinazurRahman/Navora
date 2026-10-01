import {
  AppError,
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from '../shared/errors/AppError.js';
import { getLogger } from '../shared/logger.js';

// PostgreSQL error codes we can safely translate into client errors.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_ERRORS = {
  23505: () => new ConflictError('Resource already exists'),
  23503: () => new ConflictError('Operation conflicts with a related resource'),
  23514: () => new ValidationError('Request violates a data constraint'),
  '22P02': () => new ValidationError('Invalid input value'),
  57014: () => new ServiceUnavailableError('The request took too long to process', undefined, 'TIMEOUT'),
};

function toAppError(err) {
  if (err instanceof AppError) return err;

  // express.json() errors
  if (err?.type === 'entity.parse.failed') return new AppError('INVALID_JSON', 'Request body is not valid JSON', 400);
  if (err?.type === 'entity.too.large') return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large', 413);

  const pgError = typeof err?.code === 'string' && PG_ERRORS[err.code];
  if (pgError) {
    // Log what happened for developers; the client only sees the translated message.
    getLogger().warn({ pgCode: err.code, constraint: err.constraint, table: err.table }, 'Database error translated');
    return pgError();
  }

  // Other client errors raised by Express/body-parser (http-errors with expose=true).
  if (err?.expose === true && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return new AppError('BAD_REQUEST', err.message, err.status);
  }

  return null;
}

export function errorMiddleware() {
  // Express identifies error middleware by its 4-argument signature.
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const appError = toAppError(err);
    const status = appError?.status ?? 500;

    // pino-http logs res.err (with stack) on the request's completion line.
    if (status >= 500) res.err = err;

    const error = appError
      ? { code: appError.code, message: appError.message }
      : { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
    if (appError?.details !== undefined) error.details = appError.details;
    error.requestId = req.id;

    res.status(status).json({ success: false, error });
  };
}
