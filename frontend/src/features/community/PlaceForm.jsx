import { Suspense, lazy, useRef, useState } from 'react';
import { LocateFixed, Plus, X } from 'lucide-react';
import { Button, IconButton } from '../../components/Button.jsx';
import { Skeleton } from '../../components/Feedback.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/Field.jsx';
import { fieldErrors } from '../../lib/errors.js';
import { useCategories, useTags } from '../catalogue/api.js';
import { DAYS, FACILITY_FIELDS, buildPlacePayload, toPlaceFormErrors, validatePlaceForm } from './placeForm.js';
import { ErrorAlert } from '../../components/ErrorState.jsx';
import styles from './PlaceForm.module.css';

const LocationPicker = lazy(() => import('../../components/LocationPicker.jsx'));

const FACILITY_OPTIONS = [
  ['YES', 'Yes'],
  ['NO', 'No'],
  ['UNKNOWN', 'Not sure'],
];

function focusFirstInvalid(form) {
  requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus());
}

function RadioRow({ name, legend, value, options, onChange, hint }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>{legend}</legend>
      {hint && <p className={styles.hint}>{hint}</p>}
      <div className={styles.radioRow}>
        {options.map(([optionValue, label]) => (
          <label key={optionValue} className={`${styles.radio} ${value === optionValue ? styles.radioChecked : ''}`}>
            <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LocationField({ value, error, onChange }) {
  const [coords, setCoords] = useState({ lat: value ? value.latitude.toFixed(6) : '', lng: value ? value.longitude.toFixed(6) : '' });
  const [shown, setShown] = useState(value);
  const [locating, setLocating] = useState(false);

  if (value !== shown) {
    setShown(value);
    setCoords({ lat: value ? value.latitude.toFixed(6) : '', lng: value ? value.longitude.toFixed(6) : '' });
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

  return (
    <fieldset className={styles.fieldset} aria-describedby="location-hint">
      <legend className={styles.label}>Location</legend>
      <p id="location-hint" className={styles.hint}>
        Click the map at the entrance, drag the pin to adjust, or use your location if you are there now.
      </p>
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={LocateFixed}
          loading={locating}
          onClick={() => {
            if (!navigator.geolocation) return;
            setLocating(true);
            navigator.geolocation.getCurrentPosition(
              ({ coords: c }) => {
                setLocating(false);
                onChange({ latitude: c.latitude, longitude: c.longitude });
              },
              () => setLocating(false),
              { timeout: 10000 },
            );
          }}
        >
          Use my location
        </Button>
      </div>
      <Suspense fallback={<Skeleton height="18rem" />}>
        <LocationPicker value={value} onChange={onChange} label="Map: click to mark the place" />
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
      {error && <p className={styles.error}>{error}</p>}
    </fieldset>
  );
}

function OpeningHoursField({ known, hours, error, onKnownChange, onHoursChange }) {
  const setDay = (day, ranges) => onHoursChange({ ...hours, [day]: ranges });
  const copyMonday = () => onHoursChange(Object.fromEntries(DAYS.map((_, i) => [i + 1, hours[1].map((r) => ({ ...r }))])));

  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>Opening hours</legend>
      <RadioRow
        name="hoursKnown"
        legend="Do you know the opening hours?"
        value={known ? 'known' : 'unknown'}
        options={[
          ['unknown', 'Opening hours unknown'],
          ['known', 'I know the hours'],
        ]}
        onChange={(v) => onKnownChange(v === 'known')}
        hint="Unknown hours are fine. Trip plans then show a warning instead of assuming the place is open."
      />
      {known && (
        <>
          <ul className={styles.days}>
            {DAYS.map((name, index) => {
              const day = index + 1;
              const ranges = hours[day];
              return (
                <li key={name} className={styles.dayRow}>
                  <span className={styles.dayName}>{name}</span>
                  <div className={styles.ranges}>
                    {ranges.length === 0 && <span className={styles.closed}>Closed</span>}
                    {ranges.map((range, i) => (
                      <div key={i} className={styles.range}>
                        <Input
                          type="time"
                          aria-label={`${name} opens at`}
                          value={range.opensAt}
                          onChange={(e) => setDay(day, ranges.map((r, j) => (j === i ? { ...r, opensAt: e.target.value } : r)))}
                        />
                        <span aria-hidden="true">to</span>
                        <Input
                          type="time"
                          aria-label={`${name} closes at`}
                          value={range.closesAt}
                          onChange={(e) => setDay(day, ranges.map((r, j) => (j === i ? { ...r, closesAt: e.target.value } : r)))}
                        />
                        <IconButton icon={X} size="sm" label={`Remove ${name} hours`} onClick={() => setDay(day, ranges.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Plus}
                    onClick={() => setDay(day, [...ranges, ranges.length ? { opensAt: '', closesAt: '' } : { opensAt: '09:00', closesAt: '17:00' }])}
                    aria-label={ranges.length ? `Add more ${name} hours` : `Set ${name} hours`}
                  >
                    {ranges.length ? 'Add hours' : 'Set hours'}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div>
            <Button variant="secondary" size="sm" onClick={copyMonday} disabled={hours[1].length === 0}>
              Use Monday&apos;s hours for every day
            </Button>
          </div>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </fieldset>
  );
}

// Submit or edit a community place. onSubmit(payload) returns a promise (a mutation).
export function PlaceForm({ initial, submitLabel, pending, serverError, onSubmit }) {
  const categories = useCategories();
  const tags = useTags();
  const formRef = useRef(null);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [seenServerError, setSeenServerError] = useState(null);

  // Show server validation errors beside their fields when a new one arrives.
  if (serverError && serverError !== seenServerError) {
    setSeenServerError(serverError);
    setErrors(toPlaceFormErrors(fieldErrors(serverError)));
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  function submit(event) {
    event.preventDefault();
    const found = validatePlaceForm(form);
    setErrors(found);
    if (Object.keys(found).length) return focusFirstInvalid(formRef.current);
    onSubmit(buildPlacePayload(form));
  }

  const showServerAlert = serverError && serverError.code !== 'VALIDATION_ERROR';

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      {showServerAlert && <ErrorAlert error={serverError} />}

      <section className={styles.section} aria-labelledby="section-basics">
        <h2 id="section-basics" className={styles.sectionTitle}>
          The place
        </h2>
        <Field label="Name" error={errors.name}>
          {(props) => <Input {...props} maxLength={200} value={form.name} onChange={(e) => update('name', e.target.value)} />}
        </Field>
        <Field label="Category" error={errors.category}>
          {(props) => (
            <Select {...props} value={form.category} onChange={(e) => update('category', e.target.value)} disabled={!categories.data}>
              <option value="">Choose a category</option>
              {categories.data?.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" optional hint="What makes it worth visiting? Up to 5,000 characters." error={errors.description}>
          {(props) => <Textarea {...props} rows={5} maxLength={5000} value={form.description} onChange={(e) => update('description', e.target.value)} />}
        </Field>
        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>Interests (optional)</legend>
          <p className={styles.hint}>Who would enjoy it? Choose up to 10.</p>
          {tags.isPending && <Skeleton height="5rem" />}
          {tags.data && (
            <div className={styles.choices}>
              {tags.data.map((t) => (
                <Checkbox
                  key={t.slug}
                  label={t.name}
                  checked={form.tags.includes(t.slug)}
                  onChange={(e) => update('tags', e.target.checked ? [...form.tags, t.slug] : form.tags.filter((s) => s !== t.slug))}
                />
              ))}
            </div>
          )}
          {errors.tags && <p className={styles.error}>{errors.tags}</p>}
        </fieldset>
      </section>

      <section className={styles.section} aria-labelledby="section-where">
        <h2 id="section-where" className={styles.sectionTitle}>
          Where it is
        </h2>
        <LocationField value={form.location} error={errors.location} onChange={(location) => update('location', location)} />
        <div className={styles.twoColumns}>
          <Field label="Address" optional error={errors.address}>
            {(props) => <Input {...props} maxLength={300} value={form.address} onChange={(e) => update('address', e.target.value)} />}
          </Field>
          <Field label="City" optional error={errors.city}>
            {(props) => <Input {...props} maxLength={100} value={form.city} onChange={(e) => update('city', e.target.value)} />}
          </Field>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="section-visit">
        <h2 id="section-visit" className={styles.sectionTitle}>
          Visiting
        </h2>
        <RadioRow
          name="feeMode"
          legend="Entry fee"
          value={form.feeMode}
          options={[
            ['unknown', 'Not sure'],
            ['free', 'Free'],
            ['amount', 'Paid'],
          ]}
          onChange={(v) => update('feeMode', v)}
        />
        {form.feeMode === 'amount' && (
          <Field label="Entry fee per person (BDT)" error={errors.entryFee}>
            {(props) => (
              <Input {...props} type="number" min={0} step="0.01" inputMode="decimal" value={form.entryFee} onChange={(e) => update('entryFee', e.target.value)} />
            )}
          </Field>
        )}
        <Field label="Typical visit length (minutes)" optional hint="5 to 720 minutes." error={errors.typicalVisitMinutes}>
          {(props) => (
            <Input {...props} type="number" min={5} max={720} step={5} inputMode="numeric" value={form.typicalVisitMinutes} onChange={(e) => update('typicalVisitMinutes', e.target.value)} />
          )}
        </Field>
        <OpeningHoursField
          known={form.hoursKnown}
          hours={form.hours}
          error={errors.openingHours}
          onKnownChange={(known) => update('hoursKnown', known)}
          onHoursChange={(hours) => update('hours', hours)}
        />
      </section>

      <section className={styles.section} aria-labelledby="section-facilities">
        <h2 id="section-facilities" className={styles.sectionTitle}>
          Facilities
        </h2>
        <p className={styles.hint}>
          Answer only what you know. &quot;Not sure&quot; is better than a guess: trip plans with a requirement leave out places
          that are not confirmed.
        </p>
        {FACILITY_FIELDS.map(([field, label]) => (
          <RadioRow key={field} name={field} legend={label} value={form[field]} options={FACILITY_OPTIONS} onChange={(v) => update(field, v)} />
        ))}
        <Field label="Accessibility notes" optional hint="For example, a ramp at the side gate." error={errors.accessibilityNotes}>
          {(props) => <Textarea {...props} rows={2} maxLength={1000} value={form.accessibilityNotes} onChange={(e) => update('accessibilityNotes', e.target.value)} />}
        </Field>
        <Field label="Restrictions" optional hint="For example, a dress code or no photography inside." error={errors.restrictions}>
          {(props) => <Textarea {...props} rows={2} maxLength={1000} value={form.restrictions} onChange={(e) => update('restrictions', e.target.value)} />}
        </Field>
      </section>

      <div className={styles.actions}>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
