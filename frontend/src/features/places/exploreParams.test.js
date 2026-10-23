import { describe, expect, it } from 'vitest';
import { exploreRequest, parseExploreParams, toSearchParams } from './exploreParams.js';

const parse = (query) => parseExploreParams(new URLSearchParams(query));

describe('explore params', () => {
  it('parses a full URL and round-trips it', () => {
    const state = parse('lat=23.81034&lng=90.41249&radiusKm=10&category=museum,park&maxEntryFee=100&minRating=4&facilities=petFriendly,parkingAvailable&page=2');
    expect(state).toEqual({
      q: '',
      category: ['museum', 'park'],
      maxEntryFee: 100,
      minRating: 4,
      facilities: ['petFriendly', 'parkingAvailable'],
      location: { latitude: 23.81034, longitude: 90.41249 },
      radiusKm: 10,
      page: 2,
    });
    expect(toSearchParams(state).toString()).toBe(
      'lat=23.81&lng=90.412&radiusKm=10&category=museum%2Cpark&maxEntryFee=100&minRating=4&facilities=petFriendly%2CparkingAvailable&page=2',
    );
  });

  it('drops invalid values instead of sending them to the API', () => {
    const state = parse('category=Museum,park,../x&maxEntryFee=-5&minRating=9&facilities=sauna,petFriendly&lat=200&lng=90&radiusKm=0&page=abc');
    expect(state).toMatchObject({ category: ['park'], facilities: ['petFriendly'], maxEntryFee: undefined, minRating: undefined, location: null, radiusKm: 5, page: 1 });
  });

  it('lets text search win over a location', () => {
    const state = parse('q=fort&lat=23.8&lng=90.4');
    expect(state.location).toBeNull();
    expect(exploreRequest(state)).toMatchObject({ mode: 'search', path: '/places/search', query: { q: 'fort' } });
  });

  it('chooses the endpoint for the state', () => {
    expect(exploreRequest(parse('')).path).toBe('/places');
    expect(exploreRequest(parse('lat=23.8&lng=90.4')).query).toMatchObject({ latitude: 23.8, longitude: 90.4, radiusKm: 5 });
    expect(exploreRequest(parse('facilities=wheelchairAccessible')).query).toMatchObject({ wheelchairAccessible: true });
  });
});
