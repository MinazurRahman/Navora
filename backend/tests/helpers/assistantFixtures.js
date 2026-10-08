// DTO fixtures shaped like the real services' output, for AI Trip Assistant unit tests.

// 2026-10-05 is a Monday.
export const MONDAY = '2026-10-05';
export const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'user' };
export const START = { latitude: 23.81234, longitude: 90.41234 };
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function place(n, overrides = {}) {
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

export function trip(overrides = {}) {
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

export function stop(n, order, overrides = {}) {
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

export function itinerary(overrides = {}) {
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

// One recommendation-engine result entry.
export const entry = (p, score, extra = {}) => ({
  place: p,
  score,
  breakdown: { interest: 100, proximity: 80 },
  reasons: ['Matches your interests: history'],
  warnings: [],
  ...extra,
});

export function recommendations(entries, meta = {}) {
  return {
    recommendations: entries,
    meta: { startDate: MONDAY, eligible: entries.length, excludedBy: { parking: 3 }, suggestions: [], ...meta },
  };
}

export const visible = (...places) => new Map(places.map((p) => [p.id, p]));
