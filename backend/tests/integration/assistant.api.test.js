import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createIntegrationApp, testDatabaseUrl } from '../helpers/integrationApp.js';
import { AI_ERROR, AiProviderError } from '../../src/integrations/ai/index.js';

const MONDAY = '2026-10-05';
const START = { latitude: 23.75, longitude: 90.39 };
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '18:00' }));
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

// Fake AI provider: records what it was sent and answers as each test sets it up. No Ollama.
const aiProvider = {
  name: 'fake',
  model: 'fake-model:1b',
  requests: [],
  reply: null, // async (request) => output
  async generate(req) {
    this.requests.push(req);
    return { output: await this.reply(req), truncated: false, usage: { promptTokens: 1, outputTokens: 1 }, durationMs: 1 };
  },
  async checkHealth() {},
};
const answer = (text, extra = {}) => async () => ({ answer: text, places: [], suggestions: [], ...extra });

describe.skipIf(!testDatabaseUrl)('AI Trip Assistant API (PostGIS)', () => {
  let ctx;
  let owner;
  let stranger;
  let moderator;

  const api = () => request(ctx.app);
  const as = (session) => ({
    get: (path) => api().get(path).set(session.headers),
    post: (path, body) => api().post(path).set(session.headers).send(body),
  });
  const ask = (session, body) => as(session).post('/api/v1/ai/trip-assistant', body);

  async function addPlace(name, latitude, longitude) {
    await as(moderator).post('/api/v1/places', {
      name, description: `${name} description`, category: 'museum', location: { latitude, longitude }, typicalVisitMinutes: 60,
      entryFee: 10, openingHours: ALL_WEEK, parkingAvailable: 'YES', tags: ['history'],
    });
  }

  async function newTrip(session = owner, overrides = {}) {
    const res = await as(session).post('/api/v1/trips', {
      title: 'Old Dhaka day', startLocation: START, startAddress: '12 Secret Road', startDate: MONDAY, durationDays: 1, searchRadiusKm: 3, interests: ['history'], ...overrides,
    });
    return res.body.data;
  }

  async function newItinerary(session = owner) {
    const trip = await newTrip(session);
    const res = await as(session).post('/api/v1/itineraries/generate', { tripId: trip.id });
    expect(res.status).toBe(201);
    return { trip, itinerary: res.body.data };
  }

  beforeAll(async () => {
    ctx = await createIntegrationApp({ aiProvider });
  });

  beforeEach(async () => {
    await ctx.reset();
    aiProvider.requests = [];
    aiProvider.reply = answer('Your day starts at North, then East.');
    owner = await ctx.signUp('owner');
    stranger = await ctx.signUp('stranger');
    moderator = await ctx.signUp('moderator', 'moderator');
    await addPlace('North', 23.7600, 90.3850);
    await addPlace('East', 23.7536, 90.3994);
    await addPlace('South', 23.7450, 90.3800);
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('answers an authenticated question about an itinerary the user owns', async () => {
    const { itinerary } = await newItinerary();
    aiProvider.reply = async () => ({ answer: 'Start with P1.', places: ['P1'], suggestions: [] });

    const res = await ask(owner, { itineraryId: itinerary.id, task: 'question', question: 'Where do I start?' });

    expect(res.status).toBe(200);
    const first = itinerary.days[0].stops[0].place;
    expect(res.body).toEqual({
      success: true,
      data: {
        task: 'question',
        itinerary: { id: itinerary.id, version: 1, isCurrent: true },
        answer: `Start with ${first.name}.`,
        truncated: false,
        places: [{ id: first.id, name: first.name }],
        suggestions: [],
        source: { generatedBy: 'ai' },
        disclaimer: expect.stringMatching(/AI-generated/),
      },
    });
  });

  it('answers about the current itinerary of a trip via tripId', async () => {
    const { trip, itinerary } = await newItinerary();
    const res = await ask(owner, { tripId: trip.id, task: 'summarize' });
    expect(res.status).toBe(200);
    expect(res.body.data.itinerary.id).toBe(itinerary.id);
  });

  it('sends the AI only the controlled context, and never returns the prompt', async () => {
    const { itinerary } = await newItinerary();
    const res = await ask(owner, { itineraryId: itinerary.id, task: 'summarize' });

    const [{ system, messages }] = aiProvider.requests;
    const prompt = system + messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('NAVORA CONTEXT');
    expect(prompt).toMatch(/North|East|South/);
    // No IDs, start address, coordinates, emails or tokens reach the model.
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|Secret Road|23\.75|90\.39|@example\.com|Bearer/);
    // The response carries no prompt or provider details.
    expect(JSON.stringify(res.body)).not.toMatch(/NAVORA CONTEXT|You are Navora|fake-model|"provider"/);
  });

  it('401 without a token, and the AI is never called', async () => {
    const { itinerary } = await newItinerary();
    const res = await api().post('/api/v1/ai/trip-assistant').send({ itineraryId: itinerary.id, task: 'summarize' });
    expect(res.status).toBe(401);
    expect(aiProvider.requests).toHaveLength(0);
  });

  it('400 for an invalid trip ID, 404 for an unknown one', async () => {
    expect((await ask(owner, { tripId: 'not-a-uuid', task: 'summarize' })).status).toBe(400);
    const unknown = await ask(owner, { tripId: UNKNOWN_ID, task: 'summarize' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('TRIP_NOT_FOUND');
    expect((await ask(owner, { itineraryId: UNKNOWN_ID, task: 'summarize' })).body.error.code).toBe('ITINERARY_NOT_FOUND');
  });

  it('404 for a trip or itinerary that belongs to another user; the AI sees nothing', async () => {
    const { trip, itinerary } = await newItinerary(owner);
    const byTrip = await ask(stranger, { tripId: trip.id, task: 'summarize' });
    const byItinerary = await ask(stranger, { itineraryId: itinerary.id, task: 'summarize' });

    expect(byTrip.status).toBe(404);
    expect(byTrip.body.error.code).toBe('TRIP_NOT_FOUND');
    expect(byItinerary.status).toBe(404);
    expect(byItinerary.body.error.code).toBe('ITINERARY_NOT_FOUND');
    expect(aiProvider.requests).toHaveLength(0);
  });

  it('400 for an invalid body, and for a place or day that is not in the itinerary', async () => {
    const { itinerary } = await newItinerary();
    expect((await ask(owner, { itineraryId: itinerary.id })).status).toBe(400);
    expect((await ask(owner, { itineraryId: itinerary.id, task: 'question' })).status).toBe(400);

    const otherPlace = await ask(owner, { itineraryId: itinerary.id, task: 'explain_place', placeId: UNKNOWN_ID });
    expect(otherPlace.status).toBe(400);
    expect(otherPlace.body.error.details).toEqual([expect.objectContaining({ path: 'placeId' })]);
    const otherDay = await ask(owner, { itineraryId: itinerary.id, task: 'summarize', dayNumber: 5 });
    expect(otherDay.status).toBe(400);
    expect(aiProvider.requests).toHaveLength(0);
  });

  it('422 ITINERARY_NOT_GENERATED for a trip without an itinerary', async () => {
    const trip = await newTrip();
    const res = await ask(owner, { tripId: trip.id, task: 'summarize' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITINERARY_NOT_GENERATED');
  });

  it.each([
    ['unavailable', AI_ERROR.UNAVAILABLE, 'UNAVAILABLE'],
    ['timed out', AI_ERROR.TIMEOUT, 'TIMEOUT'],
    ['model missing', AI_ERROR.MODEL_NOT_FOUND, 'UNAVAILABLE'],
  ])('503 AI_UNAVAILABLE when the provider is %s, without internals; the app keeps working', async (_label, kind, reason) => {
    const { itinerary } = await newItinerary();
    aiProvider.reply = async () => {
      throw new AiProviderError(kind, 'connect ECONNREFUSED 10.0.0.5:11434 (llama3.2:3b)');
    };

    const res = await ask(owner, { itineraryId: itinerary.id, task: 'summarize' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'AI_UNAVAILABLE', details: { reason } });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|11434|llama|10\.0\.0\.5/);

    // The rest of Navora is unaffected.
    expect((await as(owner).get(`/api/v1/itineraries/${itinerary.id}`)).status).toBe(200);
  });

  it('503 when the AI reply is empty or malformed (never a 200 for a failed answer)', async () => {
    const { itinerary } = await newItinerary();
    aiProvider.reply = answer('   ');
    expect((await ask(owner, { itineraryId: itinerary.id, task: 'summarize' })).status).toBe(503);
    aiProvider.reply = async () => 'not an object';
    expect((await ask(owner, { itineraryId: itinerary.id, task: 'summarize' })).status).toBe(503);
  });

  it('returns grounded suggestions with real place IDs and changes nothing', async () => {
    const { itinerary } = await newItinerary();
    const [firstStop] = itinerary.days[0].stops;
    aiProvider.reply = async () => ({
      answer: 'One idea.',
      places: ['P1', 'P99'],
      suggestions: [
        { type: 'REMOVE_STOP', place: 'P1', rationale: 'Saves travel time.' },
        { type: 'REMOVE_STOP', place: 'P99', rationale: 'Invented place.' },
      ],
    });

    const res = await ask(owner, { itineraryId: itinerary.id, task: 'suggest_adjustments' });
    expect(res.status).toBe(200);
    expect(res.body.data.places).toEqual([{ id: firstStop.place.id, name: firstStop.place.name }]);
    expect(res.body.data.suggestions).toEqual([
      { type: 'REMOVE_STOP', placeId: firstStop.place.id, placeName: firstStop.place.name, rationale: 'Saves travel time.' },
    ]);

    // Read-only: the itinerary is exactly as before.
    const after = (await as(owner).get(`/api/v1/itineraries/${itinerary.id}`)).body.data;
    expect(after).toEqual(itinerary);
  });

  it('reports status as available when the provider is healthy', async () => {
    const res = await as(owner).get('/api/v1/ai/trip-assistant/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: true, available: true });
  });
});
