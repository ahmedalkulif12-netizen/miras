import React, { useEffect, useRef, useState } from 'react';
import { Map, Marker, useMap, useApiIsLoaded } from '@vis.gl/react-google-maps';
import type { Order } from '@/types';
import type { DriverNavPhase } from '@/domain/order-status';
import { watchDriverPosition, type GeoCoordinates } from '@/lib/geolocation';
import {
  haversineKm,
  isNearTripEndpoints,
  resolveDriverMapEndpoints,
  type LatLng,
} from '@/lib/orderGeo';
import { DEFAULT_MAP_CITY, geocodePlaceName } from '@/lib/cityCoordinates';

export {
  getOrderDropoffLatLng,
  getOrderPickupLatLng,
  getOrderTripCoordinates,
} from '@/lib/orderGeo';

/** Fit camera tightly to the order trip (pickup + dropoff). Never expand to a far GPS point. */
const TripBoundsFitter: React.FC<{
  pickup: LatLng;
  dropoff: LatLng;
  driverPos?: LatLng | null;
}> = ({ pickup, dropoff, driverPos }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(pickup);
    bounds.extend(dropoff);

    // Include the driver only when they are near the local trip — otherwise country-level zoom.
    if (driverPos && isNearTripEndpoints(driverPos, pickup, dropoff, 40)) {
      bounds.extend(driverPos);
    }

    const tripKm = haversineKm(pickup, dropoff);
    const padding = tripKm < 5 ? 72 : tripKm < 25 ? 56 : 48;
    map.fitBounds(bounds, padding);

    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      const zoom = map.getZoom();
      if (zoom == null) return;
      // Keep short city trips readable; avoid over-zoom on nearly identical pins.
      if (tripKm < 30 && zoom < 11) map.setZoom(12);
      if (zoom > 15) map.setZoom(15);
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, driverPos?.lat, driverPos?.lng]);

  return null;
};

/** After accept, pan/center on pickup immediately — defaultCenter does not update in place. */
const PickupFocusOnAccept: React.FC<{ pickup: LatLng }> = ({ pickup }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    map.panTo(pickup);
    const zoom = map.getZoom();
    if (zoom == null || zoom < 12 || zoom > 15) {
      map.setZoom(13);
    }
  }, [map, pickup.lat, pickup.lng]);

  return null;
};

/**
 * Directions polyline strictly between the order's pickup & dropoff coordinates.
 * Camera framing is owned by TripBoundsFitter (not the Directions route bounds),
 * so a failed/odd Directions response cannot zoom the map to country scale.
 */
const TripDirectionsLayer: React.FC<{
  origin: LatLng;
  destination: LatLng;
}> = ({ origin, destination }) => {
  const map = useMap();
  const ready = useApiIsLoaded();
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const fallbackLineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !ready) return;

    const clearFallback = () => {
      if (fallbackLineRef.current) {
        fallbackLineRef.current.setMap(null);
        fallbackLineRef.current = null;
      }
    };

    const service = new google.maps.DirectionsService();
    const renderer =
      rendererRef.current ??
      new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true, // do not let Directions expand camera to country scale
        polylineOptions: {
          strokeColor: '#0f766e',
          strokeOpacity: 0.9,
          strokeWeight: 5,
        },
      });
    renderer.setMap(map);
    rendererRef.current = renderer;
    clearFallback();

    let cancelled = false;
    service.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (cancelled) return;
        if (status === google.maps.DirectionsStatus.OK && result) {
          clearFallback();
          renderer.setDirections(result);
        } else {
          console.warn('[DriverTripMap] Directions request failed:', status);
          renderer.set('directions', null);
          // Straight fallback segment so the local trip is still visible.
          fallbackLineRef.current = new google.maps.Polyline({
            path: [origin, destination],
            strokeColor: '#0f766e',
            strokeOpacity: 0.75,
            strokeWeight: 4,
            map,
          });
        }
      }
    );

    return () => {
      cancelled = true;
      clearFallback();
      renderer.setMap(null);
    };
  }, [map, ready, origin.lat, origin.lng, destination.lat, destination.lng]);

  return null;
};

interface DriverTripMapProps {
  order: Order | null;
  /** When true, draw the order trip route (after Accept / active trip / offer preview). */
  showRoute: boolean;
  /** Pickup phase vs dropoff phase — banner + driver marker emphasis only. */
  navPhase?: DriverNavPhase;
  isRtl?: boolean;
  heightClassName?: string;
  /** Live GPS from the dashboard — used as city-route fallback when order coords are missing. */
  driverCoords?: LatLng | null;
  driverCity?: string | null;
}

/**
 * Driver map embedded in the dashboard.
 * Markers + polyline bind to saved pickup/dropoff lat/lng when valid;
 * otherwise the route falls back to customer city ↔ driver city/GPS.
 */
export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  order,
  showRoute,
  navPhase = 'idle',
  isRtl = false,
  heightClassName = 'h-64 md:h-80',
  driverCoords = null,
  driverCity = null,
}) => {
  const apiReady = useApiIsLoaded();
  const tableResolved = resolveDriverMapEndpoints(order, {
    driverPos: driverCoords,
    driverCity,
  });
  const [watchedDriverPos, setWatchedDriverPos] = useState<LatLng | null>(null);
  const [geocoded, setGeocoded] = useState<{ pickup: LatLng | null; dropoff: LatLng | null }>({
    pickup: null,
    dropoff: null,
  });
  const [geoTried, setGeoTried] = useState(false);

  useEffect(() => {
    if (!showRoute || navPhase === 'idle' || navPhase === 'preview') {
      setWatchedDriverPos(null);
      return;
    }

    const stop = watchDriverPosition(
      (coords: GeoCoordinates) => {
        setWatchedDriverPos({ lat: coords.lat, lng: coords.lng });
      },
      (err) => {
        console.warn('[DriverTripMap] geolocation watch failed:', err);
      }
    );

    return () => {
      stop();
    };
  }, [showRoute, navPhase, order?.id]);

  const liveDriver = watchedDriverPos || driverCoords;

  useEffect(() => {
    setGeocoded({ pickup: null, dropoff: null });
    setGeoTried(false);
  }, [order?.id, tableResolved.customerCity, tableResolved.dropoffCity]);

  useEffect(() => {
    if (!order || !apiReady) return;
    if (tableResolved.pickup && tableResolved.dropoff) {
      setGeoTried(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      const pickup =
        tableResolved.pickup || (await geocodePlaceName(tableResolved.customerCity));
      const dropoff =
        tableResolved.dropoff ||
        (await geocodePlaceName(tableResolved.dropoffCity)) ||
        liveDriver ||
        (await geocodePlaceName(driverCity));
      if (cancelled) return;
      setGeocoded({
        pickup: pickup || null,
        dropoff: dropoff || null,
      });
      setGeoTried(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    apiReady,
    order?.id,
    tableResolved.pickup?.lat,
    tableResolved.pickup?.lng,
    tableResolved.dropoff?.lat,
    tableResolved.dropoff?.lng,
    tableResolved.customerCity,
    tableResolved.dropoffCity,
    driverCity,
  ]);

  const withLiveDriver = resolveDriverMapEndpoints(order, {
    driverPos: liveDriver,
    driverCity,
  });
  const pickup = withLiveDriver.pickup || geocoded.pickup;
  const dropoff = withLiveDriver.dropoff || geocoded.dropoff;

  const nearbyDriver =
    liveDriver && pickup && dropoff && isNearTripEndpoints(liveDriver, pickup, dropoff, 40)
      ? liveDriver
      : null;

  const center =
    navPhase === 'to_pickup' && pickup
      ? pickup
      : pickup || dropoff || nearbyDriver || DEFAULT_MAP_CITY;
  const mapKey = `${order?.id ?? 'idle'}-${navPhase}-${showRoute ? 'nav' : 'preview'}-${pickup && dropoff ? 'ready' : 'pending'}`;

  const bannerText = (() => {
    if (!showRoute || navPhase === 'idle') return null;
    const deliveryOnly =
      order?.deliveryOnly === true ||
      order?.locationMode === 'delivery_only' ||
      order?.serviceType === 'water_tanker';
    if (navPhase === 'preview') {
      return deliveryOnly
        ? isRtl
          ? 'معاينة المسار — توجه مباشرة إلى موقع التنزيل'
          : 'Route preview — go directly to drop-off'
        : isRtl
          ? 'معاينة المسار — من موقع الاستلام إلى موقع التنزيل'
          : 'Route preview — pickup to dropoff';
    }
    if (navPhase === 'to_pickup') {
      return isRtl
        ? 'المرحلة 1 — توجه إلى موقع الاستلام / التحميل'
        : 'Phase 1 — Navigate to pickup / loading location';
    }
    return deliveryOnly
      ? isRtl
        ? 'توجه مباشرة إلى موقع التنزيل / العميل'
        : 'Navigate directly to customer drop-off'
      : isRtl
        ? 'المرحلة 2 — توجه إلى موقع التنزيل / التسليم'
        : 'Phase 2 — Navigate to dropoff / delivery location';
  })();

  const deliveryOnly =
    order?.deliveryOnly === true ||
    order?.locationMode === 'delivery_only' ||
    order?.serviceType === 'water_tanker';

  // Water tanker: route driver → drop-off (pickup marker = tanker origin if distinct).
  const routeOrigin =
    navPhase === 'to_dropoff' && nearbyDriver
      ? nearbyDriver
      : pickup &&
          !(
            deliveryOnly &&
            pickup &&
            dropoff &&
            Math.abs(pickup.lat - dropoff.lat) < 1e-5 &&
            Math.abs(pickup.lng - dropoff.lng) < 1e-5
          )
        ? pickup
        : nearbyDriver || pickup;

  const coordsUnavailable = Boolean(order) && geoTried && (!pickup || !dropoff);

  return (
    <div
      className={`${heightClassName} rounded-3xl overflow-hidden border border-slate-200 shadow-inner relative bg-slate-100`}
    >
      <Map
        key={mapKey}
        defaultCenter={center}
        defaultZoom={navPhase === 'to_pickup' ? 13 : 12}
        gestureHandling="greedy"
        disableDefaultUI={false}
        style={{ width: '100%', height: '100%' }}
      >
        {navPhase === 'to_pickup' && pickup && <PickupFocusOnAccept pickup={pickup} />}
        {navPhase !== 'to_pickup' && pickup && dropoff && !deliveryOnly && (
          <TripBoundsFitter pickup={pickup} dropoff={dropoff} driverPos={nearbyDriver} />
        )}
        {navPhase !== 'to_pickup' && deliveryOnly && dropoff && (
          <TripBoundsFitter
            pickup={nearbyDriver || pickup || dropoff}
            dropoff={dropoff}
            driverPos={nearbyDriver}
          />
        )}

        {!deliveryOnly && pickup && (
          <Marker position={pickup} title={isRtl ? 'موقع الاستلام' : 'Pickup'} />
        )}
        {dropoff && (
          <Marker position={dropoff} title={isRtl ? 'موقع التنزيل' : 'Dropoff'} />
        )}
        {nearbyDriver && (
          <Marker position={nearbyDriver} title={isRtl ? 'موقعك' : 'You'} />
        )}

        {showRoute && routeOrigin && dropoff && (
          <TripDirectionsLayer origin={routeOrigin} destination={dropoff} />
        )}
      </Map>

      {bannerText && (
        <div
          className={`absolute top-3 inset-x-3 pointer-events-none rounded-xl bg-teal-700/90 text-white text-[11px] font-bold px-3 py-2 shadow ${
            isRtl ? 'text-right' : 'text-left'
          }`}
        >
          {bannerText}
        </div>
      )}

      {coordsUnavailable && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-bold text-slate-500 px-4 text-center">
          {isRtl ? 'إحداثيات الطلب غير متوفرة على الخريطة' : 'Order coordinates unavailable for map'}
        </div>
      )}
    </div>
  );
};
