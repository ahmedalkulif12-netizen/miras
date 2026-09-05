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
      const loc = place.geometry?.location;
      if (!loc) {
        const typed = (inputRef.current?.value || place.name || '').trim();
        if (typed) {
          void geocodeSaudiQuery(typed).then((hit) => {
            if (hit) onSelectRef.current(placeFromGeocode(hit));
          });
        }
        return;
      }

      const formatted = place.formatted_address || place.name || '';
      onSelectRef.current({
        location: { lat: loc.lat(), lng: loc.lng() },
        formattedAddress: formatted,
        displayName: place.name || formatted,
        city: cityFromAddressComponents(place.address_components) || formatted.split(',')[0]?.trim(),
        addressComponents: place.address_components,
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
