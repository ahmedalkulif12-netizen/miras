import { authFetch, isDevBypassAuthSession } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { loadDevBypassProfile } from '@/lib/devAuthBypass';
import { isLocalDevRuntime } from '@/lib/localDevRuntime';
import { getApiOrigin } from '@/lib/apiUrl';
import {
  assignSharedLocalOrder,
  patchSharedLocalOrderStatus,
} from '@/lib/localOrderBridge';

export interface CreateOrderRequest {
  serviceType: string;
  truckType?: 'normal' | 'hydraulic' | 'box' | string;
  tripType?: 'inside_city' | 'outside_city';
  serviceDetails?: Record<string, unknown>;
  vehicleFieldNotes?: {
    keyInside?: boolean;
    tiresFlat?: boolean;
    brokenDown?: boolean;
    extraNotes?: string;
  };
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  /** Kilometers only — never tank liters. */
  distanceKm: number;
  pickupCity?: string;
  dropoffCity?: string;
  truckCount?: number;
  matchedDriverId?: string;
  /** Water tanker: customer only sets drop-off. */
  deliveryOnly?: boolean;
  locationMode?: 'pickup_destination' | 'delivery_only';
}

export interface CreateOrderResponse {
  orderId: string;
  financials: {
    tripFare: number;
    serviceFee: number;
    customerTotal: number;
    platformFee: number;
    driverNet: number;
    currency: string;
  };
  quote: Record<string, unknown>;
}

/** Restore unpaid draft / demo payload after payment redirect. */
export function loadDemoOrderFromSession(orderId: string): (CreateOrderRequest & CreateOrderResponse) | null {
  if (!orderId.startsWith('demo-') && !orderId.startsWith('draft-')) return null;
  try {
    const keys = [
      `miras_demo_order_${orderId}`,
      `hamula_demo_order_${orderId}`,
      `miras_checkout_draft_${orderId}`,
      `hamula_checkout_draft_${orderId}`,
    ];
    let raw: string | null = null;
    for (const key of keys) {
      raw = sessionStorage.getItem(key);
      if (raw) {
        if (key.startsWith('hamula_')) {
          const migrated = key.replace(/^hamula_/, 'miras_');
          sessionStorage.setItem(migrated, raw);
          sessionStorage.removeItem(key);
        }
        break;
      }
    }
    if (!raw) return null;
    return JSON.parse(raw) as CreateOrderRequest & CreateOrderResponse;
  } catch {
    return null;
  }
}

/**
 * Prepares an unpaid checkout draft only — never writes to Firestore `orders`.
 * Prefer prepareCheckoutDraft() directly; this wrapper keeps older call sites safe.
 */
export async function createOrderSecure(payload: CreateOrderRequest): Promise<CreateOrderResponse> {
  const { prepareCheckoutDraft } = await import('@/lib/checkoutDraft');
  const draft = await prepareCheckoutDraft(payload);
  return {
    orderId: draft.draftId,
    financials: draft.financials,
    quote: draft.quote,
  };
}

function previewOrderBlocked(orderId: string, code: string): void {
  if (orderId === 'dev-preview' || orderId.startsWith('demo-trip-')) {
    throw new Error(code);
  }
}

function shouldUseClientOrderWrite(status: number, errorText: string): boolean {
  if (status === 409) return false;
  if (status === 503 || status === 501) return true;
  if (status >= 500) return true;
  if (
    /CLIENT_WRITE_REQUIRED|default credentials|Admin Firestore|Could not load the default credentials/i.test(
      errorText
    )
  ) {
    return true;
  }
  return isLocalDevRuntime() || Boolean(import.meta.env.DEV);
}

const CLIENT_ORDER_WRITE = Symbol('client-order-write');

function skipServerOrderMutation(): boolean {
  if (isDevBypassAuthSession()) return true;
  // Same-origin `npm run dev` has no Admin service account — skip the 503 round-trip.
  // Remote API (VITE_API_ORIGIN) is still used so Cloud Run Admin writes work from localhost.
  return isLocalDevRuntime() && !getApiOrigin();
}

async function tryServerOrderMutation<T>(
  path: string,
  body: Record<string, unknown>,
  fallbackMessage: string
): Promise<T | typeof CLIENT_ORDER_WRITE> {
  if (skipServerOrderMutation()) return CLIENT_ORDER_WRITE;

  let response: Response;
  try {
    response = await authFetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!shouldUseClientOrderWrite(500, text)) {
      throw error;
    }
    console.warn('[orders] Order API unreachable — using client SDK:', error);
    return CLIENT_ORDER_WRITE;
  }

  if (response.ok) {
    return readApiJson<T>(response);
  }

  const message = await readApiErrorMessage(response, fallbackMessage);
  if (!shouldUseClientOrderWrite(response.status, message)) {
    throw new Error(message);
  }
  console.info('[orders] Order API unavailable — using client SDK:', message);
  return CLIENT_ORDER_WRITE;
}

/** P0-12: Atomic accept — first driver wins. Falls back to client SDK when Admin credentials are missing. */
export async function acceptOrder(
  orderId: string,
  driver: { name: string; phone: string; truckDetails: string; vehicleType?: string }
): Promise<{ orderId: string; status: string; alreadyAssigned?: boolean }> {
  previewOrderBlocked(orderId, 'ACCEPT_REQUIRES_CUSTOMER_ORDER');

  const serverResult = await tryServerOrderMutation<{
    orderId: string;
    status: string;
    alreadyAssigned?: boolean;
  }>(
    `/api/orders/${orderId}/accept`,
    {
      driverName: driver.name,
      driverPhone: driver.phone,
      truckDetails: driver.truckDetails,
    },
    'Failed to accept order'
  );
  if (serverResult !== CLIENT_ORDER_WRITE) {
    return serverResult;
  }

  const { auth } = await import('@/lib/firebase');
  const profile = loadDevBypassProfile();
  const uid = auth.currentUser?.uid || profile?.uid;
  if (!uid) {
    throw new Error('Failed to accept order');
  }
  return assignSharedLocalOrder(orderId, {
    id: uid,
    name: driver.name,
    phone: driver.phone,
    truckDetails: driver.truckDetails,
    vehicleType: driver.vehicleType || profile?.vehicleType,
  });
}

export interface CompleteOrderResult {
  orderId: string;
  status: string;
  alreadyCompleted?: boolean;
  wallet?: {
    balance: number;
    totalEarnings: number;
    platformCommission: number;
    netEarnings: number;
    creditedNet: number;
  };
}

/** Completes the trip and credits wallets/{driverId} on the server. */
export async function completeDriverOrder(
  orderId: string
): Promise<CompleteOrderResult> {
  previewOrderBlocked(orderId, 'COMPLETE_REQUIRES_CUSTOMER_ORDER');

  const serverResult = await tryServerOrderMutation<CompleteOrderResult>(
    `/api/orders/${orderId}/complete`,
    {},
    'Failed to complete order'
  );
  if (serverResult !== CLIENT_ORDER_WRITE) {
    return serverResult;
  }

  await patchSharedLocalOrderStatus(orderId, 'completed');
  return { orderId, status: 'completed' };
}

/** Driver trip status progression. Falls back to client SDK when Admin credentials are missing. */
export async function transitionOrderStatus(
  orderId: string,
  status: 'driver_arrived' | 'in_transit' | 'in_progress'
): Promise<{ status: string }> {
  previewOrderBlocked(orderId, 'STATUS_REQUIRES_CUSTOMER_ORDER');
  const nextStatus = status === 'in_progress' ? 'in_transit' : status;

  const serverResult = await tryServerOrderMutation<{ status: string }>(
    `/api/orders/${orderId}/status`,
    { status: nextStatus },
    'Failed to update status'
  );
  if (serverResult !== CLIENT_ORDER_WRITE) {
    return serverResult;
  }

  await patchSharedLocalOrderStatus(orderId, nextStatus);
  return { status: nextStatus };
}
