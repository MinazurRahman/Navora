// A saved trip and its itinerary: day tabs, the route ribbon, the map, versions and editing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { itinerariesApi, tripsApi } from '../api/endpoints';
import type { Itinerary, ItineraryDay, ItineraryEditDay, Location, Trip } from '../api/types';
import { MapView, type MapMarker, type MapRoute } from '../components/MapView';
import { EmptyState, ErrorNotice, Loading, Notice } from '../components/ui';
import { errorMessage, isApiError } from '../lib/errors';
import {
  formatDate,
  formatDistance,
  formatMinutes,
  formatMoney,
  formatTimestamp,
  TRAVEL_MODE_LABEL,
} from '../lib/format';
import { decodePolyline } from '../lib/polyline';

export function TripPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id) });
  const trip = tripQuery.data;

  const versionsQuery = useQuery({
    queryKey: ['itineraries', id],
    queryFn: () => itinerariesApi.list({ tripId: id, limit: 50 }),
    enabled: Boolean(trip),
  });

  const chosenVersion = params.get('version');
  const itineraryId = chosenVersion ?? trip?.currentItineraryId ?? null;
  const itineraryQuery = useQuery({
    queryKey: ['itinerary', itineraryId],
    queryFn: () => itinerariesApi.get(itineraryId!),
    enabled: Boolean(itineraryId),
  });

  const afterNewVersion = (itinerary: Itinerary) => {
    queryClient.setQueryData(['itinerary', itinerary.id], itinerary);
    queryClient.invalidateQueries({ queryKey: ['trip', id] });
    queryClient.invalidateQueries({ queryKey: ['itineraries', id] });
    queryClient.invalidateQueries({ queryKey: ['trips'] });
    const next = new URLSearchParams(params);
    next.delete('version');
    next.delete('generate');
    setParams(next, { replace: true });
  };

  // Builds a plan from the trip's current requirements: first version or a new one.
  const build = useMutation({
    mutationFn: (t: Trip) =>
      t.currentItineraryId ? itinerariesApi.regenerate(t.currentItineraryId) : itinerariesApi.generate(t.id),
    onSuccess: afterNewVersion,
  });

  // Arriving from the planner with ?generate=1: build once (guards against double effects).
  const autoBuilt = useRef(false);
  useEffect(() => {
    if (trip && params.get('generate') === '1' && !autoBuilt.current) {
      autoBuilt.current = true;
      build.mutate(trip);
      const next = new URLSearchParams(params);
      next.delete('generate');
      setParams(next, { replace: true });
    }
  }, [trip, params, setParams, build]);

  const removeTrip = useMutation({
    mutationFn: () => tripsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      navigate('/trips', { replace: true });
    },
  });

  if (tripQuery.isPending) return <div className="page"><Loading label="Loading trip" /></div>;
  if (tripQuery.isError) {
    return (
      <div className="page narrow">
        {isApiError(tripQuery.error, 'TRIP_NOT_FOUND', 'NOT_FOUND') ? (
          <EmptyState title="Trip not found">
            It may have been deleted. <Link to="/trips">See your trips</Link>
          </EmptyState>
        ) : (
          <ErrorNotice error={tripQuery.error} />
        )}
      </div>
    );
  }

  const itinerary = itineraryQuery.data;

  return (
    <div className="page trip">
      <header className="trip__head">
        <div>
          <Link to="/trips" className="crumbs">
            My trips
          </Link>
          <h1>{trip!.title}</h1>
          <p className="muted">
            {trip!.durationDays} day{trip!.durationDays > 1 ? 's' : ''}
            {trip!.startDate ? `, from ${formatDate(trip!.startDate, true)}` : ', starting today'}
            {`, ${trip!.dailyStartTime}–${trip!.dailyEndTime} each day, by ${TRAVEL_MODE_LABEL[trip!.travelMode].toLowerCase()}`}
          </p>
          <RequirementList trip={trip!} />
        </div>
        <div className="trip__actions">
          <Link to={`/trips/${id}/edit`} className="btn btn--ghost">
            Change requirements
          </Link>
          <button className="btn btn--primary" disabled={build.isPending} onClick={() => build.mutate(trip!)}>
            {build.isPending ? 'Building…' : trip!.currentItineraryId ? 'Rebuild itinerary' : 'Build itinerary'}
          </button>
          <button
            className="btn btn--ghost btn--danger"
            disabled={removeTrip.isPending}
            onClick={() => window.confirm('Delete this trip and all its itinerary versions?') && removeTrip.mutate()}
          >
            Delete trip
          </button>
        </div>
      </header>

      {build.isPending && <Loading label="Choosing places, ordering each day and checking opening hours" />}
      {build.isError && <GenerationError error={build.error} tripId={id} />}
      {removeTrip.isError && <ErrorNotice error={removeTrip.error} />}

      {!itineraryId && !build.isPending && !build.isError && (
        <EmptyState title="No itinerary yet">Build one to see your days, times and route.</EmptyState>
      )}
      {itineraryQuery.isPending && itineraryId && <Loading label="Loading itinerary" />}
      {itineraryQuery.isError && <ErrorNotice error={itineraryQuery.error} />}

      {itinerary?.isCurrent && !build.isPending && trip!.updatedAt > itinerary.createdAt && (
        <Notice
          tone="info"
          title="Your requirements changed after this plan was built"
          action={
            <button className="btn btn--dark" onClick={() => build.mutate(trip!)}>
              Rebuild with new requirements
            </button>
          }
        >
          This itinerary still follows the requirements it was built with.
        </Notice>
      )}

      {itinerary && (
        <ItineraryView
          key={itinerary.id + itinerary.updatedAt}
          itinerary={itinerary}
          start={trip!.startLocation}
          onSaved={afterNewVersion}
        />
      )}

      {versionsQuery.data && versionsQuery.data.data.length > 1 && (
        <Versions
          versions={versionsQuery.data.data}
          shownId={itinerary?.id ?? null}
          onShow={(vid, isCurrent) => {
            const next = new URLSearchParams(params);
            if (isCurrent) next.delete('version');
            else next.set('version', vid);
            setParams(next);
          }}
          onDeleted={() => {
            queryClient.invalidateQueries({ queryKey: ['trip', id] });
            queryClient.invalidateQueries({ queryKey: ['itineraries', id] });
            const next = new URLSearchParams(params);
            next.delete('version');
            setParams(next, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function RequirementList({ trip }: { trip: Trip }) {
  const items = [
    trip.travelingWithPet && 'Pet-friendly only',
    trip.parkingRequired && 'Parking required',
    trip.wheelchairAccessRequired && 'Wheelchair access',
    trip.minimumRating !== null && `${trip.minimumRating}+ stars`,
    trip.budget && `${formatMoney(trip.budget.amount, trip.budget.currency)} ${trip.budget.type === 'per_day' ? 'per day' : 'budget'}`,
    trip.partySize > 1 && `${trip.partySize} people`,
    trip.interests.length > 0 && `Into ${trip.interests.map((i) => i.replace(/_/g, ' ')).join(', ')}`,
  ].filter(Boolean) as string[];
  if (items.length === 0) return null;
  return (
    <ul className="tags tags--quiet" aria-label="Trip requirements">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

const SELECTED_REASON: Record<string, string> = {
  NOT_AVAILABLE: 'is no longer available',
  FAILS_REQUIREMENTS: 'does not meet your must-haves',
  CLOSED_ON_TRIP_DAYS: 'is closed on your trip days',
  NOT_ENOUGH_TIME: 'needs more time than a day allows',
  NO_ROOM_IN_SCHEDULE: 'does not fit into the schedule',
  OVER_BUDGET: 'goes over your budget',
};

function GenerationError({ error, tripId }: { error: unknown; tripId: string }) {
  if (isApiError(error, 'INSUFFICIENT_MATCHING_PLACES')) {
    const d = (error.details ?? {}) as {
      emptyDays?: { dayNumber: number; date: string }[];
      eligiblePlaces?: number;
      candidatesInRadius?: number;
      suggestions?: string[];
    };
    return (
      <Notice
        tone="warning"
        title="Not enough places match to fill every day"
        action={<Link className="btn btn--dark" to={`/trips/${tripId}/edit`}>Change requirements</Link>}
      >
        <p>
          {d.eligiblePlaces ?? 0} of {d.candidatesInRadius ?? 0} nearby places meet your must-haves
          {d.emptyDays?.length ? `, leaving day ${d.emptyDays.map((e) => e.dayNumber).join(' and ')} empty` : ''}.
          Navora does not relax your requirements on its own.
        </p>
        {d.suggestions && d.suggestions.length > 0 && (
          <ul>
            {d.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }
  if (isApiError(error, 'SELECTED_PLACES_NOT_FEASIBLE')) {
    const places = ((error.details as { places?: { placeId: string; name?: string; reason: string }[] })?.places ?? []);
    return (
      <Notice
        tone="warning"
        title="Some places you picked cannot fit"
        action={<Link className="btn btn--dark" to={`/trips/${tripId}/edit`}>Change picks</Link>}
      >
        <ul>
          {places.map((p) => (
            <li key={p.placeId}>
              {p.name ?? 'A place'} {SELECTED_REASON[p.reason] ?? p.reason.toLowerCase().replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      </Notice>
    );
  }
  return <ErrorNotice error={error} title="The itinerary could not be built" />;
}

function stopsRoute(day: ItineraryDay, start: Location): MapRoute {
  if (day.routePolyline) {
    return { id: `day-${day.dayNumber}`, points: decodePolyline(day.routePolyline) };
  }
  // No road geometry: connect start → stops → start with straight dashed lines.
  const pts: [number, number][] = [
    [start.latitude, start.longitude],
    ...day.stops.map((s) => [s.place.location.latitude, s.place.location.longitude] as [number, number]),
    [start.latitude, start.longitude],
  ];
  return { id: `day-${day.dayNumber}`, points: pts, estimated: true };
}

function ItineraryView({
  itinerary,
  start,
  onSaved,
}: {
  itinerary: Itinerary;
  start: Location;
  onSaved: (it: Itinerary) => void;
}) {
  const [dayNumber, setDayNumber] = useState(itinerary.days[0]?.dayNumber ?? 1);
  const [editing, setEditing] = useState(false);
  const day = itinerary.days.find((d) => d.dayNumber === dayNumber) ?? itinerary.days[0];
  const estimated = itinerary.routing.travelTimesEstimated;

  const routes = useMemo<MapRoute[]>(
    () =>
      itinerary.days.map((d) => ({
        ...stopsRoute(d, start),
        muted: d.dayNumber !== day?.dayNumber,
      })),
    [itinerary, start, day?.dayNumber],
  );
  const markers: MapMarker[] = [
    { id: 'start', position: start, label: 'Start and finish', tone: 'start' },
    ...(day?.stops ?? []).map((s) => ({
      id: `${day!.dayNumber}-${s.place.id}`,
      position: s.place.location,
      label: `${s.order}. ${s.place.name} (${s.plannedStart}–${s.plannedEnd})`,
      tone: 'stop' as const,
      order: s.order,
    })),
  ];

  const unknownFees = itinerary.warnings.some((w) => w.code === 'ENTRY_FEE_UNKNOWN');

  return (
    <section className="itinerary">
      {!itinerary.isCurrent && (
        <Notice tone="info" title={`You are viewing version ${itinerary.version}, an older plan. It is read-only.`} />
      )}

      <dl className="totals">
        <div>
          <dt>Distance</dt>
          <dd>{formatDistance(itinerary.totals.distanceMeters)}</dd>
        </div>
        <div>
          <dt>Travelling</dt>
          <dd>{formatMinutes(itinerary.totals.travelMinutes)}</dd>
        </div>
        <div>
          <dt>Visiting</dt>
          <dd>{formatMinutes(itinerary.totals.visitMinutes)}</dd>
        </div>
        <div>
          <dt>Entry fees</dt>
          <dd>
            {itinerary.totals.estimatedCost === null
              ? 'Unknown'
              : `${formatMoney(itinerary.totals.estimatedCost, itinerary.totals.currency)}${unknownFees ? ' + unknown' : ''}`}
          </dd>
        </div>
      </dl>

      <Warnings itinerary={itinerary} />

      <div className="itinerary__grid">
        <div>
          <div className="day-tabs" role="tablist" aria-label="Days">
            {itinerary.days.map((d) => (
              <button
                key={d.dayNumber}
                role="tab"
                aria-selected={d.dayNumber === day?.dayNumber}
                onClick={() => setDayNumber(d.dayNumber)}
              >
                <span className="day-tabs__n">Day {d.dayNumber}</span>
                <span className="day-tabs__date">{formatDate(d.date)}</span>
              </button>
            ))}
          </div>

          {editing ? (
            <ItineraryEditor itinerary={itinerary} onCancel={() => setEditing(false)} onSaved={onSaved} />
          ) : (
            day && <RouteRibbon day={day} estimated={estimated} />
          )}

          {itinerary.isCurrent && !editing && (
            <button className="btn btn--ghost" onClick={() => setEditing(true)}>
              Edit stops
            </button>
          )}
          <p className="fine">
            Version {itinerary.version}
            {itinerary.userModified ? ', edited by you' : ''}. Updated {formatTimestamp(itinerary.updatedAt)}. Order found
            by {itinerary.routing.algorithm.replace(/\+/g, ' + ').replace(/-/g, ' ')}: a short route, not guaranteed
            shortest.
          </p>
        </div>

        <MapView
          ariaLabel={`Route map for day ${day?.dayNumber ?? ''}`}
          className="map--itinerary"
          center={start}
          markers={markers}
          routes={routes}
          fit
        />
      </div>
    </section>
  );
}

function Warnings({ itinerary }: { itinerary: Itinerary }) {
  if (itinerary.warnings.length === 0) return null;
  const names = new Map(itinerary.days.flatMap((d) => d.stops.map((s) => [s.place.id, s.place.name] as const)));
  const byCode = new Map<string, typeof itinerary.warnings>();
  for (const w of itinerary.warnings) byCode.set(w.code, [...(byCode.get(w.code) ?? []), w]);

  const TITLES: Record<string, string> = {
    TRAVEL_TIMES_ESTIMATED: 'Travel times are estimates',
    START_DATE_ASSUMED: 'Start date assumed',
    OPENING_HOURS_UNVERIFIED: 'Opening hours not confirmed',
    ENTRY_FEE_UNKNOWN: 'Entry fee unknown',
    STOP_REMOVED_AFTER_ROUTING: 'A stop was removed',
  };

  return (
    <details className="warnings" open={itinerary.warnings.length <= 3}>
      <summary>
        {itinerary.warnings.length} thing{itinerary.warnings.length > 1 ? 's' : ''} to check before you go
      </summary>
      <ul>
        {[...byCode.entries()].map(([code, list]) => {
          const places = list.map((w) => (w.placeId ? names.get(w.placeId) : null)).filter(Boolean);
          return (
            <li key={code}>
              <strong>{TITLES[code] ?? code}.</strong> {list[0].message}
              {places.length > 0 && <span className="muted"> {places.join(', ')}.</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The signature view: one continuous line from the start, through each stop, back to the start. */
function RouteRibbon({ day, estimated }: { day: ItineraryDay; estimated: boolean }) {
  // The trip back to the start is the part of the day's totals not covered by the legs to each stop.
  const backMeters = day.totals.distanceMeters - day.stops.reduce((sum, s) => sum + s.travelFromPrevious.distanceMeters, 0);
  const backMinutes = day.totals.travelMinutes - day.stops.reduce((sum, s) => sum + s.travelFromPrevious.minutes, 0);
  return (
    <ol className={`ribbon ${estimated ? 'ribbon--estimated' : ''}`} aria-label={`Day ${day.dayNumber} plan`}>
      <li className="ribbon__end">
        <span className="ribbon__time">{day.startTime}</span>
        <span>Leave your starting point</span>
      </li>
      {day.stops.map((stop) => (
        <li key={stop.place.id} className="ribbon__group">
          <div className="ribbon__leg">
            {formatMinutes(stop.travelFromPrevious.minutes)}, {formatDistance(stop.travelFromPrevious.distanceMeters)}
            {estimated ? ' (estimated)' : ''}
          </div>
          <div className="ribbon__stop">
            <span className="ribbon__order" aria-hidden>
              {stop.order}
            </span>
            <div className="ribbon__body">
              <p className="ribbon__time">
                {stop.plannedStart}–{stop.plannedEnd}
              </p>
              <Link to={`/places/${stop.place.id}`} className="ribbon__name">
                {stop.place.name}
              </Link>
              <p className="fine">
                {stop.place.category.name}, {formatMinutes(stop.visitMinutes)} visit,{' '}
                {stop.estimatedCost === null ? 'fee unknown' : formatMoney(stop.estimatedCost)}
              </p>
              {!stop.openingHoursVerified && <p className="ribbon__flag">Opening hours not confirmed</p>}
            </div>
          </div>
        </li>
      ))}
      {day.stops.length === 0 && <li className="muted">Nothing planned for this day.</li>}
      {day.stops.length > 0 && backMeters > 0 && (
        <li className="ribbon__group">
          <div className="ribbon__leg">
            {formatMinutes(Math.max(0, backMinutes))}, {formatDistance(backMeters)}
            {estimated ? ' (estimated)' : ''}
          </div>
        </li>
      )}
      <li className="ribbon__end">
        <span className="ribbon__time">{day.endTime}</span>
        <span>Back at your starting point</span>
      </li>
    </ol>
  );
}

const DAY_REASON: Record<string, string> = {
  TOO_MANY_STOPS: 'has too many stops',
  CLOSED: 'includes a place that is closed then',
  EXCEEDS_DAILY_WINDOW: 'does not fit between your start and end times',
  NO_TIME_TO_RETURN: 'leaves no time to get back',
};

function ItineraryEditor({
  itinerary,
  onCancel,
  onSaved,
}: {
  itinerary: Itinerary;
  onCancel: () => void;
  onSaved: (it: Itinerary) => void;
}) {
  type EditStop = { id: string; name: string };
  const initial = useMemo(
    () =>
      Object.fromEntries(
        itinerary.days.map((d) => [d.dayNumber, d.stops.map((s) => ({ id: s.place.id, name: s.place.name }))]),
      ) as Record<number, EditStop[]>,
    [itinerary],
  );
  const [days, setDays] = useState<Record<number, EditStop[]>>(initial);
  const [optimize, setOptimize] = useState<Record<number, boolean>>({});

  const changedDays = Object.keys(days)
    .map(Number)
    .filter(
      (n) => optimize[n] || days[n].map((s) => s.id).join() !== (initial[n] ?? []).map((s) => s.id).join(),
    );

  const save = useMutation({
    mutationFn: () => {
      const payload: ItineraryEditDay[] = changedDays.map((n) => ({
        dayNumber: n,
        placeIds: days[n].map((s) => s.id),
        optimizeOrder: Boolean(optimize[n]),
      }));
      return itinerariesApi.edit(itinerary.id, payload);
    },
    onSuccess: (it) => {
      onSaved(it);
      onCancel();
    },
  });

  const move = (dayN: number, index: number, delta: number) =>
    setDays((all) => {
      const list = [...all[dayN]];
      const [item] = list.splice(index, 1);
      list.splice(index + delta, 0, item);
      return { ...all, [dayN]: list };
    });
  const remove = (dayN: number, index: number) =>
    setDays((all) => ({ ...all, [dayN]: all[dayN].filter((_, i) => i !== index) }));
  const moveToDay = (from: number, index: number, to: number) =>
    setDays((all) => {
      const item = all[from][index];
      return { ...all, [from]: all[from].filter((_, i) => i !== index), [to]: [...all[to], item] };
    });

  const names = new Map(Object.values(initial).flat().map((s) => [s.id, s.name]));

  return (
    <div className="editor">
      <p className="fine">
        Reorder, remove or move stops between days. Navora re-checks times, opening hours and your must-haves when
        you save; nothing changes if a day no longer fits.
      </p>
      {itinerary.days.map((d) => (
        <fieldset key={d.dayNumber} className="editor__day">
          <legend>
            Day {d.dayNumber}, {formatDate(d.date)}
          </legend>
          <ol>
            {days[d.dayNumber].map((stop, index) => (
              <li key={stop.id}>
                <span className="editor__name">{stop.name}</span>
                <span className="editor__tools">
                  <button type="button" className="icon-btn" aria-label={`Move ${stop.name} earlier`} disabled={index === 0} onClick={() => move(d.dayNumber, index, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${stop.name} later`}
                    disabled={index === days[d.dayNumber].length - 1}
                    onClick={() => move(d.dayNumber, index, 1)}
                  >
                    ↓
                  </button>
                  {itinerary.days.length > 1 && (
                    <select
                      aria-label={`Move ${stop.name} to another day`}
                      value=""
                      onChange={(e) => e.target.value && moveToDay(d.dayNumber, index, Number(e.target.value))}
                    >
                      <option value="">Move to…</option>
                      {itinerary.days
                        .filter((o) => o.dayNumber !== d.dayNumber)
                        .map((o) => (
                          <option key={o.dayNumber} value={o.dayNumber}>
                            Day {o.dayNumber}
                          </option>
                        ))}
                    </select>
                  )}
                  <button type="button" className="link-btn link-btn--danger" onClick={() => remove(d.dayNumber, index)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
            {days[d.dayNumber].length === 0 && <li className="muted">No stops</li>}
          </ol>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(optimize[d.dayNumber])}
              onChange={(e) => setOptimize((o) => ({ ...o, [d.dayNumber]: e.target.checked }))}
            />
            Let Navora re-order this day for the shortest route
          </label>
        </fieldset>
      ))}

      {save.isError && <EditError error={save.error} names={names} />}
      <div className="row">
        <button className="btn btn--primary" disabled={changedDays.length === 0 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Checking and saving…' : 'Save changes'}
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditError({ error, names }: { error: unknown; names: Map<string, string> }) {
  if (isApiError(error, 'ITINERARY_DAY_INFEASIBLE')) {
    const days = (error.details as { days?: { dayNumber: number; reason: string; placeId?: string | null }[] })?.days ?? [];
    return (
      <Notice tone="error" title="These changes do not fit. Nothing was saved.">
        <ul>
          {days.map((d) => (
            <li key={`${d.dayNumber}-${d.reason}`}>
              Day {d.dayNumber} {DAY_REASON[d.reason] ?? d.reason}
              {d.placeId && names.get(d.placeId) ? ` (${names.get(d.placeId)})` : ''}.
            </li>
          ))}
        </ul>
      </Notice>
    );
  }
  if (isApiError(error, 'PLACE_VIOLATES_REQUIREMENTS')) {
    const places = (error.details as { places?: { placeId: string; name: string; requirements: string[] }[] })?.places ?? [];
    return (
      <Notice tone="error" title="A place does not meet this trip’s must-haves. Nothing was saved.">
        <ul>
          {places.map((p) => (
            <li key={p.placeId}>
              {p.name}: {p.requirements.join(', ')}
            </li>
          ))}
        </ul>
      </Notice>
    );
  }
  return <Notice tone="error" title={errorMessage(error)} />;
}

function Versions({
  versions,
  shownId,
  onShow,
  onDeleted,
}: {
  versions: { id: string; version: number; isCurrent: boolean; userModified: boolean; stopCount: number; createdAt: string }[];
  shownId: string | null;
  onShow: (id: string, isCurrent: boolean) => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({ mutationFn: (vid: string) => itinerariesApi.remove(vid), onSuccess: onDeleted });
  return (
    <section className="versions">
      <h2>Earlier versions</h2>
      <ul>
        {versions.map((v) => (
          <li key={v.id} className={v.id === shownId ? 'is-shown' : ''}>
            <button className="link-btn" onClick={() => onShow(v.id, v.isCurrent)}>
              Version {v.version}
              {v.isCurrent ? ' (current)' : ''}
            </button>
            <span className="fine">
              {v.stopCount} stops{v.userModified ? ', edited' : ''}, {formatTimestamp(v.createdAt)}
            </span>
            <button
              className="link-btn link-btn--danger"
              disabled={remove.isPending}
              onClick={() => window.confirm(`Delete version ${v.version}?`) && remove.mutate(v.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {remove.isError && <ErrorNotice error={remove.error} />}
    </section>
  );
}
