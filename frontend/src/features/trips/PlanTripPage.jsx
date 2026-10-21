import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, LocateFixed, Pencil, Sparkles } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { Card } from '../../components/Card.jsx';
import { Alert, Skeleton } from '../../components/Feedback.jsx';
import { Checkbox, Field, Input, Select } from '../../components/Field.jsx';
import { errorMessage, fieldErrors } from '../../lib/errors.js';
import { formatEntryFee } from '../../lib/format.js';
import { useCategories, useTags } from '../catalogue/api.js';
import { generateItinerary } from '../itineraries/api.js';
import { useSavedPlaces } from '../saved/api.js';
import { createTrip, updateTrip } from './api.js';
import {
  MAX_DAYS,
  STEPS,
  TRAVEL_MODES,
  buildTripPayload,
  firstStepWithError,
  initialForm,
  toFormErrors,
  todayInDhaka,
  validateStep,
} from './tripForm.js';
import styles from './PlanTripPage.module.css';

const LocationPicker = lazy(() => import('./LocationPicker.jsx'));

const RADIUS_OPTIONS = [2, 5, 10, 20, 50];
const RATING_OPTIONS = [
  ['', 'Any rating'],
  ['3', '3 stars and above'],
  ['3.5', '3.5 stars and above'],
  ['4', '4 stars and above'],
  ['4.5', '4.5 stars and above'],
];
const REQUIREMENTS = [
  ['travelingWithPet', 'Travelling with a pet', 'pet-friendly'],
  ['parkingRequired', 'Parking required', 'to have parking'],
  ['wheelchairAccessRequired', 'Wheelchair access required', 'wheelchair accessible'],
];
const NOT_FEASIBLE_REASONS = {
  NOT_AVAILABLE: 'is no longer available',
  FAILS_REQUIREMENTS: 'does not meet your requirements',
  CLOSED_ON_TRIP_DAYS: 'is closed on your trip days',
  NOT_ENOUGH_TIME: 'needs more time than your daily hours allow',
  NO_ROOM_IN_SCHEDULE: 'does not fit into the schedule',
  OVER_BUDGET: 'is over your budget',
};

function focusFirstInvalid(container) {
  requestAnimationFrame(() => container?.querySelector('[aria-invalid="true"]')?.focus());
}

// Stores a list of slugs/ids on the form: toggles one value.
function toggle(list, value, checked) {
  return checked ? [...list, value] : list.filter((v) => v !== value);
}

// ---------- Step 1: where and when ----------

function StartPoint({ value, error, onChange }) {
  const [coords, setCoords] = useState({ lat: value?.latitude ?? '', lng: value?.longitude ?? '' });
  const [shown, setShown] = useState(value);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);

  // Show coordinates picked on the map or by geolocation in the fields.
  if (value !== shown) {
    setShown(value);
    setCoords({ lat: value ? value.latitude.toFixed(5) : '', lng: value ? value.longitude.toFixed(5) : '' });
  }

  function typed(field, text) {
    const next = { ...coords, [field]: text };
    setCoords(next);
    const latitude = Number(next.lat);
    const longitude = Number(next.lng);
    const valid = next.lat !== '' && next.lng !== '' && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    const location = valid ? { latitude, longitude } : null;
    setShown(location);
    onChange(location);
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocateError('Your browser cannot share its location. Click the map instead.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords: c }) => {
        setLocating(false);
        onChange({ latitude: c.latitude, longitude: c.longitude });
      },
      () => {
        setLocating(false);
        setLocateError('Your location could not be used. Click the map or enter coordinates instead.');
      },
      { timeout: 10000 },
    );
  }

  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? 'start-error' : 'start-hint'}>
      <legend className={styles.legend}>Start point</legend>
      <p id="start-hint" className={styles.hint}>
        Where each day begins and ends, such as your hotel. Click the map, drag the pin, or use your location.
      </p>
      <div>
        <Button variant="secondary" size="sm" icon={LocateFixed} loading={locating} onClick={locate}>
          Use my location
        </Button>
      </div>
      {locateError && <Alert tone="warning">{locateError}</Alert>}
      <Suspense fallback={<Skeleton height="18rem" />}>
        <LocationPicker value={value} onChange={onChange} />
      </Suspense>
      <div className={styles.twoColumns}>
        <Field label="Latitude">
          {(props) => (
            <Input {...props} type="number" step="any" inputMode="decimal" value={coords.lat} onChange={(e) => typed('lat', e.target.value)} aria-invalid={error ? true : undefined} />
          )}
        </Field>
        <Field label="Longitude">
          {(props) => (
            <Input {...props} type="number" step="any" inputMode="decimal" value={coords.lng} onChange={(e) => typed('lng', e.target.value)} aria-invalid={error ? true : undefined} />
          )}
        </Field>
      </div>
      {error && (
        <p id="start-error" className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

function BasicsStep({ form, errors, update }) {
  return (
    <>
      <Field label="Trip name" error={errors.title}>
        {(props) => (
          <Input {...props} maxLength={150} placeholder="For example, Old Dhaka weekend" value={form.title} onChange={(e) => update('title', e.target.value)} />
        )}
      </Field>
      <StartPoint value={form.location} error={errors.location} onChange={(location) => update('location', location)} />
      <Field label="Start point name" optional hint="Helps you recognise it later, for example the hotel name." error={errors.startAddress}>
        {(props) => <Input {...props} maxLength={300} value={form.startAddress} onChange={(e) => update('startAddress', e.target.value)} />}
      </Field>
      <div className={styles.twoColumns}>
        <Field label="Start date" optional hint="Leave empty to start today." error={errors.startDate}>
          {(props) => <Input {...props} type="date" min={todayInDhaka()} value={form.startDate} onChange={(e) => update('startDate', e.target.value)} />}
        </Field>
        <Field label="Number of days" hint={`1 to ${MAX_DAYS} days.`} error={errors.durationDays}>
          {(props) => (
            <Input {...props} type="number" min={1} max={MAX_DAYS} step={1} inputMode="numeric" value={form.durationDays} onChange={(e) => update('durationDays', e.target.value)} />
          )}
        </Field>
      </div>
      <div className={styles.twoColumns}>
        <Field label="Start each day at" error={errors.dailyStartTime}>
          {(props) => <Input {...props} type="time" value={form.dailyStartTime} onChange={(e) => update('dailyStartTime', e.target.value)} />}
        </Field>
        <Field label="Be back by" error={errors.dailyEndTime}>
          {(props) => <Input {...props} type="time" value={form.dailyEndTime} onChange={(e) => update('dailyEndTime', e.target.value)} />}
        </Field>
      </div>
    </>
  );
}

// ---------- Steps 2 and 3: interests, categories, must-visit places ----------

function ChoiceGrid({ legend, hint, error, options, selected, onToggle, loading, loadError }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      <p className={styles.hint}>
        {hint} {selected.length > 0 && <span className={styles.selectedCount}>{selected.length} selected.</span>}
      </p>
      {loading && <Skeleton height="8rem" />}
      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {options && (
        <div className={styles.choices}>
          {options.map(({ value, label }) => (
            <Checkbox key={value} label={label} checked={selected.includes(value)} onChange={(e) => onToggle(value, e.target.checked)} />
          ))}
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </fieldset>
  );
}

function InterestsStep({ form, errors, update }) {
  const tags = useTags();
  return (
    <ChoiceGrid
      legend="What do you enjoy?"
      hint="Places that match your interests rank higher. Choose up to 10, or none."
      error={errors.interests}
      options={tags.data?.map((t) => ({ value: t.slug, label: t.name }))}
      loading={tags.isPending}
      loadError={tags.isError && 'Interests could not be loaded.'}
      selected={form.interests}
      onToggle={(slug, checked) => update('interests', toggle(form.interests, slug, checked))}
    />
  );
}

function PlacesStep({ form, errors, update }) {
  const categories = useCategories();
  const saved = useSavedPlaces(1, 50);
  return (
    <>
      <ChoiceGrid
        legend="Preferred categories"
        hint="Places in these categories rank higher. Others can still be included. Choose up to 10, or none."
        error={errors.preferredCategories}
        options={categories.data?.map((c) => ({ value: c.slug, label: c.name }))}
        loading={categories.isPending}
        loadError={categories.isError && 'Categories could not be loaded.'}
        selected={form.preferredCategories}
        onToggle={(slug, checked) => update('preferredCategories', toggle(form.preferredCategories, slug, checked))}
      />
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Places you must visit</legend>
        <p className={styles.hint}>
          Chosen places are always included, or NAVORA explains why they cannot be. Pick from your saved places.
        </p>
        {saved.isPending && <Skeleton height="4rem" />}
        {saved.isError && <Alert tone="danger">Your saved places could not be loaded.</Alert>}
        {saved.data?.data.length === 0 && (
          <p className="muted">
            You have no saved places yet. <Link to="/explore">Explore places</Link> and save the ones you want to visit.
          </p>
        )}
        {saved.data?.data.length > 0 && (
          <div className={styles.placeChoices}>
            {saved.data.data.map((place) => (
              <Checkbox
                key={place.id}
                label={place.name}
                description={`${place.category.name}, ${formatEntryFee(place.entryFee, place.currency)}`}
                checked={form.selectedPlaceIds.includes(place.id)}
                onChange={(e) => update('selectedPlaceIds', toggle(form.selectedPlaceIds, place.id, e.target.checked))}
              />
            ))}
          </div>
        )}
        {errors.selectedPlaceIds && <p className={styles.error}>{errors.selectedPlaceIds}</p>}
      </fieldset>
    </>
  );
}

// ---------- Step 4: travel and budget ----------

function TravelStep({ form, errors, update }) {
  return (
    <>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>How will you get around?</legend>
        <div className={styles.radios}>
          {TRAVEL_MODES.map(({ value, label }) => (
            <label key={value} className={`${styles.radio} ${form.travelMode === value ? styles.radioChecked : ''}`}>
              <input type="radio" name="travelMode" value={value} checked={form.travelMode === value} onChange={() => update('travelMode', value)} />
              {label}
            </label>
          ))}
        </div>
        {form.travelMode === 'public_transport' && (
          <p className={styles.hint}>Travel times by public transport are estimated from distance.</p>
        )}
      </fieldset>
      <div className={styles.twoColumns}>
        <Field label="Search distance" hint="How far from the start point to look for places." error={errors.searchRadiusKm}>
          {(props) => (
            <Select {...props} value={form.searchRadiusKm} onChange={(e) => update('searchRadiusKm', e.target.value)}>
              {RADIUS_OPTIONS.map((km) => (
                <option key={km} value={String(km)}>
                  Within {km} km
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="People" hint="Entry fees are estimated for everyone." error={errors.partySize}>
          {(props) => (
            <Input {...props} type="number" min={1} max={50} step={1} inputMode="numeric" value={form.partySize} onChange={(e) => update('partySize', e.target.value)} />
          )}
        </Field>
      </div>
      <div className={styles.twoColumns}>
        <Field label="Budget for entry fees (BDT)" optional hint="Leave empty for no budget." error={errors.budgetAmount}>
          {(props) => (
            <Input {...props} type="number" min={0} step="any" inputMode="decimal" value={form.budgetAmount} onChange={(e) => update('budgetAmount', e.target.value)} />
          )}
        </Field>
        <Field label="Budget is">
          {(props) => (
            <Select {...props} value={form.budgetType} disabled={form.budgetAmount === ''} onChange={(e) => update('budgetType', e.target.value)}>
              <option value="total">For the whole trip</option>
              <option value="per_day">Per day</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Minimum rating" hint="Places without reviews are left out when you set this." error={errors.minimumRating}>
        {(props) => (
          <Select {...props} value={form.minimumRating} onChange={(e) => update('minimumRating', e.target.value)}>
            {RATING_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

// ---------- Step 5: requirements ----------

function RequirementsStep({ form, update }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Must-haves</legend>
      <p className={styles.hint}>
        Requirements are strict: a place is only included when it is confirmed. Places where the information is unknown
        are left out, so each requirement can reduce the number of places available.
      </p>
      <div className={styles.requirements}>
        {REQUIREMENTS.map(([field, label, confirmed]) => (
          <Checkbox
            key={field}
            label={label}
            description={`Only places confirmed ${confirmed} are included.`}
            checked={form[field]}
            onChange={(e) => update(field, e.target.checked)}
          />
        ))}
      </div>
    </fieldset>
  );
}

// ---------- Step 6: review ----------

function Summary({ form, goTo }) {
  const tags = useTags();
  const categories = useCategories();
  const saved = useSavedPlaces(1, 50);
  const names = (list, source, key = 'slug') =>
    list.map((value) => source.data?.find((item) => item[key] === value)?.name ?? value).join(', ') || 'None';
  const travel = TRAVEL_MODES.find((m) => m.value === form.travelMode)?.label;
  const requirements = REQUIREMENTS.filter(([field]) => form[field]).map(([, label]) => label);
  const days = Number(form.durationDays);

  const sections = [
    {
      step: 0,
      title: 'Where and when',
      rows: [
        ['Trip name', form.title.trim()],
        ['Start point', form.startAddress.trim() || `${form.location?.latitude.toFixed(4)}, ${form.location?.longitude.toFixed(4)}`],
        ['Dates', `${form.startDate || 'Starting today'}, ${days} day${days === 1 ? '' : 's'}`],
        ['Daily hours', `${form.dailyStartTime} to ${form.dailyEndTime}`],
      ],
    },
    { step: 1, title: 'Interests', rows: [['Interests', names(form.interests, tags)]] },
    {
      step: 2,
      title: 'Categories and places',
      rows: [
        ['Preferred categories', names(form.preferredCategories, categories)],
        ['Must visit', form.selectedPlaceIds.length ? names(form.selectedPlaceIds, { data: saved.data?.data }, 'id') : 'None'],
      ],
    },
    {
      step: 3,
      title: 'Travel and budget',
      rows: [
        ['Travel mode', travel],
        ['Search distance', `Within ${form.searchRadiusKm} km`],
        ['People', form.partySize],
        ['Budget', form.budgetAmount === '' ? 'No budget' : `BDT ${form.budgetAmount} ${form.budgetType === 'total' ? 'for the trip' : 'per day'}`],
        ['Minimum rating', RATING_OPTIONS.find(([v]) => v === form.minimumRating)?.[1]],
      ],
    },
    { step: 4, title: 'Requirements', rows: [['Must-haves', requirements.join(', ') || 'None']] },
  ];

  return (
    <div className={styles.summary}>
      {sections.map(({ step, title, rows }) => (
        <section key={title} className={styles.summarySection} aria-label={title}>
          <div className={styles.summaryHeader}>
            <h3>{title}</h3>
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => goTo(step)} aria-label={`Edit ${title.toLowerCase()}`}>
              Edit
            </Button>
          </div>
          <dl className={styles.summaryList}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

// Why generation failed (422): the backend never relaxes requirements, it explains them.
function GenerationFailure({ error, form, goTo }) {
  const saved = useSavedPlaces(1, 50);
  const details = error.details ?? {};
  const placeName = (id, name) => name ?? saved.data?.data.find((p) => p.id === id)?.name ?? 'A chosen place';

  return (
    <Alert tone="warning" title="No itinerary could be made with these requirements">
      {error.code === 'INSUFFICIENT_MATCHING_PLACES' && (
        <>
          <p>Not enough places match your choices to fill every day. Your trip is saved; change it and try again.</p>
          {details.suggestions?.length > 0 && (
            <ul className={styles.reasons}>
              {details.suggestions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {error.code === 'SELECTED_PLACES_NOT_FEASIBLE' && (
        <>
          <p>Some places you must visit cannot be included. Your trip is saved; change it and try again.</p>
          <ul className={styles.reasons}>
            {(details.places ?? []).map(({ placeId, name, reason }) => (
              <li key={placeId}>
                {placeName(placeId, name)} {NOT_FEASIBLE_REASONS[reason] ?? 'cannot be included'}.
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={styles.failureActions}>
        {(form.travelingWithPet || form.parkingRequired || form.wheelchairAccessRequired) && (
          <Button variant="secondary" size="sm" onClick={() => goTo(4)}>
            Change requirements
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => goTo(3)}>
          Change distance or budget
        </Button>
        {form.selectedPlaceIds.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => goTo(2)}>
            Change must-visit places
          </Button>
        )}
      </div>
    </Alert>
  );
}

// ---------- The wizard ----------

export function PlanTripPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState({});
  // Set once the trip is saved: a retry after a failed generation updates it instead of
  // creating a second trip.
  const [tripId, setTripId] = useState(null);
  const panelRef = useRef(null);
  const headingRef = useRef(null);
  const firstRender = useRef(true);
  const step = STEPS[stepIndex];

  // Move focus to the new step's heading so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  const generate = useMutation({
    mutationFn: async (payload) => {
      const trip = tripId ? await updateTrip(tripId, payload) : await createTrip(payload);
      setTripId(trip.id);
      await generateItinerary(trip.id);
      return trip;
    },
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      navigate(`/trips/${trip.id}`);
    },
    onError: (error) => {
      if (error.code === 'VALIDATION_ERROR') {
        const formErrors = toFormErrors(fieldErrors(error));
        setErrors(formErrors);
        const target = firstStepWithError(formErrors);
        if (target) setStepIndex(STEPS.findIndex((s) => s.id === target));
      }
      if (tripId || error.status === 422) queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  function goTo(index) {
    generate.reset();
    setStepIndex(index);
  }

  function next() {
    const stepErrors = validateStep(step.id, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length) {
      focusFirstInvalid(panelRef.current);
      return;
    }
    setStepIndex(stepIndex + 1);
  }

  const failure = generate.error && generate.error.status === 422 ? generate.error : null;
  const otherError = generate.error && !failure && generate.error.code !== 'VALIDATION_ERROR' ? generate.error : null;

  return (
    <main className={`container ${styles.page}`}>
      <title>Plan a trip | NAVORA</title>
      <header className={styles.header}>
        <h1>Plan a trip</h1>
        <p className="muted">Tell NAVORA how you like to travel. It builds a day-by-day plan from approved places.</p>
      </header>

      <div className={styles.layout}>
        <nav aria-label="Trip planning steps">
          <ol className={styles.steps}>
            {STEPS.map((s, index) => {
              const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'upcoming';
              return (
                <li key={s.id} className={`${styles.step} ${styles[state]}`}>
                  {state === 'done' ? (
                    <button type="button" className={styles.stepButton} onClick={() => goTo(index)}>
                      <span className={styles.stepNumber}>{index + 1}</span>
                      {s.title}
                    </button>
                  ) : (
                    <span className={styles.stepButton} aria-current={state === 'current' ? 'step' : undefined}>
                      <span className={styles.stepNumber}>{index + 1}</span>
                      {s.title}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className={styles.panel}>
          <form
            ref={panelRef}
            className={styles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (step.id === 'review') generate.mutate(buildTripPayload(form));
              else next();
            }}
          >
            <p className={styles.progress}>
              Step {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 ref={headingRef} tabIndex={-1} className={styles.stepTitle}>
              {step.title}
            </h2>

            {step.id === 'basics' && <BasicsStep form={form} errors={errors} update={update} />}
            {step.id === 'interests' && <InterestsStep form={form} errors={errors} update={update} />}
            {step.id === 'places' && <PlacesStep form={form} errors={errors} update={update} />}
            {step.id === 'travel' && <TravelStep form={form} errors={errors} update={update} />}
            {step.id === 'requirements' && <RequirementsStep form={form} update={update} />}
            {step.id === 'review' && (
              <>
                <Summary form={form} goTo={goTo} />
                {failure && <GenerationFailure error={failure} form={form} goTo={goTo} />}
                {otherError && <Alert tone="danger">{errorMessage(otherError)}</Alert>}
                <p className={styles.hint} role="status">
                  {generate.isPending
                    ? 'Building your itinerary: choosing places, checking opening hours and ordering each day. This can take a few seconds.'
                    : 'NAVORA checks opening hours, visit lengths and travel times, then orders each day into a route.'}
                </p>
              </>
            )}

            <div className={styles.actions}>
              {stepIndex > 0 && (
                <Button variant="ghost" icon={ArrowLeft} onClick={() => goTo(stepIndex - 1)} disabled={generate.isPending}>
                  Back
                </Button>
              )}
              {step.id === 'review' ? (
                <Button type="submit" icon={Sparkles} loading={generate.isPending}>
                  {generate.isPending ? 'Generating' : tripId ? 'Update and try again' : 'Generate itinerary'}
                </Button>
              ) : (
                <Button type="submit">
                  Continue
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
