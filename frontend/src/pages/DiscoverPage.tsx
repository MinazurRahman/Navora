import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { catalogueApi, placesApi, type PlaceFilters } from '../api/endpoints';
import { MapView, type MapMarker } from '../components/MapView';
import { PlaceCard } from '../components/PlaceCard';
import { ChipGroup, EmptyState, ErrorNotice, Loading, Pagination } from '../components/ui';
import { requestDeviceLocation, setExploreLocation, useExploreLocation } from '../lib/location';
import { useTripDraft } from '../trip/tripDraft';

const RADIUS_OPTIONS = [2, 5, 10, 20, 50];

export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const here = useExploreLocation();
  const draft = useTripDraft();
  const [hovered, setHovered] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  const q = params.get('q') ?? '';
  const mode = q ? 'search' : params.get('sort') === 'newest' ? 'newest' : 'nearby';
  const categories = params.get('category')?.split(',').filter(Boolean) ?? [];
  const maxEntryFee = params.get('maxFee') ? Number(params.get('maxFee')) : undefined;
  const minRating = params.get('minRating') ? Number(params.get('minRating')) : undefined;
  const radiusKm = Number(params.get('radius') ?? 10);
  const page = Number(params.get('page') ?? 1);

  const [searchText, setSearchText] = useState(q);
  useEffect(() => setSearchText(q), [q]);

  // One helper to change URL filters; any filter change goes back to page 1.
  const update = (changes: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: catalogueApi.categories, staleTime: Infinity });

  const filters: PlaceFilters = { category: categories, maxEntryFee, minRating, page, limit: 20 };
  const placesQuery = useQuery({
    queryKey: ['places', mode, q, here.latitude, here.longitude, radiusKm, filters],
    queryFn: () => {
      if (mode === 'search') return placesApi.search({ ...filters, q });
      if (mode === 'newest') return placesApi.list(filters);
      return placesApi.nearby({ ...filters, latitude: here.latitude, longitude: here.longitude, radiusKm });
    },
    placeholderData: keepPreviousData,
  });

  const places = placesQuery.data?.data ?? [];
  const meta = placesQuery.data?.meta;

  const markers: MapMarker[] = [
    { id: 'here', position: here, label: here.label, tone: 'start' },
    ...places.map((p) => ({
      id: p.id,
      position: p.location,
      label: p.name,
      tone: (hovered === p.id || draft.some((d) => d.id === p.id) ? 'selected' : 'place') as MapMarker['tone'],
      onClick: () => document.getElementById(`place-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    })),
  ];

  function onSearch(event: FormEvent) {
    event.preventDefault();
    update({ q: searchText.trim() || null });
  }

  async function useMyLocation() {
    setLocationError(null);
    try {
      setExploreLocation(await requestDeviceLocation());
      update({ q: null, sort: null });
    } catch (err) {
      setLocationError((err as Error).message);
    }
  }

  return (
    <div className="discover">
      <section className="discover__intro">
        <h1>Find places worth the trip</h1>
        <form className="search" role="search" onSubmit={onSearch}>
          <label className="sr-only" htmlFor="search">
            Search places
          </label>
          <input
            id="search"
            type="search"
            placeholder="Search forts, cafés, parks, markets…"
            value={searchText}
            maxLength={100}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button className="btn btn--primary">Search</button>
        </form>
        <div className="where">
          <span>
            Exploring from <strong>{here.label}</strong>
          </span>
          <button className="link-btn" onClick={useMyLocation}>
            Use my location
          </button>
          <button className="link-btn" onClick={() => setPicking((p) => !p)} aria-pressed={picking}>
            {picking ? 'Click the map to choose' : 'Pick on map'}
          </button>
        </div>
        {locationError && <p className="field__error">{locationError}</p>}
      </section>

      <div className="discover__body">
        <section className={`discover__list ${mobileView === 'map' ? 'hide-mobile' : ''}`} aria-label="Places">
          <div className="filters">
            <div className="segmented" role="group" aria-label="Show">
              <button aria-pressed={mode === 'nearby'} onClick={() => update({ q: null, sort: null })}>
                Nearby
              </button>
              <button aria-pressed={mode === 'newest'} onClick={() => update({ q: null, sort: 'newest' })}>
                Newest
              </button>
              {mode === 'search' && <button aria-pressed>Results for “{q}”</button>}
            </div>

            <div className="filters__row">
              {mode === 'nearby' && (
                <label className="select">
                  <span>Within</span>
                  <select value={radiusKm} onChange={(e) => update({ radius: e.target.value })}>
                    {RADIUS_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r} km
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="select">
                <span>Rating</span>
                <select value={minRating ?? ''} onChange={(e) => update({ minRating: e.target.value || null })}>
                  <option value="">Any</option>
                  <option value="3">3+ stars</option>
                  <option value="4">4+ stars</option>
                  <option value="4.5">4.5+ stars</option>
                </select>
              </label>
              <label className="select">
                <span>Entry fee up to</span>
                <select value={maxEntryFee ?? ''} onChange={(e) => update({ maxFee: e.target.value || null })}>
                  <option value="">Any</option>
                  <option value="0">Free only</option>
                  <option value="50">৳50</option>
                  <option value="200">৳200</option>
                  <option value="500">৳500</option>
                </select>
              </label>
            </div>
            {(minRating !== undefined || maxEntryFee !== undefined) && (
              <p className="fine">Places with no reviews or an unknown fee are hidden by these filters.</p>
            )}

            {categoriesQuery.data && (
              <ChipGroup
                label="Categories"
                options={categoriesQuery.data.map((c) => ({ value: c.slug, label: c.name }))}
                selected={categories}
                onToggle={(slug) => {
                  const next = categories.includes(slug) ? categories.filter((c) => c !== slug) : [...categories, slug];
                  update({ category: next.join(',') || null });
                }}
              />
            )}
          </div>

          {placesQuery.isPending && <Loading label="Finding places" />}
          {placesQuery.isError && <ErrorNotice error={placesQuery.error} />}
          {placesQuery.isSuccess && places.length === 0 && (
            <EmptyState title="No places match">
              {mode === 'nearby'
                ? 'Try a wider radius, fewer filters, or another starting point.'
                : 'Try different words or fewer filters.'}
            </EmptyState>
          )}

          <div className={`place-list ${placesQuery.isFetching && !placesQuery.isPending ? 'is-refreshing' : ''}`}>
            {places.map((place) => (
              <div id={`place-${place.id}`} key={place.id}>
                <PlaceCard place={place} highlighted={hovered === place.id} onHover={setHovered} />
              </div>
            ))}
          </div>
          {meta && (
            <>
              <p className="fine">
                {meta.total} place{meta.total === 1 ? '' : 's'}
              </p>
              <Pagination meta={meta} onPage={(p) => update({ page: String(p) }, true)} />
            </>
          )}
        </section>

        <section className={`discover__map ${mobileView === 'list' ? 'hide-mobile' : ''}`} aria-label="Map">
          <MapView
            ariaLabel="Map of places"
            center={here}
            markers={markers}
            fit={!picking}
            onPick={
              picking
                ? (loc) => {
                    setExploreLocation({ ...loc, label: 'Chosen point', source: 'map' });
                    setPicking(false);
                    update({ q: null, sort: null });
                  }
                : undefined
            }
          />
        </section>
      </div>

      <div className="mobile-switch">
        <button className="btn btn--dark" onClick={() => setMobileView((v) => (v === 'list' ? 'map' : 'list'))}>
          {mobileView === 'list' ? 'Show map' : 'Show list'}
        </button>
      </div>
    </div>
  );
}
