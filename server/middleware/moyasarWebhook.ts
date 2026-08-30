import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface MoyasarWebhookRequest extends Request {
  rawBody?: Buffer;
}

/** Capture raw body before JSON parser for HMAC verification. */
export function captureRawBody(
  req: MoyasarWebhookRequest,
  _res: Response,
  buf: Buffer
) {
  if (buf?.length) {
    req.rawBody = buf;
  }
}

export function verifyMoyasarWebhookSignature(
  req: MoyasarWebhookRequest,
  res: Response,
  next: NextFunction
) {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  const signature = req.headers['x-moyasar-signature'] as string | undefined;

  if (!secret) {
    console.error('MOYASAR_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'Webhook verification not configured' });
  }

  if (!signature) {
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedHex, 'utf8');

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}
