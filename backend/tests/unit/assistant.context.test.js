import { describe, expect, it, vi } from 'vitest';
import { buildAssistantContext } from '../../src/modules/assistant/context.js';
import { createAssistantContextLoader } from '../../src/modules/assistant/contextLoader.js';
import { ASSISTANT_CONFIG as config } from '../../src/config/assistant.js';
import { NotFoundError, ValidationError } from '../../src/shared/errors/AppError.js';

// 2026-10-05 is a Monday.
const MONDAY = '2026-10-05';
const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'user' };
const START = { latitude: 23.81234, longitude: 90.41234 };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function place(n, overrides = {}) {
  return {
    id: id(n),
    name: `Place ${n}`,
    description: `About place ${n}`,
    category: { slug: 'museum', name: 'Museum' },
    location: { latitude: 23.7 + n / 1000, longitude: 90.4 },
    address: `${n} Hidden Lane`,
    entryFee: 50,
    currency: 'BDT',
    typicalVisitMinutes: 60,
    tags: ['history'],
    openingHours: [1, 2, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '17:00' })),
    facilities: { parking: 'YES', petFriendly: 'UNKNOWN', wheelchairAccessible: 'NO', accessibilityNotes: 'ramp', restrictions: null, verifiedAt: null },
    rating: { average: 4.5, count: 12 },
    status: 'APPROVED',
    createdBy: USER.id,
    distanceMeters: 1500,
    ...overrides,
  };
}

function trip(overrides = {}) {
  return {
    id: id(900),
    title: 'Dhaka weekend',
    startLocation: START,
    startAddress: '12 Secret Road',
    startDate: MONDAY,
    durationDays: 2,
    dailyStartTime: '09:00',
    dailyEndTime: '18:00',
    searchRadiusKm: 10,
    budget: { amount: 2000, type: 'total', currency: 'BDT' },
    travelMode: 'car',
    travelingWithPet: false,
    parkingRequired: true,
    wheelchairAccessRequired: false,
    partySize: 2,
    minimumRating: 4,
    interests: ['history'],
    preferredCategories: ['museum'],
    selectedPlaceIds: [id(2)],
    currentItineraryId: id(800),
    ...overrides,
  };
}

function stop(n, order, overrides = {}) {
  return {
    order,
    place: { id: id(n), name: `Place ${n}`, category: { slug: 'museum', name: 'Museum' }, location: { latitude: 23.7, longitude: 90.4 } },
    plannedStart: '10:00',
    plannedEnd: '11:00',
    visitMinutes: 60,
    travelFromPrevious: { minutes: 15, distanceMeters: 4250 },
    estimatedCost: 100,
    openingHoursVerified: true,
    ...overrides,
  };
}

function itinerary(overrides = {}) {
  return {
    id: id(800),
    tripId: id(900),
    version: 2,
    isCurrent: true,
    userModified: false,
    routing: { provider: 'openrouteservice', algorithm: 'nearest-neighbor+2opt', travelTimesEstimated: false },
    totals: { distanceMeters: 12_340, travelMinutes: 55, visitMinutes: 180, plannedMinutes: 300, estimatedCost: 200, currency: 'BDT' },
    days: [
      {
        dayNumber: 1,
        date: MONDAY,
        startTime: '09:45',
        endTime: '13:30',
        totals: { distanceMeters: 8_000, travelMinutes: 35, visitMinutes: 120, plannedMinutes: 225 },
        routePolyline: '_p~iF~ps|U_ulLnnqC',
        stops: [stop(1, 1), stop(2, 2, { plannedStart: '11:20', plannedEnd: '12:20' })],
      },
      {
        dayNumber: 2,
        date: '2026-10-06',
        startTime: '09:50',
        endTime: '11:40',
        totals: { distanceMeters: 4_340, travelMinutes: 20, visitMinutes: 60, plannedMinutes: 110 },
        routePolyline: null,
        stops: [stop(3, 1, { estimatedCost: null, openingHoursVerified: false })],
      },
    ],
    warnings: [
      { code: 'OPENING_HOURS_UNVERIFIED', message: 'Opening hours could not be verified.', placeId: id(3), dayNumber: 2 },
    ],
    generatedFrom: { trip: trip(), startDate: MONDAY, startDateAssumed: false, weights: {} },
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const entry = (p, score, extra = {}) => ({
  place: p,
  score,
  breakdown: { interest: 100, proximity: 80 },
  reasons: ['Matches your interests: history'],
  warnings: [],
  ...extra,
});

function recommendations(entries, meta = {}) {
  return {
    recommendations: entries,
    meta: { startDate: MONDAY, eligible: entries.length, excludedBy: { parking: 3 }, suggestions: [], ...meta },
  };
}

const visible = (...places) => new Map(places.map((p) => [p.id, p]));

function build(overrides = {}) {
  return buildAssistantContext({
    trip: trip(),
    startDate: MONDAY,
    startDateAssumed: false,
    itinerary: itinerary(),
    placesById: visible(place(1), place(2), place(3)),
    recommendations: recommendations([entry(place(5), 91), entry(place(1), 88), entry(place(3), 70)]),
    config,
    ...overrides,
  });
}

describe('buildAssistantContext: construction', () => {
  it('copies trip requirements, interests, budget, duration and travel mode', () => {
    const { context } = build();
    expect(context.schemaVersion).toBe(1);
    expect(context.trip).toEqual({
      title: 'Dhaka weekend',
      startDate: MONDAY,
      startDateAssumed: false,
      durationDays: 2,
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      travelMode: 'car',
      partySize: 2,
      searchRadiusKm: 10,
      budget: { amount: 2000, type: 'total', currency: 'BDT' },
      interests: ['history'],
      preferredCategories: ['museum'],
      requirements: { travelingWithPet: false, parkingRequired: true, wheelchairAccessRequired: false, minimumRating: 4 },
    });
  });

  it('describes itinerary stops with visit and travel durations, routing and selection', () => {
    const { context, refs } = build();
    expect(context.itinerary.routing).toEqual({ provider: 'openrouteservice', travelTimesEstimated: false, algorithm: 'nearest-neighbor+2opt' });
    expect(context.itinerary.totals).toEqual({ distanceKm: 12.3, travelMinutes: 55, visitMinutes: 180, plannedMinutes: 300, estimatedCost: 200, currency: 'BDT' });
    expect(context.itinerary.days[0].stops[1]).toEqual({
      place: 'P2',
      name: 'Place 2',
      category: 'Museum',
      plannedStart: '11:20',
      plannedEnd: '12:20',
      visitMinutes: 60,
      travelMinutesFromPrevious: 15,
      travelKmFromPrevious: 4.3,
      estimatedCost: 100,
      openingHoursVerified: true,
      selectedByUser: true,
    });
    expect(context.itinerary.days[0].stops[0].selectedByUser).toBe(false);
    expect(refs).toMatchObject({ P1: id(1), P2: id(2), P3: id(3) });
  });

  it("quotes the engine's scores and reasons without changing them", () => {
    const { context, refs } = build();
    expect(context.recommendations.results).toEqual([
      { place: 'P1', rank: 2, score: 88, breakdown: { interest: 100, proximity: 80 }, reasons: ['Matches your interests: history'], warnings: [], inItinerary: true },
      { place: 'P3', rank: 3, score: 70, breakdown: { interest: 100, proximity: 80 }, reasons: ['Matches your interests: history'], warnings: [], inItinerary: true },
      { place: 'P4', rank: 1, score: 91, breakdown: { interest: 100, proximity: 80 }, reasons: ['Matches your interests: history'], warnings: [], inItinerary: false },
    ]);
    expect(refs.P4).toBe(id(5));
    expect(context.recommendations).toMatchObject({ eligiblePlaces: 3, excludedBy: { parking: 3 }, suggestions: [] });
  });

  it('includes relevant place metadata only, with opening hours for the trip weekdays', () => {
    const { context } = build();
    expect(context.places.P1).toEqual({
      name: 'Place 1',
      category: 'Museum',
      description: 'About place 1',
      tags: ['history'],
      entryFee: 50,
      currency: 'BDT',
      typicalVisitMinutes: 60,
      rating: { average: 4.5, count: 12 },
      // Mon + Tue are trip days; Sunday's hours are left out.
      openingHours: [{ day: 'Mon', opens: '09:00', closes: '17:00' }, { day: 'Tue', opens: '09:00', closes: '17:00' }],
      facilities: { parking: 'YES', petFriendly: 'UNKNOWN', wheelchairAccessible: 'NO' },
    });
  });

  it('leaves out locations, addresses, polylines, user data and internal IDs', () => {
    const json = JSON.stringify(build().context);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no UUIDs (place, trip, itinerary, user)
    expect(json).not.toMatch(/Secret Road|Hidden Lane|23\.81|90\.41|_p~iF/);
    expect(json).not.toMatch(/latitude|longitude|createdBy|createdAt|password|token|accessibilityNotes/i);
  });

  it('keeps the context small: capped extra recommendations and truncated descriptions', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(place(100 + i), 90 - i));
    const { context } = build({
      recommendations: recommendations(many),
      placesById: visible(place(1, { description: 'x'.repeat(5_000) }), place(2), place(3)),
    });
    expect(context.recommendations.results).toHaveLength(config.maxRecommendations);
    expect(context.places.P1.description.length).toBe(config.maxDescriptionChars);
    expect(JSON.stringify(context).length).toBeLessThan(12_000);
  });
});

describe('buildAssistantContext: missing optional data', () => {
  it('keeps unknown values unknown (null / UNKNOWN / "unknown"), never filled in', () => {
    const bare = place(1, {
      description: null,
      entryFee: null,
      typicalVisitMinutes: null,
      tags: [],
      openingHours: [],
      rating: { average: null, count: 0 },
      facilities: { parking: 'UNKNOWN', petFriendly: 'UNKNOWN', wheelchairAccessible: 'UNKNOWN' },
    });
    const { context } = build({ placesById: visible(bare, place(2), place(3)) });
    expect(context.places.P1).toMatchObject({
      description: null,
      entryFee: null,
      typicalVisitMinutes: null,
      openingHours: 'unknown',
      rating: { average: null, count: 0 },
      facilities: { parking: 'UNKNOWN', petFriendly: 'UNKNOWN', wheelchairAccessible: 'UNKNOWN' },
    });
    expect(context.notes.join(' ')).toMatch(/never means yes, free or open/);
  });

  it('handles a trip without budget, minimum rating, start date, interests or selections', () => {
    const { context } = build({
      trip: trip({ budget: null, minimumRating: null, startDate: null, interests: [], preferredCategories: [], selectedPlaceIds: undefined }),
      startDate: '2026-10-08',
      startDateAssumed: true,
    });
    expect(context.trip).toMatchObject({ budget: null, startDate: '2026-10-08', startDateAssumed: true, interests: [], preferredCategories: [] });
    expect(context.trip.requirements.minimumRating).toBeNull();
    expect(context.itinerary.days.flatMap((d) => d.stops).every((s) => s.selectedByUser === false)).toBe(true);
  });

  it('works without recommendations (engine unavailable)', () => {
    const { context } = build({ recommendations: null });
    expect(context.recommendations).toBeNull();
    expect(Object.keys(context.places)).toEqual(['P1', 'P2', 'P3']);
    expect(context.notes.join(' ')).not.toMatch(/recommendation engine/);
  });

  it('keeps an unknown stop cost as null', () => {
    const { context } = build();
    expect(context.itinerary.days[1].stops[0]).toMatchObject({ place: 'P3', estimatedCost: null, openingHoursVerified: false });
  });
});

describe('buildAssistantContext: estimated routing', () => {
  it('flags estimated travel times and keeps the warning, with place refs instead of IDs', () => {
    const estimated = itinerary({
      routing: { provider: 'estimate', algorithm: 'nearest-neighbor+2opt', travelTimesEstimated: true },
      warnings: [
        { code: 'TRAVEL_TIMES_ESTIMATED', message: 'Road travel times were unavailable (TIMEOUT); travel times are distance-based estimates.' },
        { code: 'STOP_REMOVED_AFTER_ROUTING', message: 'Removed: actual travel times left no room for this visit.', placeId: id(7), dayNumber: 1 },
      ],
    });
    const { context, refs } = build({ itinerary: estimated, placesById: visible(place(1), place(2), place(3), place(7)) });

    expect(context.itinerary.routing).toMatchObject({ provider: 'estimate', travelTimesEstimated: true });
    expect(context.itinerary.warnings).toEqual([
      { code: 'TRAVEL_TIMES_ESTIMATED', message: 'Road travel times were unavailable (TIMEOUT); travel times are distance-based estimates.' },
      { code: 'STOP_REMOVED_AFTER_ROUTING', message: 'Removed: actual travel times left no room for this visit.', dayNumber: 1, place: 'P4' },
    ]);
    // The removed place is described so the assistant can name it.
    expect(refs.P4).toBe(id(7));
    expect(context.places.P4.name).toBe('Place 7');
    expect(context.notes).toContain('Travel times are distance-based estimates, not road routing data.');
  });

  it('does not add the estimate note for real routing data', () => {
    expect(build().context.notes.join(' ')).not.toMatch(/distance-based estimates/);
  });
});

describe('buildAssistantContext: empty recommendations', () => {
  it('returns an empty result list with the engine suggestions', () => {
    const { context } = build({
      recommendations: recommendations([], { eligible: 0, excludedBy: { parking: 12 }, suggestions: ['12 nearby places are not confirmed to have parking'] }),
    });
    expect(context.recommendations).toEqual({
      eligiblePlaces: 0,
      excludedBy: { parking: 12 },
      suggestions: ['12 nearby places are not confirmed to have parking'],
      results: [],
    });
  });
});

describe('buildAssistantContext: multiple itinerary days', () => {
  it('keeps every day in order, with refs assigned in visiting order across days', () => {
    const { context, refs } = build({ recommendations: null });
    expect(context.itinerary.days.map((d) => [d.dayNumber, d.date, d.stops.map((s) => s.place)])).toEqual([
      [1, MONDAY, ['P1', 'P2']],
      [2, '2026-10-06', ['P3']],
    ]);
    expect(context.itinerary.days[1]).toMatchObject({ startTime: '09:50', endTime: '11:40', distanceKm: 4.3, travelMinutes: 20, visitMinutes: 60 });
    expect(Object.keys(refs)).toEqual(['P1', 'P2', 'P3']);
  });

  it('does not repeat a place that appears on two days', () => {
    const repeated = itinerary({ warnings: [] });
    repeated.days[1].stops = [stop(1, 1)];
    const { context, refs } = build({ itinerary: repeated, recommendations: null });
    expect(context.itinerary.days[1].stops[0].place).toBe('P1');
    expect(Object.keys(refs)).toEqual(['P1', 'P2']);
  });
});

describe('buildAssistantContext: authorisation boundaries', () => {
  it('describes only places the user may see that are currently approved', () => {
    const { context } = build({
      // Place 2 is not visible to this user; place 3 was archived after planning.
      placesById: visible(place(1), place(3, { status: 'ARCHIVED' })),
      recommendations: null,
    });
    expect(Object.keys(context.places)).toEqual(['P1']);
    // Stops stay listed by name from the user's own itinerary.
    expect(context.itinerary.days[0].stops[1]).toMatchObject({ place: 'P2', name: 'Place 2' });
  });
});

describe('createAssistantContextLoader', () => {
  function services({ itineraryResult = itinerary(), tripResult = trip(), recommend } = {}) {
    return {
      itinerariesService: { get: vi.fn(async () => itineraryResult) },
      tripsService: { get: vi.fn(async () => tripResult) },
      placesService: { getVisibleByIds: vi.fn(async () => visible(place(1), place(2), place(3))) },
      recommendationsService: { recommend: vi.fn(recommend ?? (async () => recommendations([entry(place(1), 88)]))) },
    };
  }
  const loader = (deps) => createAssistantContextLoader({ ...deps, config });

  it('loads an itinerary through the owning services with the user, then builds the context', async () => {
    const deps = services();
    const { context, refs } = await loader(deps).forItinerary(id(800), USER);

    expect(deps.itinerariesService.get).toHaveBeenCalledWith(id(800), USER);
    expect(deps.placesService.getVisibleByIds).toHaveBeenCalledWith([id(1), id(2), id(3), id(3)], USER);
    expect(context.itinerary.version).toBe(2);
    expect(context.recommendations.results[0]).toMatchObject({ place: 'P1', score: 88 });
    expect(refs.P1).toBe(id(1));
  });

  it("asks the recommendation engine with the trip's own requirements, validated by its schema", async () => {
    const deps = services();
    await loader(deps).forItinerary(id(800), USER);
    expect(deps.recommendationsService.recommend).toHaveBeenCalledWith({
      location: START,
      searchRadiusKm: 10,
      interests: ['history'],
      preferredCategories: ['museum'],
      budget: { amount: 2000, type: 'total', currency: 'BDT' },
      durationDays: 2,
      startDate: MONDAY,
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      travelingWithPet: false,
      parkingRequired: true,
      wheelchairAccessRequired: false,
      minimumRating: 4,
      limit: config.recommendationCandidates,
    });
  });

  it("does not continue when the itinerary is not the user's (404 from the itineraries service)", async () => {
    const deps = services();
    deps.itinerariesService.get.mockRejectedValue(new NotFoundError('Itinerary not found', 'ITINERARY_NOT_FOUND'));
    await expect(loader(deps).forItinerary(id(800), USER)).rejects.toMatchObject({ status: 404, code: 'ITINERARY_NOT_FOUND' });
    expect(deps.placesService.getVisibleByIds).not.toHaveBeenCalled();
    expect(deps.recommendationsService.recommend).not.toHaveBeenCalled();
  });

  it('requires an authenticated user before calling any service', async () => {
    const deps = services();
    await expect(loader(deps).forItinerary(id(800), undefined)).rejects.toMatchObject({ status: 401 });
    await expect(loader(deps).forTrip(id(900), {})).rejects.toMatchObject({ status: 401 });
    expect(deps.itinerariesService.get).not.toHaveBeenCalled();
    expect(deps.tripsService.get).not.toHaveBeenCalled();
  });

  it('builds a trip context (no itinerary) through the trips service', async () => {
    const deps = services({ tripResult: trip({ startDate: null }), recommend: async () => recommendations([entry(place(1), 88)], { startDate: '2026-10-08' }) });
    const { context } = await loader(deps).forTrip(id(900), USER);

    expect(deps.tripsService.get).toHaveBeenCalledWith(id(900), USER);
    expect(deps.recommendationsService.recommend.mock.calls[0][0]).not.toHaveProperty('startDate');
    expect(context.itinerary).toBeNull();
    expect(context.trip).toMatchObject({ startDate: '2026-10-08', startDateAssumed: true });
    expect(context.recommendations.results).toEqual([expect.objectContaining({ place: 'P1', inItinerary: false })]);
  });

  it('propagates 404 for a trip the user does not own', async () => {
    const deps = services();
    deps.tripsService.get.mockRejectedValue(new NotFoundError('Trip not found', 'TRIP_NOT_FOUND'));
    await expect(loader(deps).forTrip(id(900), USER)).rejects.toMatchObject({ status: 404 });
    expect(deps.recommendationsService.recommend).not.toHaveBeenCalled();
  });

  it('continues without recommendations when the engine rejects the trip (e.g. a removed tag)', async () => {
    const deps = services({
      recommend: async () => {
        throw new ValidationError('Invalid request data', [{ location: 'body', path: 'interests.0', message: 'Unknown tag' }]);
      },
    });
    const { context } = await loader(deps).forItinerary(id(800), USER);
    expect(context.recommendations).toBeNull();
    expect(context.itinerary.days).toHaveLength(2);
  });

  it('does not hide unexpected engine failures', async () => {
    const deps = services({
      recommend: async () => {
        throw new Error('database down');
      },
    });
    await expect(loader(deps).forItinerary(id(800), USER)).rejects.toThrow('database down');
  });

  it('skips the engine when the saved trip no longer forms a valid request', async () => {
    const deps = services({ itineraryResult: itinerary({ generatedFrom: { trip: trip({ searchRadiusKm: 80 }), startDate: MONDAY, startDateAssumed: false } }) });
    const { context } = await loader(deps).forItinerary(id(800), USER);
    expect(deps.recommendationsService.recommend).not.toHaveBeenCalled();
    expect(context.recommendations).toBeNull();
  });
});
