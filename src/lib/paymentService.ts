import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { getMoyasarCallbackUrl } from '@/lib/appOrigin';
import { allowsDemoCheckout } from '@/lib/checkoutGating';

/** Customer-selected checkout method (Moyasar hosted form). */
export type CheckoutPaymentMethod = 'mada' | 'creditcard' | 'applepay';

export interface PaymentIntent {
  paymentId: string;
  moyasarId: string;
  paymentUrl: string;
  /** Real order id is null until payment succeeds. */
  orderId: string | null;
  draftId: string;
  amount: number;
  paymentMethod?: CheckoutPaymentMethod;
}

/**
 * Creates Moyasar payment from a checkout draft (no `orders` document yet).
 * Dev bypass / local drafts skip Moyasar and use a mock callback URL.
 */
export const createPaymentIntent = async (
  draftId: string,
  paymentMethod: CheckoutPaymentMethod = 'mada'
): Promise<PaymentIntent> => {
  // Local Vite DEV only — production/store builds always initialize live Moyasar.
  if (allowsDemoCheckout()) {
    console.info('[payments] Local checkout screen for draft', draftId);
    const method = encodeURIComponent(paymentMethod);
    return {
      paymentId: `demo-pay-${Date.now()}`,
      moyasarId: `demo-moyasar-${Date.now()}`,
      paymentUrl: `${window.location.origin}/payment-checkout?draftId=${encodeURIComponent(draftId)}&method=${method}`,
      orderId: null,
      draftId,
      amount: 0,
      paymentMethod,
    };
  }

  const callbackUrl = getMoyasarCallbackUrl();

  const response = await authFetch('/api/create-payment-intent', {
    method: 'POST',
    body: JSON.stringify({ draftId, callbackUrl, paymentMethod }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Payment initialization failed'));
  }

  return readApiJson<PaymentIntent>(response);
};

export const capturePayment = async (paymentId: string, orderId: string, driverId: string) => {
  if (allowsDemoCheckout() && (orderId.startsWith('demo-') || orderId.startsWith('draft-'))) {
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
