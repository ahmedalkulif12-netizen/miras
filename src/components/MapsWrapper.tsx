import React, { useEffect } from 'react';
import { APIProvider, useApiIsLoaded } from '@vis.gl/react-google-maps';
import { getGoogleMapsApiKey } from '@/lib/publicEnv';
import { isProductionClient } from '@/lib/appCheck/guard';
import { getAppCheckInstance, getAppCheckToken } from '@/lib/appCheck';

const API_KEY = getGoogleMapsApiKey();
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

if (import.meta.env.DEV && hasValidKey) {
  // Helps verify which key Vite resolved (.env.local overrides .env).
  console.info(
    `[Maps] Using VITE_GOOGLE_MAPS_* key ending …${API_KEY.slice(-6)} (len=${API_KEY.length})`
  );
}

/**
 * Local / demo: Maps JS loads with the API key only — do not attach Firebase App Check.
 * Production: optionally feed Maps a real App Check token (when Maps key enforcement is on).
 */
function shouldAttachMapsAppCheck(): boolean {
  return isProductionClient() && Boolean(getAppCheckInstance());
}

async function fetchMapsAppCheckToken(): Promise<google.maps.MapsAppCheckTokenResult> {
  const token = await getAppCheckToken(false);
  if (!token) {
    throw new Error('App Check token unavailable for Maps');
  }
  return { token };
}

/**
 * Ensures local Maps/Routes calls are not blocked by a failed App Check debug exchange.
 * Removes any fetchAppCheckToken hook so Routes API uses the API key alone.
 */
const LocalMapsAppCheckBypass: React.FC = () => {
  const ready = useApiIsLoaded();

  useEffect(() => {
    if (!ready || isProductionClient()) return;
    try {
      const settings = google.maps.Settings?.getInstance?.();
      if (!settings) return;

      // Prefer no App Check callback at all (API key only). Empty tokens can still 403.
      try {
        delete (settings as { fetchAppCheckToken?: unknown }).fetchAppCheckToken;
      } catch {
        (settings as { fetchAppCheckToken?: unknown }).fetchAppCheckToken = undefined;
      }

      console.info(
        '[Maps] Local App Check bypass active — Routes/Places use API key without App Check attestation'
      );
    } catch (err) {
      console.warn('[Maps] Could not install local App Check bypass:', err);
    }
  }, [ready]);

  return null;
};

export const MapsWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!hasValidKey) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', padding: '20px', backgroundColor: '#f9f9f9' }}>
        <div style={{ textAlign: 'center', maxWidth: 520, backgroundColor: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Google Maps API Key Required</h2>
          <p style={{ color: '#666', marginBottom: '16px' }}>
            Add <code>VITE_GOOGLE_MAPS_PLATFORM_KEY</code> or{' '}
            <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file.
          </p>
          <p style={{ fontSize: '14px', color: '#888' }}>See <code>docs/ENVIRONMENT.md</code> for setup.</p>
        </div>
      </div>
    );
  }

  const attachAppCheck = shouldAttachMapsAppCheck();

  return (
    <APIProvider
      apiKey={API_KEY}
      version="weekly"
      libraries={['places', 'marker', 'routes']}
      // Production only — local demos must not wait on exchangeDebugToken.
      {...(attachAppCheck ? { fetchAppCheckToken: fetchMapsAppCheckToken } : {})}
    >
      {!attachAppCheck && <LocalMapsAppCheckBypass />}
      {children}
    </APIProvider>
  );
};
