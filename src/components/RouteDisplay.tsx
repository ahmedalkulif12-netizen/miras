import React, { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { isValidRoutePoint } from '@/lib/computeDrivingRoute';

interface RouteDisplayProps {
  origin: string | google.maps.LatLngLiteral;
  destination: string | google.maps.LatLngLiteral;
}

function isUsableWaypoint(
  point: string | google.maps.LatLngLiteral
): point is string | google.maps.LatLngLiteral {
  if (typeof point === 'string') return point.trim().length > 0;
  return isValidRoutePoint(point);
}

/**
 * Draw a driving polyline with classic DirectionsService.
 * The newer Route.computeRoutes API is not enabled on this Maps key and
 * previously produced empty routes ("لم يتم العثور على مسار صالح").
 */
export const RouteDisplay: React.FC<RouteDisplayProps> = ({ origin, destination }) => {
  const map = useMap();
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!map || !isUsableWaypoint(origin) || !isUsableWaypoint(destination)) return;
    if (typeof google === 'undefined' || !google.maps?.DirectionsService) return;

    const renderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      preserveViewport: false,
      polylineOptions: {
        strokeColor: '#d97706',
        strokeWeight: 5,
        strokeOpacity: 0.9,
      },
    });
    rendererRef.current = renderer;

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
          renderer.setDirections(result);
        }
      }
    );

    return () => {
      cancelled = true;
      renderer.setMap(null);
      rendererRef.current = null;
    };
  }, [map, origin, destination]);

  return null;
};
