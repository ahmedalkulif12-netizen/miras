import axios from 'axios';
import { TAP_API_URL, formatTapAmount, tapErrorMessage } from './tapPayments.ts';

export interface TapDestinationInput {
  displayName: string;
  iban: string;
  accountHolderName?: string;
  bankName?: string;
}

export interface TapDestinationResult {
  id: string;
  status: string;
  raw: Record<string, unknown>;
}

function client(secretKey: string) {
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

/**
 * Register a driver or company IBAN as a Tap destination.
 * https://developers.tap.company/reference/create-a-destination
 */
export async function createTapDestination(
  secretKey: string,
  input: TapDestinationInput
): Promise<TapDestinationResult> {
  const displayName = String(input.displayName || '').trim().slice(0, 100);
  const iban = String(input.iban || '').replace(/\s+/g, '').toUpperCase();
  if (!secretKey) {
    throw Object.assign(new Error('TAP_SECRET_KEY is not configured'), { statusCode: 503 });
  }
  if (!displayName || !iban) {
    throw Object.assign(new Error('Destination name and IBAN are required'), { statusCode: 400 });
  }
  const payload = {
    display_name: displayName,
    bank_account: {
      iban,
      ...(input.accountHolderName ? { name: input.accountHolderName.slice(0, 80) } : {}),
      ...(input.bankName ? { bank_name: input.bankName.slice(0, 80) } : {}),
    },
  };
  try {
    const response = await client(secretKey).post('/destinations', payload);
    const data = (response.data || {}) as Record<string, unknown>;
    const id = String(data.id || '');
    if (!id) {
      throw Object.assign(new Error('Tap did not return a destination id'), { statusCode: 502 });
    }
    return { id, status: String(data.status || ''), raw: data };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const statusCode = (error as { response?: { status?: number } }).response?.status || 502;
    throw Object.assign(new Error(tapErrorMessage(error, 'Tap destination create failed')), {
      statusCode,
    });
  }
}

export async function captureTapChargeWithDestinations(
  secretKey: string,
  chargeId: string,
  input: {
    amount: number;
    currency?: string;
    destinationId: string;
    payeeAmount: number;
  }
): Promise<Record<string, unknown>> {
  const currency = input.currency || 'SAR';
  const payload = {
    amount: Number(formatTapAmount(input.amount, currency)),
    currency,
    destinations: {
      destination: [
        {
          id: input.destinationId,
          amount: Number(formatTapAmount(input.payeeAmount, currency)),
          currency,
        },
      ],
    },
  };
  try {
    const response = await client(secretKey).post(
      `/charges/${encodeURIComponent(chargeId)}/capture`,
      payload
    );
    return (response.data || {}) as Record<string, unknown>;
  } catch (error) {
    const statusCode = (error as { response?: { status?: number } }).response?.status || 502;
    throw Object.assign(new Error(tapErrorMessage(error, 'Tap capture with destinations failed')), {
      statusCode,
    });
  }
}

/** Move the payee share after a charge that Tap already captured. */
export async function createTapTransfer(
  secretKey: string,
  input: {
    amount: number;
    currency?: string;
    destinationId: string;
    orderId: string;
    chargeId: string;
  }
): Promise<Record<string, unknown>> {
  const currency = input.currency || 'SAR';
  const payload = {
    amount: Number(formatTapAmount(input.amount, currency)),
    currency,
    destination: { id: input.destinationId },
    description: `JZ Logistics payout ${input.orderId}`.slice(0, 250),
    reference: {
      transaction: input.orderId.slice(0, 64),
      order: input.chargeId.slice(0, 64),
    },
    metadata: {
      orderId: input.orderId.slice(0, 250),
      chargeId: input.chargeId.slice(0, 250),
      split: 'payee_85',
    },
  };
  try {
    const response = await client(secretKey).post('/transfers', payload);
    return (response.data || {}) as Record<string, unknown>;
  } catch (error) {
    const statusCode = (error as { response?: { status?: number } }).response?.status || 502;
    throw Object.assign(new Error(tapErrorMessage(error, 'Tap transfer failed')), { statusCode });
  }
}
