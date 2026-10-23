import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { LocateFixed } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { Button } from '../../components/Button.jsx';
import { prefersReducedMotion } from '../../lib/motion.js';
import styles from './PlacesMap.module.css';

// Leaflet + OpenStreetMap tiles (free, no key). All map-provider code stays in this file.
// Loaded lazily so Leaflet is not in the main bundle.
const DHAKA = [23.8103, 90.4125];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Map pins are SVG, styled by PlacesMap.module.css (.marker, .markerSelected).
const PIN_SVG =
  '<svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>';

const icons = {
  normal: L.divIcon({ html: PIN_SVG, className: styles.marker, iconSize: [24, 32], iconAnchor: [12, 32], popupAnchor: [0, -28] }),
  selected: L.divIcon({
    html: PIN_SVG,
    className: `${styles.marker} ${styles.markerSelected}`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -28],
  }),
};

const toLatLng = ({ latitude, longitude }) => [latitude, longitude];

// Fit the view to the results whenever the set of results (not the selection) changes.
function FitToResults({ places, center, radiusKm }) {
  const map = useMap();
  const key = places.map((p) => p.id).join(',') + (center ? `@${center.latitude},${center.longitude},${radiusKm}` : '');

  const fit = useEffectEvent(() => {
    const points = places.map((p) => toLatLng(p.location));
    if (center) {
      const area = L.latLng(toLatLng(center)).toBounds(radiusKm * 2000);
      map.fitBounds(points.length ? area.extend(L.latLngBounds(points)) : area, { padding: [24, 24] });
    } else if (points.length) {
      map.fitBounds(points, { padding: [32, 32], maxZoom: 15 });
    } else {
      map.setView(DHAKA, 12);
    }
  });

  // Refit only when the result set changes (`key`), not on every render.
  useEffect(() => fit(), [map, key]);

  return null;
}

// Leaflet measures its container once; re-measure when it is resized or shown (small
// screens switch between list and map).
function TrackSize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// Open the selected place's popup and bring it into view (selection may come from the list).
function FocusSelected({ selectedId, markers }) {
  const map = useMap();
  useEffect(() => {
    const marker = selectedId && markers.current.get(selectedId);
    if (!marker) return;
    map.panTo(marker.getLatLng(), { animate: !prefersReducedMotion() });
    marker.openPopup();
  }, [map, selectedId, markers]);
  return null;
}

export default function PlacesMap({ places, selectedId, onSelect, center, radiusKm, onSearchArea }) {
  const [map, setMap] = useState(null);
  const markers = useRef(new Map());
  const located = useMemo(() => places.filter((p) => p.location), [places]);
  const reduceMotion = prefersReducedMotion();

  return (
    // react-leaflet passes only className/id/style to its element, so the accessible name
    // lives on this wrapper.
    <div className={styles.wrapper} role="region" aria-label="Map of results">
      <MapContainer center={DHAKA} zoom={12} className={styles.map} ref={setMap} zoomAnimation={!reduceMotion} fadeAnimation={!reduceMotion} markerZoomAnimation={!reduceMotion}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        {center && (
          <Circle
            center={toLatLng(center)}
            radius={radiusKm * 1000}
            pathOptions={{ color: '#1e3a8a', weight: 1, fillColor: '#1e3a8a', fillOpacity: 0.04 }}
          />
        )}
        {located.map((place) => (
          <Marker
            key={place.id}
            position={toLatLng(place.location)}
            icon={place.id === selectedId ? icons.selected : icons.normal}
            title={place.name}
            alt={place.name}
            zIndexOffset={place.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(place.id) }}
            ref={(marker) => {
              if (marker) markers.current.set(place.id, marker);
              else markers.current.delete(place.id);
            }}
          >
            <Popup>
              <div className={styles.popupCategory}>{place.category.name}</div>
              <div className={styles.popupName}>{place.name}</div>
              <Link to={`/places/${place.id}`}>View details</Link>
            </Popup>
          </Marker>
        ))}
        <FitToResults places={located} center={center} radiusKm={radiusKm} />
        <FocusSelected selectedId={selectedId} markers={markers} />
        <TrackSize />
      </MapContainer>
      {map && onSearchArea && (
        <div className={styles.overlay}>
          <Button
            variant="secondary"
            size="sm"
            icon={LocateFixed}
            onClick={() => {
              const { lat, lng } = map.getCenter();
              onSearchArea({ latitude: lat, longitude: lng });
            }}
          >
            Search this area
          </Button>
        </div>
      )}
    </div>
  );
}
