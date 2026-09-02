import crypto from 'crypto';
import type { AdminContext } from './adminContext.ts';

export interface MoyasarWebhookPayload {
  id: string;
  status: 'authorized' | 'paid' | 'failed';
  amount: number;
  currency: string;
}

/** Build signed Moyasar webhook body — exercises real HMAC middleware + server handler. */
export function buildSignedMoyasarWebhook(
  payload: MoyasarWebhookPayload
): { body: string; signature: string; eventId: string } {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error('MOYASAR_WEBHOOK_SECRET is required to simulate payment webhooks in E2E.');
  }

  const envelope = {
    type: 'payment_paid',
    data: payload,
  };
  const body = JSON.stringify(envelope);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const eventId = `${payload.id}_${payload.status}`;

  return { body, signature, eventId };
}

export async function postMoyasarWebhook(
  ctx: AdminContext,
  baseUrl: string,
  payload: MoyasarWebhookPayload
): Promise<{ status: number; eventId: string }> {
  const { body, signature, eventId } = buildSignedMoyasarWebhook(payload);

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/webhooks/moyasar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-moyasar-signature': signature,
    },
    body,
  });

  ctx.artifacts.webhookEventIds.push(eventId);
  return { status: res.status, eventId };
}
