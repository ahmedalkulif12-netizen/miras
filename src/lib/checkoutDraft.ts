/**
 * Pre-payment checkout draft — never written to the `orders` collection.
 * Drivers only see orders after payment finalizes the draft into a broadcasting order.
 */

import { isDevBypassAuthSession } from '@/lib/authApi';
import { allowsSandboxCheckout } from '@/lib/checkoutGating';
import { loadDevBypassProfile } from '@/lib/devAuthBypass';
import { computeTripFare } from '@/domain/pricing-engine';
import { buildTripFinancials, shouldWaiveServiceFee, normalizeTripFinancials } from '@/domain/financials';
import { calculateTotal } from '@/lib/checkoutTotal';
import { defaultPricingForService } from '@/lib/pricingDefaults';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  sanitizeWaterTankerDistanceKm,
} from '@/lib/waterTankerDistance';
import { canonicalizeServiceType } from '@/domain/serviceCategories';
import type { CreateOrderRequest, CreateOrderResponse } from '@/lib/orderContract';
import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { normalizeWaterServiceType } from '@/lib/waterTankerCatalog';
import { ensureSignedInFirebaseUid } from '@/lib/firebaseAuthSession';
import { countCustomerPaidOrders } from '@/lib/customerOrderCount';
import { auth } from '@/lib/firebase';

const DRAFT_KEY_PREFIX = 'miras_checkout_draft_';
const LEGACY_DRAFT_KEY_PREFIX = 'hamula_checkout_draft_';
const ACTIVE_DRAFT_KEY = 'miras_active_checkout_draft_id';
const LEGACY_ACTIVE_DRAFT_KEY = 'hamula_active_checkout_draft_id';
const DEMO_ORDER_PREFIX = 'miras_demo_order_';
const LEGACY_DEMO_ORDER_PREFIX = 'hamula_demo_order_';

function checkoutDraftKey(draftId: string): string {
  return `${DRAFT_KEY_PREFIX}${draftId}`;
}

function legacyCheckoutDraftKey(draftId: string): string {
  return `${LEGACY_DRAFT_KEY_PREFIX}${draftId}`;
}

function readDraftRaw(draftId: string): string | null {
  const key = checkoutDraftKey(draftId);
  const current = sessionStorage.getItem(key);
  if (current !== null) return current;
  const legacyKey = legacyCheckoutDraftKey(draftId);
  const legacy = sessionStorage.getItem(legacyKey);
  if (legacy === null) return null;
  sessionStorage.setItem(key, legacy);
  sessionStorage.removeItem(legacyKey);
  return legacy;
}

function readActiveDraftId(): string | null {
  const current = sessionStorage.getItem(ACTIVE_DRAFT_KEY);
  if (current !== null) return current;
  const legacy = sessionStorage.getItem(LEGACY_ACTIVE_DRAFT_KEY);
  if (legacy === null) return null;
  sessionStorage.setItem(ACTIVE_DRAFT_KEY, legacy);
  sessionStorage.removeItem(LEGACY_ACTIVE_DRAFT_KEY);
  return legacy;
}

export interface CheckoutDraft extends CreateOrderRequest, CreateOrderResponse {
  draftId: string;
  createdAt: string;
  /** Explicit unpaid marker — never treat as a live order. */
  paymentPending: true;
}

export function checkoutDraftStorageKey(draftId: string): string {
  return checkoutDraftKey(draftId);
}

export function saveCheckoutDraft(draft: CheckoutDraft): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (
        key &&
        (key.startsWith(DRAFT_KEY_PREFIX) || key.startsWith(LEGACY_DRAFT_KEY_PREFIX)) &&
        key !== checkoutDraftStorageKey(draft.draftId)
      ) {
        sessionStorage.removeItem(key);
      }
    }
    sessionStorage.setItem(checkoutDraftStorageKey(draft.draftId), JSON.stringify(draft));
    sessionStorage.setItem(ACTIVE_DRAFT_KEY, draft.draftId);
  } catch {
    /* ignore quota */
  }
}

export function loadCheckoutDraft(draftId: string): CheckoutDraft | null {
  try {
    const raw = readDraftRaw(draftId);
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutDraft;
  } catch {
    return null;
  }
}

export function getActiveCheckoutDraftId(): string | null {
  try {
    return readActiveDraftId();
  } catch {
    return null;
  }
}

/** Restore unpaid draft / demo payload after payment redirect. */
export function loadDemoOrderFromSession(
  orderId: string
): (CreateOrderRequest & CreateOrderResponse) | null {
  if (!orderId.startsWith('demo-') && !orderId.startsWith('draft-')) return null;
  try {
    const keys = [
      `${DEMO_ORDER_PREFIX}${orderId}`,
      `${LEGACY_DEMO_ORDER_PREFIX}${orderId}`,
      checkoutDraftKey(orderId),
      legacyCheckoutDraftKey(orderId),
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

export function clearCheckoutDraft(draftId?: string): void {
  try {
    const id = draftId || readActiveDraftId();
    if (id) {
      sessionStorage.removeItem(checkoutDraftKey(id));
      sessionStorage.removeItem(legacyCheckoutDraftKey(id));
    }
    sessionStorage.removeItem(ACTIVE_DRAFT_KEY);
    sessionStorage.removeItem(LEGACY_ACTIVE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Build a local unpaid checkout draft (no Firestore `orders` write).
 */
export async function prepareCheckoutDraft(
  payload: CreateOrderRequest
): Promise<CheckoutDraft> {
  try {
    await ensureSignedInFirebaseUid(8000);
  } catch (error) {
    console.warn('[checkout] No live Firebase Auth session before draft:', error);
    throw new Error('NOT_AUTHENTICATED');
  }

  const serviceType = canonicalizeServiceType(payload.serviceType) || payload.serviceType;
  const draftId = `draft-${Date.now()}`;

  const option =
    typeof payload.serviceDetails?.capacity === 'string'
      ? payload.serviceDetails.capacity
      : typeof payload.serviceDetails?.type === 'string'
        ? payload.serviceDetails.type
        : serviceType === 'water_tanker'
          ? undefined
          : payload.truckType;

  const capacity =
    typeof payload.serviceDetails?.capacity === 'string'
      ? payload.serviceDetails.capacity
      : undefined;

  const waterType =
    serviceType === 'water_tanker'
      ? normalizeWaterServiceType(
          typeof payload.serviceDetails?.waterType === 'string'
            ? payload.serviceDetails.waterType
            : undefined
        )
      : undefined;

  const distanceKm =
    serviceType === 'water_tanker'
      ? sanitizeWaterTankerDistanceKm(payload.distanceKm, WATER_TANKER_MOCK_DISTANCE_KM)
      : Math.round((Number(payload.distanceKm) || 0) * 10) / 10;

  // Prefer server quote when authenticated. Local fare is DEV/bypass only.
  if (!isDevBypassAuthSession()) {
    try {
      const response = await authFetch('/api/checkout-draft', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          serviceType,
          distanceKm,
          deliveryOnly: serviceType === 'water_tanker' || payload.deliveryOnly === true,
          locationMode:
            serviceType === 'water_tanker' || payload.deliveryOnly
              ? 'delivery_only'
              : 'pickup_destination',
        }),
      });
      if (response.ok) {
        const serverDraft = await readApiJson<CheckoutDraft>(response);
        const deliveryOnly =
          serviceType === 'water_tanker' || payload.deliveryOnly === true;
        const draft: CheckoutDraft = {
          ...payload,
          ...serverDraft,
          serviceType,
          distanceKm: serverDraft.distanceKm ?? distanceKm,
          draftId: serverDraft.draftId || draftId,
          paymentPending: true,
          createdAt: serverDraft.createdAt || new Date().toISOString(),
          deliveryOnly,
          locationMode: deliveryOnly ? 'delivery_only' : 'pickup_destination',
          financials: normalizeTripFinancials(serverDraft.financials || {}),
          vehicleFieldNotes:
            payload.vehicleFieldNotes || serverDraft.vehicleFieldNotes,
          serviceDetails: {
            ...(payload.serviceDetails || {}),
            ...(serverDraft.serviceDetails || {}),
            ...(payload.vehicleFieldNotes
              ? { vehicleFieldNotes: payload.vehicleFieldNotes }
              : {}),
          },
        };
        saveCheckoutDraft(draft);
        try {
          sessionStorage.setItem(
            `${DEMO_ORDER_PREFIX}${draft.draftId}`,
            JSON.stringify(draft)
          );
          sessionStorage.removeItem(`${LEGACY_DEMO_ORDER_PREFIX}${draft.draftId}`);
        } catch {
          /* ignore */
        }
        return draft;
      }
      const serverError = await readApiErrorMessage(response, 'checkout-draft failed');
      console.warn('[checkout] Server draft failed:', serverError);
      if (!allowsSandboxCheckout()) {
        throw new Error(serverError || 'Checkout is unavailable. Please try again.');
      }
    } catch (err) {
      if (!allowsSandboxCheckout()) {
        throw err instanceof Error
          ? err
          : new Error('Checkout is unavailable. Please try again.');
      }
      console.warn('[checkout] Server draft unavailable, using local quote:', err);
    }
  }

  const profile = loadDevBypassProfile();
  const pricing = defaultPricingForService(serviceType);
  const fare = computeTripFare(pricing, {
    distance: distanceKm,
    serviceType,
    option: option || undefined,
    truckType: payload.truckType || 'normal',
    truckCount: payload.truckCount ?? 1,
    capacity,
    waterType,
  });
  const tripSubtotal = Math.round((fare.base + fare.extraKmCost) * 100) / 100;
  const truckCount = payload.truckCount ?? 1;
  const tripFare =
    fare.surgeApplied || truckCount > 1 ? fare.tripFare : tripSubtotal;
  const paidCount = auth.currentUser?.uid
    ? await countCustomerPaidOrders(auth.currentUser.uid)
    : 0;
  const financials = normalizeTripFinancials(
    buildTripFinancials(tripFare, {
      waiveServiceFee: shouldWaiveServiceFee(paidCount),
    })
  );
  const checkout = calculateTotal({
    basePrice: fare.base,
    extraDistanceFee: fare.extraKmCost,
    serviceFee: financials.serviceFee,
  });
  const snapshot = normalizeTripFinancials({
    financials: {
      ...financials,
      tripFare: checkout.basePrice + checkout.extraDistanceFee,
      serviceFee: checkout.serviceFee,
      customerTotal: checkout.total,
    },
  });

  const draft: CheckoutDraft = {
    ...payload,
    serviceType,
    distanceKm,
    draftId,
    orderId: draftId,
    paymentPending: true,
    createdAt: new Date().toISOString(),
    deliveryOnly: serviceType === 'water_tanker' || payload.deliveryOnly === true,
    locationMode:
      serviceType === 'water_tanker' || payload.deliveryOnly
        ? 'delivery_only'
        : payload.locationMode || 'pickup_destination',
    financials: snapshot,
    quote: {
      draft: true,
      uid: profile?.uid,
      serviceType,
      distanceKm,
      capacity,
      waterType,
      tier: fare.tier,
      option: fare.tier,
      matchedDriverId: payload.matchedDriverId,
      includedKm: fare.includedKm,
      extraDistanceKm: fare.extraKm,
    },
  };

  saveCheckoutDraft(draft);
  // Compatible restore key for local promote after payment.
  try {
    sessionStorage.setItem(`${DEMO_ORDER_PREFIX}${draftId}`, JSON.stringify(draft));
    sessionStorage.removeItem(`${LEGACY_DEMO_ORDER_PREFIX}${draftId}`);
  } catch {
    /* ignore */
  }

  console.info('[checkout] Draft prepared (not in Firestore orders)', draftId, {
    serviceType,
    distanceKm,
    customerTotal: draft.financials.customerTotal,
  });

  return draft;
}
