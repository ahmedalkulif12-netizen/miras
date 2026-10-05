import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, MapPin } from 'lucide-react';
import { RouteDisplay } from '@/components/RouteDisplay';
import { cityFromAddressComponents } from '@/lib/saudiGeo';

export type BookingPinTarget = 'pickup' | 'destination';

/** delivery_only = water tanker (single delivery pin); pickup_destination = transport. */
export type BookingMapMode = 'pickup_destination' | 'delivery_only';

interface BookingLocationMapProps {
  pickupCoords: google.maps.LatLngLiteral | null;
  destinationCoords: google.maps.LatLngLiteral | null;
  activePin: BookingPinTarget;
  onActivePinChange: (target: BookingPinTarget) => void;
  onLocationPicked: (
    target: BookingPinTarget,
    coords: google.maps.LatLngLiteral,
    address: string,
    city?: string
  ) => void;
  isRtl?: boolean;
  showRoute?: boolean;
  /** Live GPS — centers the map and shows a user-location marker. */
  userLocation?: google.maps.LatLngLiteral | null;
  mode?: BookingMapMode;
  onRequestUserLocation?: () => void;
  locating?: boolean;
  /** Fixed center pin: dragging the map moves the active point. */
  centerPin?: boolean;
  /** Bump to pan the camera to the current GPS / active pin once. */
  focusNonce?: number;
}

const RIYADH_CENTER: google.maps.LatLngLiteral = { lat: 24.7136, lng: 46.6753 };

async function reverseGeocode(
  geocoder: google.maps.Geocoder,
  coords: google.maps.LatLngLiteral
): Promise<{ address: string; city: string }> {
  try {
    const { results } = await geocoder.geocode({ location: coords });
    const best = results?.[0];
    return {
      address: best?.formatted_address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      city: cityFromAddressComponents(best?.address_components) || '',
    };
  } catch {
    return { address: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, city: '' };
  }
}

/** Keeps the map camera on GPS / pins when they change. */
const MapCameraController: React.FC<{
  pickup: google.maps.LatLngLiteral | null;
  destination: google.maps.LatLngLiteral | null;
  userLocation: google.maps.LatLngLiteral | null;
  mode: BookingMapMode;
  centerPin: boolean;
  focusNonce: number;
}> = ({ pickup, destination, userLocation, mode, centerPin, focusNonce }) => {
  const map = useMap();

  useEffect(() => {
    if (!map || !centerPin || focusNonce < 1) return;
    const focus = userLocation || pickup || destination;
    if (!focus) return;
    map.panTo(focus);
    map.setZoom(16);
  }, [map, centerPin, focusNonce]);

  useEffect(() => {
    if (!map || centerPin) return;

    if (mode === 'pickup_destination' && pickup && destination) {
      const samePoint =
        Math.abs(pickup.lat - destination.lat) < 1e-5 &&
        Math.abs(pickup.lng - destination.lng) < 1e-5;
      if (!samePoint) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(pickup);
        bounds.extend(destination);
        map.fitBounds(bounds, 64);
        return;
      }
    }

    const focus =
      (mode === 'delivery_only' ? destination : null) ||
      userLocation ||
      pickup ||
      destination;
    if (focus) {
      map.panTo(focus);
      map.setZoom(15);
    }
  }, [map, pickup, destination, userLocation, mode, centerPin]);

  return null;
};

/** Reads the map center after the user stops dragging and writes it to the active step. */
const CenterPinPicker: React.FC<{
  activePin: BookingPinTarget;
  onPick: (target: BookingPinTarget, coords: google.maps.LatLngLiteral) => void;
}> = ({ activePin, onPick }) => {
  const map = useMap();
  const pinRef = React.useRef(activePin);
  const pickRef = React.useRef(onPick);
  pinRef.current = activePin;
  pickRef.current = onPick;

  useEffect(() => {
    if (!map) return;
    let moved = false;
    let timer = 0;
    const markMoved = () => {
      moved = true;
    };
    const drag = map.addListener('dragstart', markMoved);
    const zoom = map.addListener('zoom_changed', markMoved);
    const idle = map.addListener('idle', () => {
      if (!moved) return;
      moved = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const center = map.getCenter();
        if (!center) return;
        pickRef.current(pinRef.current, { lat: center.lat(), lng: center.lng() });
      }, 220);
    });
    return () => {
      window.clearTimeout(timer);
      drag.remove();
      zoom.remove();
      idle.remove();
    };
  }, [map, activePin]);

  return null;
};

/**
 * Always-visible interactive booking map.
 * Centers on live GPS when available; tap / drag pins to set locations.
 */
export const BookingLocationMap: React.FC<BookingLocationMapProps> = ({
  pickupCoords,
  destinationCoords,
  activePin,
  onLocationPicked,
  isRtl = false,
  showRoute = false,
  userLocation = null,
  mode = 'pickup_destination',
  onRequestUserLocation,
  locating = false,
  centerPin = false,
  focusNonce = 0,
}) => {
  const geocodingLib = useMapsLibrary('geocoding');
  const geocoder = useMemo(
    () => (geocodingLib ? new geocodingLib.Geocoder() : null),
    [geocodingLib]
  );
  const [mapReady, setMapReady] = useState(false);

  const defaultCenter = userLocation || pickupCoords || destinationCoords || RIYADH_CENTER;
  const deliveryOnly = mode === 'delivery_only';
  const effectiveActivePin: BookingPinTarget = deliveryOnly ? 'destination' : activePin;

  const applyCoords = useCallback(
    async (target: BookingPinTarget, coords: google.maps.LatLngLiteral) => {
      const resolved = geocoder
        ? await reverseGeocode(geocoder, coords)
        : { address: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, city: '' };
      onLocationPicked(target, coords, resolved.address, resolved.city);
    },
    [geocoder, onLocationPicked]
  );

  const handleMapClick = useCallback(
    async (event: { detail?: { latLng?: google.maps.LatLngLiteral | null } }) => {
      const latLng = event.detail?.latLng;
      if (!latLng) return;
      await applyCoords(effectiveActivePin, { lat: latLng.lat, lng: latLng.lng });
    },
    [effectiveActivePin, applyCoords]
  );

  const handleMarkerDrag = useCallback(
    async (target: BookingPinTarget, event: google.maps.MapMouseEvent) => {
      const latLng = event.latLng;
      if (!latLng) return;
      await applyCoords(target, { lat: latLng.lat(), lng: latLng.lng() });
    },
    [applyCoords]
  );

  return (
    <div className="space-y-3">
      <div className="rounded-[32px] overflow-hidden border-2 border-black shadow-inner relative h-[320px] sm:h-[380px] md:h-[440px] bg-slate-100">
        <Map
          defaultCenter={defaultCenter}
          defaultZoom={userLocation ? 15 : 11}
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: '100%', height: '100%' }}
          onClick={centerPin ? undefined : handleMapClick}
          onTilesLoaded={() => setMapReady(true)}
          reuseMaps
        >
          {mapReady && (
            <>
            <MapCameraController
              pickup={pickupCoords}
              destination={destinationCoords}
              userLocation={userLocation}
              mode={mode}
              centerPin={centerPin}
              focusNonce={focusNonce}
            />
            {centerPin && (
              <CenterPinPicker
                activePin={effectiveActivePin}
                onPick={(target, coords) => void applyCoords(target, coords)}
              />
            )}
            </>
          )}

          {userLocation && (
            <Marker
              position={userLocation}
              clickable={false}
              title={isRtl ? 'موقعك الحالي' : 'Your location'}
            />
          )}

          {!centerPin && !deliveryOnly && pickupCoords && (
            <Marker
              position={pickupCoords}
              draggable
              title={isRtl ? 'نقطة التحميل' : 'Pickup'}
              onDragEnd={(e) => void handleMarkerDrag('pickup', e)}
            />
          )}

          {!centerPin && destinationCoords && (
            <Marker
              position={destinationCoords}
              draggable
              title={
                deliveryOnly
                  ? isRtl
                    ? 'موقع التوصيل'
                    : 'Delivery'
                  : isRtl
                    ? 'نقطة التسليم'
                    : 'Delivery'
              }
              onDragEnd={(e) => void handleMarkerDrag('destination', e)}
            />
          )}

          {showRoute &&
            !deliveryOnly &&
            pickupCoords &&
            destinationCoords && (
              <RouteDisplay origin={pickupCoords} destination={destinationCoords} />
            )}
        </Map>

        {centerPin && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full z-10">
            <div className="flex flex-col items-center">
              <div className="px-3 py-1.5 rounded-full bg-black text-[#FFCC00] text-xs font-black shadow-lg mb-1">
                {effectiveActivePin === 'pickup'
                  ? isRtl
                    ? 'موقع التحميل'
                    : 'Pickup'
                  : isRtl
                    ? 'موقع التنزيل'
                    : 'Drop-off'}
              </div>
              <MapPin size={42} className="text-black drop-shadow-md" fill="#FFCC00" />
            </div>
          </div>
        )}

        {onRequestUserLocation && (
          <button
            type="button"
            onClick={onRequestUserLocation}
            disabled={locating}
            className={`absolute z-10 bottom-16 ${isRtl ? 'left-3' : 'right-3'} min-h-14 px-4 rounded-2xl bg-[#FFCC00] text-black font-black text-sm shadow-xl border-2 border-black flex items-center gap-2 disabled:opacity-60`}
          >
            <Crosshair size={22} className={locating ? 'animate-spin' : ''} />
            {locating
              ? isRtl
                ? 'جاري التحديد...'
                : 'Locating...'
              : isRtl
                ? 'موقعي الحالي'
                : 'My location'}
          </button>
        )}

        <div
          className={`absolute bottom-3 inset-x-3 pointer-events-none rounded-xl bg-white/90 backdrop-blur-sm border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 shadow-sm ${
            isRtl ? 'text-right' : 'text-left'
          }`}
        >
          {deliveryOnly
            ? isRtl
              ? 'موقع التنزيل فقط — اسحب الدبوس أو انقر على الخريطة لتعديل الموقع'
              : 'Drop-off only — drag the pin or tap the map to set the location'
            : effectiveActivePin === 'pickup'
              ? isRtl
                ? 'نقطة التحميل = موقعك الحالي — انقر أو اسحب الدبوس للتعديل'
                : 'Pickup starts at your GPS — tap or drag the pin to fine-tune'
              : isRtl
                ? 'انقر على الخريطة لتعيين الوجهة — يمكن سحب الدبوس لاحقاً'
                : 'Tap the map to set destination — drag the pin to fine-tune'}
        </div>
      </div>
    </div>
  );
};
