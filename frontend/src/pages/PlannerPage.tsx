// Trip planner. Covers both PRD flows:
//   Flow A — places picked while browsing arrive as "must include" (selectedPlaceIds);
//   Flow B — no picks: Navora chooses places from the requirements.
// /plan creates a trip; /trips/:id/edit changes one (then the trip page regenerates).

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogueApi, placesApi, recommendationsApi, tripsApi } from '../api/endpoints';
import type { Recommendation, RecommendationMeta, TravelMode, Trip, TripInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { MapView, type MapMarker } from '../components/MapView';
import { ChipGroup, ErrorNotice, Field, Loading, Notice, Toggle } from '../components/ui';
import { fieldErrors } from '../lib/errors';
import { formatDistance, TRAVEL_MODE_LABEL, todayInDhaka } from '../lib/format';
import { requestDeviceLocation, useExploreLocation } from '../lib/location';
import { MAX_SELECTED_PLACES, tripDraft, useTripDraft, type DraftPlace } from '../trip/tripDraft';

interface PlannerForm {
  title: string;
  latitude: number;
  longitude: number;
  startAddress: string;
  startDate: string;
  durationDays: number;
  dailyStartTime: string;
  dailyEndTime: string;
  searchRadiusKm: number;
  budgetAmount: string;
  budgetType: 'total' | 'per_day';
  travelMode: TravelMode;
  travelingWithPet: boolean;
  parkingRequired: boolean;
  wheelchairAccessRequired: boolean;
  partySize: number;
  minimumRating: string;
  interests: string[];
  preferredCategories: string[];
}

const FORM_STORAGE = 'navora.plannerForm';

function fromTrip(trip: Trip): PlannerForm {
  return {
    title: trip.title,
    latitude: trip.startLocation.latitude,
    longitude: trip.startLocation.longitude,
    startAddress: trip.startAddress ?? '',
    startDate: trip.startDate ?? '',
    durationDays: trip.durationDays,
    dailyStartTime: trip.dailyStartTime,
    dailyEndTime: trip.dailyEndTime,
    searchRadiusKm: trip.searchRadiusKm,
    budgetAmount: trip.budget ? String(trip.budget.amount) : '',
    budgetType: trip.budget?.type ?? 'total',
    travelMode: trip.travelMode,
    travelingWithPet: trip.travelingWithPet,
    parkingRequired: trip.parkingRequired,
    wheelchairAccessRequired: trip.wheelchairAccessRequired,
    partySize: trip.partySize,
    minimumRating: trip.minimumRating === null ? '' : String(trip.minimumRating),
    interests: trip.interests,
    preferredCategories: trip.preferredCategories,
  };
}

function toTripInput(form: PlannerForm, selectedPlaceIds: string[]): TripInput {
  const budget = form.budgetAmount.trim() === '' ? null : { amount: Number(form.budgetAmount), type: form.budgetType };
  return {
    title: form.title.trim(),
    startLocation: { latitude: form.latitude, longitude: form.longitude },
    startAddress: form.startAddress.trim() || null,
    startDate: form.startDate || null,
    durationDays: form.durationDays,
    dailyStartTime: form.dailyStartTime,
    dailyEndTime: form.dailyEndTime,
    searchRadiusKm: form.searchRadiusKm,
    budget,
    travelMode: form.travelMode,
    travelingWithPet: form.travelingWithPet,
    parkingRequired: form.parkingRequired,
    wheelchairAccessRequired: form.wheelchairAccessRequired,
    partySize: form.partySize,
    minimumRating: form.minimumRating === '' ? null : Number(form.minimumRating),
    interests: form.interests,
    preferredCategories: form.preferredCategories,
    selectedPlaceIds,
  };
}

export function PlannerPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id!), enabled: editing });

  if (editing && tripQuery.isPending) return <div className="page"><Loading label="Loading trip" /></div>;
  if (editing && tripQuery.isError) return <div className="page narrow"><ErrorNotice error={tripQuery.error} /></div>;
  return <PlannerFormView trip={tripQuery.data} key={tripQuery.data?.id ?? 'new'} />;
}

function PlannerFormView({ trip }: { trip?: Trip }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const here = useExploreLocation();
  const draft = useTripDraft();

  const [form, setForm] = useState<PlannerForm>(() => {
    if (trip) return fromTrip(trip);
    try {
      const saved = sessionStorage.getItem(FORM_STORAGE);
      if (saved) return JSON.parse(saved) as PlannerForm;
    } catch {
      /* ignore */
    }
    return {
      title: '',
      latitude: here.latitude,
      longitude: here.longitude,
      startAddress: here.source === 'default' ? '' : here.label,
      startDate: todayInDhaka(),
      durationDays: 2,
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      searchRadiusKm: 10,
      budgetAmount: '',
      budgetType: 'total',
      travelMode: 'car',
      travelingWithPet: false,
      parkingRequired: false,
      wheelchairAccessRequired: false,
      partySize: 1,
      minimumRating: '',
      interests: [],
      preferredCategories: [],
    };
  });

  // Keep an unfinished new plan if the traveller goes off to sign in.
  useEffect(() => {
    if (!trip) {
      try {
        sessionStorage.setItem(FORM_STORAGE, JSON.stringify(form));
      } catch {
        /* ignore */
      }
    }
  }, [form, trip]);

  // Picked places: the browsing draft for a new trip; the trip's own list when editing.
  const [editPicks, setEditPicks] = useState<string[]>(trip?.selectedPlaceIds ?? []);
  const selectedIds = trip ? editPicks : draft.map((p) => p.id);
  const pickedQuery = useQuery({
    queryKey: ['picked-places', editPicks],
    queryFn: () => Promise.all(editPicks.map((pid) => placesApi.get(pid).catch(() => null))),
    enabled: Boolean(trip) && editPicks.length > 0,
  });
  const pickedPlaces: DraftPlace[] = trip
    ? (pickedQuery.data ?? [])
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => ({ id: p.id, name: p.name, category: p.category.name, location: p.location }))
    : draft;

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: catalogueApi.tags, staleTime: Infinity });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: catalogueApi.categories, staleTime: Infinity });

  const set = <K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = (key: 'interests' | 'preferredCategories', value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value].slice(0, 10),
    }));

  const [localError, setLocalError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const input = toTripInput(form, selectedIds);
      return trip ? tripsApi.update(trip.id, input) : tripsApi.create(input);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.setQueryData(['trip', saved.id], saved);
      if (!trip) {
        tripDraft.clear();
        try {
          sessionStorage.removeItem(FORM_STORAGE);
        } catch {
          /* ignore */
        }
      }
      // The trip page generates (new trip) or regenerates (edited trip) the itinerary.
      navigate(`/trips/${saved.id}?generate=1`);
    },
  });

  // Recommendations preview (no sign-in needed; rate limited to 20/min, so only on click).
  const [preview, setPreview] = useState<{ data: Recommendation[]; meta: RecommendationMeta } | null>(null);
  const recommend = useMutation({
    mutationFn: () => {
      const input = toTripInput(form, selectedIds);
      return recommendationsApi.recommend({
        location: input.startLocation!,
        searchRadiusKm: input.searchRadiusKm,
        interests: input.interests,
        preferredCategories: input.preferredCategories,
        budget: input.budget ?? undefined,
        durationDays: input.durationDays,
        startDate: input.startDate ?? undefined,
        dailyStartTime: input.dailyStartTime,
        dailyEndTime: input.dailyEndTime,
        travelingWithPet: input.travelingWithPet,
        parkingRequired: input.parkingRequired,
        wheelchairAccessRequired: input.wheelchairAccessRequired,
        minimumRating: input.minimumRating ?? undefined,
        limit: 12,
      });
    },
    onSuccess: setPreview,
  });

  function validate(): string | null {
    if (!form.title.trim()) return 'Give your trip a name.';
    if (form.dailyStartTime >= form.dailyEndTime) return 'The day must start before it ends.';
    if (form.budgetAmount && !(Number(form.budgetAmount) >= 0)) return 'Budget must be a number.';
    if (form.durationDays < 1 || form.durationDays > 14) return 'Trips can be 1 to 14 days.';
    return null;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validate();
    setLocalError(problem);
    if (problem) return;
    if (!user) {
      navigate('/login', { state: { from: '/plan' } });
      return;
    }
    save.mutate();
  }

  const fields = fieldErrors(save.error);
  const start = { latitude: form.latitude, longitude: form.longitude };
  const markers: MapMarker[] = [
      { id: 'start', position: start, label: 'Trip start', tone: 'start' },
      ...pickedPlaces.map((p) => ({ id: p.id, position: p.location, label: p.name, tone: 'selected' as const })),
      ...(preview?.data ?? [])
        .filter((r) => !selectedIds.includes(r.place.id))
        .map((r) => ({ id: `rec-${r.place.id}`, position: r.place.location, label: r.place.name, tone: 'place' as const })),
  ];

  return (
    <div className="page planner">
      <header className="page__head">
        <h1>{trip ? `Edit “${trip.title}”` : 'Plan a trip'}</h1>
        <p className="muted measure">
          Tell Navora how long you have and what matters. It picks places that fit, orders each day to avoid
          backtracking, and checks opening hours and travel time.
        </p>
      </header>

      <form className="planner__grid" onSubmit={onSubmit} noValidate>
        <div className="planner__form">
          <fieldset className="panel">
            <legend>The basics</legend>
            <Field label="Trip name" error={fields.title}>
              <input
                value={form.title}
                maxLength={150}
                placeholder="Old Dhaka weekend"
                onChange={(e) => set('title', e.target.value)}
              />
            </Field>

            <div className="field">
              <span className="field__label">How many days?</span>
              <div className="segmented" role="group" aria-label="Trip length">
                {[1, 2, 3].map((n) => (
                  <button type="button" key={n} aria-pressed={form.durationDays === n} onClick={() => set('durationDays', n)}>
                    {n} day{n > 1 ? 's' : ''}
                  </button>
                ))}
                <label className="segmented__custom">
                  <span className="sr-only">Custom number of days</span>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={form.durationDays}
                    onChange={(e) => set('durationDays', Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
                  />
                  <span aria-hidden>days</span>
                </label>
              </div>
            </div>

            <div className="grid-3">
              <Field label="First day" hint="Leave empty to start today.">
                <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
              </Field>
              <Field label="Day starts">
                <input type="time" value={form.dailyStartTime} onChange={(e) => set('dailyStartTime', e.target.value)} />
              </Field>
              <Field label="Day ends" error={fields.dailyEndTime}>
                <input type="time" value={form.dailyEndTime} onChange={(e) => set('dailyEndTime', e.target.value)} />
              </Field>
            </div>

            <div className="field">
              <span className="field__label">Starting point</span>
              <span className="field__hint">Click the map to move it. Each day starts and ends here.</span>
              <MapView
                ariaLabel="Choose the trip's starting point"
                className="map--picker-sm"
                center={start}
                markers={markers}
                onPick={(loc) => setForm((f) => ({ ...f, latitude: loc.latitude, longitude: loc.longitude }))}
              />
              <div className="row">
                <input
                  aria-label="Starting point name (optional)"
                  placeholder="Name this place, e.g. Hotel in Banani (optional)"
                  value={form.startAddress}
                  maxLength={300}
                  onChange={(e) => set('startAddress', e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={async () => {
                    setLocationError(null);
                    try {
                      const loc = await requestDeviceLocation();
                      setForm((f) => ({ ...f, latitude: loc.latitude, longitude: loc.longitude }));
                    } catch (err) {
                      setLocationError((err as Error).message);
                    }
                  }}
                >
                  Use my location
                </button>
              </div>
              {locationError && <span className="field__error">{locationError}</span>}
            </div>
          </fieldset>

          <fieldset className="panel">
            <legend>What you enjoy</legend>
            {tagsQuery.data && (
              <ChipGroup
                label="Interests"
                options={tagsQuery.data.map((t) => ({ value: t.slug, label: t.name }))}
                selected={form.interests}
                onToggle={(v) => toggleIn('interests', v)}
              />
            )}
            <details className="more">
              <summary>Favourite kinds of places</summary>
              {categoriesQuery.data && (
                <ChipGroup
                  label="Preferred categories"
                  options={categoriesQuery.data.map((c) => ({ value: c.slug, label: c.name }))}
                  selected={form.preferredCategories}
                  onToggle={(v) => toggleIn('preferredCategories', v)}
                />
              )}
            </details>
          </fieldset>

          <fieldset className="panel">
            <legend>Must-haves</legend>
            <p className="fine measure">
              Every place in the plan must be confirmed for these. Places where it is unknown are left out, never
              guessed.
            </p>
            <Toggle checked={form.travelingWithPet} onChange={(v) => set('travelingWithPet', v)} label="I’m bringing a pet" />
            <Toggle checked={form.parkingRequired} onChange={(v) => set('parkingRequired', v)} label="I need parking" />
            <Toggle
              checked={form.wheelchairAccessRequired}
              onChange={(v) => set('wheelchairAccessRequired', v)}
              label="Wheelchair access needed"
            />
            <Field label="Minimum rating" hint="Unrated places are left out when you set this.">
              <select value={form.minimumRating} onChange={(e) => set('minimumRating', e.target.value)}>
                <option value="">No minimum</option>
                <option value="3">3 stars</option>
                <option value="3.5">3.5 stars</option>
                <option value="4">4 stars</option>
                <option value="4.5">4.5 stars</option>
              </select>
            </Field>
          </fieldset>

          <fieldset className="panel">
            <legend>Getting around and budget</legend>
            <div className="grid-3">
              <Field label="Travel by">
                <select value={form.travelMode} onChange={(e) => set('travelMode', e.target.value as TravelMode)}>
                  {(Object.keys(TRAVEL_MODE_LABEL) as TravelMode[]).map((m) => (
                    <option key={m} value={m}>
                      {TRAVEL_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Search within">
                <select value={form.searchRadiusKm} onChange={(e) => set('searchRadiusKm', Number(e.target.value))}>
                  {[2, 5, 10, 15, 20, 30, 50].map((r) => (
                    <option key={r} value={r}>
                      {r} km
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="People">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.partySize}
                  onChange={(e) => set('partySize', Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </Field>
            </div>
            <div className="grid-2">
              <Field label="Budget for entry fees (৳)" hint="Optional.">
                <input
                  inputMode="decimal"
                  value={form.budgetAmount}
                  placeholder="e.g. 3000"
                  onChange={(e) => set('budgetAmount', e.target.value.replace(/[^\d.]/g, ''))}
                />
              </Field>
              <Field label="Budget is">
                <select value={form.budgetType} onChange={(e) => set('budgetType', e.target.value as 'total' | 'per_day')}>
                  <option value="total">For the whole trip</option>
                  <option value="per_day">Per day</option>
                </select>
              </Field>
            </div>
          </fieldset>

          <fieldset className="panel">
            <legend>Places you picked</legend>
            {pickedPlaces.length === 0 ? (
              <p className="muted">
                None yet. Navora will choose for you, or <Link to="/">browse places</Link> and add the ones you
                must see.
              </p>
            ) : (
              <>
                <p className="fine">These will be included, or Navora will explain why one cannot fit.</p>
                <ul className="picked">
                  {pickedPlaces.map((p) => (
                    <li key={p.id}>
                      <span>
                        <strong>{p.name}</strong> <span className="muted">{p.category}</span>
                      </span>
                      <button
                        type="button"
                        className="link-btn link-btn--danger"
                        onClick={() => (trip ? setEditPicks((ids) => ids.filter((x) => x !== p.id)) : tripDraft.remove(p.id))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </fieldset>

          {localError && <Notice tone="error" title={localError} />}
          {save.isError && <ErrorNotice error={save.error} />}

          <div className="planner__submit">
            <button className="btn btn--primary btn--large" disabled={save.isPending}>
              {save.isPending
                ? 'Saving…'
                : !user
                  ? 'Sign in to build this trip'
                  : trip
                    ? 'Save and rebuild itinerary'
                    : 'Build my itinerary'}
            </button>
            {trip && (
              <Link className="btn btn--ghost" to={`/trips/${trip.id}`}>
                Cancel
              </Link>
            )}
          </div>
        </div>

        <aside className="planner__preview">
          <div className="panel panel--sticky">
            <h2>What would fit</h2>
            <p className="fine">Preview the places that match before you build the plan.</p>
            <button type="button" className="btn btn--dark btn--block" disabled={recommend.isPending} onClick={() => recommend.mutate()}>
              {recommend.isPending ? 'Checking…' : preview ? 'Check again' : 'Preview matching places'}
            </button>
            {recommend.isError && <ErrorNotice error={recommend.error} />}
            {preview && (
              <RecommendationList
                preview={preview}
                selectedIds={selectedIds}
                onPick={(r) => {
                  if (trip) setEditPicks((ids) => (ids.includes(r.place.id) ? ids : [...ids, r.place.id].slice(0, MAX_SELECTED_PLACES)));
                  else tripDraft.add({ id: r.place.id, name: r.place.name, category: r.place.category.name, location: r.place.location });
                }}
              />
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}

const EXCLUDED_LABEL: Record<string, string> = {
  petFriendly: 'not confirmed pet-friendly',
  parking: 'no confirmed parking',
  wheelchairAccessible: 'no confirmed wheelchair access',
  minimumRating: 'below your minimum rating',
  openDuringTrip: 'closed during your hours',
  searchRadius: 'outside your search radius',
};

function RecommendationList({
  preview,
  selectedIds,
  onPick,
}: {
  preview: { data: Recommendation[]; meta: RecommendationMeta };
  selectedIds: string[];
  onPick: (r: Recommendation) => void;
}) {
  const { data, meta } = preview;
  const excluded = Object.entries(meta.excludedBy).filter(([, n]) => n > 0);
  return (
    <div className="recs">
      <p className="recs__summary">
        <strong>{meta.eligible}</strong> of {meta.candidatesInRadius} places within {meta.searchRadiusKm} km fit your
        must-haves.
      </p>
      {excluded.length > 0 && (
        <ul className="excluded">
          {excluded.map(([key, n]) => (
            <li key={key}>
              {n} {EXCLUDED_LABEL[key] ?? key}
            </li>
          ))}
        </ul>
      )}
      {meta.suggestions.length > 0 && (
        <Notice tone="warning" title="Few places match">
          <ul>
            {meta.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="fine">Navora never drops a must-have on its own. Change one above if you want more options.</p>
        </Notice>
      )}
      <ol className="recs__list">
        {data.map((r) => {
          const picked = selectedIds.includes(r.place.id);
          return (
            <li key={r.place.id} className="rec">
              <div className="rec__head">
                <span className="rec__score" aria-label={`Match score ${r.score} out of 100`}>
                  {r.score}
                </span>
                <div>
                  <Link to={`/places/${r.place.id}`} className="rec__name">
                    {r.place.name}
                  </Link>
                  <p className="fine">
                    {r.place.category.name}
                    {r.place.distanceMeters !== undefined && `, ${formatDistance(r.place.distanceMeters)}`}
                  </p>
                </div>
                <button type="button" className="link-btn" disabled={picked} onClick={() => onPick(r)}>
                  {picked ? 'Picked' : 'Must include'}
                </button>
              </div>
              <ul className="rec__reasons">
                {r.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {r.warnings.map((w) => (
                  <li key={w} className="rec__warning">
                    {w}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
