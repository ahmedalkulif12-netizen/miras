import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

export interface AppCheckRequest extends Request {
  appCheckVerified?: boolean;
}

import { getServerConfig } from '../config/env.ts';

/**
 * Installed Capacitor shells call the API through URLSession / HttpURLConnection.
 * Those requests do not send a browser `Sec-Fetch-Site` or an https Origin.
 * iOS cannot mint an App Attest token (the store profile has no App Attest
 * entitlement), so TestFlight sends no X-Firebase-AppCheck header.
 * Chrome on https://hamula-cfc6c.web.app sends Sec-Fetch-Site and still requires a token.
 */
export function isNativeShellRequest(req: Request): boolean {
  const origin = String(req.headers.origin || '').trim();
  if (/^(capacitor|ionic|file):/i.test(origin)) return true;
  const ua = String(req.headers['user-agent'] || '');
  if (/CFNetwork|okhttp|Dalvik/i.test(ua)) return true;
  const secFetch = String(req.headers['sec-fetch-site'] || '').trim();
  if (secFetch) return false;
  if (/^https?:/i.test(origin)) return false;
  return origin.length === 0;
}

/**
 * Verifies Firebase App Check token on Express APIs (P0-13).
 * Enforcement is opt-in via APP_CHECK_ENFORCE=true so dev/staging stays usable
 * until Console debug tokens and providers are configured.
 * Routes still require a Firebase ID token via verifyFirebaseToken.
 */
export function verifyAppCheck() {
  const enforce = getServerConfig().appCheckEnforce;

  return async (req: AppCheckRequest, res: Response, next: NextFunction) => {
    const token = req.header('X-Firebase-AppCheck');
    const nativeShell = isNativeShellRequest(req);

    if (!token) {
      if (enforce && !nativeShell) {
        return res.status(401).json({ error: 'Unauthorized: missing App Check token' });
      }
      if (nativeShell) {
        console.warn('[App Check] Native shell request has no token — Firebase auth still required.');
      }
      return next();
    }

    try {
      await admin.appCheck().verifyToken(token);
      req.appCheckVerified = true;
      next();
    } catch (error) {
      console.error('App Check verification failed:', error);
      if (enforce && !nativeShell) {
        return res.status(401).json({ error: 'Unauthorized: invalid App Check token' });
      }
      if (nativeShell) {
        console.warn('[App Check] Native shell token rejected — continuing with Firebase auth.');
      }
      next();
    }
  };
}
