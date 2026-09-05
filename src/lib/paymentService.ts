import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { getMoyasarCallbackUrl } from '@/lib/appOrigin';
import { allowsDemoCheckout, allowsSandboxCheckout } from '@/lib/checkoutGating';

/** Customer-selected checkout method (Moyasar hosted form or in-app wallet). */
export type CheckoutPaymentMethod = 'mada' | 'creditcard' | 'applepay' | 'wallet';

export interface PaymentIntent {
  paymentId: string;
  moyasarId: string;
  paymentUrl: string;
  /** Real order id is null until payment succeeds. */
  orderId: string | null;
  draftId: string;
  amount: number;
  paymentMethod?: CheckoutPaymentMethod;
  /** In-app review/sandbox checkout — stay in the SPA, do not open Moyasar. */
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
    moyasarId: `demo-moyasar-${Date.now()}`,
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
 * Creates Moyasar payment from a checkout draft (no `orders` document yet).
 * Local DEV and TestFlight/staging native builds may use an in-app sandbox
 * checkout when Moyasar is unavailable so App Review can complete the step.
 */
export const createPaymentIntent = async (
  draftId: string,
  paymentMethod: CheckoutPaymentMethod = 'mada'
): Promise<PaymentIntent> => {
  if (allowsDemoCheckout()) {
    console.info('[payments] Local checkout screen for draft', draftId);
    return sandboxIntent(draftId, paymentMethod);
  }

  const callbackUrl = getMoyasarCallbackUrl(draftId);

  try {
    const response = await authFetch('/api/create-payment-intent', {
      method: 'POST',
      body: JSON.stringify({ draftId, callbackUrl, paymentMethod }),
    });

    if (response.ok) {
      const intent = await readApiJson<PaymentIntent>(response);
      return { ...intent, sandbox: false };
    }

    const message = await readApiErrorMessage(response, 'Payment initialization failed');
    if (!allowsSandboxCheckout()) {
      throw new Error(message);
    }
    console.warn('[payments] Moyasar init failed — using App Review sandbox checkout:', message);
    return sandboxIntent(draftId, paymentMethod);
  } catch (error) {
    if (!allowsSandboxCheckout()) {
      throw error;
    }
    console.warn('[payments] Moyasar unreachable — using App Review sandbox checkout:', error);
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
