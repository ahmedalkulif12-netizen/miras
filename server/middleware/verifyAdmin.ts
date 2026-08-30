import type { Response, NextFunction } from 'express';
import type admin from 'firebase-admin';
import { verifyAdminAccess } from '../lib/adminAcl.ts';
import type { AuthenticatedRequest } from './verifyFirebaseToken.ts';

/**
 * P0-14: Server-side admin gate — requires the sole authorized phone
 * +966541330720 (0541330720). No other number can pass, even with claims/ACL.
 * Never trust client profile.role alone.
 */
export function verifyAdmin(db: admin.firestore.Firestore, authSdk?: admin.auth.Auth) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.firebaseUid || !req.firebaseToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      await verifyAdminAccess(db, req.firebaseToken, authSdk);
      next();
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number })?.statusCode ?? 403;
      const message = (error as Error)?.message || 'Admin access denied';
      return res.status(statusCode).json({ error: message });
    }
  };
}
