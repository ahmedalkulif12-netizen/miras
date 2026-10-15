import type { AdminContext } from './adminContext.ts';
import { computeTapHashString } from '../../server/lib/tapPayments.ts';

export interface TapWebhookPayload {
  id: string;
  status: 'CAPTURED' | 'AUTHORIZED' | 'FAILED' | 'CANCELLED' | 'authorized' | 'paid' | 'failed';
  amount: number;
  currency: string;
}

/** Signed Tap charge body — exercises hashstring verification on /api/webhooks/tap. */
export function buildSignedTapWebhook(
  payload: TapWebhookPayload
): { body: string; eventId: string } {
  const secret = process.env.TAP_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error('TAP_SECRET_KEY is required to simulate payment webhooks in E2E.');
  }

  const charge: Record<string, unknown> = {
    id: payload.id,
    status: payload.status,
    amount: payload.amount,
    currency: payload.currency,
    reference: { gateway: 'e2e', payment: payload.id },
    transaction: { created: '1700000000000' },
  };
  charge.hashstring = computeTapHashString(charge, secret);
  const body = JSON.stringify(charge);
  return { body, eventId: `${payload.id}_${payload.status}` };
}

export async function postTapWebhook(
  ctx: AdminContext,
  baseUrl: string,
  payload: TapWebhookPayload
): Promise<{ status: number; eventId: string }> {
  const { body, eventId } = buildSignedTapWebhook(payload);
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/webhooks/tap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  ctx.artifacts.webhookEventIds.push(eventId);
  return { status: res.status, eventId };
}
