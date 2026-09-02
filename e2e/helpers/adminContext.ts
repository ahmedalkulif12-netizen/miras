import admin from 'firebase-admin';
import { loadServerEnv, getServerConfig } from '../../server/config/env.ts';
import type { E2eActors, E2eConfig } from '../config.ts';

export interface E2eRunArtifacts {
  orderIds: string[];
  paymentIds: string[];
  webhookEventIds: string[];
}

export interface AdminContext {
  db: admin.firestore.Firestore;
  auth: admin.auth.Auth;
  artifacts: E2eRunArtifacts;
}

let initialized = false;

export function initAdminContext(): AdminContext {
  if (!initialized) {
    loadServerEnv();
    const config = getServerConfig();
    if (!admin.apps.length) {
      if (config.firebaseProjectId) {
        admin.initializeApp({ projectId: config.firebaseProjectId });
      } else {
        admin.initializeApp();
      }
    }
    initialized = true;
  }

  return {
    db: admin.firestore(),
    auth: admin.auth(),
    artifacts: { orderIds: [], paymentIds: [], webhookEventIds: [] },
  };
}

/** Ensure dedicated staging actors exist in Auth + Firestore (never touches prod users). */
export async function ensureTestActors(ctx: AdminContext, actors: E2eActors): Promise<void> {
  const specs: Array<{ uid: string; role: 'customer' | 'driver'; phone: string; name: string }> = [
    { uid: actors.customerUid, role: 'customer', phone: '+966500000001', name: 'E2E Customer' },
    { uid: actors.driverAUid, role: 'driver', phone: '+966500000002', name: 'E2E Driver A' },
    { uid: actors.driverBUid, role: 'driver', phone: '+966500000003', name: 'E2E Driver B' },
  ];

  for (const spec of specs) {
    try {
      await ctx.auth.getUser(spec.uid);
    } catch {
      await ctx.auth.createUser({ uid: spec.uid, phoneNumber: spec.phone, displayName: spec.name });
    }

    await ctx.db.collection('users').doc(spec.uid).set(
      {
        uid: spec.uid,
        role: spec.role,
        phone: spec.phone,
        name: spec.name,
        accountStatus: 'approved',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (spec.role === 'driver') {
      await ctx.db.collection('drivers').doc(spec.uid).set(
        {
          uid: spec.uid,
          accountStatus: 'approved',
          vehicleType: 'flatbed',
          plateNumber: 'E2E-001',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
}

/** Exchange Admin custom token for a client ID token (same path mobile/web use after OTP). */
export async function mintIdToken(
  ctx: AdminContext,
  uid: string,
  firebaseApiKey: string
): Promise<string> {
  const customToken = await ctx.auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const data = (await res.json()) as { idToken?: string; error?: { message?: string } };
  if (!data.idToken) {
    throw new Error(`Failed to mint ID token for ${uid}: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data.idToken;
}

/** Seed payment doc the same shape server creates before Moyasar webhook authorization. */
export async function seedPaymentFixture(
  ctx: AdminContext,
  input: {
    orderId: string;
    userId: string;
    financials: Record<string, unknown>;
  }
): Promise<{ paymentId: string; moyasarId: string }> {
  const customerTotal = Number(input.financials.customerTotal ?? 0);
  const moyasarId = `e2e_moy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const paymentRef = await ctx.db.collection('payments').add({
    userId: input.userId,
    orderId: input.orderId,
    amount: customerTotal,
    tripFare: input.financials.tripFare ?? customerTotal,
    serviceFee: input.financials.serviceFee ?? 0,
    platformFee: input.financials.platformFee ?? 0,
    driverAmount: input.financials.driverNet ?? 0,
    financials: input.financials,
    status: 'pending',
    paymentMethod: 'mada',
    transactionId: moyasarId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await ctx.db.collection('orders').doc(input.orderId).update({
    paymentId: paymentRef.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  ctx.artifacts.paymentIds.push(paymentRef.id);
  return { paymentId: paymentRef.id, moyasarId };
}

export async function waitForOrderStatus(
  ctx: AdminContext,
  orderId: string,
  expected: string | string[],
  timeoutMs = 20_000
): Promise<string> {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snap = await ctx.db.collection('orders').doc(orderId).get();
    const status = String(snap.data()?.status || '');
    if (allowed.includes(status)) return status;
    await new Promise((r) => setTimeout(r, 400));
  }

  const latest = await ctx.db.collection('orders').doc(orderId).get();
  throw new Error(
    `Timeout waiting for order ${orderId} status [${allowed.join(', ')}]; last="${latest.data()?.status}"`
  );
}

/** Remove artifacts created during this run — scoped to tracked order/payment ids only. */
export async function cleanupArtifacts(ctx: AdminContext, config: E2eConfig): Promise<void> {
  if (config.skipCleanup) {
    console.log('[e2e] cleanup skipped (--skip-cleanup)');
    return;
  }

  for (const orderId of ctx.artifacts.orderIds) {
    const trackingSnap = await ctx.db.collection('orders').doc(orderId).collection('tracking').get();
    for (const doc of trackingSnap.docs) {
      await doc.ref.delete();
    }
    await ctx.db.collection('orders').doc(orderId).delete();
  }

  for (const paymentId of ctx.artifacts.paymentIds) {
    await ctx.db.collection('payments').doc(paymentId).delete();
  }

  for (const eventId of ctx.artifacts.webhookEventIds) {
    await ctx.db.collection('webhook_events').doc(eventId).delete();
  }
}
