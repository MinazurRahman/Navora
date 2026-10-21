import { describe, expect, it } from 'vitest';
import { place } from '../../test/fetchMock.js';
import { buildPlacePayload, initialPlaceForm, placeToForm, toPlaceFormErrors, validatePlaceForm } from './placeForm.js';

const filled = (overrides = {}) => ({
  ...initialPlaceForm(),
  name: ' Star Mosque ',
  category: 'religious_site',
  location: { latitude: 23.7154123456, longitude: 90.4011987654 },
  ...overrides,
});

describe('buildPlacePayload', () => {
  it('sends unknown values as unknown: null fee, UNKNOWN facilities, [] hours', () => {
    expect(buildPlacePayload(filled())).toEqual({
      name: 'Star Mosque',
      description: null,
      category: 'religious_site',
      location: { latitude: 23.715412, longitude: 90.401199 },
      address: null,
      city: 'Dhaka',
      entryFee: null,
      typicalVisitMinutes: null,
      parkingAvailable: 'UNKNOWN',
      petFriendly: 'UNKNOWN',
      wheelchairAccessible: 'UNKNOWN',
      accessibilityNotes: null,
      restrictions: null,
      tags: [],
      openingHours: [],
    });
  });

  it('sends free as 0, amounts as numbers and known hours sorted per day', () => {
    const hours = { ...initialPlaceForm().hours, 1: [{ opensAt: '15:00', closesAt: '20:00' }, { opensAt: '09:00', closesAt: '12:00' }], 5: [{ opensAt: '10:00', closesAt: '17:00' }] };
    expect(buildPlacePayload(filled({ feeMode: 'free' })).entryFee).toBe(0);
    const body = buildPlacePayload(filled({ feeMode: 'amount', entryFee: '20.5', typicalVisitMinutes: '45', hoursKnown: true, hours, parkingAvailable: 'YES' }));
    expect(body).toMatchObject({ entryFee: 20.5, typicalVisitMinutes: 45, parkingAvailable: 'YES' });
    expect(body.openingHours).toEqual([
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' },
      { dayOfWeek: 1, opensAt: '15:00', closesAt: '20:00' },
      { dayOfWeek: 5, opensAt: '10:00', closesAt: '17:00' },
    ]);
  });
});

describe('placeToForm', () => {
  it('round-trips a place from the API', () => {
    const fromApi = place({
      entryFee: 0,
      typicalVisitMinutes: 90,
      openingHours: [{ dayOfWeek: 2, opensAt: '10:00', closesAt: '17:00' }],
      facilities: { parking: 'YES', petFriendly: 'NO', wheelchairAccessible: 'UNKNOWN', accessibilityNotes: 'Ramp at gate 2', restrictions: null, verifiedAt: null },
    });
    const body = buildPlacePayload(placeToForm(fromApi));
    expect(body).toMatchObject({
      name: 'Lalbagh Fort',
      category: 'historical_site',
      entryFee: 0,
      typicalVisitMinutes: 90,
      parkingAvailable: 'YES',
      petFriendly: 'NO',
      wheelchairAccessible: 'UNKNOWN',
      accessibilityNotes: 'Ramp at gate 2',
      tags: ['history'],
      openingHours: [{ dayOfWeek: 2, opensAt: '10:00', closesAt: '17:00' }],
    });
  });
});

describe('validatePlaceForm', () => {
  it('requires a name, category and location', () => {
    expect(Object.keys(validatePlaceForm(initialPlaceForm())).sort()).toEqual(['category', 'location', 'name']);
    expect(validatePlaceForm(filled())).toEqual({});
  });

  it('checks the fee amount and visit length', () => {
    expect(validatePlaceForm(filled({ feeMode: 'amount', entryFee: '' })).entryFee).toBeDefined();
    expect(validatePlaceForm(filled({ feeMode: 'amount', entryFee: '20.555' })).entryFee).toBe('Use at most 2 decimal places.');
    expect(validatePlaceForm(filled({ typicalVisitMinutes: '3' })).typicalVisitMinutes).toBeDefined();
  });

  it('checks known opening hours like the backend: order, overlap and at least one day', () => {
    const week = initialPlaceForm().hours;
    expect(validatePlaceForm(filled({ hoursKnown: true })).openingHours).toMatch(/at least one day/);
    expect(validatePlaceForm(filled({ hoursKnown: true, hours: { ...week, 1: [{ opensAt: '18:00', closesAt: '09:00' }] } })).openingHours).toMatch(/^Monday: closing time/);
    expect(
      validatePlaceForm(filled({ hoursKnown: true, hours: { ...week, 3: [{ opensAt: '09:00', closesAt: '13:00' }, { opensAt: '12:00', closesAt: '18:00' }] } })).openingHours,
    ).toBe('Wednesday: time ranges overlap.');
    expect(validatePlaceForm(filled({ hoursKnown: true, hours: { ...week, 1: [{ opensAt: '09:00', closesAt: '17:00' }] } }))).toEqual({});
  });
});

describe('toPlaceFormErrors', () => {
  it('maps nested backend paths to form fields', () => {
    expect(toPlaceFormErrors({ 'location.latitude': 'Too big', 'openingHours.2.closesAt': 'Invalid', name: 'Too long' })).toEqual({
      location: 'Too big',
      openingHours: 'Invalid',
      name: 'Too long',
    });
  });
});
