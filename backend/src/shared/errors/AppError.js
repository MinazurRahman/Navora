// Errors thrown by services/middleware. The error middleware turns them into the
// standard error envelope; `code` is the stable, machine-readable contract for clients.
export class AppError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request data', details = []) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(code, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(code, message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT', details = undefined) {
    super(code, message, 409, details);
  }
}

export class UnprocessableError extends AppError {
  constructor(code, message, details = undefined) {
    super(code, message, 422, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details = undefined, code = 'SERVICE_UNAVAILABLE') {
    super(code, message, 503, details);
  }
}
