import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';
import { requestContextMiddleware } from '../../src/middleware/requestContext.middleware.js';
import { ForbiddenError, UnprocessableError } from '../../src/shared/errors/AppError.js';

function appThrowing(err) {
  const app = express();
  app.use(requestContextMiddleware());
  app.get('/boom', async () => {
    throw err;
  });
  app.use(errorMiddleware());
  return app;
}

function pgError(code, message) {
  return Object.assign(new Error(message), { code, constraint: 'some_constraint' });
}

describe('error middleware', () => {
  it('renders AppErrors with their status, code, message and details', async () => {
    const details = [{ constraint: 'parkingRequired', candidatesRemoved: 14 }];
    const res = await request(appThrowing(new UnprocessableError('INSUFFICIENT_MATCHING_PLACES', 'Not enough places', details))).get('/boom');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INSUFFICIENT_MATCHING_PLACES',
        message: 'Not enough places',
        details,
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('omits details when there are none', async () => {
    const res = await request(appThrowing(new ForbiddenError())).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.error).not.toHaveProperty('details');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(appThrowing(new Error('secret internal detail at db.js:42'))).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it.each([
    ['23505', 409, 'CONFLICT'],
    ['23503', 409, 'CONFLICT'],
    ['23514', 400, 'VALIDATION_ERROR'],
    ['22P02', 400, 'VALIDATION_ERROR'],
    ['57014', 503, 'TIMEOUT'],
  ])('translates PostgreSQL error %s without leaking SQL details', async (code, status, errorCode) => {
    const res = await request(appThrowing(pgError(code, 'duplicate key value violates unique constraint "users_email_key"'))).get('/boom');

    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(errorCode);
    expect(JSON.stringify(res.body)).not.toContain('users_email_key');
  });
});
