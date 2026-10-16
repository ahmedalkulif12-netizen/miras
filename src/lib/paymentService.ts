import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { getPaymentCallbackUrl } from '@/lib/appOrigin';
import { allowsDemoCheckout, allowsSandboxCheckout } from '@/lib/checkoutGating';

/** Customer-selected checkout method (Tap hosted page or in-app wallet). */
export type CheckoutPaymentMethod = 'mada' | 'creditcard' | 'applepay' | 'wallet';

export interface PaymentIntent {
  paymentId: string;
  tapChargeId: string;
  paymentUrl: string;
  status?: string;
  /** Real order id is null until payment succeeds. */
  orderId: string | null;
  draftId: string;
  amount: number;
  paymentMethod?: CheckoutPaymentMethod;
  /** Local-dev in-app checkout only — production always opens Tap. */
  sandbox?: boolean;
  testMode?: boolean;
}

function sandboxIntent(
  draftId: string,
  paymentMethod: CheckoutPaymentMethod
): PaymentIntent {
  const method = encodeURIComponent(paymentMethod);
  return {
    paymentId: `demo-pay-${Date.now()}`,
    tapChargeId: `demo-tap-${Date.now()}`,
    paymentUrl: `/payment-checkout?draftId=${encodeURIComponent(draftId)}&method=${method}`,
    orderId: null,
    draftId,
    amount: 0,
    paymentMethod,
    sandbox: true,
    testMode: true,
  };
}

/**
 * Creates a Tap charge from a checkout draft (no `orders` document yet).
 * Production and store builds never fall back to a fake in-app checkout.
 */
export const createPaymentIntent = async (
  draftId: string,
  paymentMethod: CheckoutPaymentMethod = 'mada',
  tapToken?: string
): Promise<PaymentIntent> => {
  if (allowsDemoCheckout()) {
    console.info('[payments] Local checkout screen for draft', draftId);
    return sandboxIntent(draftId, paymentMethod);
  }

  const callbackUrl = getPaymentCallbackUrl(draftId);

  try {
    const response = await authFetch('/api/create-payment-intent', {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        callbackUrl,
        paymentMethod,
        ...(tapToken ? { tapToken } : {}),
      }),
    });

    if (response.ok) {
      const intent = await readApiJson<PaymentIntent>(response);
      return { ...intent, sandbox: false };
    }

    const message = await readApiErrorMessage(response, 'Payment initialization failed');
    if (!allowsSandboxCheckout()) {
      throw new Error(message);
    }
    console.warn('[payments] Tap init failed — using local demo checkout:', message);
    return sandboxIntent(draftId, paymentMethod);
  } catch (error) {
    if (!allowsSandboxCheckout()) {
      throw error;
    }
    console.warn('[payments] Tap unreachable — using local demo checkout:', error);
    return sandboxIntent(draftId, paymentMethod);
  }
};

export const capturePayment = async (paymentId: string, orderId: string, driverId: string) => {
  if (
    (allowsDemoCheckout() || allowsSandboxCheckout()) &&
    (orderId.startsWith('demo-') || orderId.startsWith('draft-'))
  ) {
    return { ok: true, demo: true };
  }

  const response = await authFetch('/api/capture-payment', {
    method: 'POST',
    body: JSON.stringify({ paymentId, orderId, driverId }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Payment capture failed'));
  }

  return readApiJson<Record<string, unknown>>(response);
};
