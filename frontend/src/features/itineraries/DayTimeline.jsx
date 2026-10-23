import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Bike, Bus, Car, Clock, Footprints, Pencil, Ticket, Trash2, TriangleAlert } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button, IconButton } from '../../components/Button.jsx';
import { Checkbox, Field, Select } from '../../components/Field.jsx';
import { useToast } from '../../components/useToast.js';
import { formatDayDate, formatDistance, formatEntryFee, formatMinutes } from '../../lib/format.js';
import { useSavedPlaces } from '../saved/api.js';
import { recommendForDay, updateItinerary } from './api.js';
import { ErrorAlert } from '../../components/ErrorState.jsx';
import styles from './DayTimeline.module.css';

const MODE_ICONS = { car: Car, walking: Footprints, cycling: Bike, public_transport: Bus };

function Leg({ stop, estimated, travelMode }) {
  const Icon = MODE_ICONS[travelMode] ?? Car;
  const { minutes, distanceMeters } = stop.travelFromPrevious;
  const from = stop.order === 1 ? 'From start point' : 'From previous stop';
  return (
    <p className={styles.leg}>
      <Icon size={14} aria-hidden="true" />
      {from}: {formatMinutes(minutes)}, {formatDistance(distanceMeters)}
      {estimated && <span className={styles.estimated}> (estimated)</span>}
    </p>
  );
}

function StopRow({ stop, currency, estimated, travelMode, active, onActivate }) {
  return (
    <li className={`${styles.stop} ${active ? styles.active : ''}`}>
      <span className={styles.number} aria-hidden="true">
        {stop.order}
      </span>
      <div className={styles.stopBody}>
        <Leg stop={stop} estimated={estimated} travelMode={travelMode} />
        <div className={styles.stopCard} onMouseEnter={onActivate} onFocus={onActivate}>
          <p className={styles.time}>
            <span className="visually-hidden">Stop {stop.order}, </span>
            {stop.plannedStart}–{stop.plannedEnd}
          </p>
          <h4 className={styles.name}>
            <Link to={`/places/${stop.place.id}`}>{stop.place.name}</Link>
          </h4>
          <ul className={styles.meta}>
            <li>{stop.place.category.name}</li>
            <li>
              <Clock size={14} aria-hidden="true" />
              {formatMinutes(stop.visitMinutes)} visit
            </li>
            <li className={stop.estimatedCost === null ? styles.unknown : undefined}>
              <Ticket size={14} aria-hidden="true" />
              {formatEntryFee(stop.estimatedCost, currency)}
            </li>
          </ul>
          {!stop.openingHoursVerified && (
            <Badge tone="warning" icon={TriangleAlert}>
              Opening hours not verified
            </Badge>
          )}
        </div>
      </div>
    </li>
  );
}

// Reorder, remove, move to another day, or add stops; the backend re-schedules every changed
// day and checks it, and nothing changes if any of them does not fit.
function DayEditor({ itinerary, trip, day, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [stops, setStops] = useState(day.stops.map((s) => s.place));
  // placeId -> another day's number, for stops being moved there.
  const [moves, setMoves] = useState({});
  const [optimizeOrder, setOptimizeOrder] = useState(false);
  const save = useMutation({
    mutationFn: () => updateItinerary(itinerary.id, buildChanges(itinerary, day, stops, moves, optimizeOrder)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['itineraries', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      const days = [...new Set([day.dayNumber, ...Object.values(moves)])].sort((a, b) => a - b);
      const which = days.length > 1 ? `Days ${days.join(', ')} were` : `Day ${day.dayNumber} was`;
      toast.show({ tone: 'success', message: `${which} updated and re-scheduled.` });
      onDone();
    },
    onError: (error) => {
      if (error.code === 'ITINERARY_NOT_CURRENT') queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const move = (index, delta) =>
    setStops((list) => {
      const next = [...list];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  const otherDays = itinerary.days.filter((d) => d.dayNumber !== day.dayNumber);
  const staying = stops.filter((p) => !moves[p.id]);

  return (
    <div className={styles.editor}>
      <p className={styles.editorHint}>
        Reorder, remove, add or move stops to another day, then save. NAVORA recalculates times and checks opening
        hours; nothing changes if a day does not fit.
      </p>
      {save.isError && <ErrorAlert error={save.error} />}
      {staying.length === 0 && <p className="muted">This day will have no stops.</p>}
      <ol className={styles.editList}>
        {stops.map((place, index) => (
          <li key={place.id} className={`${styles.editItem} ${moves[place.id] ? styles.moving : ''}`}>
            <span className={styles.editNumber}>{index + 1}</span>
            <span className={styles.editName}>{place.name}</span>
            {otherDays.length > 0 && (
              <Select
                className={styles.daySelect}
                aria-label={`Day for ${place.name}`}
                value={moves[place.id] ?? day.dayNumber}
                onChange={(e) => {
                  const target = Number(e.target.value);
                  setMoves(({ [place.id]: _, ...rest }) => (target === day.dayNumber ? rest : { ...rest, [place.id]: target }));
                }}
              >
                {itinerary.days.map((d) => (
                  <option key={d.dayNumber} value={d.dayNumber}>
                    {d.dayNumber === day.dayNumber ? `Day ${d.dayNumber}` : `Move to day ${d.dayNumber}`}
                  </option>
                ))}
              </Select>
            )}
            <IconButton icon={ArrowUp} size="sm" label={`Move ${place.name} up`} disabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton
              icon={ArrowDown}
              size="sm"
              label={`Move ${place.name} down`}
              disabled={index === stops.length - 1}
              onClick={() => move(index, 1)}
            />
            <IconButton
              icon={Trash2}
              size="sm"
              label={`Remove ${place.name}`}
              onClick={() => setStops((list) => list.filter((p) => p.id !== place.id))}
            />
          </li>
        ))}
      </ol>
      <AddPlace
        itinerary={itinerary}
        trip={trip}
        day={day}
        exclude={stops.map((p) => p.id)}
        onAdd={(place) => setStops((list) => [...list, place])}
      />
      <Checkbox
        label="Reorder for a short route when saving"
        description="NAVORA puts the stops of each changed day in a short visiting order for you."
        checked={optimizeOrder}
        onChange={(e) => setOptimizeOrder(e.target.checked)}
      />
      <div className="cluster">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save day {day.dayNumber}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// This day's new stop list, plus each day receiving moved stops (appended to its own).
export function buildChanges(itinerary, day, stops, moves, optimizeOrder) {
  const changes = [{ dayNumber: day.dayNumber, placeIds: stops.filter((p) => !moves[p.id]).map((p) => p.id), optimizeOrder }];
  for (const target of itinerary.days) {
    const incoming = stops.filter((p) => moves[p.id] === target.dayNumber).map((p) => p.id);
    if (incoming.length) {
      changes.push({ dayNumber: target.dayNumber, placeIds: [...target.stops.map((s) => s.place.id), ...incoming], optimizeOrder });
    }
  }
  return changes;
}

// Recommendations for this day (the trip's requirements apply) and saved places, minus
// places already in the itinerary.
function AddPlace({ itinerary, trip, day, exclude, onAdd }) {
  const recommended = useQuery({
    queryKey: ['recommendations', 'day', trip.id, trip.updatedAt, day.date],
    queryFn: ({ signal }) => recommendForDay(trip, day.date, { signal }),
  });
  const saved = useSavedPlaces(1, 50);
  const planned = new Set([...exclude, ...itinerary.days.flatMap((d) => d.stops.map((s) => s.place.id))]);
  const recommendedPlaces = (recommended.data ?? []).map((r) => r.place).filter((p) => !planned.has(p.id));
  const shown = new Set(recommendedPlaces.map((p) => p.id));
  const savedPlaces = (saved.data?.data ?? []).filter((p) => !planned.has(p.id) && !shown.has(p.id));
  const byId = new Map([...recommendedPlaces, ...savedPlaces].map((p) => [p.id, p]));
  const loading = recommended.isPending || saved.isPending;

  return (
    <Field
      label="Add a place"
      hint={
        recommended.isError
          ? 'Recommendations could not be loaded; your saved places are listed.'
          : 'Recommended places match this trip. Saved places must meet its requirements too.'
      }
    >
      {(props) => (
        <Select
          {...props}
          value=""
          disabled={loading || byId.size === 0}
          onChange={(e) => byId.has(e.target.value) && onAdd(byId.get(e.target.value))}
        >
          <option value="">{loading ? 'Loading places' : byId.size === 0 ? 'No other places to add' : 'Choose a place'}</option>
          {recommendedPlaces.length > 0 && (
            <optgroup label="Recommended for this trip">
              {recommendedPlaces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {savedPlaces.length > 0 && (
            <optgroup label="Your saved places">
              {savedPlaces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      )}
    </Field>
  );
}

export function DayTimeline({ itinerary, trip, day, activeOrder, onActiveChange }) {
  const [editing, setEditing] = useState(false);
  const estimated = itinerary.routing.travelTimesEstimated;
  const { currency } = itinerary.totals;

  return (
    <section className={styles.day} aria-labelledby={`day-${day.dayNumber}-heading`}>
      <div className={styles.dayHeader}>
        <div>
          <h3 id={`day-${day.dayNumber}-heading`} className={styles.dayTitle}>
            Day {day.dayNumber}, {formatDayDate(day.date)}
          </h3>
          <p className={styles.dayTotals}>
            {day.stops.length} stop{day.stops.length === 1 ? '' : 's'}, {formatMinutes(day.totals.visitMinutes)} visiting,{' '}
            {formatMinutes(day.totals.travelMinutes)} travelling ({formatDistance(day.totals.distanceMeters)})
          </p>
        </div>
        {itinerary.isCurrent && !editing && (
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            Edit day
          </Button>
        )}
      </div>

      {editing ? (
        <DayEditor itinerary={itinerary} trip={trip} day={day} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className={styles.boundary}>Leave the start point at {day.startTime}</p>
          {day.stops.length === 0 ? (
            <p className="muted">No stops planned for this day.</p>
          ) : (
            <ol className={styles.timeline}>
              {day.stops.map((stop) => (
                <StopRow
                  key={stop.place.id}
                  stop={stop}
                  currency={currency}
                  estimated={estimated}
                  travelMode={trip.travelMode}
                  active={stop.order === activeOrder}
                  onActivate={() => onActiveChange(stop.order)}
                />
              ))}
            </ol>
          )}
          <p className={styles.boundary}>Back at the start point by {day.endTime}</p>
        </>
      )}
    </section>
  );
}
