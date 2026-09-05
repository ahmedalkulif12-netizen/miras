/**
 * Saudi address / city helpers for booking geocode + stored order cities.
 */

import { cityCenterFromName } from './cityCoordinates';

export type AddressComponentLike = {
  long_name?: string;
  longText?: string;
  types?: string[];
};

export function cityFromAddressComponents(
  components: AddressComponentLike[] | null | undefined
): string {
  if (!components?.length) return '';
  const pick = (...types: string[]) => {
    for (const type of types) {
      const hit = components.find((part) => (part.types || []).includes(type));
      const name = String(hit?.long_name || hit?.longText || '').trim();
      if (name) return name;
    }
    return '';
  };
  return (
    pick('locality', 'postal_town') ||
    pick('administrative_area_level_2') ||
    pick('administrative_area_level_1')
  );
}

export type SaudiGeocodeHit = {
  location: { lat: number; lng: number };
  formattedAddress: string;
  displayName: string;
  city: string;
};

/**
 * City label stored on the order — prefer Places city, else a known Saudi city
 * inside the address, else the first comma-separated token.
 */
export function cityLabelFromAddress(
  address: string | null | undefined,
  explicitCity?: string | null
): string {
  const named = String(explicitCity || '').trim();
  if (named) return named;
  const raw = String(address || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[,،]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (cityCenterFromName(part)) return part;
  }
  if (cityCenterFromName(raw)) return raw;
  return parts[0] || raw;
}

function tableGeocodeHit(query: string): SaudiGeocodeHit | null {
  const point = cityCenterFromName(query);
  if (!point) return null;
  const city = cityLabelFromAddress(query) || query;
  return {
    location: point,
    formattedAddress: query,
    displayName: city,
    city,
  };
}

/**
 * Forward-geocode a typed Saudi query (city, landmark, or street).
 * Uses componentRestrictions so "الأحساء" / "مكة" resolve inside KSA.
 * Falls back to the local city table when Geocoder is missing or empty.
 */
export async function geocodeSaudiQuery(
  query: string
): Promise<SaudiGeocodeHit | null> {
  const q = String(query || '').trim();
  if (!q) return null;

  if (typeof google !== 'undefined' && google.maps?.Geocoder) {
    const geocoder = new google.maps.Geocoder();
    const request: google.maps.GeocoderRequest = {
      address: /saudi|السعودية|المملكة/i.test(q) ? q : `${q}, Saudi Arabia`,
      componentRestrictions: { country: 'SA' },
      region: 'sa',
    };

    try {
      const { results } = await geocoder.geocode(request);
      const best = results?.[0];
      const loc = best?.geometry?.location;
      if (best && loc) {
        const lat = loc.lat();
        const lng = loc.lng();
        if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
          return {
            location: { lat, lng },
            formattedAddress: best.formatted_address || q,
            displayName: best.address_components?.[0]?.long_name || q,
            city: cityFromAddressComponents(best.address_components) || cityLabelFromAddress(best.formatted_address || q, q),
          };
        }
      }
    } catch (error) {
      console.warn('[geocode] Saudi query failed:', q, error);
    }
  }

  return tableGeocodeHit(q);
}
