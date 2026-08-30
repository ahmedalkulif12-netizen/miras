import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { promoteSharedOrderToBroadcasting } from '@/lib/localOrderBridge';
import {
  clearCheckoutDraft,
  loadCheckoutDraft,
  type CheckoutDraft,
} from '@/lib/checkoutDraft';
import { allowsDemoCheckout, isDemoMoyasarId } from '@/lib/checkoutGating';

export interface PaymentReturnStatus {
  success: boolean;
  orderId: string;
  paymentStatus: string;
  orderStatus: string;
  startTracking: boolean;
  testMode?: boolean;
  message?: string;
  /** Local/dev: server could not use Admin SDK — client must write Firestore. */
  clientWriteRequired?: boolean;
}

const FAILED_PAYMENT_STATUSES = new Set(['failed', 'voided', 'cancelled']);

export function isPaymentSuccessStatus(status?: string | null): boolean {
  const value = String(status || '').toLowerCase();
  return value === 'paid' || value === 'authorized' || value === 'captured';
}

/** Local/demo gateway (no Moyasar payment doc) — disabled in production builds. */
function isLocalDemoGateway(params: {
  draftId?: string | null;
  orderId?: string | null;
  moyasarId?: string | null;
}): boolean {
  if (!allowsDemoCheckout()) return false;
  const id = params.draftId || params.orderId || '';
  if (id.startsWith('demo-')) return true;
  if (isDemoMoyasarId(params.moyasarId)) return true;
  return false;
}

function draftPayloadBody(draft: CheckoutDraft) {
  return {
    serviceType: draft.serviceType,
    truckType: draft.truckType,
    tripType: draft.tripType,
    serviceDetails: draft.serviceDetails,
    vehicleFieldNotes: draft.vehicleFieldNotes,
    pickupAddress: draft.pickupAddress,
    dropoffAddress: draft.dropoffAddress,
    pickupLat: draft.pickupLat,
    pickupLng: draft.pickupLng,
    dropoffLat: draft.dropoffLat,
    dropoffLng: draft.dropoffLng,
    distanceKm: draft.distanceKm,
    pickupCity: draft.pickupCity,
    dropoffCity: draft.dropoffCity,
    truckCount: draft.truckCount,
    matchedDriverId: draft.matchedDriverId,
  };
}

function seedPromoteRestoreKey(draftId: string, draft: CheckoutDraft | null): void {
  if (!draft) return;
  try {
    sessionStorage.setItem(
      `miras_demo_order_${draftId}`,
      JSON.stringify({ ...draft, orderId: draftId })
    );
    sessionStorage.removeItem(`hamula_demo_order_${draftId}`);
  } catch {
    /* ignore */
  }
}

/**
 * Publish broadcasting order after local checkout confirm.
 * Prefers Admin SDK (`/api/orders/publish-after-checkout`) so locked Firestore rules
 * still allow drivers to see the offer with canonical serviceType.
 */
async function publishLocalCheckoutOrder(params: {
  draftId: string;
  moyasarId?: string | null;
}): Promise<PaymentReturnStatus> {
  const { draftId } = params;
  const draft = loadCheckoutDraft(draftId);
  seedPromoteRestoreKey(draftId, draft);

  const succeed = (orderId: string, message: string): PaymentReturnStatus => {
    clearCheckoutDraft(draftId);
    return {
      success: true,
      orderId,
      paymentStatus: 'authorized',
      orderStatus: 'broadcasting',
      startTracking: true,
      message,
    };
  };

  const tryClientWrite = async (): Promise<boolean> => {
    try {
      await promoteSharedOrderToBroadcasting(draftId);
      console.info('[payments] Client wrote broadcasting order', draftId);
      return true;
    } catch (error) {
      console.warn('[payments] Client Firestore write failed:', error);
      return false;
    }
  };

  // Write from the browser first so a stale/500 Admin API cannot block checkout.
  const clientWrote = await tryClientWrite();

  try {
    const response = await authFetch('/api/orders/publish-after-checkout', {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        moyasarId: params.moyasarId || `demo-checkout-${Date.now()}`,
        ...(draft
          ? {
              payload: draftPayloadBody(draft),
              financials: draft.financials,
              quote: draft.quote,
            }
          : {}),
      }),
    });

    if (response.ok) {
      const result = await readApiJson<PaymentReturnStatus>(response);
      if (result.success && result.startTracking) {
        if (result.clientWriteRequired && !clientWrote) {
          await tryClientWrite();
        }
        console.info(
          '[payments] Payment OK — order broadcast for drivers',
          result.orderId || draftId,
          result.orderStatus
        );
        return succeed(
          result.orderId || draftId,
          result.message || 'Order published for drivers'
        );
      }
    } else {
      console.warn(
        '[payments] Server publish returned',
        response.status,
        await readApiErrorMessage(response, 'Failed to publish order after payment')
      );
    }
  } catch (error) {
    if (
      !(error instanceof Error && error.message === 'DEV_BYPASS_NO_FIREBASE_SESSION')
    ) {
      console.warn('[payments] Server publish failed:', error);
    }
  }

  if (clientWrote) {
    return succeed(draftId, 'Payment verified — order created for drivers');
  }

  return {
    success: false,
    orderId: draftId,
    paymentStatus: 'authorized',
    orderStatus: 'awaiting_payment',
    startTracking: false,
    message:
      'Payment confirmed but order could not be published for drivers. Sign in and ensure the API server is running.',
  };
}

/**
 * Validates payment return. On success, creates/broadcasts the Firestore order.
 * Never treats an unpaid checkout draft as a live order.
 */
export async function verifyPaymentReturn(params: {
  draftId?: string | null;
  orderId?: string | null;
  moyasarId?: string | null;
  status?: string | null;
}): Promise<PaymentReturnStatus> {
  const status = (params.status || '').toLowerCase();
  const draftId = params.draftId || params.orderId || '';

  if (status && FAILED_PAYMENT_STATUSES.has(status)) {
    return {
      success: false,
      orderId: draftId,
      paymentStatus: 'failed',
      orderStatus: 'awaiting_payment',
      startTracking: false,
      message: 'Payment failed or was cancelled',
    };
  }

  // Local/demo gateway: never call GET /api/payments/return with demo-checkout ids
  // (that path requires a real Moyasar payments doc). Publish via Admin SDK instead.
  if (isLocalDemoGateway(params)) {
    if (!draftId) {
      return {
        success: false,
        orderId: '',
        paymentStatus: 'failed',
        orderStatus: 'awaiting_payment',
        startTracking: false,
        message: 'Missing checkout draft id',
      };
    }
    return publishLocalCheckoutOrder({
      draftId,
      moyasarId: params.moyasarId,
    });
  }

  const query = new URLSearchParams();
  if (params.draftId) query.set('draftId', params.draftId);
  if (params.orderId) query.set('orderId', params.orderId);
  if (params.moyasarId) query.set('moyasarId', params.moyasarId);
  if (params.status) query.set('status', params.status);

  const publishIfPossible = async (): Promise<PaymentReturnStatus | null> => {
    if (!draftId) return null;
    return publishLocalCheckoutOrder({
      draftId,
      moyasarId: params.moyasarId,
    });
  };

  try {
    const response = await authFetch(`/api/payments/return?${query.toString()}`);
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, 'Payment verification failed'));
    }
    const result = await readApiJson<PaymentReturnStatus>(response);
    if (result.success && (result.startTracking || result.orderId)) {
      clearCheckoutDraft(params.draftId || undefined);
      return { ...result, success: true, startTracking: true };
    }

    // Local DEV only: webhook lag / test keys may need a client publish.
    // Production never creates a live order without Moyasar verification.
    if (allowsDemoCheckout() && (isPaymentSuccessStatus(params.status) || !status)) {
      const published = await publishIfPossible();
      if (published?.success) return published;
    }

    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'DEV_BYPASS_NO_FIREBASE_SESSION'
    ) {
      return publishLocalCheckoutOrder({
        draftId,
        moyasarId: params.moyasarId,
      });
    }

    if (allowsDemoCheckout()) {
      console.warn('[payments] Return verify failed, attempting order publish:', error);
      const published = await publishIfPossible();
      if (published?.success) return published;
    }
    throw error;
  }
}
