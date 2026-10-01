import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { assertOwnerOrRole, isOwnerOrHasRole } from '../../src/shared/auth/authorization.js';
import { createAuthMiddleware } from '../../src/middleware/auth.middleware.js';
import { createTokenService } from '../../src/modules/auth/token.service.js';
import { errorMiddleware } from '../../src/middleware/error.middleware.js';

const owner = { id: 'owner-id', role: 'user' };
const stranger = { id: 'stranger-id', role: 'user' };
const moderator = { id: 'mod-id', role: 'moderator' };

describe('ownership checks', () => {
  it('allows the owner', () => {
    expect(isOwnerOrHasRole(owner, 'owner-id')).toBe(true);
    expect(() => assertOwnerOrRole(owner, 'owner-id')).not.toThrow();
  });

  it('forbids other users', () => {
    expect(isOwnerOrHasRole(stranger, 'owner-id')).toBe(false);
    expect(() => assertOwnerOrRole(stranger, 'owner-id')).toThrow(expect.objectContaining({ status: 403, code: 'FORBIDDEN' }));
  });

  it('allows listed privileged roles only', () => {
    expect(() => assertOwnerOrRole(moderator, 'owner-id', 'moderator', 'admin')).not.toThrow();
    expect(() => assertOwnerOrRole(moderator, 'owner-id', 'admin')).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('requires an authenticated user', () => {
    expect(() => assertOwnerOrRole(undefined, 'owner-id')).toThrow(expect.objectContaining({ status: 401 }));
  });
});

describe('requireRole middleware', () => {
  const tokenService = createTokenService({
    jwtSecret: 's'.repeat(40),
    accessTokenTtlSeconds: 900,
    issuer: 'navora-api',
    audience: 'navora-app',
  });
  const { authenticate, requireRole } = createAuthMiddleware({ tokenService });

  const app = express();
  app.get('/moderation', authenticate, requireRole('moderator', 'admin'), (req, res) => res.json({ ok: true }));
  app.use(errorMiddleware());

  const tokenFor = (role) => tokenService.signAccessToken({ id: '0b6b7c1e-2f4a-4c55-9d8e-3a1f2b4c5d6e', role });

  it('lets permitted roles through', async () => {
    const res = await request(app).get('/moderation').set('Authorization', `Bearer ${tokenFor('moderator')}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 for other roles', async () => {
    const res = await request(app).get('/moderation').set('Authorization', `Bearer ${tokenFor('user')}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/moderation');
    expect(res.status).toBe(401);
  });
});
