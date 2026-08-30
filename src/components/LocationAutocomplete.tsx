import React, { useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

/** Normalized place payload used by CustomerDashboard handlers. */
export interface SelectedPlace {
  location: google.maps.LatLngLiteral;
  formattedAddress: string;
  displayName: string;
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

/**
 * Classic Places Autocomplete input (reliable with Maps JS + places library).
 * Replaces the broken `gmp-place-autocomplete` web component that required
 * the Extended Component Library (not loaded in this project).
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

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;

    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry', 'name', 'address_components'],
      componentRestrictions: { country: 'sa' },
    });

    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const loc = place.geometry?.location;
      if (!loc) return;

      onSelectRef.current({
        location: { lat: loc.lat(), lng: loc.lng() },
        formattedAddress: place.formatted_address || place.name || '',
        displayName: place.name || place.formatted_address || '',
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

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      autoComplete="off"
      className={`w-full bg-transparent border-none outline-none text-sm font-medium text-neutral-800 placeholder:text-stone-400 ${className ?? ''}`}
      style={{ direction: isRtl ? 'rtl' : 'ltr', textAlign: isRtl ? 'right' : 'left' }}
    />
  );
};
