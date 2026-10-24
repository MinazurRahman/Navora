// Submit a new place (→ PENDING until a moderator approves) or fix your own pending/rejected one.

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogueApi, placesApi } from '../api/endpoints';
import type { FacilityStatus, OpeningHours, Place, PlaceInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { MapView } from '../components/MapView';
import { ChipGroup, ErrorNotice, Field, Loading, Notice } from '../components/ui';
import { fieldErrors } from '../lib/errors';
import { WEEKDAYS } from '../lib/format';
import { useExploreLocation } from '../lib/location';

interface DayHours {
  open: boolean;
  opensAt: string;
  closesAt: string;
}

interface ContributeForm {
  name: string;
  description: string;
  category: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  city: string;
  feeKnown: 'unknown' | 'free' | 'paid';
  entryFee: string;
  typicalVisitMinutes: string;
  parkingAvailable: FacilityStatus;
  petFriendly: FacilityStatus;
  wheelchairAccessible: FacilityStatus;
  restrictions: string;
  accessibilityNotes: string;
  tags: string[];
  hoursKnown: boolean;
  hours: DayHours[];
}

function emptyForm(): ContributeForm {
  return {
    name: '',
    description: '',
    category: '',
    latitude: null,
    longitude: null,
    address: '',
    city: 'Dhaka',
    feeKnown: 'unknown',
    entryFee: '',
    typicalVisitMinutes: '',
    parkingAvailable: 'UNKNOWN',
    petFriendly: 'UNKNOWN',
    wheelchairAccessible: 'UNKNOWN',
    restrictions: '',
    accessibilityNotes: '',
    tags: [],
    hoursKnown: false,
    hours: WEEKDAYS.map(() => ({ open: true, opensAt: '09:00', closesAt: '17:00' })),
  };
}

function fromPlace(p: Place): ContributeForm {
  const base = emptyForm();
  return {
    ...base,
    name: p.name,
    description: p.description ?? '',
    category: p.category.slug,
    latitude: p.location.latitude,
    longitude: p.location.longitude,
    address: p.address ?? '',
    city: p.city ?? '',
    feeKnown: p.entryFee === null ? 'unknown' : p.entryFee === 0 ? 'free' : 'paid',
    entryFee: p.entryFee ? String(p.entryFee) : '',
    typicalVisitMinutes: p.typicalVisitMinutes ? String(p.typicalVisitMinutes) : '',
    parkingAvailable: p.facilities.parking,
    petFriendly: p.facilities.petFriendly,
    wheelchairAccessible: p.facilities.wheelchairAccessible,
    restrictions: p.facilities.restrictions ?? '',
    accessibilityNotes: p.facilities.accessibilityNotes ?? '',
    tags: p.tags,
    hoursKnown: p.openingHours.length > 0,
    hours: WEEKDAYS.map((_, i) => {
      const h = p.openingHours.find((x) => x.dayOfWeek === i + 1);
      return h ? { open: true, opensAt: h.opensAt, closesAt: h.closesAt } : { open: false, opensAt: '09:00', closesAt: '17:00' };
    }),
  };
}

function toInput(f: ContributeForm): PlaceInput {
  const openingHours: OpeningHours[] = f.hoursKnown
    ? f.hours.flatMap((h, i) => (h.open ? [{ dayOfWeek: i + 1, opensAt: h.opensAt, closesAt: h.closesAt }] : []))
    : [];
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    category: f.category,
    location: { latitude: f.latitude!, longitude: f.longitude! },
    address: f.address.trim() || null,
    city: f.city.trim() || null,
    entryFee: f.feeKnown === 'unknown' ? null : f.feeKnown === 'free' ? 0 : Number(f.entryFee),
    typicalVisitMinutes: f.typicalVisitMinutes ? Number(f.typicalVisitMinutes) : null,
    parkingAvailable: f.parkingAvailable,
    petFriendly: f.petFriendly,
    wheelchairAccessible: f.wheelchairAccessible,
    restrictions: f.restrictions.trim() || null,
    accessibilityNotes: f.accessibilityNotes.trim() || null,
    tags: f.tags,
    openingHours,
  };
}

export function ContributePage() {
  const { id } = useParams();
  const placeQuery = useQuery({ queryKey: ['place', id, 'edit'], queryFn: () => placesApi.get(id!), enabled: Boolean(id) });
  if (id && placeQuery.isPending) return <div className="page"><Loading label="Loading place" /></div>;
  if (id && placeQuery.isError) return <div className="page narrow"><ErrorNotice error={placeQuery.error} /></div>;
  return <ContributeFormView place={placeQuery.data} key={placeQuery.data?.id ?? 'new'} />;
}

function ContributeFormView({ place }: { place?: Place }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isModerator } = useAuth();
  const here = useExploreLocation();
  const [form, setForm] = useState<ContributeForm>(() => (place ? fromPlace(place) : emptyForm()));
  const [problem, setProblem] = useState<string | null>(null);
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: catalogueApi.categories, staleTime: Infinity });
  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: catalogueApi.tags, staleTime: Infinity });

  const set = <K extends keyof ContributeForm>(key: K, value: ContributeForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setHours = (index: number, change: Partial<DayHours>) =>
    setForm((f) => ({ ...f, hours: f.hours.map((h, i) => (i === index ? { ...h, ...change } : h)) }));

  const save = useMutation({
    mutationFn: () => (place ? placesApi.update(place.id, toInput(form)) : placesApi.create(toInput(form))),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['places'] });
      queryClient.invalidateQueries({ queryKey: ['my-places'] });
      queryClient.invalidateQueries({ queryKey: ['place', saved.id] });
      navigate(`/my-places?saved=${saved.id}`);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    let issue: string | null = null;
    if (!form.name.trim()) issue = 'Add the place’s name.';
    else if (!form.category) issue = 'Choose a category.';
    else if (form.latitude === null) issue = 'Click the map to mark where the place is.';
    else if (form.feeKnown === 'paid' && !(Number(form.entryFee) > 0)) issue = 'Enter the entry fee, or mark it as free or unknown.';
    else if (form.hoursKnown && form.hours.some((h) => h.open && h.opensAt >= h.closesAt))
      issue = 'Opening time must be before closing time. Split overnight hours across two days.';
    setProblem(issue);
    if (!issue) save.mutate();
  }

  const fields = fieldErrors(save.error);
  const point = form.latitude !== null && form.longitude !== null ? { latitude: form.latitude, longitude: form.longitude } : null;

  return (
    <div className="page contribute">
      <header className="page__head page__head--row">
        <div>
          <h1>{place ? `Edit “${place.name}”` : 'Add a place'}</h1>
          <p className="muted measure">
            {isModerator
              ? 'As a moderator, places you add are published straight away.'
              : 'A moderator checks each submission before it appears for everyone. Only fill in what you know: leave the rest as Unknown.'}
          </p>
        </div>
        <Link to="/my-places" className="btn btn--ghost">
          My submissions
        </Link>
      </header>

      {place?.status === 'REJECTED' && (
        <Notice tone="warning" title="This submission was rejected">
          Saving your changes sends it back to the moderators. See the reason under <Link to="/my-places">My submissions</Link>.
        </Notice>
      )}

      <form className="contribute__grid" onSubmit={onSubmit} noValidate>
        <div className="stack-lg">
          <fieldset className="panel">
            <legend>What and where</legend>
            <Field label="Name" error={fields.name}>
              <input value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Category" error={fields.category}>
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Choose…</option>
                {categoriesQuery.data?.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description" hint="What makes it worth a visit? Facts only, no links or phone numbers.">
              <textarea rows={4} maxLength={5000} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div className="field">
              <span className="field__label">Location</span>
              <span className="field__hint">Click the map exactly where the entrance is.</span>
              <MapView
                ariaLabel="Click to set the place's location"
                className="map--picker-sm"
                center={point ?? here}
                zoom={point ? 16 : 13}
                markers={point ? [{ id: 'new', position: point, label: form.name || 'New place', tone: 'pick' }] : []}
                onPick={(loc) => setForm((f) => ({ ...f, latitude: loc.latitude, longitude: loc.longitude }))}
              />
              {point && (
                <span className="fine">
                  {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                </span>
              )}
            </div>
            <div className="grid-2">
              <Field label="Address">
                <input value={form.address} maxLength={300} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field label="City">
                <input value={form.city} maxLength={100} onChange={(e) => set('city', e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="panel">
            <legend>Visiting</legend>
            <div className="field">
              <span className="field__label">Entry fee</span>
              <div className="segmented" role="group" aria-label="Entry fee">
                {(['unknown', 'free', 'paid'] as const).map((v) => (
                  <button type="button" key={v} aria-pressed={form.feeKnown === v} onClick={() => set('feeKnown', v)}>
                    {v === 'unknown' ? 'Not sure' : v === 'free' ? 'Free' : 'Paid'}
                  </button>
                ))}
              </div>
              {form.feeKnown === 'paid' && (
                <input
                  aria-label="Entry fee in taka"
                  inputMode="decimal"
                  placeholder="Amount in ৳"
                  value={form.entryFee}
                  onChange={(e) => set('entryFee', e.target.value.replace(/[^\d.]/g, ''))}
                />
              )}
            </div>
            <Field label="Typical visit (minutes)" hint="How long people usually stay. 5 to 720.">
              <input
                type="number"
                min={5}
                max={720}
                value={form.typicalVisitMinutes}
                onChange={(e) => set('typicalVisitMinutes', e.target.value)}
              />
            </Field>

            <label className="check">
              <input type="checkbox" checked={form.hoursKnown} onChange={(e) => set('hoursKnown', e.target.checked)} />I
              know the opening hours
            </label>
            {form.hoursKnown && (
              <table className="hours hours--edit">
                <tbody>
                  {WEEKDAYS.map((day, i) => (
                    <tr key={day}>
                      <th scope="row">
                        <label className="check">
                          <input type="checkbox" checked={form.hours[i].open} onChange={(e) => setHours(i, { open: e.target.checked })} />
                          {day}
                        </label>
                      </th>
                      <td>
                        {form.hours[i].open ? (
                          <>
                            <input
                              type="time"
                              aria-label={`${day} opens`}
                              value={form.hours[i].opensAt}
                              onChange={(e) => setHours(i, { opensAt: e.target.value })}
                            />
                            <span aria-hidden> to </span>
                            <input
                              type="time"
                              aria-label={`${day} closes`}
                              value={form.hours[i].closesAt}
                              onChange={(e) => setHours(i, { closesAt: e.target.value })}
                            />
                          </>
                        ) : (
                          <span className="muted">Closed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </fieldset>
        </div>

        <div className="stack-lg">
          <fieldset className="panel">
            <legend>Facilities</legend>
            <p className="fine">Say Yes or No only if you are sure. Travellers rely on this.</p>
            {(
              [
                ['parkingAvailable', 'Parking'],
                ['petFriendly', 'Pets allowed'],
                ['wheelchairAccessible', 'Wheelchair access'],
              ] as const
            ).map(([key, label]) => (
              <div className="field" key={key}>
                <span className="field__label">{label}</span>
                <div className="segmented" role="group" aria-label={label}>
                  {(['YES', 'NO', 'UNKNOWN'] as const).map((v) => (
                    <button type="button" key={v} aria-pressed={form[key] === v} onClick={() => set(key, v)}>
                      {v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : 'Unknown'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Field label="Restrictions" hint="e.g. Pets on a leash only, no photography inside.">
              <input value={form.restrictions} maxLength={1000} onChange={(e) => set('restrictions', e.target.value)} />
            </Field>
            <Field label="Accessibility notes">
              <input value={form.accessibilityNotes} maxLength={1000} onChange={(e) => set('accessibilityNotes', e.target.value)} />
            </Field>
          </fieldset>

          <fieldset className="panel">
            <legend>Good for</legend>
            {tagsQuery.data && (
              <ChipGroup
                label="Interests"
                options={tagsQuery.data.map((t) => ({ value: t.slug, label: t.name }))}
                selected={form.tags}
                onToggle={(v) =>
                  set('tags', form.tags.includes(v) ? form.tags.filter((t) => t !== v) : [...form.tags, v].slice(0, 10))
                }
              />
            )}
          </fieldset>

          <p className="fine">Photos are not supported yet.</p>
          {problem && <Notice tone="error" title={problem} />}
          {save.isError && <ErrorNotice error={save.error} />}
          <button className="btn btn--primary btn--large btn--block" disabled={save.isPending}>
            {save.isPending ? 'Sending…' : place ? 'Save changes' : isModerator ? 'Publish place' : 'Send for review'}
          </button>
        </div>
      </form>
    </div>
  );
}
