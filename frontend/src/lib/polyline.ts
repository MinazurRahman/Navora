// Decodes Google's "encoded polyline" format (precision 5), which the backend uses for
// each itinerary day's road route (`routePolyline`). Returns [latitude, longitude] pairs,
// the order Leaflet expects. (GeoJSON uses the opposite order — a classic map bug.)

export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / factor, lng / factor]);
  }
  return points;
}
