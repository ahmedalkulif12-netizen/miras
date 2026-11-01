/** True when the map camera is already on this point (about 50m). */
export function mapCenterIsNear(
  map: google.maps.Map,
  target: google.maps.LatLngLiteral,
  epsilon = 0.00045
): boolean {
  const center = map.getCenter();
  if (!center) return false;
  return (
    Math.abs(center.lat() - target.lat) < epsilon &&
    Math.abs(center.lng() - target.lng) < epsilon
  );
}

/**
 * Move the camera in one shot.
 * panTo() followed by setZoom() is dropped by the Maps JS API inside iOS and
 * Android WebViews: the zoom wins and the map stays on the previous city.
 * Zoom first, then moveCamera and setCenter so the new lat/lng sticks.
 */
export function setMapCamera(
  map: google.maps.Map,
  center: google.maps.LatLngLiteral,
  zoom?: number
): void {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
  const latLng = new google.maps.LatLng(center.lat, center.lng);
  const nextZoom = zoom != null && Number.isFinite(zoom) ? zoom : undefined;
  if (nextZoom != null && map.getZoom() !== nextZoom) {
    map.setZoom(nextZoom);
  }
  if (typeof map.moveCamera === 'function') {
    map.moveCamera({
      center: latLng,
      ...(nextZoom != null ? { zoom: nextZoom } : {}),
    });
  }
  map.setCenter(latLng);
}

/** One-shot recenter. Triggers a WebView relayout, then sets the camera. */
export function focusMapCamera(
  map: google.maps.Map,
  center: google.maps.LatLngLiteral,
  zoom: number
): void {
  try {
    google.maps.event.trigger(map, 'resize');
  } catch {
    // The instance can exist before the event bus is ready.
  }
  setMapCamera(map, center, zoom);
}
