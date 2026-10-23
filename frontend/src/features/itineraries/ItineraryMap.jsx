import { useEffect, useEffectEvent, useMemo } from 'react';
import { Link } from 'react-router';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { decodePolyline } from '../../lib/polyline.js';
import { prefersReducedMotion } from '../../lib/motion.js';
import styles from './ItineraryMap.module.css';

// One day of an itinerary: start point, numbered stops and the route. The road route is
// drawn only when the backend sent one (routePolyline); otherwise dashed straight lines
// show the visiting order and the legend says they are not the road route.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const numberIcon = (order, active) =>
  L.divIcon({
    html: `<span>${order}</span>`,
    className: `${styles.stopMarker} ${active ? styles.stopMarkerActive : ''}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

const startIcon = L.divIcon({
  html: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" fill="currentColor"/></svg>',
  className: styles.startMarker,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const toLatLng = ({ latitude, longitude }) => [latitude, longitude];

function FitDay({ points, dayKey }) {
  const map = useMap();
  const fit = useEffectEvent(() => {
    if (points.length) map.fitBounds(points, { padding: [32, 32], maxZoom: 16 });
  });
  useEffect(() => fit(), [map, dayKey]);
  return null;
}

// Leaflet measures its container once; re-measure when it is resized.
function TrackSize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function ItineraryMap({ start, day, activeOrder }) {
  const stops = day.stops;
  const road = useMemo(() => (day.routePolyline ? decodePolyline(day.routePolyline) : null), [day.routePolyline]);
  const straight = useMemo(
    () => [toLatLng(start), ...stops.map((s) => toLatLng(s.place.location)), toLatLng(start)],
    [start, stops],
  );
  const points = road ?? straight;
  const reduceMotion = prefersReducedMotion();

  return (
    <figure className={styles.figure}>
      <MapContainer center={toLatLng(start)} zoom={13} className={styles.map} aria-label={`Map of day ${day.dayNumber}`} zoomAnimation={!reduceMotion} fadeAnimation={!reduceMotion} markerZoomAnimation={!reduceMotion}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <Polyline
          positions={points}
          pathOptions={road ? { color: '#1e3a8a', weight: 4, opacity: 0.8 } : { color: '#1e3a8a', weight: 2, dashArray: '6 8', opacity: 0.7 }}
        />
        {/* Not interactive: it has no popup or action, so it should not be a focusable control. */}
        <Marker position={toLatLng(start)} icon={startIcon} title="Start point" alt="Start point" interactive={false} keyboard={false} />
        {stops.map((stop) => (
          <Marker
            key={stop.place.id}
            position={toLatLng(stop.place.location)}
            icon={numberIcon(stop.order, stop.order === activeOrder)}
            title={`${stop.order}. ${stop.place.name}`}
            alt={`Stop ${stop.order}: ${stop.place.name}`}
            zIndexOffset={stop.order === activeOrder ? 1000 : 0}
          >
            <Popup>
              <div className={styles.popupName}>
                {stop.order}. {stop.place.name}
              </div>
              <div className={styles.popupTime}>
                {stop.plannedStart}–{stop.plannedEnd}
              </div>
              <Link to={`/places/${stop.place.id}`}>View place</Link>
            </Popup>
          </Marker>
        ))}
        <FitDay points={points} dayKey={`${day.dayNumber}:${stops.map((s) => s.place.id).join(',')}`} />
        <TrackSize />
      </MapContainer>
      <figcaption className={styles.legend}>
        {road ? 'Road route for this day.' : 'Dashed lines show the visiting order, not the road route.'}
      </figcaption>
    </figure>
  );
}
