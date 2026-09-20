import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { isFirebaseAdminCredentialError } from '../lib/firebaseAdmin.ts';
import {
  ADMIN_OVERVIEW_CLOCK_SKEW_SECONDS,
  ID_TOKEN_VERIFY_ATTEMPTS,
  ID_TOKEN_VERIFY_RETRY_MS,
  decodeIdTokenPayload,
  isExpiredIdTokenError,
  isTransientFirebaseAuthError,
  isWithinClockSkew,
  sleepMs,
  type LooseIdTokenClaims,
} from '../lib/idTokenVerify.ts';

export interface AuthenticatedRequest extends Request {
  firebaseUid?: string;
  firebaseToken?: admin.auth.DecodedIdToken;
  firebaseTokenRelaxed?: boolean;
}

export interface VerifyFirebaseTokenOptions {
  required?: boolean;
  /** Accept a recently expired token so overview/read routes survive refresh races. */
  clockSkewSeconds?: number;
  verifyAttempts?: number;
}

const DEV_BYPASS_BEARER = 'dev-bypass-token';
const DEV_BYPASS_UIDS = new Set([
  'dev-bypass-b2c-client',
  'dev-bypass-b2c-driver',
  'dev-bypass-b2b-corporate',
  'dev-bypass-b2b-operator',
  'dev-bypass-admin',
]);

function claimsToDecodedToken(claims: LooseIdTokenClaims): admin.auth.DecodedIdToken {
  return {
    uid: claims.uid,
    sub: claims.sub || claims.uid,
    user_id: claims.user_id || claims.uid,
    phone_number: claims.phone_number,
    admin: claims.admin === true,
    superuser: claims.superuser === true,
    role: typeof claims.role === 'string' ? claims.role : undefined,
    exp: claims.exp || 0,
    iat: claims.iat || 0,
    auth_time: claims.auth_time || claims.iat || 0,
    aud: claims.aud || '',
    iss: claims.iss || '',
    firebase: claims.firebase || { identities: {}, sign_in_provider: 'phone' },
  } as admin.auth.DecodedIdToken;
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

function retryableAuthJson(
  res: Response,
  status: number,
  error: string,
  code: string
) {
  return res.status(status).json({ error, code, retryable: true });
}

async function verifyIdTokenWithRetries(
  token: string,
  attempts: number
): Promise<admin.auth.DecodedIdToken> {
  let lastError: unknown;
  const total = Math.max(1, attempts);
  for (let i = 0; i < total; i += 1) {
    try {
      return await admin.auth().verifyIdToken(token, false);
    } catch (error) {
      lastError = error;
      const retry =
        i < total - 1 &&
        (isTransientFirebaseAuthError(error) || isFirebaseAdminCredentialError(error));
      if (!retry) throw error;
      const delay = ID_TOKEN_VERIFY_RETRY_MS[Math.min(i, ID_TOKEN_VERIFY_RETRY_MS.length - 1)];
      console.warn(
        `[auth] ID token verify attempt ${i + 1}/${total} failed — retrying in ${delay}ms:`,
        error instanceof Error ? error.message : error
      );
      await sleepMs(delay);
    }
  }
  throw lastError;
}

export function verifyFirebaseToken(
  requiredOrOptions: boolean | VerifyFirebaseTokenOptions = true
) {
  const options: VerifyFirebaseTokenOptions =
    typeof requiredOrOptions === 'boolean'
      ? { required: requiredOrOptions }
      : requiredOrOptions;
  const required = options.required !== false;
  const clockSkewSeconds = Number(options.clockSkewSeconds || 0);
  const verifyAttempts = Number(options.verifyAttempts || ID_TOKEN_VERIFY_ATTEMPTS);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (required) {
        return retryableAuthJson(
          res,
          401,
          'Unauthorized: missing Bearer token',
          'MISSING_TOKEN'
        );
      }
      return next();
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      if (required) {
        return retryableAuthJson(res, 401, 'Unauthorized: missing Bearer token', 'MISSING_TOKEN');
      }
      return next();
    }

    if (token === DEV_BYPASS_BEARER && isLocalDevBypassAllowed(req)) {
      const uid = String(req.headers['x-dev-bypass-uid'] || '');
      if (!DEV_BYPASS_UIDS.has(uid)) {
        return res.status(401).json({ error: 'Unauthorized: invalid dev bypass uid' });
      }
      req.firebaseUid = uid;
      return next();
    }

    try {
      const decoded = await verifyIdTokenWithRetries(token, verifyAttempts);
      req.firebaseUid = decoded.uid;
      req.firebaseToken = decoded;
      req.firebaseTokenRelaxed = false;
      return next();
    } catch (error) {
      const claims = decodeIdTokenPayload(token);

      if (isFirebaseAdminCredentialError(error) && isLocalDevBypassAllowed(req) && claims?.uid) {
        console.warn(
          '[auth] Admin credentials missing — accepted ID token uid on localhost only'
        );
        req.firebaseUid = claims.uid;
        req.firebaseToken = claimsToDecodedToken(claims);
        req.firebaseTokenRelaxed = true;
        return next();
      }

      if (
        clockSkewSeconds > 0 &&
        claims &&
        (isExpiredIdTokenError(error) || isWithinClockSkew(claims, clockSkewSeconds)) &&
        isWithinClockSkew(claims, clockSkewSeconds)
      ) {
        console.warn(
          `[auth] Accepted recently expired ID token for ${req.path} (clock skew ≤ ${clockSkewSeconds}s)`
        );
        req.firebaseUid = claims.uid;
        req.firebaseToken = claimsToDecodedToken(claims);
        req.firebaseTokenRelaxed = true;
        return next();
      }

      if (isTransientFirebaseAuthError(error) || isFirebaseAdminCredentialError(error)) {
        console.warn('[auth] Firebase Admin not ready — asking client to retry:', error);
        return retryableAuthJson(
          res,
          503,
          'Authentication service is warming up — retry shortly',
          'AUTH_NOT_READY'
        );
      }

      if (isExpiredIdTokenError(error)) {
        return retryableAuthJson(res, 401, 'Unauthorized: token expired', 'TOKEN_EXPIRED');
      }

      console.error('Firebase token verification failed:', error);
      return retryableAuthJson(res, 401, 'Unauthorized: invalid token', 'INVALID_TOKEN');
    }
  };
}

export const adminOverviewTokenOptions: VerifyFirebaseTokenOptions = {
  required: true,
  clockSkewSeconds: ADMIN_OVERVIEW_CLOCK_SKEW_SECONDS,
  verifyAttempts: ID_TOKEN_VERIFY_ATTEMPTS,
};
