import crypto from 'crypto';
import axios from 'axios';

/** Tap Payments REST API — https://developers.tap.company/reference/create-a-charge */
export const TAP_API_URL = 'https://api.tap.company/v2';

export type CheckoutGatewayMethod = 'mada' | 'creditcard' | 'applepay';

const PAID_STATUSES = new Set(['captured', 'authorized', 'paid']);
const FAILED_STATUSES = new Set([
  'failed',
  'cancelled',
  'canceled',
  'abandoned',
  'declined',
  'void',
  'voided',
  'timedout',
  'restricted',
]);

export function isTapTestSecret(secret: string): boolean {
  return String(secret || '').startsWith('sk_test_');
}

export function isPaidTapStatus(status: unknown): boolean {
  return PAID_STATUSES.has(String(status || '').toLowerCase());
}

export function isFailedTapStatus(status: unknown): boolean {
  return FAILED_STATUSES.has(String(status || '').toLowerCase());
}

/** Hosted-page source for the method the customer picked in checkout. */
export function tapSourceId(method: string): string {
  switch (method) {
    case 'creditcard':
      return 'src_card';
    case 'applepay':
      return 'src_apple_pay';
    case 'mada':
    default:
      return 'src_sa.mada';
  }
}

export function toStringMetadata(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (typeof value === 'boolean') {
      out[key] = value ? 'true' : 'false';
      continue;
    }
    const str = String(value).trim();
    if (!str || str === 'null' || str === 'undefined') continue;
    out[key] = str.slice(0, 250);
  }
  return out;
}

function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  if (code === 'BHD' || code === 'KWD' || code === 'OMR') return 3;
  return 2;
}

/** Tap hash strings use a fixed decimal amount, not a raw float. */
export function formatTapAmount(amount: unknown, currency = 'SAR'): string {
  const decimals = currencyDecimals(currency);
  const value = Number(amount);
  if (!Number.isFinite(value)) return (0).toFixed(decimals);
  return value.toFixed(decimals);
}

export function splitSaudiPhone(raw: string): { country_code: string; number: string } | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('966') && digits.length >= 12) {
    return { country_code: '966', number: digits.slice(3, 12) };
  }
  if (digits.startsWith('05') && digits.length >= 10) {
    return { country_code: '966', number: digits.slice(1, 10) };
  }
  if (digits.startsWith('5') && digits.length >= 9) {
    return { country_code: '966', number: digits.slice(0, 9) };
  }
  return null;
}

/**
 * Tap posts `hashstring` on the charge. It is HMAC-SHA256 of the documented
 * field string, keyed with the secret API key.
 */
export function computeTapHashString(
  charge: Record<string, unknown>,
  secretKey: string
): string {
  const id = String(charge.id || '');
  const currency = String(charge.currency || 'SAR');
  const amount = formatTapAmount(charge.amount, currency);
  const reference = (charge.reference || {}) as Record<string, unknown>;
  const gateway = (charge.gateway || {}) as Record<string, unknown>;
  const gatewayReference = String(reference.gateway || gateway.reference || '');
  const paymentReference = String(reference.payment || '');
  const status = String(charge.status || '');
  const transaction = (charge.transaction || {}) as Record<string, unknown>;
  const created = String(transaction.created || charge.created || '');
  const toBeHashed =
    `x_id${id}` +
    `x_amount${amount}` +
    `x_currency${currency}` +
    `x_gateway_reference${gatewayReference}` +
    `x_payment_reference${paymentReference}` +
    `x_status${status}` +
    `x_created${created}`;
  return crypto.createHmac('sha256', secretKey).update(toBeHashed).digest('hex');
}

export function verifyTapChargeHash(
  charge: Record<string, unknown>,
  secretKey: string
): boolean {
  const posted = String(charge.hashstring || '').trim().toLowerCase();
  if (!posted || !secretKey) return false;
  const expected = computeTapHashString(charge, secretKey).toLowerCase();
  const postedBuf = Buffer.from(posted, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (postedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(postedBuf, expectedBuf);
}

export interface TapChargeRequest {
  amount: number;
  currency?: string;
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  draftId: string;
  userId: string;
  paymentMethod: CheckoutGatewayMethod;
  /** Card SDK token (`tok_...`). When set, the charge uses that card instead of a hosted source. */
  sourceId?: string;
  customer: {
    firstName: string;
    email?: string;
    phone: { country_code: string; number: string };
  };
  metadata?: Record<string, unknown>;
}

export interface TapChargeResult {
  id: string;
  status: string;
  paymentUrl: string;
  raw: Record<string, unknown>;
}

function tapClient(secretKey: string) {
  return axios.create({
    baseURL: TAP_API_URL,
    timeout: 20_000,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
  });
}

function tapErrorMessage(error: unknown, fallback: string): string {
  const err = error as {
    response?: { data?: { errors?: Array<{ description?: string }>; message?: string } };
    message?: string;
  };
  const described = err?.response?.data?.errors?.find((item) => item?.description)?.description;
  return described || err?.response?.data?.message || err?.message || fallback;
}

export async function createTapCharge(
  secretKey: string,
  input: TapChargeRequest
): Promise<TapChargeResult> {
  const currency = input.currency || 'SAR';
  const payload = {
    amount: Number(formatTapAmount(input.amount, currency)),
    currency,
    customer_initiated: true,
    threeDSecure: true,
    save_card: false,
    description: input.description.slice(0, 250),
    statement_descriptor: 'JZ Logistics',
    metadata: toStringMetadata({
      userId: input.userId,
      draftId: input.draftId,
      paymentMethod: input.paymentMethod,
      ...(input.metadata || {}),
    }),
    reference: {
      transaction: input.draftId.slice(0, 64),
      order: input.draftId.slice(0, 64),
    },
    receipt: { email: false, sms: false },
    customer: {
      first_name: input.customer.firstName.slice(0, 40) || 'Customer',
      email: input.customer.email || `customer@miras.app`,
      phone: input.customer.phone,
    },
    source: { id: input.sourceId || tapSourceId(input.paymentMethod) },
    post: { url: input.webhookUrl },
    redirect: { url: input.redirectUrl },
  };

  try {
    const response = await tapClient(secretKey).post('/charges', payload);
    const data = (response.data || {}) as Record<string, unknown>;
    const transaction = (data.transaction || {}) as Record<string, unknown>;
    const id = String(data.id || '');
    const paymentUrl = String(transaction.url || '');
    const status = String(data.status || '');
    if (!id || (!paymentUrl && !isPaidTapStatus(status))) {
      throw Object.assign(new Error('Tap did not return a charge id'), {
        statusCode: 502,
      });
    }
    return {
      id,
      status: String(data.status || ''),
      paymentUrl,
      raw: data,
    };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const statusCode = (error as { response?: { status?: number } }).response?.status || 502;
    throw Object.assign(new Error(tapErrorMessage(error, 'Tap charge create failed')), {
      statusCode,
    });
  }
}

export async function retrieveTapCharge(
  secretKey: string,
  chargeId: string
): Promise<Record<string, unknown> | null> {
  const id = String(chargeId || '').trim();
  if (!id || !secretKey) return null;
  try {
    const response = await tapClient(secretKey).get(`/charges/${encodeURIComponent(id)}`);
    return (response.data || null) as Record<string, unknown> | null;
  } catch (error) {
    console.warn('[payments] Tap charge fetch failed for', id, tapErrorMessage(error, 'fetch failed'));
    return null;
  }
}
