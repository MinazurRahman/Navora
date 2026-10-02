import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate.middleware.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';
import { requestContextMiddleware } from '../../src/middleware/requestContext.middleware.js';
import {
  buildPaginationMeta,
  coordinatesSchema,
  idParamSchema,
  paginationQuerySchema,
} from '../../src/shared/validation/common.schemas.js';

function buildApp() {
  const app = express();
  app.use(requestContextMiddleware());
  app.use(express.json());
  app.post(
    '/items/:id',
    validate({
      params: idParamSchema,
      query: paginationQuerySchema,
      body: z.object({ name: z.string().min(1), location: coordinatesSchema }),
    }),
    (req, res) => res.json(req.validated),
  );
  app.use(errorMiddleware());
  return app;
}

const ID = '3f1c9a52-6a4f-4a8e-9a43-0f2b7c1d5e10';

describe('validate middleware', () => {
  it('exposes parsed, coerced values on req.validated', async () => {
    const res = await request(buildApp())
      .post(`/items/${ID}?page=2`)
      .send({ name: 'Lalbagh Fort', location: { latitude: '23.7189', longitude: 90.3882 }, extra: 'dropped' });

    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ id: ID });
    expect(res.body.query).toEqual({ page: 2, limit: 20 });
    expect(res.body.body).toEqual({ name: 'Lalbagh Fort', location: { latitude: 23.7189, longitude: 90.3882 } });
  });

  it('returns 400 VALIDATION_ERROR with details from every request part', async () => {
    const res = await request(buildApp())
      .post('/items/not-a-uuid?limit=500')
      .send({ name: '', location: { latitude: 91, longitude: 0 } });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const locations = res.body.error.details.map((d) => `${d.location}:${d.path}`);
    expect(locations).toEqual(
      expect.arrayContaining(['params:id', 'query:limit', 'body:name', 'body:location.latitude']),
    );
  });
});

describe('common schemas', () => {
  it('builds pagination metadata', () => {
    expect(buildPaginationMeta({ page: 2, limit: 20 }, 45)).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    expect(buildPaginationMeta({ page: 1, limit: 20 }, 0)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('bounds pagination so OFFSET cannot be abused', () => {
    expect(paginationQuerySchema.safeParse({ page: '1000' }).success).toBe(true);
    expect(paginationQuerySchema.safeParse({ page: '1001' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(coordinatesSchema.safeParse({ latitude: -91, longitude: 0 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: 0, longitude: 181 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: 23.81, longitude: 90.41 }).success).toBe(true);
  });
});
