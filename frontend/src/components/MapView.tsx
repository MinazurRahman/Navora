// The one map component every screen uses (discovery, place details, planner, itinerary,
// place submission). Built on Leaflet + OpenStreetMap tiles. Coordinates are [lat, lng].

import { useEffect, useMemo } from 'react';
import L, { type DivIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Location } from '../api/types';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors';

export type MarkerTone = 'place' | 'selected' | 'start' | 'stop' | 'pick';

export interface MapMarker {
  id: string;
  position: Location;
  label: string;
  tone?: MarkerTone;
  /** Shown inside stop markers (visit order). */
  order?: number;
  onClick?: () => void;
}

export interface MapRoute {
  id: string;
  points: [number, number][];
  /** Straight lines between stops because no road route is available: drawn dashed. */
  estimated?: boolean;
  muted?: boolean;
}

interface MapViewProps {
  center: Location;
  zoom?: number;
  markers?: MapMarker[];
  routes?: MapRoute[];
  /** Fit the view to all markers and routes whenever they change. */
  fit?: boolean;
  /** Called with the clicked point: makes the map a location picker. */
  onPick?: (location: Location) => void;
  className?: string;
  ariaLabel: string;
}

const icons = new Map<string, DivIcon>();
function iconFor(tone: MarkerTone, order?: number): DivIcon {
  const key = `${tone}-${order ?? ''}`;
  let icon = icons.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<span class="pin pin--${tone}">${order ?? ''}</span>`,
      iconSize: tone === 'stop' ? [28, 28] : [20, 20],
      iconAnchor: tone === 'stop' ? [14, 14] : [10, 10],
    });
    icons.set(key, icon);
  }
  return icon;
}

function FitToContent({ markers, routes }: { markers: MapMarker[]; routes: MapRoute[] }) {
  const map = useMap();
  const signature = useMemo(
    () => markers.map((m) => `${m.position.latitude},${m.position.longitude}`).join('|') + routes.length,
    [markers, routes],
  );
  useEffect(() => {
    const points: [number, number][] = [
      ...markers.map((m) => [m.position.latitude, m.position.longitude] as [number, number]),
      ...routes.flatMap((r) => r.points),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 14));
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 });
  }, [map, signature]);
  return null;
}

function PickHandler({ onPick }: { onPick: (location: Location) => void }) {
  useMapEvents({
    click(event) {
      onPick({
        latitude: Number(event.latlng.lat.toFixed(5)),
        longitude: Number(event.latlng.lng.toFixed(5)),
      });
    },
  });
  return null;
}

function Recenter({ center }: { center: Location }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([center.latitude, center.longitude]);
  }, [map, center.latitude, center.longitude]);
  return null;
}

export function MapView({
  center,
  zoom = 13,
  markers = [],
  routes = [],
  fit = false,
  onPick,
  className = '',
  ariaLabel,
}: MapViewProps) {
  return (
    <div className={`map ${onPick ? 'map--picker' : ''} ${className}`} role="region" aria-label={ariaLabel}>
      <MapContainer center={[center.latitude, center.longitude]} zoom={zoom} scrollWheelZoom className="map__canvas">
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points}
            pathOptions={{
              color: route.muted ? '#7d9a98' : '#E9A100',
              weight: route.muted ? 3 : 5,
              opacity: route.muted ? 0.5 : 0.95,
              dashArray: route.estimated ? '2 10' : undefined,
              lineCap: 'round',
            }}
          />
        ))}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.position.latitude, marker.position.longitude]}
            icon={iconFor(marker.tone ?? 'place', marker.order)}
            eventHandlers={marker.onClick ? { click: marker.onClick } : undefined}
            keyboard
            title={marker.label}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              {marker.label}
            </Tooltip>
          </Marker>
        ))}
        {fit ? <FitToContent markers={markers} routes={routes} /> : <Recenter center={center} />}
        {onPick && <PickHandler onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
