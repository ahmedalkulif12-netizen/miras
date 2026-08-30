import React, { useEffect, useMemo, useRef } from 'react';
import { Map, Marker, useMap } from '@vis.gl/react-google-maps';
import type { LiveDriverPosition } from '@/lib/liveTracking';
import { haversineKm, type LatLng } from '@/lib/orderGeo';

interface LiveTrackingMapProps {
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driver?: LiveDriverPosition | null;
  pickupLabel: string;
  dropoffLabel: string;
  driverLabel: string;
  /** When true (driver assigned / en route), pan camera to follow live GPS. */
  followDriver?: boolean;
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

/** Fit / center camera on Saudi trip endpoints; follow driver when nearby. */
const TrackingCamera: React.FC<{
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driver?: LiveDriverPosition | null;
  followDriver?: boolean;
}> = ({ pickup, dropoff, driver, followDriver }) => {
  const map = useMap();
  const lastFollowKey = useRef<string>('');

  useEffect(() => {
    if (!map) return;

    const pickupPt = isValidLatLng(pickup) ? pickup : null;
    const dropoffPt = isValidLatLng(dropoff) ? dropoff : null;
    const driverPt =
      driver && isValidLatLng({ lat: driver.lat, lng: driver.lng })
        ? { lat: driver.lat, lng: driver.lng }
        : null;

    // Live follow once the driver is on the local trip.
    if (followDriver && driverPt) {
      const nearTrip =
        (pickupPt && haversineKm(driverPt, pickupPt) <= 80) ||
        (dropoffPt && haversineKm(driverPt, dropoffPt) <= 80) ||
        (!pickupPt && !dropoffPt);

      if (nearTrip) {
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
    }

    const points: LatLng[] = [];
    if (pickupPt) points.push(pickupPt);
    if (dropoffPt) points.push(dropoffPt);

    if (driverPt && pickupPt && dropoffPt) {
      const near =
        haversineKm(driverPt, pickupPt) <= 40 || haversineKm(driverPt, dropoffPt) <= 40;
      if (near) points.push(driverPt);
    } else if (driverPt && points.length === 0) {
      points.push(driverPt);
    }

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
  ]);

  return null;
};

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
}) => {
  const pickupPt = isValidLatLng(pickup) ? pickup : null;
  const dropoffPt = isValidLatLng(dropoff) ? dropoff : null;
  const driverPt =
    driver && isValidLatLng({ lat: driver.lat, lng: driver.lng })
      ? { lat: driver.lat, lng: driver.lng }
      : null;

  const center = useMemo(() => {
    if (followDriver && driverPt) return driverPt;
    if (pickupPt) return pickupPt;
    if (dropoffPt) return dropoffPt;
    if (driverPt) return driverPt;
    return SAUDI_CENTER;
  }, [followDriver, driverPt?.lat, driverPt?.lng, pickupPt?.lat, pickupPt?.lng, dropoffPt?.lat, dropoffPt?.lng]);

  const defaultZoom = pickupPt || dropoffPt || driverPt ? CITY_ZOOM : SAUDI_OVERVIEW_ZOOM;

  // Remount when trip coords first become available so defaultCenter isn't stuck at world scale.
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
      />

      {pickupPt && <Marker position={pickupPt} title={pickupLabel} />}
      {dropoffPt && <Marker position={dropoffPt} title={dropoffLabel} />}
      {driverPt && <Marker position={driverPt} title={driverLabel} />}
    </Map>
  );
};
