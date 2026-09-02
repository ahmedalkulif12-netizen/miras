import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { AdminContext } from './adminContext.ts';
import type { E2eConfig } from '../config.ts';
import { assert, sleep } from './assert.ts';

function createNamedClient(config: E2eConfig, name: string): { app: FirebaseApp; auth: Auth; db: Firestore } {
  const app = initializeApp(
    {
      apiKey: config.firebaseApiKey,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: config.projectId,
      appId: process.env.VITE_FIREBASE_APP_ID,
    },
    name
  );
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

async function signIn(ctx: AdminContext, clientAuth: Auth, uid: string): Promise<void> {
  const customToken = await ctx.auth.createCustomToken(uid);
  await signInWithCustomToken(clientAuth, customToken);
}

/**
 * Validates customer Firestore listener receives driver GPS writes on tracking/live.
 * Uses two isolated Firebase app instances so customer snapshot stays active while driver writes.
 */
export async function assertTrackingListenerReceivesUpdate(
  ctx: AdminContext,
  config: E2eConfig,
  input: {
    orderId: string;
    customerUid: string;
    driverUid: string;
    lat: number;
    lng: number;
  }
): Promise<void> {
  const customer = createNamedClient(config, 'e2e-customer');
  const driver = createNamedClient(config, 'e2e-driver');

  await signIn(ctx, customer.auth, input.customerUid);
  await signIn(ctx, driver.auth, input.driverUid);

  const trackingPath = doc(customer.db, 'orders', input.orderId, 'tracking', 'live');
  const driverTrackingPath = doc(driver.db, 'orders', input.orderId, 'tracking', 'live');

  let received: { lat: number; lng: number } | null = null;
  const unsubscribe = onSnapshot(trackingPath, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    received = { lat: Number(data.lat), lng: Number(data.lng) };
  });

  try {
    // Driver publishes GPS through client SDK (same path as DriverDashboard → liveTracking.ts)
    await setDoc(
      driverTrackingPath,
      {
        driverId: input.driverUid,
        lat: input.lat,
        lng: input.lng,
        heading: null,
        speed: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (received && received.lat === input.lat && received.lng === input.lng) {
        return;
      }
      await sleep(300);
    }

    assert(false, `Customer listener did not receive tracking update for order ${input.orderId}`);
  } finally {
    unsubscribe();
  }
}
