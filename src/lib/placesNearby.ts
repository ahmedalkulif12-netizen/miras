import { haversineKm } from '@/lib/tripDistance';

export interface NearbyPlace {
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
}

function readLatLng(
  loc: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined
): { lat: number; lng: number } | null {
  if (!loc) return null;
  const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Google Places text search, nearest to the bias point first. */
export function searchPlacesByText(
  query: string,
  bias?: { lat: number; lng: number } | null
): Promise<NearbyPlace[]> {
  const places = google.maps?.places;
  if (!places || !query.trim()) return Promise.resolve([]);
  return new Promise((resolve) => {
    const service = new places.PlacesService(document.createElement('div'));
    service.textSearch(
      {
        query: query.trim(),
        ...(bias ? { location: bias, radius: 45000 } : {}),
      },
      (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([]);
          return;
        }
        const hits = results
          .map((place) => {
            const location = readLatLng(place.geometry?.location ?? null);
            if (!location || !place.place_id) return null;
            return {
              id: place.place_id,
              name: place.name || place.formatted_address || '',
              address: place.formatted_address || place.name || '',
              location,
            };
          })
          .filter((row): row is NearbyPlace => Boolean(row));
        if (bias) {
          hits.sort(
            (a, b) => haversineKm(bias, a.location) - haversineKm(bias, b.location)
          );
        }
        resolve(hits.slice(0, 8));
      }
    );
  });
}
