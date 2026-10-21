import { Suspense, lazy, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { List, LocateFixed, Map as MapIcon, MapPin, Search, SearchX, X } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button } from '../../components/Button.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { Checkbox, Field, Select } from '../../components/Field.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { useCategories } from '../catalogue/api.js';
import { useExploreResults } from './api.js';
import { activeFilterCount, parseExploreParams, toSearchParams } from './exploreParams.js';
import { PlaceCard, PlaceCardSkeleton } from './PlaceCard.jsx';
import styles from './ExplorePage.module.css';

const PlacesMap = lazy(() => import('./PlacesMap.jsx'));

const SEARCH_DEBOUNCE_MS = 400;
const FEE_OPTIONS = [
  ['', 'Any entry fee'],
  ['0', 'Free entry only'],
  ['50', 'Up to BDT 50'],
  ['100', 'Up to BDT 100'],
  ['200', 'Up to BDT 200'],
  ['500', 'Up to BDT 500'],
];
const RATING_OPTIONS = [
  ['', 'Any rating'],
  ['3', '3 stars and above'],
  ['4', '4 stars and above'],
  ['4.5', '4.5 stars and above'],
];
const RADIUS_OPTIONS = [1, 2, 5, 10, 20, 50];

// Explore approved places: text search, nearby search and filters, with a synced map.
export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseExploreParams(searchParams);
  const results = useExploreResults(state);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState('list'); // small screens show the list or the map

  // Every change goes through here; anything but paging starts again at page 1.
  function update(changes, { replace = false } = {}) {
    const next = { ...state, page: 1, ...changes };
    setSearchParams(toSearchParams(next), { replace });
    setSelectedId(null);
  }

  const places = results.data?.data ?? [];
  const meta = results.data?.meta;
  const filterCount = activeFilterCount(state);

  return (
    <main className={`container ${styles.page}`}>
      <title>Explore places | NAVORA</title>
      <header className={styles.header}>
        <h1>Explore places</h1>
        <p className="muted">Approved places in Dhaka, from landmarks to community favourites.</p>
      </header>

      <SearchBar
        q={state.q}
        location={state.location}
        onSearch={(q, options) => update({ q, location: null }, options)}
        onLocate={(location) => update({ q: '', location })}
      />

      {state.location && (
        <div className={styles.locationBar}>
          <Badge tone="info" icon={MapPin}>
            Within {state.radiusKm} km of the selected point, closest first
          </Badge>
          <Button variant="ghost" size="sm" icon={X} onClick={() => update({ location: null })}>
            Clear location
          </Button>
        </div>
      )}

      <div className={styles.layout}>
        <div className={`${styles.listColumn} ${view === 'map' ? styles.hiddenOnSmall : ''}`}>
          <Filters state={state} filterCount={filterCount} onChange={update} />

          <ResultsHeader results={results} meta={meta} view={view} onViewChange={setView} />

          <Results
            state={state}
            results={results}
            places={places}
            filterCount={filterCount}
            selectedId={selectedId}
            onShowOnMap={(id) => {
              setSelectedId(id);
              setView('map');
            }}
            onClearFilters={() => update({ category: [], maxEntryFee: undefined, minRating: undefined })}
            onWiderRadius={() => update({ radiusKm: Math.min(50, state.radiusKm * 2) })}
          />

          {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onPage={(page) => update({ page })} />}
        </div>

        <div className={`${styles.mapColumn} ${view === 'list' ? styles.hiddenOnSmall : ''}`}>
          <div className={styles.smallOnly}>
            <ViewToggle view={view} onChange={setView} />
          </div>
          <Suspense fallback={<Skeleton height="100%" className={styles.mapFallback} />}>
            <PlacesMap
              places={places}
              selectedId={selectedId}
              onSelect={setSelectedId}
              center={state.location}
              radiusKm={state.radiusKm}
              onSearchArea={(location) => update({ q: '', location })}
            />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

function SearchBar({ q, location, onSearch, onLocate }) {
  const [text, setText] = useState(q);
  const [shownQ, setShownQ] = useState(q);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);

  // Follow the URL when it changes elsewhere (back button, category link).
  if (q !== shownQ) {
    setShownQ(q);
    setText(q);
  }

  // Search as the user types, after a pause. The URL entry is replaced, not pushed,
  // so Back does not step through every keystroke.
  const searchLater = useEffectEvent((value) => onSearch(value, { replace: true }));
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === q) return undefined;
    const timer = setTimeout(() => searchLater(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, q]);

  function locate() {
    if (!navigator.geolocation) {
      setLocationError('Your browser cannot share its location. Use "Search this area" on the map instead.');
      return;
    }
    setText(''); // a pending text search would otherwise replace the location search
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        onLocate({ latitude: coords.latitude, longitude: coords.longitude });
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? 'Location access was denied. Use "Search this area" on the map instead.'
            : 'Your location could not be found. Try again or use "Search this area" on the map.',
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div className={styles.searchArea}>
      <form
        role="search"
        className={styles.searchForm}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(text.trim());
        }}
      >
        <label htmlFor="explore-search" className="visually-hidden">
          Search places
        </label>
        <div className={styles.searchField}>
          <Search size={18} aria-hidden="true" className={styles.searchIcon} />
          <input
            id="explore-search"
            type="search"
            className={styles.searchInput}
            placeholder="Search by name or description"
            value={text}
            maxLength={100}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          icon={LocateFixed}
          loading={locating}
          onClick={locate}
          aria-pressed={Boolean(location)}
        >
          Near me
        </Button>
      </form>
      <p className={styles.searchHint}>
        {q
          ? 'Best matches first. Text search does not use distance.'
          : 'Search by text, or find places near you or on the map.'}
      </p>
      {locationError && <Alert tone="warning">{locationError}</Alert>}
    </div>
  );
}

function Filters({ state, filterCount, onChange }) {
  const categories = useCategories();
  // Collapsed by default so results stay above the fold; the summary shows the active count.
  const [open, setOpen] = useState(false);

  function toggleCategory(slug, checked) {
    onChange({ category: checked ? [...state.category, slug] : state.category.filter((s) => s !== slug) });
  }

  return (
    <details className={styles.filters} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={styles.filtersSummary}>
        Filters{filterCount > 0 && <span className={styles.filterCount}>{filterCount} active</span>}
      </summary>
      <div className={styles.filtersBody}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Category</legend>
          {categories.isPending && <Skeleton height="6rem" />}
          {categories.isError && <p className="muted">Categories could not be loaded.</p>}
          {categories.data && (
            <div className={styles.categoryGrid}>
              {categories.data.map((category) => (
                <Checkbox
                  key={category.slug}
                  label={category.name}
                  checked={state.category.includes(category.slug)}
                  onChange={(event) => toggleCategory(category.slug, event.target.checked)}
                />
              ))}
            </div>
          )}
        </fieldset>

        <div className={styles.selectRow}>
          <Field label="Entry fee" hint="Places with an unknown fee are left out.">
            {(props) => (
              <Select
                {...props}
                value={state.maxEntryFee ?? ''}
                onChange={(e) => onChange({ maxEntryFee: e.target.value === '' ? undefined : Number(e.target.value) })}
              >
                {FEE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rating" hint="Places without reviews are left out.">
            {(props) => (
              <Select
                {...props}
                value={state.minRating ?? ''}
                onChange={(e) => onChange({ minRating: e.target.value === '' ? undefined : Number(e.target.value) })}
              >
                {RATING_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {state.location && (
            <Field label="Distance">
              {(props) => (
                <Select {...props} value={state.radiusKm} onChange={(e) => onChange({ radiusKm: Number(e.target.value) })}>
                  {RADIUS_OPTIONS.map((km) => (
                    <option key={km} value={km}>
                      Within {km} km
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {filterCount > 0 && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => onChange({ category: [], maxEntryFee: undefined, minRating: undefined })}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function ViewToggle({ view, onChange }) {
  return (
    <div className={styles.viewToggle} role="group" aria-label="Show results as">
      <Button variant={view === 'list' ? 'primary' : 'secondary'} size="sm" icon={List} aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        List
      </Button>
      <Button variant={view === 'map' ? 'primary' : 'secondary'} size="sm" icon={MapIcon} aria-pressed={view === 'map'} onClick={() => onChange('map')}>
        Map
      </Button>
    </div>
  );
}

function ResultsHeader({ results, meta, view, onViewChange }) {
  return (
    <div className={styles.resultsHeader}>
      <p className={styles.count} aria-live="polite">
        {meta ? `${meta.total} place${meta.total === 1 ? '' : 's'}` : results.isError ? '' : 'Loading places'}
        {results.isFetching && meta && <span className="visually-hidden"> (updating)</span>}
      </p>
      <div className={styles.smallOnly}>
        <ViewToggle view={view} onChange={onViewChange} />
      </div>
    </div>
  );
}

function Results({ state, results, places, filterCount, selectedId, onShowOnMap, onClearFilters, onWiderRadius }) {
  const cards = useRef(new Map());

  // Keep the selected card visible when it was picked on the map.
  useEffect(() => {
    cards.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  if (results.isPending) {
    return (
      <ul className={styles.list} aria-busy="true" aria-label="Loading places">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i}>
            <PlaceCardSkeleton />
          </li>
        ))}
      </ul>
    );
  }

  if (results.isError && !results.data) {
    return <ErrorState error={results.error} onRetry={results.refetch} title="Places could not be loaded" />;
  }

  if (places.length === 0) {
    const notes = [];
    if (state.maxEntryFee !== undefined) notes.push('places with an unknown entry fee are not included');
    if (state.minRating !== undefined) notes.push('places without reviews are not included');
    return (
      <EmptyState
        icon={SearchX}
        title="No places match"
        description={
          notes.length ? `Try fewer filters: ${notes.join(', and ')}.` : state.q ? 'Try a different search.' : undefined
        }
        action={
          <div className="cluster">
            {filterCount > 0 && (
              <Button variant="secondary" onClick={onClearFilters}>
                Clear filters
              </Button>
            )}
            {state.location && state.radiusKm < 50 && (
              <Button variant="secondary" onClick={onWiderRadius}>
                Search within {Math.min(50, state.radiusKm * 2)} km
              </Button>
            )}
          </div>
        }
      />
    );
  }

  return (
    <ul className={`${styles.list} ${results.isPlaceholderData ? styles.stale : ''}`}>
      {places.map((place) => (
        <li key={place.id} ref={(el) => (el ? cards.current.set(place.id, el) : cards.current.delete(place.id))}>
          <PlaceCard
            place={place}
            selected={place.id === selectedId}
            action={
              <Button variant="ghost" size="sm" icon={MapPin} onClick={() => onShowOnMap(place.id)}>
                Show on map
              </Button>
            }
          />
        </li>
      ))}
    </ul>
  );
}
