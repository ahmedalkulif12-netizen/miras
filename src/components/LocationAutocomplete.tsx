import React, { useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { geocodeSaudiQuery, cityFromAddressComponents } from '@/lib/saudiGeo';

/** Normalized place payload used by CustomerDashboard handlers. */
export interface SelectedPlace {
  location: google.maps.LatLngLiteral;
  formattedAddress: string;
  displayName: string;
  city?: string;
  addressComponents?: google.maps.GeocoderAddressComponent[];
}

interface LocationAutocompleteProps {
  placeholder: string;
  onPlaceSelect: (place: SelectedPlace) => void;
  className?: string;
  isRtl?: boolean;
  /** Controlled display value (e.g. after map pin drop). */
  value?: string;
}

function placeFromGeocode(
  hit: {
    location: google.maps.LatLngLiteral;
    formattedAddress: string;
    displayName: string;
    city: string;
  }
): SelectedPlace {
  return {
    location: hit.location,
    formattedAddress: hit.formattedAddress,
    displayName: hit.displayName,
    city: hit.city || hit.displayName,
  };
}

function readLatLng(
  loc: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined
): google.maps.LatLngLiteral | null {
  if (!loc) return null;
  const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) < 1e-8 && Math.abs(lng) < 1e-8) return null;
  return { lat, lng };
}

function displayText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'text' in value) {
    return String((value as { text?: string }).text || '').trim();
  }
  return '';
}

function selectedFromPlaceResult(place: google.maps.places.PlaceResult): SelectedPlace | null {
  const coords = readLatLng(place.geometry?.location ?? null);
  if (!coords) return null;
  const formatted = place.formatted_address || place.name || '';
  return {
    location: coords,
    formattedAddress: formatted,
    displayName: place.name || formatted,
    city: cityFromAddressComponents(place.address_components) || formatted.split(',')[0]?.trim(),
    addressComponents: place.address_components,
  };
}

/** Place Details when Autocomplete returns a prediction without geometry. */
async function fetchPlaceDetails(placeId: string): Promise<SelectedPlace | null> {
  const placesNs = google.maps.places as typeof google.maps.places & {
    Place?: new (opts: { id: string }) => {
      fetchFields: (request: { fields: string[] }) => Promise<unknown>;
      location?: google.maps.LatLng | google.maps.LatLngLiteral | null;
      formattedAddress?: string | null;
      displayName?: string | { text?: string } | null;
      addressComponents?: google.maps.GeocoderAddressComponent[] | null;
    };
  };

  if (placesNs.Place) {
    try {
      const detailed = new placesNs.Place({ id: placeId });
      await detailed.fetchFields({
        fields: ['location', 'formattedAddress', 'displayName', 'addressComponents'],
      });
      const coords = readLatLng(detailed.location ?? null);
      if (coords) {
        const formatted = detailed.formattedAddress || '';
        const name = displayText(detailed.displayName) || formatted;
        return {
          location: coords,
          formattedAddress: formatted || name,
          displayName: name,
          city:
            cityFromAddressComponents(detailed.addressComponents) ||
            formatted.split(',')[0]?.trim(),
        };
      }
    } catch (error) {
      console.warn('[places] Place.fetchFields failed:', placeId, error);
    }
  }

  return new Promise((resolve) => {
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails(
      {
        placeId,
        fields: ['geometry', 'formatted_address', 'name', 'address_components'],
      },
      (result, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !result) {
          resolve(null);
          return;
        }
        resolve(selectedFromPlaceResult(result));
      }
    );
  });
}

async function resolveSelectedPlace(
  place: google.maps.places.PlaceResult,
  typedFallback: string
): Promise<SelectedPlace | null> {
  const direct = selectedFromPlaceResult(place);
  if (direct) return direct;

  const placeId = place.place_id;
  if (placeId) {
    const detailed = await fetchPlaceDetails(placeId);
    if (detailed) return detailed;
  }

  const typed = (typedFallback || place.name || place.formatted_address || '').trim();
  if (!typed) return null;
  const hit = await geocodeSaudiQuery(typed);
  return hit ? placeFromGeocode(hit) : null;
}

/**
 * Classic Places Autocomplete input, with Geocoder fallback when the user
 * types a city (الأحساء / مكة) and presses Enter without picking a suggestion.
 */
export const LocationAutocomplete: React.FC<LocationAutocompleteProps> = ({
  placeholder,
  onPlaceSelect,
  className,
  isRtl = false,
  value,
}) => {
  const placesLib = useMapsLibrary('places');
  const inputRef = useRef<HTMLInputElement>(null);
  const onSelectRef = useRef(onPlaceSelect);
  onSelectRef.current = onPlaceSelect;
  const pickedRef = useRef(false);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;

    const saBounds = new google.maps.LatLngBounds(
      { lat: 16.0, lng: 34.4 },
      { lat: 32.3, lng: 55.7 }
    );

    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry', 'name', 'address_components', 'place_id'],
      componentRestrictions: { country: 'sa' },
      bounds: saBounds,
      strictBounds: false,
    });

    const listener = autocomplete.addListener('place_changed', () => {
      pickedRef.current = true;
      const place = autocomplete.getPlace();
      const typed = (inputRef.current?.value || place.name || place.formatted_address || '').trim();
      void resolveSelectedPlace(place, typed).then((selected) => {
        if (!selected) {
          console.warn('[places] selection has no coordinates:', place.place_id || typed);
          return;
        }
        onSelectRef.current(selected);
      });
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [placesLib]);

  useEffect(() => {
    if (value !== undefined && inputRef.current && inputRef.current.value !== value) {
      inputRef.current.value = value;
    }
  }, [value]);

  const commitTypedQuery = async () => {
    const typed = inputRef.current?.value?.trim() || '';
    if (!typed) return;
    if (value && typed === value) return;
    const hit = await geocodeSaudiQuery(typed);
    if (hit) onSelectRef.current(placeFromGeocode(hit));
  };

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      autoComplete="off"
      onBlur={() => {
        window.setTimeout(() => {
          if (pickedRef.current) {
            pickedRef.current = false;
            return;
          }
          void commitTypedQuery();
        }, 250);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          window.setTimeout(() => {
            if (pickedRef.current) {
              pickedRef.current = false;
              return;
            }
            void commitTypedQuery();
          }, 300);
        }
      }}
      className={`w-full bg-transparent border-none outline-none text-sm font-medium text-neutral-800 placeholder:text-stone-400 ${className ?? ''}`}
      style={{ direction: isRtl ? 'rtl' : 'ltr', textAlign: isRtl ? 'right' : 'left' }}
    />
  );
};
