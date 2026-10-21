import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Bike, Bus, Car, Clock, Footprints, Pencil, Ticket, Trash2, TriangleAlert } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button, IconButton } from '../../components/Button.jsx';
import { Alert } from '../../components/Feedback.jsx';
import { Checkbox } from '../../components/Field.jsx';
import { useToast } from '../../components/useToast.js';
import { errorMessage } from '../../lib/errors.js';
import { formatDayDate, formatDistance, formatEntryFee, formatMinutes } from '../../lib/format.js';
import { updateItinerary } from './api.js';
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

// Reorder or remove stops of one day; the backend re-schedules the day and checks it.
function DayEditor({ itinerary, day, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [stops, setStops] = useState(day.stops.map((s) => s.place));
  const [optimizeOrder, setOptimizeOrder] = useState(false);
  const save = useMutation({
    mutationFn: () => updateItinerary(itinerary.id, [{ dayNumber: day.dayNumber, placeIds: stops.map((p) => p.id), optimizeOrder }]),
    onSuccess: (updated) => {
      queryClient.setQueryData(['itineraries', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      toast.show({ tone: 'success', message: `Day ${day.dayNumber} was updated and re-scheduled.` });
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

  return (
    <div className={styles.editor}>
      <p className={styles.editorHint}>
        Reorder or remove stops, then save. NAVORA recalculates times and checks opening hours; nothing changes if the
        new day does not fit.
      </p>
      {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      {stops.length === 0 && <p className="muted">This day will have no stops.</p>}
      <ol className={styles.editList}>
        {stops.map((place, index) => (
          <li key={place.id} className={styles.editItem}>
            <span className={styles.editNumber}>{index + 1}</span>
            <span className={styles.editName}>{place.name}</span>
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
      <Checkbox
        label="Reorder for a short route when saving"
        description="NAVORA puts these stops in a short visiting order for you."
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

export function DayTimeline({ itinerary, day, travelMode, activeOrder, onActiveChange }) {
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
        {itinerary.isCurrent && !editing && day.stops.length > 0 && (
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            Edit day
          </Button>
        )}
      </div>

      {editing ? (
        <DayEditor itinerary={itinerary} day={day} onDone={() => setEditing(false)} />
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
                  travelMode={travelMode}
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
