import React, { useEffect, useMemo, useRef } from 'react';
import { Map, Marker, useMap, useApiIsLoaded } from '@vis.gl/react-google-maps';
import type { LiveDriverPosition } from '@/lib/liveTracking';
import type { DriverNavPhase } from '@/domain/order-status';
import type { LatLng } from '@/lib/orderGeo';
import { isValidRoutePoint } from '@/lib/computeDrivingRoute';

interface LiveTrackingMapProps {
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driver?: LiveDriverPosition | null;
  pickupLabel: string;
  dropoffLabel: string;
  driverLabel: string;
  /** When true (driver assigned / en route), pan camera to follow live GPS. */
  followDriver?: boolean;
  /** Pickup approach vs drop-off haul — chooses the live route endpoints. */
  navPhase?: DriverNavPhase;
}

/** Riyadh — default local framing instead of Google's world overview. */
const SAUDI_CENTER: LatLng = { lat: 24.7136, lng: 46.6753 };
const SAUDI_OVERVIEW_ZOOM = 6;
const CITY_ZOOM = 13;
const FOLLOW_ZOOM = 14;

function isValidLatLng(p?: { lat: number; lng: number } | null): p is LatLng {
  if (!p) return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false;
  if (p.lat === 0 && p.lng === 0) return false;
  return true;
}

function samePoint(a: LatLng, b: LatLng, epsilon = 1e-5): boolean {
  return Math.abs(a.lat - b.lat) < epsilon && Math.abs(a.lng - b.lng) < epsilon;
}

/**
 * Driving polyline for the current trip phase.
 * to_pickup: driver → pickup (origin snapped ~1 km so Directions is not spammed).
 * to_dropoff: pickup → dropoff (static once loaded).
 */
const TrackingRouteLayer: React.FC<{
  origin: LatLng;
  destination: LatLng;
}> = ({ origin, destination }) => {
  const map = useMap();
  const ready = useApiIsLoaded();
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const fallbackRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !ready) return;
    if (!isValidRoutePoint(origin) || !isValidRoutePoint(destination)) return;
    if (samePoint(origin, destination)) return;
    if (typeof google === 'undefined' || !google.maps?.DirectionsService) return;

    const clearFallback = () => {
      fallbackRef.current?.setMap(null);
      fallbackRef.current = null;
    };

    const renderer =
      rendererRef.current ??
      new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: '#111111',
          strokeOpacity: 0.9,
          strokeWeight: 5,
        },
      });
    renderer.setMap(map);
    rendererRef.current = renderer;
    clearFallback();

    let cancelled = false;
    const service = new google.maps.DirectionsService();
    service.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (cancelled) return;
        if (status === google.maps.DirectionsStatus.OK && result?.routes?.[0]) {
          clearFallback();
          renderer.setDirections(result);
          return;
        }
        renderer.set('directions', null);
        fallbackRef.current = new google.maps.Polyline({
          path: [origin, destination],
          strokeColor: '#111111',
          strokeOpacity: 0.7,
          strokeWeight: 4,
          map,
        });
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

/** Fit / center camera on Saudi trip endpoints; follow driver along the active leg. */
const TrackingCamera: React.FC<{
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driver?: LiveDriverPosition | null;
  followDriver?: boolean;
  navPhase?: DriverNavPhase;
}> = ({ pickup, dropoff, driver, followDriver, navPhase = 'idle' }) => {
  const map = useMap();
  const lastFollowKey = useRef<string>('');
  const fittedPhaseRef = useRef<string>('');

  useEffect(() => {
    if (!map) return;

    const pickupPt = isValidLatLng(pickup) ? pickup : null;
    const dropoffPt = isValidLatLng(dropoff) ? dropoff : null;
    const driverPt =
      driver && isValidLatLng({ lat: driver.lat, lng: driver.lng })
        ? { lat: driver.lat, lng: driver.lng }
        : null;

    const targetPt =
      navPhase === 'to_dropoff' ? dropoffPt : navPhase === 'to_pickup' ? pickupPt : null;

    if (followDriver && driverPt) {
      const phaseKey = `${navPhase}:${targetPt ? `${targetPt.lat.toFixed(4)},${targetPt.lng.toFixed(4)}` : 'none'}`;
      if (fittedPhaseRef.current !== phaseKey && targetPt && !samePoint(driverPt, targetPt)) {
        fittedPhaseRef.current = phaseKey;
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(driverPt);
        bounds.extend(targetPt);
        map.fitBounds(bounds, 72);
        google.maps.event.addListenerOnce(map, 'idle', () => {
          const zoom = map.getZoom();
          if (zoom != null && zoom > 16) map.setZoom(16);
          if (zoom != null && zoom < 11) map.setZoom(12);
        });
        lastFollowKey.current = '';
        return;
      }

      const key = `${driverPt.lat.toFixed(5)},${driverPt.lng.toFixed(5)}`;
      if (key !== lastFollowKey.current) {
        lastFollowKey.current = key;
        map.panTo(driverPt);
        const zoom = map.getZoom();
        if (zoom == null || zoom < 12 || zoom > 16) {
          map.setZoom(FOLLOW_ZOOM);
        }
      }
      return;
    }

    const points: LatLng[] = [];
    if (pickupPt) points.push(pickupPt);
    if (dropoffPt) points.push(dropoffPt);
    if (driverPt && points.length === 0) points.push(driverPt);

    if (points.length === 0) {
      map.panTo(SAUDI_CENTER);
      map.setZoom(SAUDI_OVERVIEW_ZOOM);
      return;
    }

    if (points.length === 1) {
      map.panTo(points[0]);
      map.setZoom(CITY_ZOOM);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);

    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      const zoom = map.getZoom();
      if (zoom != null && zoom > 15) map.setZoom(15);
      if (zoom != null && zoom < 10) map.setZoom(11);
    });
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [
    map,
    pickup?.lat,
    pickup?.lng,
    dropoff?.lat,
    dropoff?.lng,
    driver?.lat,
    driver?.lng,
    followDriver,
    navPhase,
  ]);

  return null;
};

function snapRouteOrigin(point: LatLng): LatLng {
  return {
    lat: Math.round(point.lat * 100) / 100,
    lng: Math.round(point.lng * 100) / 100,
  };
}

/**
 * Customer tracking map — always frames Saudi Arabia / trip coords (never a blank world view).
 * Classic Markers (no Cloud Map ID required).
 */
export const LiveTrackingMap: React.FC<LiveTrackingMapProps> = ({
  pickup,
  dropoff,
  driver,
  pickupLabel,
  dropoffLabel,
  driverLabel,
  followDriver = false,
  navPhase = 'idle',
}) => {
  const pickupPt = isValidLatLng(pickup) ? pickup : null;
  const dropoffPt = isValidLatLng(dropoff) ? dropoff : null;
  const driverPt =
    driver && isValidLatLng({ lat: driver.lat, lng: driver.lng })
      ? { lat: driver.lat, lng: driver.lng }
      : null;

  const route = useMemo(() => {
    if (navPhase === 'to_pickup' && driverPt && pickupPt && !samePoint(driverPt, pickupPt)) {
      return { origin: snapRouteOrigin(driverPt), destination: pickupPt };
    }
    if (navPhase === 'to_dropoff' && dropoffPt) {
      const origin = pickupPt || (driverPt ? snapRouteOrigin(driverPt) : null);
      if (origin && !samePoint(origin, dropoffPt)) {
        return { origin, destination: dropoffPt };
      }
    }
    return null;
  }, [
    navPhase,
    pickupPt?.lat,
    pickupPt?.lng,
    dropoffPt?.lat,
    dropoffPt?.lng,
    driverPt ? `${snapRouteOrigin(driverPt).lat},${snapRouteOrigin(driverPt).lng}` : 'none',
  ]);

  const center = useMemo(() => {
    if (followDriver && driverPt) return driverPt;
    if (pickupPt) return pickupPt;
    if (dropoffPt) return dropoffPt;
    if (driverPt) return driverPt;
    return SAUDI_CENTER;
  }, [followDriver, driverPt?.lat, driverPt?.lng, pickupPt?.lat, pickupPt?.lng, dropoffPt?.lat, dropoffPt?.lng]);

  const defaultZoom = pickupPt || dropoffPt || driverPt ? CITY_ZOOM : SAUDI_OVERVIEW_ZOOM;

  const mapKey = `${pickupPt ? `${pickupPt.lat},${pickupPt.lng}` : 'np'}-${
    dropoffPt ? `${dropoffPt.lat},${dropoffPt.lng}` : 'nd'
  }`;

  return (
    <Map
      key={mapKey}
      defaultCenter={center}
      defaultZoom={defaultZoom}
      gestureHandling="greedy"
      disableDefaultUI
      className="absolute inset-0 w-full h-full"
    >
      <TrackingCamera
        pickup={pickupPt}
        dropoff={dropoffPt}
        driver={driverPt ? { lat: driverPt.lat, lng: driverPt.lng } : null}
        followDriver={followDriver && Boolean(driverPt)}
        navPhase={navPhase}
      />

      {route && <TrackingRouteLayer origin={route.origin} destination={route.destination} />}

      {pickupPt && <Marker position={pickupPt} title={pickupLabel} />}
      {dropoffPt && <Marker position={dropoffPt} title={dropoffLabel} />}
      {driverPt && <Marker position={driverPt} title={driverLabel} />}
    </Map>
  );
};
