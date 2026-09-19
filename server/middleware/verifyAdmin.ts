import type { Response, NextFunction } from 'express';
import type admin from 'firebase-admin';
import { isFirebaseAdminCredentialError } from '../lib/firebaseAdmin.ts';
import { isTransientFirebaseAuthError } from '../lib/idTokenVerify.ts';
import { verifyAdminAccess } from '../lib/adminAcl.ts';
import type { AuthenticatedRequest } from './verifyFirebaseToken.ts';

/**
 * P0-14: Server-side admin gate — requires the sole authorized phone
 * +966541330720 (0541330720). No other number can pass, even with claims/ACL.
 * Never trust client profile.role alone.
 */
export function verifyAdmin(db: admin.firestore.Firestore, authSdk?: admin.auth.Auth) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.firebaseUid) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'MISSING_TOKEN',
        retryable: true,
      });
    }

    const token =
      req.firebaseToken ||
      ({
        uid: req.firebaseUid,
        sub: req.firebaseUid,
      } as admin.auth.DecodedIdToken);

    try {
      await verifyAdminAccess(db, token, authSdk);
      next();
    } catch (error: unknown) {
      if (isFirebaseAdminCredentialError(error) || isTransientFirebaseAuthError(error)) {
        console.warn('[verifyAdmin] Auth/Firestore not ready — asking client to retry:', error);
        return res.status(503).json({
          error: 'Admin auth is warming up — retry shortly',
          code: 'AUTH_NOT_READY',
          retryable: true,
        });
      }
      const statusCode = (error as { statusCode?: number })?.statusCode ?? 403;
      const message = (error as Error)?.message || 'Admin access denied';
      return res.status(statusCode).json({
        error: message,
        retryable: statusCode === 401,
      });
    }
  };
}
