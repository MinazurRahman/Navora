import { Suspense, lazy, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarRange, RefreshCw, Settings2, Sparkles, Trash2, TriangleAlert, Users } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button } from '../../components/Button.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { ErrorAlert, ErrorState } from '../../components/ErrorState.jsx';
import { Alert, EmptyState, Skeleton } from '../../components/Feedback.jsx';
import { useToast } from '../../components/useToast.js';
import { formatDayDate, formatDistance, formatMinutes } from '../../lib/format.js';
import { deleteTrip, getTrip } from '../trips/api.js';
import { TRAVEL_MODES } from '../trips/tripForm.js';
import { generateItinerary, getItinerary, regenerateItinerary } from './api.js';
import { AssistantPanel } from './AssistantPanel.jsx';
import { DayTimeline } from './DayTimeline.jsx';
import { VersionHistory } from './VersionHistory.jsx';
import styles from './TripPage.module.css';

const ItineraryMap = lazy(() => import('./ItineraryMap.jsx'));

const WARNING_LABELS = {
  TRAVEL_TIMES_ESTIMATED: 'Travel times are estimates',
  START_DATE_ASSUMED: 'Start date assumed',
  OPENING_HOURS_UNVERIFIED: 'Opening hours not verified',
  ENTRY_FEE_UNKNOWN: 'Entry fees unknown',
  STOP_REMOVED_AFTER_ROUTING: 'A stop was removed',
};

// The backend's own messages, grouped by warning code.
function Warnings({ warnings }) {
  if (warnings.length === 0) return null;
  const groups = new Map();
  for (const w of warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w]);
  return (
    <section className={styles.warnings} aria-labelledby="warnings-heading">
      <h2 id="warnings-heading" className={styles.sectionHeading}>
        <TriangleAlert size={18} aria-hidden="true" />
        Before you go
      </h2>
      <ul className={styles.warningList}>
        {[...groups].map(([code, items]) => (
          <li key={code}>
            <p className={styles.warningTitle}>{WARNING_LABELS[code] ?? 'Note'}</p>
            {items.length === 1 ? (
              <p className={styles.warningText}>{items[0].message}</p>
            ) : (
              <details className={styles.warningDetails}>
                <summary>{items.length} notes</summary>
                <ul>
                  {items.map((w, i) => (
                    <li key={i}>
                      {w.dayNumber ? `Day ${w.dayNumber}: ` : ''}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The total counts known fees only. With no known fee it is unknown; with some unknown
// it is a minimum, never presented as the full price.
function costText({ totals, days }) {
  const stops = days.flatMap((d) => d.stops);
  const known = stops.filter((stop) => stop.estimatedCost !== null).length;
  if (totals.estimatedCost === null || (stops.length > 0 && known === 0)) return 'Unknown';
  const amount = `${totals.currency} ${new Intl.NumberFormat('en').format(totals.estimatedCost)}`;
  return known < stops.length ? `At least ${amount}` : amount;
}

function GenerateFailure({ error, tripId }) {
  const details = error.details ?? {};
  return (
    <Alert tone="warning" title="No itinerary could be made with these requirements">
      <p>{error.message}</p>
      {details.suggestions?.length > 0 && (
        <ul className={styles.reasons}>
          {details.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <div className={styles.failureAction}>
        <Button as={Link} to={`/plan?trip=${tripId}`} variant="secondary" size="sm" icon={Settings2}>
          Change trip settings
        </Button>
      </div>
    </Alert>
  );
}

export function TripPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dayIndex, setDayIndex] = useState(0);
  const [activeOrder, setActiveOrder] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [searchParams] = useSearchParams();
  const trip = useQuery({ queryKey: ['trips', tripId], queryFn: ({ signal }) => getTrip(tripId, { signal }) });
  // ?version=<itineraryId> shows an older version (read-only); otherwise the current one.
  const itineraryId = searchParams.get('version') ?? trip.data?.currentItineraryId;
  const itinerary = useQuery({
    queryKey: ['itineraries', itineraryId],
    queryFn: ({ signal }) => getItinerary(itineraryId, { signal }),
    enabled: Boolean(itineraryId),
  });

  // A new version becomes current: show it and refresh the trip that points to it.
  function showNewVersion(next) {
    queryClient.setQueryData(['itineraries', next.id], next);
    queryClient.invalidateQueries({ queryKey: ['trips'] });
    // Every other version just stopped being current, including cached copies.
    queryClient.invalidateQueries({ queryKey: ['itineraries'], predicate: (q) => q.queryKey[1] !== next.id });
    setDayIndex(0);
    setActiveOrder(null);
    if (searchParams.has('version')) navigate(`/trips/${tripId}`);
  }

  const regenerate = useMutation({
    mutationFn: () => (itineraryId ? regenerateItinerary(itineraryId) : generateItinerary(tripId)),
    onSuccess: (next) => {
      showNewVersion(next);
      toast.show({ tone: 'success', message: `Version ${next.version} of your itinerary is ready.` });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteTrip(tripId),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      toast.show({ tone: 'info', message: 'The trip was deleted.' });
      await navigate('/trips');
    },
  });

  if (trip.isPending || (itineraryId && itinerary.isPending)) {
    return (
      <main className={`container ${styles.page}`} aria-busy="true" aria-label="Loading trip">
        <Skeleton width="50%" height="2.25rem" />
        <Skeleton width="30%" />
        <Skeleton height="20rem" />
      </main>
    );
  }

  const loadError = trip.error ?? itinerary.error;
  if (loadError) {
    const missing = loadError.status === 404 || loadError.code === 'VALIDATION_ERROR';
    return (
      <main className={`container ${styles.page}`}>
        <title>{missing ? 'Trip not found | NAVORA' : 'NAVORA'}</title>
        {missing ? (
          <EmptyState
            headingLevel={1}
            icon={CalendarRange}
            title="Trip not found"
            description="This trip does not exist or belongs to another account."
            action={
              <Button as={Link} to="/trips">
                My trips
              </Button>
            }
          />
        ) : (
          <ErrorState error={loadError} onRetry={() => (trip.error ? trip.refetch() : itinerary.refetch())} title="This trip could not be loaded" />
        )}
      </main>
    );
  }

  const t = trip.data;
  const plan = itinerary.data?.tripId === t.id ? itinerary.data : undefined;
  const day = plan?.days[Math.min(dayIndex, plan.days.length - 1)];
  const mode = TRAVEL_MODES.find((m) => m.value === t.travelMode)?.label;
  const failure = regenerate.error?.status === 422 ? regenerate.error : null;

  return (
    <main className={`container ${styles.page}`}>
      <title>{`${t.title} | NAVORA`}</title>
      <Link to="/trips" className={styles.back}>
        <ArrowLeft size={16} aria-hidden="true" />
        My trips
      </Link>

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1>{t.title}</h1>
          <ul className={styles.tripMeta}>
            <li>
              <CalendarRange size={16} aria-hidden="true" />
              {plan
                ? `${formatDayDate(plan.days[0].date)} to ${formatDayDate(plan.days.at(-1).date)}`
                : `${t.durationDays} day${t.durationDays === 1 ? '' : 's'}`}
            </li>
            <li>{mode}</li>
            <li>
              <Users size={16} aria-hidden="true" />
              {t.partySize} {t.partySize === 1 ? 'person' : 'people'}
            </li>
            {t.startAddress && <li>From {t.startAddress}</li>}
          </ul>
          {plan && (
            <div className="cluster">
              <Badge>Version {plan.version}</Badge>
              {plan.userModified && <Badge tone="info">Edited by you</Badge>}
            </div>
          )}
        </div>
        <div className={styles.actions}>
          {plan && (
            <Button variant="secondary" icon={RefreshCw} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
              Regenerate
            </Button>
          )}
          <Button as={Link} to={`/plan?trip=${t.id}`} variant="secondary" icon={Settings2}>
            Change trip settings
          </Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
            Delete trip
          </Button>
        </div>
      </header>

      {plan && !plan.isCurrent && (
        <Alert tone="info" title={`You are viewing version ${plan.version}, an older version`}>
          <p>
            Older versions cannot be edited. <Link to={`/trips/${t.id}`}>Show the current version</Link>
          </p>
        </Alert>
      )}

      {failure && <GenerateFailure error={failure} tripId={t.id} />}
      {regenerate.isError && !failure && <ErrorAlert error={regenerate.error} />}

      {!plan && (
        <EmptyState
          icon={Sparkles}
          title="No itinerary yet"
          description="Generate a day-by-day plan from this trip's settings."
          action={
            <Button icon={Sparkles} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
              Generate itinerary
            </Button>
          }
        />
      )}

      {plan && (
        <>
          <dl className={styles.totals}>
            <div>
              <dt>Stops</dt>
              <dd>{plan.days.reduce((n, d) => n + d.stops.length, 0)}</dd>
            </div>
            <div>
              <dt>Visiting</dt>
              <dd>{formatMinutes(plan.totals.visitMinutes)}</dd>
            </div>
            <div>
              <dt>Travelling</dt>
              <dd>
                {formatMinutes(plan.totals.travelMinutes)}, {formatDistance(plan.totals.distanceMeters)}
              </dd>
            </div>
            <div>
              <dt>Entry fees</dt>
              <dd>{costText(plan)}</dd>
            </div>
          </dl>
          <p className={styles.routeNote}>
            Stops are ordered for a short route: a good order, not a guaranteed shortest one.
            {plan.routing.travelTimesEstimated && ' Travel times are estimated from distance.'}
          </p>

          <Warnings warnings={plan.warnings} />
          <VersionHistory
            tripId={t.id}
            viewingId={plan.id}
            onDeleted={(id) => {
              if (id === plan.id) navigate(`/trips/${t.id}`, { replace: true });
            }}
          />

          {plan.days.length > 1 && (
            <div className={styles.dayTabs} role="group" aria-label="Choose a day">
              {plan.days.map((d, index) => (
                <Button
                  key={d.dayNumber}
                  variant={index === dayIndex ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={index === dayIndex}
                  onClick={() => {
                    setDayIndex(index);
                    setActiveOrder(null);
                  }}
                >
                  Day {d.dayNumber}
                </Button>
              ))}
            </div>
          )}

          <div className={styles.layout}>
            <div className={styles.timelineColumn}>
              <DayTimeline key={`${plan.id}:${plan.updatedAt}:${day.dayNumber}`} itinerary={plan} trip={t} day={day} activeOrder={activeOrder} onActiveChange={setActiveOrder} />
            </div>
            <div className={styles.sideColumn}>
              <div className={styles.mapBox}>
                <Suspense fallback={<Skeleton height="100%" />}>
                  <ItineraryMap start={t.startLocation} day={day} activeOrder={activeOrder} />
                </Suspense>
              </div>
              <AssistantPanel itinerary={plan} />
            </div>
          </div>
        </>
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this trip?"
        description="The trip and every version of its itinerary will be deleted. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete trip
            </Button>
          </>
        }
      >
        {remove.isError && <ErrorAlert error={remove.error} />}
      </Dialog>
    </main>
  );
}
