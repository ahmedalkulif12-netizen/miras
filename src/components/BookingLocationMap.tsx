import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, MapPin, Navigation2 } from 'lucide-react';
import { RouteDisplay } from '@/components/RouteDisplay';

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
    address: string
  ) => void;
  isRtl?: boolean;
  showRoute?: boolean;
  /** Live GPS — centers the map and shows a user-location marker. */
  userLocation?: google.maps.LatLngLiteral | null;
  mode?: BookingMapMode;
  onRequestUserLocation?: () => void;
  locating?: boolean;
}

const RIYADH_CENTER: google.maps.LatLngLiteral = { lat: 24.7136, lng: 46.6753 };

async function reverseGeocode(
  geocoder: google.maps.Geocoder,
  coords: google.maps.LatLngLiteral
): Promise<string> {
  try {
    const { results } = await geocoder.geocode({ location: coords });
    return results?.[0]?.formatted_address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  } catch {
    return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  }
}

/** Keeps the map camera on GPS / pins when they change. */
const MapCameraController: React.FC<{
  pickup: google.maps.LatLngLiteral | null;
  destination: google.maps.LatLngLiteral | null;
  userLocation: google.maps.LatLngLiteral | null;
  mode: BookingMapMode;
}> = ({ pickup, destination, userLocation, mode }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

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
  }, [map, pickup, destination, userLocation, mode]);

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
  onActivePinChange,
  onLocationPicked,
  isRtl = false,
  showRoute = false,
  userLocation = null,
  mode = 'pickup_destination',
  onRequestUserLocation,
  locating = false,
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
      const address = geocoder
        ? await reverseGeocode(geocoder, coords)
        : `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      onLocationPicked(target, coords, address);
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
      <div className="flex flex-wrap gap-2">
        {!deliveryOnly && (
          <button
            type="button"
            onClick={() => onActivePinChange('pickup')}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
              activePin === 'pickup'
                ? 'bg-blue-500 text-white border-blue-500 shadow-md shadow-blue-500/20'
                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
            }`}
          >
            <MapPin size={14} />
            {isRtl ? 'تعيين نقطة التحميل على الخريطة' : 'Set pickup on map'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onActivePinChange('destination')}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
            deliveryOnly || activePin === 'destination'
              ? 'bg-amber-400 text-black border-amber-400 shadow-md shadow-amber-400/20'
              : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
          }`}
        >
          <Navigation2 size={14} />
          {deliveryOnly
            ? isRtl
              ? 'تعيين موقع التنزيل على الخريطة'
              : 'Set drop-off on map'
            : isRtl
              ? 'تعيين نقطة التسليم على الخريطة'
              : 'Set delivery on map'}
        </button>
        {onRequestUserLocation && (
          <button
            type="button"
            onClick={onRequestUserLocation}
            disabled={locating}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 transition-all disabled:opacity-60"
          >
            <Crosshair size={14} className={locating ? 'animate-spin' : ''} />
            {locating
              ? isRtl
                ? 'جاري تحديد الموقع...'
                : 'Locating...'
              : isRtl
                ? 'موقعي الحالي'
                : 'My current location'}
          </button>
        )}
      </div>

      <div className="rounded-[32px] overflow-hidden border border-slate-200 shadow-inner relative h-[280px] sm:h-[320px] md:h-[360px] bg-slate-100">
        <Map
          defaultCenter={defaultCenter}
          defaultZoom={userLocation ? 15 : 11}
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: '100%', height: '100%' }}
          onClick={handleMapClick}
          onTilesLoaded={() => setMapReady(true)}
          reuseMaps
        >
          {mapReady && (
            <MapCameraController
              pickup={pickupCoords}
              destination={destinationCoords}
              userLocation={userLocation}
              mode={mode}
            />
          )}

          {userLocation && (
            <Marker
              position={userLocation}
              clickable={false}
              title={isRtl ? 'موقعك الحالي' : 'Your location'}
            />
          )}

          {!deliveryOnly && pickupCoords && (
            <Marker
              position={pickupCoords}
              draggable
              title={isRtl ? 'نقطة التحميل' : 'Pickup'}
              onDragEnd={(e) => void handleMarkerDrag('pickup', e)}
            />
          )}

          {destinationCoords && (
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
