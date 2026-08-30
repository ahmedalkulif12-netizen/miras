type LatLng = { lat: number; lng: number };

const CITY_CENTERS: Record<string, LatLng> = {
  riyadh: { lat: 24.7136, lng: 46.6753 },
  الرياض: { lat: 24.7136, lng: 46.6753 },
  jeddah: { lat: 21.4858, lng: 39.1925 },
  jiddah: { lat: 21.4858, lng: 39.1925 },
  جدة: { lat: 21.4858, lng: 39.1925 },
  dammam: { lat: 26.4207, lng: 50.0888 },
  الدمام: { lat: 26.4207, lng: 50.0888 },
  khobar: { lat: 26.2172, lng: 50.1971 },
  الخبر: { lat: 26.2172, lng: 50.1971 },
  makkah: { lat: 21.3891, lng: 39.8579 },
  mecca: { lat: 21.3891, lng: 39.8579 },
  مكة: { lat: 21.3891, lng: 39.8579 },
  madinah: { lat: 24.5247, lng: 39.5692 },
  medina: { lat: 24.5247, lng: 39.5692 },
  المدينة: { lat: 24.5247, lng: 39.5692 },
  taif: { lat: 21.2703, lng: 40.4158 },
  الطائف: { lat: 21.2703, lng: 40.4158 },
  abha: { lat: 18.2164, lng: 42.5053 },
  أبها: { lat: 18.2164, lng: 42.5053 },
  tabuk: { lat: 28.3838, lng: 36.555 },
  تبوك: { lat: 28.3838, lng: 36.555 },
  hail: { lat: 27.5114, lng: 41.69 },
  حائل: { lat: 27.5114, lng: 41.69 },
  buraidah: { lat: 26.326, lng: 43.975 },
  buraydah: { lat: 26.326, lng: 43.975 },
  بريدة: { lat: 26.326, lng: 43.975 },
  najran: { lat: 17.5656, lng: 44.2289 },
  نجران: { lat: 17.5656, lng: 44.2289 },
  jazan: { lat: 16.8892, lng: 42.5511 },
  جازان: { lat: 16.8892, lng: 42.5511 },
  hofuf: { lat: 25.3646, lng: 49.586 },
  'al hofuf': { lat: 25.3646, lng: 49.586 },
  الهفوف: { lat: 25.3646, lng: 49.586 },
  ahsa: { lat: 25.3646, lng: 49.586 },
  الأحساء: { lat: 25.3646, lng: 49.586 },
  dhahran: { lat: 26.2886, lng: 50.1139 },
  الظهران: { lat: 26.2886, lng: 50.1139 },
  jubail: { lat: 27.0046, lng: 49.6225 },
  الجبيل: { lat: 27.0046, lng: 49.6225 },
  qatif: { lat: 26.565, lng: 49.996 },
  القطيف: { lat: 26.565, lng: 49.996 },
  yanbu: { lat: 24.0892, lng: 38.0618 },
  ينبع: { lat: 24.0892, lng: 38.0618 },
  'khamis mushait': { lat: 18.3, lng: 42.7333 },
  'خميس مشيط': { lat: 18.3, lng: 42.7333 },
};

function normalizeCityKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/city$/i, '')
    .replace(/[,].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Approximate map pin from a city name when order lat/lng are missing. */
export function cityCenterFromName(name: string | null | undefined): LatLng | null {
  if (!name) return null;
  const raw = name.trim();
  if (!raw) return null;
  const direct = CITY_CENTERS[raw] || CITY_CENTERS[normalizeCityKey(raw)];
  if (direct) return direct;
  const key = normalizeCityKey(raw);
  for (const [label, point] of Object.entries(CITY_CENTERS)) {
    if (key.includes(normalizeCityKey(label)) || normalizeCityKey(label).includes(key)) {
      return point;
    }
  }
  return null;
}

export const DEFAULT_MAP_CITY: LatLng = CITY_CENTERS.riyadh;

/** Geocode a city/address via Google Maps when it is not in the local table. */
export function geocodePlaceName(name: string | null | undefined): Promise<LatLng | null> {
  const query = String(name || '').trim();
  if (!query) return Promise.resolve(null);
  if (typeof google === 'undefined' || !google.maps?.Geocoder) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode(
      { address: `${query}, Saudi Arabia` },
      (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results?.[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
          return;
        }
        resolve(null);
      }
    );
  });
}
