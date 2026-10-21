// Explore's search state lives in the URL so results can be shared and survive reloads.
//   q            text search (/places/search). Mutually exclusive with a location.
//   lat, lng     search near a point (/places/nearby), rounded to ~110 m like the backend.
//   radiusKm     with lat/lng only; 0 < r <= 50, default 5.
//   category     comma-separated category slugs.
//   maxEntryFee  known fee at most this (unknown fees are excluded by the backend).
//   minRating    average rating at least this (unrated places are excluded).
//   page         1-based.
export const DEFAULT_RADIUS_KM = 5;
export const PAGE_SIZE = 20;
const SLUG = /^[a-z0-9_]{1,50}$/;

function toNumber(value, { min, max, minExclusive = false } = {}) {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (min !== undefined && (minExclusive ? n <= min : n < min)) return undefined;
  if (max !== undefined && n > max) return undefined;
  return n;
}

export const roundCoordinate = (value) => Math.round(value * 1000) / 1000;

export function parseExploreParams(searchParams) {
  const q = (searchParams.get('q') ?? '').trim().slice(0, 100);
  const lat = toNumber(searchParams.get('lat'), { min: -90, max: 90 });
  const lng = toNumber(searchParams.get('lng'), { min: -180, max: 180 });
  const hasLocation = !q && lat !== undefined && lng !== undefined;
  const page = Math.floor(toNumber(searchParams.get('page'), { min: 1, max: 1000 }) ?? 1);

  return {
    q,
    category: (searchParams.get('category') ?? '').split(',').filter((slug) => SLUG.test(slug)),
    maxEntryFee: toNumber(searchParams.get('maxEntryFee'), { min: 0 }),
    minRating: toNumber(searchParams.get('minRating'), { min: 1, max: 5 }),
    location: hasLocation ? { latitude: lat, longitude: lng } : null,
    radiusKm: toNumber(searchParams.get('radiusKm'), { min: 0, minExclusive: true, max: 50 }) ?? DEFAULT_RADIUS_KM,
    page,
  };
}

// Inverse of parseExploreParams; defaults are left out to keep URLs short.
export function toSearchParams({ q, category, maxEntryFee, minRating, location, radiusKm, page }) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (!q && location) {
    params.set('lat', String(roundCoordinate(location.latitude)));
    params.set('lng', String(roundCoordinate(location.longitude)));
    if (radiusKm !== DEFAULT_RADIUS_KM) params.set('radiusKm', String(radiusKm));
  }
  if (category?.length) params.set('category', category.join(','));
  if (maxEntryFee !== undefined) params.set('maxEntryFee', String(maxEntryFee));
  if (minRating !== undefined) params.set('minRating', String(minRating));
  if (page > 1) params.set('page', String(page));
  return params;
}

// Which endpoint answers this state, and with which query parameters.
export function exploreRequest({ q, category, maxEntryFee, minRating, location, radiusKm, page }) {
  const filters = { category, maxEntryFee, minRating, page, limit: PAGE_SIZE };
  if (q) return { mode: 'search', path: '/places/search', query: { q, ...filters } };
  if (location) {
    return {
      mode: 'nearby',
      path: '/places/nearby',
      query: { latitude: location.latitude, longitude: location.longitude, radiusKm, ...filters },
    };
  }
  return { mode: 'list', path: '/places', query: filters };
}

export function activeFilterCount({ category, maxEntryFee, minRating }) {
  return category.length + (maxEntryFee !== undefined ? 1 : 0) + (minRating !== undefined ? 1 : 0);
}
