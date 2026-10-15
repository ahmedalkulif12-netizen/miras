import type { Request, Response, NextFunction } from 'express';
import { verifyTapChargeHash } from '../lib/tapPayments.ts';

export interface TapWebhookRequest extends Request {
  rawBody?: Buffer;
}

/** Capture raw body before JSON parser. */
export function captureRawBody(req: TapWebhookRequest, _res: Response, buf: Buffer) {
  if (buf?.length) {
    req.rawBody = buf;
  }
}

/**
 * Tap signs the charge with hashstring (HMAC-SHA256 using TAP_SECRET_KEY).
 * Reject the webhook when the hash does not match.
 */
export function verifyTapWebhookHash(req: TapWebhookRequest, res: Response, next: NextFunction) {
  const secret = process.env.TAP_SECRET_KEY?.trim() || '';
  if (!secret) {
    console.error('TAP_SECRET_KEY is not configured');
    return res.status(503).json({ error: 'Webhook verification not configured' });
  }

  const charge = (req.body?.data ?? req.body) as Record<string, unknown> | undefined;
  if (!charge || typeof charge !== 'object' || !charge.id) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  if (!verifyTapChargeHash(charge, secret)) {
    console.error('[payments] Tap webhook hash mismatch for', charge.id);
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}
