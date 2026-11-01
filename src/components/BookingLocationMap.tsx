import React, { useCallback, useEffect, useMemo } from 'react';
import {
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, MapPin } from 'lucide-react';
import { RouteDisplay } from '@/components/RouteDisplay';
import { DEFAULT_MAP_CENTER } from '@/lib/geolocation';
import { focusMapCamera, mapCenterIsNear } from '@/lib/mapCamera';
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
  /** Bump to pan the camera to focusPoint, or the active pin. */
  focusNonce?: number;
  /** Exact coordinates to pan to when focusNonce changes. */
  focusPoint?: google.maps.LatLngLiteral | null;
  /** GPS failed. The map stays on the default city so the pin can be placed by hand. */
  manualSelection?: boolean;
}

const RIYADH_CENTER: google.maps.LatLngLiteral = DEFAULT_MAP_CENTER;

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
  focusPoint: google.maps.LatLngLiteral | null;
  activePin: BookingPinTarget;
  suppressCenterPickRef: React.MutableRefObject<boolean>;
  pendingFocusRef: React.MutableRefObject<google.maps.LatLngLiteral | null>;
}> = ({
  pickup,
  destination,
  userLocation,
  mode,
  centerPin,
  focusNonce,
  focusPoint,
  activePin,
  suppressCenterPickRef,
  pendingFocusRef,
}) => {
  const map = useMap();
  const focusTokenRef = React.useRef(0);

  useEffect(() => {
    if (!map || focusNonce < 1) return;
    // The point captured with this focus request. Pin fallbacks cover search
    // and step changes that pan without a fresh GPS fix.
    const focus =
      focusPoint ||
      (activePin === 'destination'
        ? destination || pickup || userLocation
        : pickup || userLocation || destination);
    if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lng)) return;
    if (focus.lat === 0 && focus.lng === 0) return;

    const token = ++focusTokenRef.current;
    const target = { lat: focus.lat, lng: focus.lng };
    pendingFocusRef.current = target;
    suppressCenterPickRef.current = true;

    let attempts = 0;
    const apply = () => {
      if (focusTokenRef.current !== token) return;
      focusMapCamera(map, target, 16);
    };
    apply();
    const frame = window.requestAnimationFrame(apply);
    const retry = window.setTimeout(() => {
      if (!mapCenterIsNear(map, target)) apply();
    }, 400);
    const idle = map.addListener('idle', () => {
      if (focusTokenRef.current !== token) return;
      if (mapCenterIsNear(map, target)) {
        pendingFocusRef.current = null;
        return;
      }
      if (attempts >= 3) return;
      attempts += 1;
      apply();
    });
    const release = window.setTimeout(() => {
      if (focusTokenRef.current === token) suppressCenterPickRef.current = false;
    }, 2000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      window.clearTimeout(release);
      idle.remove();
    };
    // Dragging the map must not re-run this. Only a new focus request pans.
  }, [
    map,
    focusNonce,
    focusPoint?.lat,
    focusPoint?.lng,
    activePin,
    suppressCenterPickRef,
    pendingFocusRef,
  ]);

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
      (activePin === 'destination' ? destination : pickup) ||
      userLocation ||
      pickup ||
      destination;
    if (focus) {
      focusMapCamera(map, focus, 15);
    }
  }, [map, pickup, destination, userLocation, mode, centerPin, activePin]);

  return null;
};

/** Reads the map center after the user stops dragging and writes it to the active step. */
const CenterPinPicker: React.FC<{
  activePin: BookingPinTarget;
  onPick: (target: BookingPinTarget, coords: google.maps.LatLngLiteral) => void;
  suppressCenterPickRef: React.MutableRefObject<boolean>;
  pendingFocusRef: React.MutableRefObject<google.maps.LatLngLiteral | null>;
}> = ({ activePin, onPick, suppressCenterPickRef, pendingFocusRef }) => {
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
      if (suppressCenterPickRef.current) return;
      pendingFocusRef.current = null;
      moved = true;
    };
    const drag = map.addListener('dragstart', markMoved);
    const zoom = map.addListener('zoom_changed', markMoved);
    const idle = map.addListener('idle', () => {
      const pending = pendingFocusRef.current;
      if (pending && !mapCenterIsNear(map, pending)) {
        // The camera has not reached the GPS point yet. Writing getCenter()
        // here would save the default city over the coordinates just fetched.
        moved = false;
        return;
      }
      if (pending && mapCenterIsNear(map, pending)) {
        pendingFocusRef.current = null;
      }
      if (!moved || suppressCenterPickRef.current) {
        moved = false;
        return;
      }
      moved = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (suppressCenterPickRef.current) return;
        const stillPending = pendingFocusRef.current;
        if (stillPending && !mapCenterIsNear(map, stillPending)) return;
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
  }, [map, activePin, suppressCenterPickRef, pendingFocusRef]);

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
  focusPoint = null,
  manualSelection = false,
}) => {
  const geocodingLib = useMapsLibrary('geocoding');
  const geocoder = useMemo(
    () => (geocodingLib ? new geocodingLib.Geocoder() : null),
    [geocodingLib]
  );
  const suppressCenterPickRef = React.useRef(false);
  const pendingFocusRef = React.useRef<google.maps.LatLngLiteral | null>(null);

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
          reuseMaps
        >
          <MapCameraController
            pickup={pickupCoords}
            destination={destinationCoords}
            userLocation={userLocation}
            mode={mode}
            centerPin={centerPin}
            focusNonce={focusNonce}
            focusPoint={focusPoint}
            activePin={effectiveActivePin}
            suppressCenterPickRef={suppressCenterPickRef}
            pendingFocusRef={pendingFocusRef}
          />
          {centerPin && (
            <CenterPinPicker
              activePin={effectiveActivePin}
              suppressCenterPickRef={suppressCenterPickRef}
              pendingFocusRef={pendingFocusRef}
              onPick={(target, coords) => void applyCoords(target, coords)}
            />
          )}

          {userLocation && (
            <Marker
              key={`user-${userLocation.lat.toFixed(6)}-${userLocation.lng.toFixed(6)}`}
              position={userLocation}
              clickable={false}
              title={isRtl ? 'موقعك الحالي' : 'Your location'}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: '#2563eb',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              }}
            />
          )}

          {!deliveryOnly && pickupCoords && (
            <Marker
              key={`pickup-${pickupCoords.lat.toFixed(6)}-${pickupCoords.lng.toFixed(6)}`}
              position={pickupCoords}
              draggable={!centerPin}
              title={isRtl ? 'نقطة التحميل' : 'Pickup'}
              onDragEnd={(e) => void handleMarkerDrag('pickup', e)}
            />
          )}

          {destinationCoords && (
            <Marker
              key={`drop-${destinationCoords.lat.toFixed(6)}-${destinationCoords.lng.toFixed(6)}`}
              position={destinationCoords}
              draggable={!centerPin}
              title={
                deliveryOnly
                  ? isRtl
                    ? 'موقع التنزيل'
                    : 'Drop-off'
                  : isRtl
                    ? 'موقع التنزيل'
                    : 'Drop-off'
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
          {manualSelection
            ? isRtl
              ? 'تعذر تحديد موقعك الحالي. حرّك الخريطة أو ابحث عن العنوان.'
              : 'Current location is unavailable. Drag the map or search for the address.'
            : deliveryOnly
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
