// Keeps docs/openapi.yaml honest:
//  1. it is a valid OpenAPI document and every example matches its own schema;
//  2. route parity: every Express route is documented and every documented route exists;
//  3. live: every operation is called against the real app, and each response's status must
//     be documented and its body must match the documented schema (schemas reject
//     undocumented fields, so drift in either direction fails).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';
import { buildTestApp, createInMemoryRateLimiter } from '../helpers/testApp.js';
import { AI_ERROR, AiProviderError } from '../../src/integrations/ai/index.js';

const SPEC = 'docs/openapi.yaml';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

let api;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const compiled = new WeakMap();
function matches(schema, value) {
  if (!compiled.has(schema)) compiled.set(schema, ajv.compile(schema));
  const validate = compiled.get(schema);
  return validate(value) ? null : ajv.errorsText(validate.errors, { separator: '\n' });
}

const operations = () =>
  Object.entries(api.paths).flatMap(([template, item]) =>
    METHODS.filter((m) => item[m]).map((method) => ({ method, template, op: item[method] })),
  );

beforeAll(async () => {
  await SwaggerParser.validate(SPEC);
  api = await SwaggerParser.dereference(SPEC);
});

describe('OpenAPI document', () => {
  it('every request and response example matches its schema', () => {
    const problems = [];
    for (const { method, template, op } of operations()) {
      const body = op.requestBody?.content?.['application/json'];
      if (body?.example) {
        const error = matches(body.schema, body.example);
        if (error) problems.push(`${method.toUpperCase()} ${template} request example:\n${error}`);
      }
      for (const [status, response] of Object.entries(op.responses)) {
        const content = response.content?.['application/json'];
        if (content?.example) {
          const error = matches(content.schema, content.example);
          if (error) problems.push(`${method.toUpperCase()} ${template} ${status} example:\n${error}`);
        }
      }
    }
    for (const [name, schema] of Object.entries(api.components.schemas)) {
      if (schema.example !== undefined) {
        const error = matches(schema, schema.example);
        if (error) problems.push(`components.schemas.${name} example:\n${error}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every operation documents its auth, a success response and 429', () => {
    for (const { method, template, op } of operations()) {
      const label = `${method.toUpperCase()} ${template}`;
      expect(op.summary, label).toBeTruthy();
      expect(Object.keys(op.responses).some((s) => s.startsWith('2')), label).toBe(true);
      if (template.startsWith('/api/v1')) expect(op.responses['429'], label).toBeDefined();
      if (op.security?.some((s) => s.bearerAuth) && !op.security.some((s) => Object.keys(s).length === 0)) {
        expect(op.responses['401'], `${label} requires auth but documents no 401`).toBeDefined();
      }
    }
  });
});

describe('route parity (code ⇄ spec)', () => {
  // Where each router variable is mounted. A new router file must be added here.
  const MOUNTS = {
    'src/modules/health/health.routes.js': { router: '' },
    'src/routes/v1.js': { router: '/api/v1' },
    'src/modules/auth/auth.routes.js': { router: '/api/v1/auth' },
    'src/modules/categories/index.js': { router: '/api/v1/categories', tagsRouter: '/api/v1/tags' },
    'src/modules/places/index.js': { router: '/api/v1/places' },
    'src/modules/reviews/index.js': { router: '/api/v1' },
    'src/modules/savedPlaces/index.js': { router: '/api/v1/saved-places' },
    'src/modules/recommendations/index.js': { router: '/api/v1/recommendations' },
    'src/modules/trips/index.js': { router: '/api/v1/trips' },
    'src/modules/itineraries/index.js': { router: '/api/v1/itineraries' },
    'src/modules/routing/index.js': { router: '/api/v1/routing' },
    'src/modules/assistant/index.js': { router: '/api/v1/ai' },
  };
  const ROUTE = /(\w+)\.(get|post|put|patch|delete)\(\s*'([^']*)'/g;

  const sourceFiles = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.js') ? [full.split(path.sep).join('/')] : [];
    });

  it('documents exactly the routes the code defines', () => {
    const inCode = new Set();
    // Only files that create Express routers (skips e.g. req.get('authorization')).
    for (const file of sourceFiles('src').filter((f) => readFileSync(f, 'utf8').includes('Router()'))) {
      for (const [, variable, method, routePath] of readFileSync(file, 'utf8').matchAll(ROUTE)) {
        const prefix = MOUNTS[file]?.[variable];
        expect(prefix, `${file}: router "${variable}" is not in MOUNTS (add it, then document its routes)`).toBeDefined();
        const full = `${prefix}${routePath === '/' ? '' : routePath}`.replace(/:(\w+)/g, '{$1}') || '/';
        inCode.add(`${method.toUpperCase()} ${full}`);
      }
    }
    const inSpec = new Set(operations().map(({ method, template }) => `${method.toUpperCase()} ${template}`));

    expect([...inCode].filter((r) => !inSpec.has(r)), 'routes missing from the spec').toEqual([]);
    expect([...inSpec].filter((r) => !inCode.has(r)), 'documented routes that do not exist').toEqual([]);
    expect(inCode.size).toBe(50);
  });
});

describe('error responses outside the database', () => {
  it('429 and 503 match the documented error schema', async () => {
    const limited = await request(buildTestApp({ rateLimiter: createInMemoryRateLimiter({ general: 0 }) })).get('/api/v1');
    expect(limited.status).toBe(429);
    expect(matches(api.paths['/api/v1'].get.responses['429'].content['application/json'].schema, limited.body)).toBeNull();

    const failing = { limit: async () => { throw new Error('redis down'); } };
    const closed = await request(buildTestApp({ rateLimiter: failing })).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(closed.status).toBe(503);
    expect(matches(api.paths['/api/v1/auth/login'].post.responses['503'].content['application/json'].schema, closed.body)).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)('live responses match the spec (PostGIS)', () => {
  let ctx;
  const covered = new Set();
  const failures = [];

  // Calls the app; checks the status is documented for this operation and the body matches.
  async function call(method, template, { params = {}, query, body, as } = {}) {
    const url = template.replace(/\{(\w+)\}/g, (_, key) => params[key]);
    let req = request(ctx.app)[method](url);
    if (as) req = req.set(as.headers);
    if (query) req = req.query(query);
    if (body !== undefined) req = req.send(body);
    const res = await req;

    const label = `${method.toUpperCase()} ${template} → ${res.status}`;
    covered.add(`${method.toUpperCase()} ${template}`);
    const documented = api.paths[template]?.[method]?.responses?.[String(res.status)];
    if (!documented) {
      failures.push(`${label} is not documented. Body: ${JSON.stringify(res.body).slice(0, 300)}`);
    } else {
      const schema = documented.content?.['application/json']?.schema;
      const error = schema && matches(schema, res.body);
      if (error) failures.push(`${label} body does not match the spec:\n${error}\nBody: ${JSON.stringify(res.body).slice(0, 500)}`);
    }
    return res;
  }

  // Fake AI provider: the contract is checked without Ollama.
  const aiProvider = {
    name: 'fake',
    model: 'fake-model',
    failing: false,
    async generate() {
      if (this.failing) throw new AiProviderError(AI_ERROR.UNAVAILABLE, 'fake outage');
      return { output: { answer: 'Your trip has one day with three museums.', places: [], suggestions: [] }, truncated: false, usage: {}, durationMs: 1 };
    },
    async checkHealth() {},
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp({ aiProvider });
    await ctx.reset();
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('exercises every operation; every response is documented and matches its schema', async () => {
    // --- health & auth ---
    await call('get', '/health');
    await call('get', '/ready');
    await call('get', '/api/v1');
    const registered = await call('post', '/api/v1/auth/register', { body: { name: 'Ayesha', email: 'ayesha@example.com', password: 'long enough password' } });
    expect(registered.status).toBe(201);
    await call('post', '/api/v1/auth/register', { body: { name: 'Ayesha', email: 'AYESHA@example.com', password: 'long enough password' } }); // 409
    await call('post', '/api/v1/auth/register', { body: { name: '', email: 'bad', password: 'x' } }); // 400
    const login = await call('post', '/api/v1/auth/login', { body: { email: 'ayesha@example.com', password: 'long enough password' } });
    await call('post', '/api/v1/auth/login', { body: { email: 'ayesha@example.com', password: 'wrong password' } }); // 401
    const refreshed = await call('post', '/api/v1/auth/refresh', { body: { refreshToken: login.body.data.tokens.refreshToken } });
    await call('post', '/api/v1/auth/refresh', { body: { refreshToken: login.body.data.tokens.refreshToken } }); // 401 (reused)
    await call('post', '/api/v1/auth/logout', { body: { refreshToken: refreshed.body.data.tokens.refreshToken } });
    const user = await ctx.signUp('user');
    const other = await ctx.signUp('other');
    const moderator = await ctx.signUp('moderator', 'moderator');
    await call('get', '/api/v1/auth/me', { as: user });
    await call('get', '/api/v1/auth/me'); // 401
    await call('patch', '/api/v1/auth/me', { as: other, body: { name: 'Other Person' } });
    await call('patch', '/api/v1/auth/me', { as: other, body: { email: 'user@example.com', currentPassword: 'long enough password' } }); // 409
    await call('patch', '/api/v1/auth/me', { as: other, body: { email: 'new-other@example.com' } }); // 400 password needed
    await call('patch', '/api/v1/auth/me', { body: { name: 'x' } }); // 401

    // --- catalogue ---
    await call('get', '/api/v1/categories');
    await call('get', '/api/v1/tags');

    // --- places ---
    const hours = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '18:00' }));
    const placeBody = (name, latitude, longitude) => ({
      name, description: 'Test place', category: 'museum', location: { latitude, longitude }, address: 'Dhaka', city: 'Dhaka',
      entryFee: 20, typicalVisitMinutes: 60, parkingAvailable: 'YES', petFriendly: 'NO', wheelchairAccessible: 'UNKNOWN',
      tags: ['history'], openingHours: hours,
    });
    const approved = [];
    for (const [i, [lat, lng]] of [[23.7536, 90.3994], [23.7450, 90.3800], [23.7600, 90.3850]].entries()) {
      approved.push((await call('post', '/api/v1/places', { as: moderator, body: placeBody(`Museum ${i}`, lat, lng) })).body.data);
    }
    const pending = (await call('post', '/api/v1/places', { as: user, body: placeBody('Pending place', 23.75, 90.39) })).body.data;
    const toReject = (await call('post', '/api/v1/places', { as: user, body: placeBody('To reject', 23.751, 90.391) })).body.data;
    await call('post', '/api/v1/places', { as: user, body: { name: 'x', category: 'museum', location: { latitude: 99, longitude: 0 } } }); // 400
    await call('post', '/api/v1/places', { body: placeBody('No auth', 23.75, 90.39) }); // 401

    await call('get', '/api/v1/places', { query: { category: 'museum', minRating: 1, page: 1, limit: 2 } });
    await call('get', '/api/v1/places', { query: { minRating: 9 } }); // 400
    await call('get', '/api/v1/places/nearby', { query: { latitude: 23.75, longitude: 90.39, radiusKm: 5 } });
    await call('get', '/api/v1/places/search', { query: { q: 'museum' } });
    await call('get', '/api/v1/places/mine', { as: user, query: { status: 'PENDING' } });
    await call('get', '/api/v1/places/{id}', { params: { id: approved[0].id } });
    await call('get', '/api/v1/places/{id}', { params: { id: pending.id } }); // 404 for anonymous
    await call('patch', '/api/v1/places/{id}', { as: user, params: { id: pending.id }, body: { description: 'Better description' } });
    await call('patch', '/api/v1/places/{id}', { as: user, params: { id: approved[0].id }, body: { name: 'Renamed' } }); // 403
    await call('get', '/api/v1/places/moderation', { as: moderator });
    await call('get', '/api/v1/places/moderation', { as: user }); // 403
    await call('post', '/api/v1/places/{id}/reject', { as: moderator, params: { id: toReject.id }, body: { reason: 'Duplicate' } });
    await call('post', '/api/v1/places/{id}/approve', { as: moderator, params: { id: pending.id }, body: { note: 'Verified' } });
    await call('post', '/api/v1/places/{id}/approve', { as: moderator, params: { id: pending.id }, body: {} }); // 409
    await call('get', '/api/v1/places/{id}/moderation-events', { as: user, params: { id: toReject.id } });
    await call('delete', '/api/v1/places/{id}', { as: user, params: { id: toReject.id } });

    // --- reviews ---
    const review = (await call('post', '/api/v1/places/{placeId}/reviews', { as: user, params: { placeId: approved[0].id }, body: { rating: 4, comment: 'Nice' } })).body.data;
    await call('post', '/api/v1/places/{placeId}/reviews', { as: user, params: { placeId: approved[0].id }, body: { rating: 5 } }); // 409
    await call('get', '/api/v1/places/{placeId}/reviews', { params: { placeId: approved[0].id } });
    await call('patch', '/api/v1/reviews/{id}', { as: user, params: { id: review.id }, body: { rating: 5 } });
    await call('patch', '/api/v1/reviews/{id}', { as: other, params: { id: review.id }, body: { rating: 1 } }); // 403
    await call('get', '/api/v1/places/{id}', { params: { id: approved[0].id } }); // rated place shape
    await call('get', '/api/v1/places/{placeId}/reviews/mine', { as: user, params: { placeId: approved[0].id } });
    await call('get', '/api/v1/places/{placeId}/reviews/mine', { as: other, params: { placeId: approved[0].id } }); // null
    await call('get', '/api/v1/places/{placeId}/reviews/mine', { params: { placeId: approved[0].id } }); // 401

    // --- saved places ---
    await call('post', '/api/v1/saved-places', { as: user, body: { placeId: approved[1].id } });
    await call('post', '/api/v1/saved-places', { as: user, body: { placeId: approved[1].id } }); // idempotent
    await call('post', '/api/v1/saved-places', { as: user, body: { placeId: toReject.id } }); // 409 archived
    await call('post', '/api/v1/saved-places', { as: other, body: { placeId: toReject.id } }); // 404 not visible
    await call('post', '/api/v1/saved-places', { as: user, body: { placeId: 'not-a-uuid' } }); // 400
    await call('get', '/api/v1/saved-places', { as: user });
    await call('get', '/api/v1/saved-places'); // 401
    await call('get', '/api/v1/saved-places/{placeId}', { as: user, params: { placeId: approved[1].id } });
    await call('delete', '/api/v1/saved-places/{placeId}', { as: user, params: { placeId: approved[1].id } });

    // --- recommendations ---
    await call('post', '/api/v1/recommendations', {
      body: { location: { latitude: 23.75, longitude: 90.39 }, searchRadiusKm: 5, interests: ['history'], budget: { amount: 500, type: 'total' }, parkingRequired: true, startDate: '2026-10-05' },
    });
    await call('post', '/api/v1/recommendations', { body: { location: { latitude: 23.75, longitude: 90.39 }, travelingWithPet: true, startDate: '2026-10-05' } }); // empty + suggestions

    // --- trips ---
    const tripBody = { title: 'Contract trip', startLocation: { latitude: 23.75, longitude: 90.39 }, startDate: '2026-10-05', durationDays: 1, searchRadiusKm: 5, budget: { amount: 1000, type: 'total' } };
    const trip = (await call('post', '/api/v1/trips', { as: user, body: tripBody })).body.data;
    await call('get', '/api/v1/trips', { as: user });
    await call('get', '/api/v1/trips/{id}', { as: user, params: { id: trip.id } });
    await call('get', '/api/v1/trips/{id}', { as: other, params: { id: trip.id } }); // 404
    await call('patch', '/api/v1/trips/{id}', { as: user, params: { id: trip.id }, body: { title: 'Renamed trip' } });

    // --- itineraries ---
    const itinerary = (await call('post', '/api/v1/itineraries/generate', { as: user, body: { tripId: trip.id } })).body.data;
    const impossible = (await call('post', '/api/v1/trips', { as: user, body: { ...tripBody, travelingWithPet: true } })).body.data;
    await call('post', '/api/v1/itineraries/generate', { as: user, body: { tripId: impossible.id } }); // 422
    await call('get', '/api/v1/itineraries', { as: user, query: { tripId: trip.id, current: 'true' } });
    await call('get', '/api/v1/itineraries/{id}', { as: user, params: { id: itinerary.id } });
    const [firstStop] = itinerary.days[0].stops;
    await call('patch', '/api/v1/itineraries/{id}', { as: user, params: { id: itinerary.id }, body: { days: [{ dayNumber: 1, placeIds: [firstStop.place.id] }] } });
    const v2 = (await call('post', '/api/v1/itineraries/{id}/regenerate', { as: user, params: { id: itinerary.id } })).body.data;
    await call('patch', '/api/v1/itineraries/{id}', { as: user, params: { id: itinerary.id }, body: { days: [{ dayNumber: 1, placeIds: [] }] } }); // 409
    await call('delete', '/api/v1/itineraries/{id}', { as: user, params: { id: v2.id } });

    // --- routing ---
    await call('post', '/api/v1/routing/optimize', {
      as: user,
      body: { start: { latitude: 23.75, longitude: 90.39 }, days: [{ date: '2026-10-05', placeIds: approved.map((p) => p.id) }] },
    });

    // --- AI Trip Assistant ---
    const assistant = (body, as = user) => call('post', '/api/v1/ai/trip-assistant', { as, body });
    await call('get', '/api/v1/ai/trip-assistant/status', { as: user });
    await call('get', '/api/v1/ai/trip-assistant/status'); // 401
    expect((await assistant({ itineraryId: itinerary.id, task: 'summarize' })).status).toBe(200);
    await assistant({ tripId: trip.id, task: 'question', question: 'What do I see first?' });
    await assistant({ tripId: impossible.id, task: 'summarize' }); // 422 no itinerary
    await assistant({ itineraryId: itinerary.id, task: 'summarize' }, other); // 404
    await assistant({ task: 'summarize' }); // 400
    await call('post', '/api/v1/ai/trip-assistant', { body: { itineraryId: itinerary.id, task: 'summarize' } }); // 401
    aiProvider.failing = true;
    expect((await assistant({ itineraryId: itinerary.id, task: 'summarize' })).status).toBe(503);
    aiProvider.failing = false;

    // --- deletions last ---
    await call('delete', '/api/v1/reviews/{id}', { as: user, params: { id: review.id } });
    await call('delete', '/api/v1/trips/{id}', { as: user, params: { id: trip.id } });

    // Revokes sessions, so it runs last.
    await call('post', '/api/v1/auth/change-password', { as: other, body: { currentPassword: 'wrong', newPassword: 'another long password' } }); // 400
    await call('post', '/api/v1/auth/change-password', { as: other, body: { currentPassword: 'long enough password', newPassword: 'another long password' } });
    await call('post', '/api/v1/auth/change-password', { body: { currentPassword: 'x', newPassword: 'another long password' } }); // 401

    // Password reset (also revokes sessions).
    await call('post', '/api/v1/auth/forgot-password', { body: { email: 'user@example.com' } });
    await call('post', '/api/v1/auth/forgot-password', { body: { email: 'nobody@example.com' } });
    await call('post', '/api/v1/auth/forgot-password', { body: { email: 'not an email' } }); // 400
    await vi.waitFor(() => expect(ctx.mailService.sent).toHaveLength(1));
    const resetToken = ctx.mailService.sent[0].text.match(/#token=([\w-]+)/)[1];
    await call('post', '/api/v1/auth/reset-password', { body: { token: resetToken, newPassword: 'reset long password' } });
    await call('post', '/api/v1/auth/reset-password', { body: { token: resetToken, newPassword: 'reset long password' } }); // 400 used

    expect(failures).toEqual([]);
    const missing = operations().map(({ method, template }) => `${method.toUpperCase()} ${template}`).filter((op) => !covered.has(op));
    expect(missing, 'operations never exercised').toEqual([]);
  });
});
