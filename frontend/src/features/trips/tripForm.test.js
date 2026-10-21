import { describe, expect, it } from 'vitest';
import { buildTripPayload, firstStepWithError, initialForm, toFormErrors, todayInDhaka, validateStep } from './tripForm.js';

const filled = (overrides = {}) => ({
  ...initialForm(),
  title: '  Old Dhaka weekend ',
  location: { latitude: 23.81034567891, longitude: 90.41251234567 },
  ...overrides,
});

describe('buildTripPayload', () => {
  it('builds the exact TripFields body, with empty optional values as null', () => {
    expect(buildTripPayload(filled())).toEqual({
      title: 'Old Dhaka weekend',
      startLocation: { latitude: 23.810346, longitude: 90.412512 },
      startAddress: null,
      startDate: null,
      durationDays: 2,
      dailyStartTime: '09:00',
      dailyEndTime: '20:00',
      searchRadiusKm: 10,
      budget: null,
      travelMode: 'car',
      travelingWithPet: false,
      parkingRequired: false,
      wheelchairAccessRequired: false,
      partySize: 1,
      minimumRating: null,
      interests: [],
      preferredCategories: [],
      selectedPlaceIds: [],
    });
  });

  it('includes every choice the user made', () => {
    const body = buildTripPayload(
      filled({
        startAddress: ' Hotel in Gulshan ',
        startDate: '2026-11-02',
        durationDays: '14',
        budgetAmount: '3000',
        budgetType: 'per_day',
        partySize: '3',
        minimumRating: '4',
        travelMode: 'public_transport',
        parkingRequired: true,
        interests: ['history'],
        preferredCategories: ['museum'],
        selectedPlaceIds: ['p1'],
      }),
    );
    expect(body).toMatchObject({
      startAddress: 'Hotel in Gulshan',
      startDate: '2026-11-02',
      durationDays: 14,
      budget: { amount: 3000, type: 'per_day' },
      partySize: 3,
      minimumRating: 4,
      travelMode: 'public_transport',
      parkingRequired: true,
      interests: ['history'],
      preferredCategories: ['museum'],
      selectedPlaceIds: ['p1'],
    });
  });
});

describe('validateStep', () => {
  const today = '2026-10-21';

  it('requires a title, a start point and 1 to 14 days', () => {
    const errors = validateStep('basics', { ...initialForm(), durationDays: '15' }, today);
    expect(Object.keys(errors).sort()).toEqual(['durationDays', 'location', 'title']);
    expect(validateStep('basics', filled({ durationDays: '0' }), today).durationDays).toBeDefined();
    expect(validateStep('basics', filled({ durationDays: '1.5' }), today).durationDays).toBeDefined();
    expect(validateStep('basics', filled({ durationDays: '14' }), today)).toEqual({});
  });

  it('allows no start date or today, but not a past date', () => {
    expect(validateStep('basics', filled({ startDate: '' }), today)).toEqual({});
    expect(validateStep('basics', filled({ startDate: today }), today)).toEqual({});
    expect(validateStep('basics', filled({ startDate: '2026-10-20' }), today).startDate).toBeDefined();
  });

  it('requires the day to end after it starts', () => {
    expect(validateStep('basics', filled({ dailyStartTime: '18:00', dailyEndTime: '09:00' }), today).dailyEndTime).toBeDefined();
    expect(validateStep('basics', filled({ dailyStartTime: '09:00', dailyEndTime: '09:00' }), today).dailyEndTime).toBeDefined();
  });

  it('checks budget and party size', () => {
    expect(validateStep('travel', filled({ budgetAmount: '-1' })).budgetAmount).toBeDefined();
    expect(validateStep('travel', filled({ budgetAmount: '' }))).toEqual({});
    expect(validateStep('travel', filled({ partySize: '51' })).partySize).toBeDefined();
  });

  it('limits choices to what the backend accepts', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `slug_${i}`);
    expect(validateStep('interests', filled({ interests: eleven })).interests).toBeDefined();
    expect(validateStep('places', filled({ preferredCategories: eleven })).preferredCategories).toBeDefined();
  });
});

describe('server errors', () => {
  it('map backend paths to form fields and the first step that has them', () => {
    const errors = toFormErrors({ 'budget.amount': 'Too big', 'startLocation.latitude': 'Too big', interests: 'Unknown interest' });
    expect(errors).toEqual({ budgetAmount: 'Too big', location: 'Too big', interests: 'Unknown interest' });
    expect(firstStepWithError(errors)).toBe('basics');
    expect(firstStepWithError({ partySize: 'x' })).toBe('travel');
    expect(firstStepWithError({})).toBeNull();
  });
});

describe('todayInDhaka', () => {
  it('uses the Dhaka date', () => {
    expect(todayInDhaka(new Date('2026-10-21T19:00:00Z'))).toBe('2026-10-22'); // 01:00 next day in Dhaka
  });
});
