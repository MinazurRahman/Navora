import { NotFoundError } from '../shared/errors/AppError.js';

export function notFoundMiddleware() {
  return (req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
  };
}
