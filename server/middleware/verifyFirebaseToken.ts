import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { isFirebaseAdminCredentialError } from '../lib/firebaseAdmin.ts';

export interface AuthenticatedRequest extends Request {
  firebaseUid?: string;
  firebaseToken?: admin.auth.DecodedIdToken;
}

const DEV_BYPASS_BEARER = 'dev-bypass-token';
const DEV_BYPASS_UIDS = new Set([
  'dev-bypass-b2c-client',
  'dev-bypass-b2c-driver',
  'dev-bypass-b2b-corporate',
  'dev-bypass-b2b-operator',
  'dev-bypass-admin',
]);

function decodeJwtUid(token: string): string {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return '';
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { user_id?: string; sub?: string; uid?: string };
    return String(payload.user_id || payload.sub || payload.uid || '');
  } catch {
    return '';
  }
}

function isLocalDevBypassAllowed(req: Request): boolean {
  const deploy = (
    process.env.MIRAS_DEPLOY_ENV ||
    process.env.HAMOULA_DEPLOY_ENV ||
    ''
  )
    .trim()
    .toLowerCase();
  if (deploy === 'production' || deploy === 'staging') return false;
  if (process.env.NODE_ENV === 'production') return false;
  const host = String(req.headers.host || '');
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

export function verifyFirebaseToken(required = true) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (required) return res.status(401).json({ error: 'Unauthorized: missing Bearer token' });
      return next();
    }

    const token = header.slice('Bearer '.length).trim();
    if (token === DEV_BYPASS_BEARER && isLocalDevBypassAllowed(req)) {
      const uid = String(req.headers['x-dev-bypass-uid'] || '');
      if (!DEV_BYPASS_UIDS.has(uid)) {
        return res.status(401).json({ error: 'Unauthorized: invalid dev bypass uid' });
      }
      req.firebaseUid = uid;
      return next();
    }

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.firebaseUid = decoded.uid;
      req.firebaseToken = decoded;
      next();
    } catch (error) {
      if (isFirebaseAdminCredentialError(error) && isLocalDevBypassAllowed(req)) {
        const uid = decodeJwtUid(token);
        if (uid) {
          console.warn(
            '[auth] Admin credentials missing — accepted ID token uid on localhost only'
          );
          req.firebaseUid = uid;
          return next();
        }
      }
      console.error('Firebase token verification failed:', error);
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
  };
}
