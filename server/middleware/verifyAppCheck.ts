import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

export interface AppCheckRequest extends Request {
  appCheckVerified?: boolean;
}

import { getServerConfig } from '../config/env.ts';

/**
 * Verifies Firebase App Check token on Express APIs (P0-13).
 * Enforcement is opt-in via APP_CHECK_ENFORCE=true so dev/staging stays usable
 * until Console debug tokens and providers are configured.
 */
export function verifyAppCheck() {
  const enforce = getServerConfig().appCheckEnforce;

  return async (req: AppCheckRequest, res: Response, next: NextFunction) => {
    const token = req.header('X-Firebase-AppCheck');

    if (!token) {
      if (enforce) {
        return res.status(401).json({ error: 'Unauthorized: missing App Check token' });
      }
      return next();
    }

    try {
      await admin.appCheck().verifyToken(token);
      req.appCheckVerified = true;
      next();
    } catch (error) {
      console.error('App Check verification failed:', error);
      if (enforce) {
        return res.status(401).json({ error: 'Unauthorized: invalid App Check token' });
      }
      next();
    }
  };
}
