import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { prefersReducedMotion } from '../lib/motion.js';
import styles from './LocationPicker.module.css';

// Click the map (or drag the pin) to choose a point. Callers give keyboard users coordinate
// fields next to it. Load it lazily: it pulls in Leaflet.
const DHAKA = [23.8103, 90.4125];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const PIN = L.divIcon({
  html: '<svg viewBox="0 0 24 32" width="28" height="36" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>',
  className: styles.pin,
  iconSize: [28, 36],
  iconAnchor: [14, 36],
});

function ClickToPick({ onChange }) {
  useMapEvents({ click: ({ latlng }) => onChange({ latitude: latlng.lat, longitude: latlng.lng }) });
  return null;
}

// Follow the value when it changes from outside the map (geolocation, typed coordinates).
function FollowValue({ value }) {
  const map = useMap();
  useEffect(() => {
    if (value && !map.getBounds().contains([value.latitude, value.longitude])) {
      map.setView([value.latitude, value.longitude], Math.max(map.getZoom(), 14));
    }
  }, [map, value]);
  return null;
}

export default function LocationPicker({ value, onChange, label = 'Map: click to choose a point' }) {
  const reduceMotion = prefersReducedMotion();
  return (
    <MapContainer
      center={value ? [value.latitude, value.longitude] : DHAKA}
      zoom={value ? 14 : 12}
      className={styles.map}
      aria-label={label}
      zoomAnimation={!reduceMotion}
      fadeAnimation={!reduceMotion}
      markerZoomAnimation={!reduceMotion}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <ClickToPick onChange={onChange} />
      <FollowValue value={value} />
      {value && (
        <Marker
          position={[value.latitude, value.longitude]}
          icon={PIN}
          draggable
          title="Chosen point"
          alt="Chosen point"
          eventHandlers={{
            dragend: (event) => {
              const { lat, lng } = event.target.getLatLng();
              onChange({ latitude: lat, longitude: lng });
            },
          }}
        />
      )}
    </MapContainer>
  );
}
