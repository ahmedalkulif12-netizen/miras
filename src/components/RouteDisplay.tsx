import React, { useEffect, useRef } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

interface RouteDisplayProps {
  origin: string | google.maps.LatLngLiteral;
  destination: string | google.maps.LatLngLiteral;
}

export const RouteDisplay: React.FC<RouteDisplayProps> = ({ origin, destination }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map || !origin || !destination) return;
    
    // Clear previous route
    polylinesRef.current.forEach(p => p.setMap(null));

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode: 'DRIVING',
      // Valid Maps JS Route fields: path (geometry), distanceMeters, durationMillis, viewport
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    }).then(({ routes }) => {
      if (routes?.[0]) {
        const newPolylines = routes[0].createPolylines();
        newPolylines.forEach(p => p.setMap(map));
        polylinesRef.current = newPolylines;
        if (routes[0].viewport) {
          map.fitBounds(routes[0].viewport, { top: 50, right: 50, bottom: 50, left: 50 });
        }
      }
    }).catch(err => {
      console.error('Error computing routes:', err);
    });

    return () => polylinesRef.current.forEach(p => p.setMap(null));
  }, [routesLib, map, origin, destination]);

  return null;
};
