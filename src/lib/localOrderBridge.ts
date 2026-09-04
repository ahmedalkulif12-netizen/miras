import {
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { db, ensureFirebaseReady, auth } from '@/lib/firebase';
import type { CreateOrderRequest, CreateOrderResponse } from '@/lib/orderContract';
import { loadCheckoutDraft, loadDemoOrderFromSession } from '@/lib/checkoutDraft';
import { loadDevBypassProfile } from '@/lib/devAuthBypass';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import { debitLocalCustomerWallet } from '@/lib/localCustomerWallet';
import { allowsSandboxCheckout } from '@/lib/checkoutGating';
import { canonicalizeServiceType, driverMatchesRequiredVehicle } from '@/domain/serviceCategories';
import { isActiveTripStatus, isOpenOfferStatus, isTerminalOrderStatus, OrderStatus, preferFresherOrderStatus } from '@/domain/order-status';
import { buildOrderDispatch } from '@/domain/dispatchMatching';
import { normalizeTripFinancials, toPersistedOrderMoneyFields, coerceMoney } from '@/domain/financials';

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)) {
      out[key] = omitUndefined(item as Record<string, unknown>);
    } else {
      out[key] = item;
    }
  }
  return out as T;
}

/**
 * Shared local/dev order bridge: writes the customer order to Firestore so the
 * driver dashboard can receive the exact same document (coords, furniture notes, etc.).
 * Prefer Admin SDK `/api/orders/publish-after-checkout` when authenticated.
 *
 * Important: call writeSharedLocalOrder / promoteSharedOrderToBroadcasting only
 * AFTER payment succeeds — never during the initial booking/request step.
 */

export function buildSharedOrderDocument(
  orderId: string,
  payload: CreateOrderRequest,
  response: CreateOrderResponse,
  status: string
): Record<string, unknown> {
  const profile = loadDevBypassProfile();
  const now = new Date().toISOString();
  const money = toPersistedOrderMoneyFields(normalizeTripFinancials(response.financials || {}));
  const serviceType =
    canonicalizeServiceType(payload.serviceType) || payload.serviceType;
  const userId = auth.currentUser?.uid || '';
  const customerPhone =
    auth.currentUser?.phoneNumber || profile?.phone || '';

  const resolvedStatus =
    status === 'awaiting_payment'
      ? 'awaiting_payment'
      : isOpenOfferStatus(status) || !status
        ? OrderStatus.BROADCASTING
        : status;

  return {
    userId,
    clientId: userId,
    customerId: userId,
    serviceType,
    requiredVehicleType: serviceType,
    truckType: payload.truckType || 'normal',
    tripType: payload.tripType || 'inside_city',
    serviceDetails: {
      ...(payload.serviceDetails || {}),
      ...(payload.vehicleFieldNotes
        ? { vehicleFieldNotes: payload.vehicleFieldNotes }
        : {}),
    },
    ...(payload.vehicleFieldNotes
      ? { vehicleFieldNotes: payload.vehicleFieldNotes }
      : payload.serviceDetails &&
          typeof payload.serviceDetails === 'object' &&
          (payload.serviceDetails as { vehicleFieldNotes?: unknown }).vehicleFieldNotes
        ? {
            vehicleFieldNotes: (
              payload.serviceDetails as { vehicleFieldNotes: unknown }
            ).vehicleFieldNotes,
          }
        : {}),
    pickupAddress: payload.pickupAddress,
    dropoffAddress: payload.dropoffAddress,
    pickup: {
      address: payload.pickupAddress,
      lat: payload.pickupLat,
      lng: payload.pickupLng,
      city: payload.pickupCity || '',
    },
    destination: {
      address: payload.dropoffAddress,
      lat: payload.dropoffLat,
      lng: payload.dropoffLng,
      city: payload.dropoffCity || '',
    },
    pickupLat: payload.pickupLat,
    pickupLng: payload.pickupLng,
    dropoffLat: payload.dropoffLat,
    dropoffLng: payload.dropoffLng,
    pickupCoords: { lat: payload.pickupLat, lng: payload.pickupLng },
    destinationCoords: { lat: payload.dropoffLat, lng: payload.dropoffLng },
    pickupCity: payload.pickupCity || '',
    dropoffCity: payload.dropoffCity || '',
    distanceKm: payload.distanceKm,
    distance: payload.distanceKm,
    truckCount: payload.truckCount ?? 1,
    ...(payload.matchedDriverId ? { matchedDriverId: payload.matchedDriverId } : {}),
    ...money,
    status: resolvedStatus,
    paymentStatus: resolvedStatus === OrderStatus.BROADCASTING ? 'authorized' : 'pending',
    quote: response.quote,
    ...(customerPhone ? { customerPhone } : {}),
    ...(profile?.name ? { customerName: profile.name } : {}),
    deliveryOnly: serviceType === 'water_tanker',
    locationMode:
      serviceType === 'water_tanker' ? 'delivery_only' : 'pickup_destination',
    createdAt: now,
    updatedAt: now,
    ...(import.meta.env.VITE_E2E ? { localSharedE2E: true } : {}),
    dispatch: buildOrderDispatch({
      pickupLat: payload.pickupLat,
      pickupLng: payload.pickupLng,
      pickupCity: payload.pickupCity,
      startedAt: now,
    }),
  };
}

const LOCAL_BROADCAST_KEY = 'miras_local_broadcast_orders';
export const LOCAL_ORDERS_CHANGED_EVENT = 'miras-local-orders-changed';

export function loadLocalBroadcastOrders(): Array<{
  id: string;
  data: Record<string, unknown>;
}> {
  try {
    const raw = localStorage.getItem(LOCAL_BROADCAST_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    return Object.entries(map || {}).map(([id, data]) => ({
      id,
      data: data && typeof data === 'object' ? data : {},
    }));
  } catch {
    return [];
  }
}

function jsonSafeOrderPatch(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
      try {
        out[key] = (value as { toMillis: () => number }).toMillis();
        continue;
      } catch {
        /* keep original */
      }
    }
    out[key] = value;
  }
  return out;
}

/** Merge a live Firestore snapshot into the same-browser order cache (status + driver). */
export function upsertLocalBroadcastOrder(
  orderId: string,
  data: Record<string, unknown>
): void {
  if (!orderId) return;
  const existing = loadLocalBroadcastOrders().find((entry) => entry.id === orderId)?.data || {};
  const patch = jsonSafeOrderPatch(data);
  const nextStatus = preferFresherOrderStatus(
    String(existing.status || ''),
    String(patch.status || '')
  );
  persistLocalBroadcastOrder(orderId, {
    ...existing,
    ...patch,
    status: nextStatus || patch.status || existing.status,
    driverId: patch.driverId ?? existing.driverId,
    driverName: patch.driverName ?? existing.driverName,
    driver: patch.driver ?? existing.driver,
  });
}

function persistLocalBroadcastOrder(
  orderId: string,
  data: Record<string, unknown>
): void {
  try {
    const raw = localStorage.getItem(LOCAL_BROADCAST_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    map[orderId] = data;
    localStorage.setItem(LOCAL_BROADCAST_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(LOCAL_ORDERS_CHANGED_EVENT));
    try {
      const channel = new BroadcastChannel('miras-orders');
      channel.postMessage({ type: 'order-broadcast', orderId });
      channel.close();
    } catch {
      /* BroadcastChannel unavailable */
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function subscribeLocalBroadcastOrders(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(LOCAL_ORDERS_CHANGED_EVENT, handler);
  window.addEventListener('storage', handler);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel('miras-orders');
    channel.onmessage = handler;
  } catch {
    channel = null;
  }
  return () => {
    window.removeEventListener(LOCAL_ORDERS_CHANGED_EVENT, handler);
    window.removeEventListener('storage', handler);
    channel?.close();
  };
}

/** Paid local/demo orders waiting for a driver (same-browser E2E). */
export function listLocalBroadcastingOrders(): Array<{
  id: string;
  data: Record<string, unknown>;
}> {
  return loadLocalBroadcastOrders().filter((entry) => {
    const status = String(entry.data.status || '');
    return (
      status === 'broadcasting' ||
      status === 'payment_authorized' ||
      status === 'searching_driver' ||
      status === 'pending'
    );
  });
}

/** Persist a local/demo order to Firestore (call only after successful payment). */
export function debugOrderPayload(
  orderId: string,
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const d = data || {};
  return {
    id: orderId,
    status: d.status ?? null,
    paymentStatus: d.paymentStatus ?? null,
    serviceType: d.serviceType ?? null,
    requiredVehicleType: d.requiredVehicleType ?? d.serviceType ?? null,
    userId: d.userId ?? null,
    clientId: d.clientId ?? null,
    customerId: d.customerId ?? null,
    driverId: d.driverId ?? null,
    pickupCity: d.pickupCity ?? (d.pickup as { city?: string } | undefined)?.city ?? null,
    pickupLat: d.pickupLat ?? null,
    pickupLng: d.pickupLng ?? null,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
  };
}

/** Persist a local/demo order to Firestore (call only after successful payment). */
function debitCustomerWalletAfterPlace(
  uid: string,
  orderId: string,
  financials: CreateOrderResponse['financials'] | undefined
): void {
  const amount = coerceMoney(financials?.customerTotal);
  if (!uid || !(amount > 0)) return;
  debitLocalCustomerWallet(uid, amount, orderId);
}

export async function writeSharedLocalOrder(input: {
  orderId: string;
  payload: CreateOrderRequest;
  response: CreateOrderResponse;
  status?: string;
}): Promise<void> {
  await ensureFirebaseReady();
  const firebaseUid = await ensureSignedInFirebaseUid();
  if (!firebaseUid || !auth.currentUser) {
    throw new Error('NOT_AUTHENTICATED');
  }
  const status = input.status || 'broadcasting';
  const body = buildSharedOrderDocument(
    input.orderId,
    input.payload,
    input.response,
    status
  );
  body.userId = firebaseUid;
  body.clientId = firebaseUid;
  body.customerId = firebaseUid;
  body.status = 'broadcasting';
  body.paymentStatus = 'authorized';
  const cleanBody = omitUndefined(body);

  const ref = doc(db, 'orders', input.orderId);
  const notes =
    input.payload.vehicleFieldNotes ||
    (input.payload.serviceDetails &&
    typeof input.payload.serviceDetails === 'object'
      ? (input.payload.serviceDetails as { vehicleFieldNotes?: unknown })
          .vehicleFieldNotes
      : undefined);
  const promoteFields = {
    status: 'broadcasting',
    paymentStatus: 'authorized',
    updatedAt: new Date().toISOString(),
    promotedAt: serverTimestamp(),
  };
  const promoteWithNotes = {
    ...promoteFields,
    ...(notes ? { vehicleFieldNotes: notes } : {}),
  };

  const commitLocalFallback = (): void => {
    persistLocalBroadcastOrder(input.orderId, cleanBody);
    debitCustomerWalletAfterPlace(firebaseUid, input.orderId, input.response.financials);
  };

  try {
    await setDoc(ref, cleanBody);
    persistLocalBroadcastOrder(input.orderId, cleanBody);
    debitCustomerWalletAfterPlace(firebaseUid, input.orderId, input.response.financials);
    console.info('[orders] WRITE full order → Firestore', {
      ...debugOrderPayload(input.orderId, cleanBody),
      authUid: firebaseUid,
      customerIdMatchesAuth: cleanBody.customerId === firebaseUid,
      hasCurrentUser: Boolean(auth.currentUser),
    });
  } catch (error: unknown) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code || '')
        : '';
    if (code === 'already-exists' || code === 'permission-denied') {
      try {
        await setDoc(ref, promoteWithNotes, { merge: true });
        persistLocalBroadcastOrder(input.orderId, { ...cleanBody, ...promoteWithNotes });
        debitCustomerWalletAfterPlace(firebaseUid, input.orderId, input.response.financials);
        console.info('[orders] MERGE status=broadcasting', debugOrderPayload(input.orderId, {
          ...cleanBody,
          ...promoteWithNotes,
        }));
        return;
      } catch {
        try {
          await setDoc(ref, promoteFields, { merge: true });
          persistLocalBroadcastOrder(input.orderId, { ...cleanBody, ...promoteFields });
          debitCustomerWalletAfterPlace(firebaseUid, input.orderId, input.response.financials);
          return;
        } catch {
          if (allowsSandboxCheckout()) {
            console.warn(
              '[orders] Firestore write failed — keeping local DEV order',
              input.orderId
            );
            commitLocalFallback();
            return;
          }
          throw error;
        }
      }
    }
    if (allowsSandboxCheckout()) {
      console.warn('[orders] Firestore write failed — order kept locally', error);
      commitLocalFallback();
      return;
    }
    throw error;
  }
  console.info('[orders] Shared local order written', input.orderId, {
    status,
    serviceType: body.serviceType,
    pickupLat: input.payload.pickupLat,
    pickupLng: input.payload.pickupLng,
    dropoffLat: input.payload.dropoffLat,
    dropoffLng: input.payload.dropoffLng,
  });
}

async function loadPaidSessionDraft(orderId: string) {
  return loadDemoOrderFromSession(orderId) || loadCheckoutDraft(orderId);
}

/**
 * After successful payment — first Firestore write (from session) or promote to
 * broadcasting so drivers see the offer.
 */
export async function promoteSharedOrderToBroadcasting(orderId: string): Promise<void> {
  await ensureFirebaseReady();
  await ensureSignedInFirebaseUid();
  const ref = doc(db, 'orders', orderId);
  const sessionDraft = await loadPaidSessionDraft(orderId);

  if (sessionDraft) {
    const financials = sessionDraft.financials;
    const quote = sessionDraft.quote;
    const payload: CreateOrderRequest = {
      serviceType: sessionDraft.serviceType,
      truckType: sessionDraft.truckType,
      tripType: sessionDraft.tripType,
      serviceDetails: sessionDraft.serviceDetails,
      vehicleFieldNotes: sessionDraft.vehicleFieldNotes,
      pickupAddress: sessionDraft.pickupAddress,
      dropoffAddress: sessionDraft.dropoffAddress,
      pickupLat: sessionDraft.pickupLat,
      pickupLng: sessionDraft.pickupLng,
      dropoffLat: sessionDraft.dropoffLat,
      dropoffLng: sessionDraft.dropoffLng,
      distanceKm: sessionDraft.distanceKm,
      pickupCity: sessionDraft.pickupCity,
      dropoffCity: sessionDraft.dropoffCity,
      truckCount: sessionDraft.truckCount,
      matchedDriverId: sessionDraft.matchedDriverId,
    };
    await writeSharedLocalOrder({
      orderId,
      payload,
      response: { orderId, financials, quote },
      status: 'broadcasting',
    });
    return;
  }

  let snap: Awaited<ReturnType<typeof getDoc>> | null = null;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    console.warn('[orders] Could not read order before promote — no session draft', error);
  }

  if (!snap?.exists()) {
    throw new Error(`Cannot promote — draft/order missing: ${orderId}`);
  }

  const draft = sessionDraft;
  const notes = draft?.vehicleFieldNotes || draft?.serviceDetails?.vehicleFieldNotes;
  const existing = {
    ...(snap.data() as Record<string, unknown>),
    ...(findLocalOrderData(orderId) || {}),
  };
  const promoteFields = {
    status: 'broadcasting',
    paymentStatus: 'authorized',
    updatedAt: new Date().toISOString(),
  };
  const promoteWithNotes = {
    ...promoteFields,
    promotedAt: serverTimestamp(),
    ...(notes ? { vehicleFieldNotes: notes } : {}),
    ...(draft?.serviceDetails
      ? {
          serviceDetails: {
            ...((existing.serviceDetails as Record<string, unknown>) || {}),
            ...draft.serviceDetails,
            ...(notes ? { vehicleFieldNotes: notes } : {}),
          },
        }
      : {}),
  };
  persistLocalBroadcastOrder(orderId, {
    ...existing,
    ...promoteFields,
    ...(notes ? { vehicleFieldNotes: notes } : {}),
    ...(draft?.serviceDetails
      ? {
          serviceDetails: {
            ...((existing.serviceDetails as Record<string, unknown>) || {}),
            ...draft.serviceDetails,
            ...(notes ? { vehicleFieldNotes: notes } : {}),
          },
        }
      : {}),
  });
  try {
    await setDoc(ref, promoteWithNotes, { merge: true });
    console.info('[orders] Promoted to broadcasting', orderId);
  } catch (error) {
    try {
      await setDoc(
        ref,
        { ...promoteFields, promotedAt: serverTimestamp() },
        { merge: true }
      );
    } catch {
      console.warn('[orders] Promote update failed — order already exists locally', error);
    }
  }
}

function findLocalOrderData(orderId: string): Record<string, unknown> | null {
  const entry = loadLocalBroadcastOrders().find((item) => item.id === orderId);
  return entry?.data || null;
}

/** Driver accept — claim a broadcasting order (Firestore when allowed, else local). */
export async function assignSharedLocalOrder(
  orderId: string,
  driver: {
    id: string;
    name: string;
    phone: string;
    truckDetails: string;
    vehicleType?: string;
  }
): Promise<{ orderId: string; status: string; alreadyAssigned?: boolean }> {
  await ensureFirebaseReady();
  const ref = doc(db, 'orders', orderId);

  let data: {
    status?: string;
    driverId?: string;
    serviceType?: string;
    requiredVehicleType?: string;
    truckType?: string;
  } | null = null;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      data = snap.data() as typeof data;
    }
  } catch (error) {
    console.warn('[orders] Could not read order before accept:', error);
  }

  if (!data) {
    const local = findLocalOrderData(orderId);
    if (local) {
      data = local as NonNullable<typeof data>;
    }
  }

  if (!data) {
    throw new Error(`ORDER_NOT_FOUND:${orderId}`);
  }

  if (data.driverId && data.driverId !== driver.id) {
    return {
      orderId,
      status: String(data.status || 'assigned'),
      alreadyAssigned: true,
    };
  }

  if (driver.vehicleType && !driverMatchesRequiredVehicle(driver.vehicleType, data)) {
    throw new Error(
      `VEHICLE_TYPE_MISMATCH:driver=${driver.vehicleType || 'none'}:order=${String(
        (data as { requiredVehicleType?: string }).requiredVehicleType || data.serviceType || 'none'
      )}`
    );
  }

  let firebaseUid = auth.currentUser?.uid || '';
  try {
    firebaseUid = await ensureSignedInFirebaseUid();
  } catch {
    firebaseUid = auth.currentUser?.uid || driver.id;
  }
  const alreadyBusy = loadLocalBroadcastOrders().some(
    (entry) =>
      entry.id !== orderId &&
      String(entry.data.driverId || '') === firebaseUid &&
      isActiveTripStatus(String(entry.data.status || '')) &&
      !isTerminalOrderStatus(String(entry.data.status || ''))
  );
  if (alreadyBusy) {
    throw new Error('DRIVER_ALREADY_ON_TRIP');
  }

  const assignment = {
    status: 'assigned' as const,
    driverId: firebaseUid,
    driver: {
      id: firebaseUid,
      name: driver.name,
      phone: driver.phone,
      truckDetails: driver.truckDetails,
      status: 'approved',
      vehicleType: driver.vehicleType || null,
    },
    driverPhone: driver.phone,
    updatedAt: new Date().toISOString(),
  };

  persistLocalBroadcastOrder(orderId, {
    ...(findLocalOrderData(orderId) || data),
    ...assignment,
    assignedAt: new Date().toISOString(),
  });

  try {
    await setDoc(
      ref,
      {
        ...assignment,
        assignedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn('[orders] Firestore accept write failed — kept local assignment', error);
    if (!import.meta.env.DEV) {
      throw error;
    }
  }

  console.info('[orders] Assigned shared local order', orderId, '→', firebaseUid);
  return { orderId, status: 'assigned' };
}

/** Local/dev status transitions on the same order document. */
export async function patchSharedLocalOrderStatus(
  orderId: string,
  status: string
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const existing = findLocalOrderData(orderId);
  persistLocalBroadcastOrder(orderId, {
    ...(existing || {}),
    status,
    updatedAt,
  });

  await ensureFirebaseReady();
  try {
    await ensureSignedInFirebaseUid(5000);
  } catch {
    /* continue with currentUser if present */
  }
  try {
    await setDoc(
      doc(db, 'orders', orderId),
      {
        status,
        updatedAt,
      },
      { merge: true }
    );
  } catch (error) {
    console.warn('[orders] Status patch failed — kept local status', error);
    if (!import.meta.env.DEV) {
      throw error;
    }
  }
}
