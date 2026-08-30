import { auth } from '@/lib/firebase';
import { authFetch } from '@/lib/authApi';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';
import { normalizePhoneE164 } from '@/lib/authRouting';
import type { UserProfile } from '@/lib/userProfile';
import type { RegistrableRole } from '@/domain/user-schema';
import { APP_ROLES } from '@/domain/user-schema';

/**
 * Sole authorized Miras Admin phone (E.164).
 * Must match server AUTHORIZED_ADMIN_PHONES (0541330720 → +966541330720).
 * This number is an unconditional super-admin — no Firestore ACL lookup required.
 */
export const AUTHORIZED_ADMIN_PHONES = new Set(['+966541330720']);

export interface AdminSessionResponse {
  role: 'admin';
  uid: string;
  name: string;
  phone?: string;
}

export interface UserSessionResponse {
  role: RegistrableRole;
  uid: string;
}

export class AdminAccessDeniedError extends Error {
  constructor(message = 'ADMIN_ACCESS_DENIED') {
    super(message);
    this.name = 'AdminAccessDeniedError';
  }
}

export function isAuthorizedAdminPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const e164 = normalizePhoneE164(phone);
  return Boolean(e164 && AUTHORIZED_ADMIN_PHONES.has(e164));
}

/** Build a local admin profile for the allowlisted super-admin phone (no DB read). */
export function buildSuperAdminProfile(
  uid: string,
  phone: string | null | undefined
): UserProfile {
  const e164 = phone ? normalizePhoneE164(phone) : '+966541330720';
  return {
    uid,
    role: APP_ROLES.ADMIN,
    name: 'Miras Admin',
    phone: e164,
  };
}

/**
 * Establish admin session.
 * Allowlisted super-admin phone always succeeds — server call is best-effort
 * (Hosting may not proxy /api when VITE_API_ORIGIN is unset).
 */
export async function establishAdminSession(): Promise<AdminSessionResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new AdminAccessDeniedError('NOT_AUTHENTICATED');
  }

  const authPhone = user.phoneNumber ? normalizePhoneE164(user.phoneNumber) : '';

  // Unconditional super-admin grant — never blocked by missing API / ACL docs.
  if (isAuthorizedAdminPhone(authPhone)) {
    try {
      const res = await authFetch('/api/admin/session', { method: 'POST' });
      if (res.ok) {
        const data = await readApiJson<AdminSessionResponse>(res);
        await user.getIdToken(true).catch(() => undefined);
        return {
          role: 'admin',
          uid: user.uid,
          name: data.name || 'Miras Admin',
          phone: data.phone || authPhone,
        };
      }
      console.warn(
        '[establishAdminSession] API returned',
        res.status,
        '— granting local super-admin session for allowlisted phone'
      );
    } catch (err) {
      console.warn(
        '[establishAdminSession] API unavailable — granting local super-admin session:',
        err
      );
    }

    return {
      role: 'admin',
      uid: user.uid,
      name: 'Miras Admin',
      phone: authPhone,
    };
  }

  // Non-allowlisted phones: server ACL only (must succeed).
  const res = await authFetch('/api/admin/session', { method: 'POST' });
  if (res.status === 403) {
    throw new AdminAccessDeniedError(await readApiErrorMessage(res, 'ADMIN_ACCESS_DENIED'));
  }
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'ADMIN_SESSION_FAILED'));
  }

  const data = await readApiJson<AdminSessionResponse>(res);
  await user.getIdToken(true);
  return data;
}

/**
 * Live server probe for admin route guard.
 * Allowlisted super-admin phone always passes without requiring /api/admin/me.
 */
export async function probeAdminAccess(): Promise<AdminSessionResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new AdminAccessDeniedError('NOT_AUTHENTICATED');
  }

  const authPhone = user.phoneNumber ? normalizePhoneE164(user.phoneNumber) : '';
  if (isAuthorizedAdminPhone(authPhone)) {
    try {
      const res = await authFetch('/api/admin/me');
      if (res.ok) {
        return readApiJson<AdminSessionResponse>(res);
      }
      console.warn('[probeAdminAccess] /api/admin/me', res.status, '— allowlisted phone passes locally');
    } catch (err) {
      console.warn('[probeAdminAccess] API unavailable — allowlisted phone passes locally:', err);
    }
    return {
      role: 'admin',
      uid: user.uid,
      name: 'Miras Admin',
      phone: authPhone,
    };
  }

  const res = await authFetch('/api/admin/me');
  if (res.status === 401 || res.status === 403) {
    throw new AdminAccessDeniedError(await readApiErrorMessage(res, 'ADMIN_ACCESS_DENIED'));
  }
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'ADMIN_PROBE_FAILED'));
  }
  return readApiJson<AdminSessionResponse>(res);
}

/** Registrable-role login — server revokes any stale admin claims. */
export async function establishUserSession(
  intendedRole: RegistrableRole
): Promise<UserSessionResponse> {
  const res = await authFetch('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify({ intendedRole }),
  });

  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, 'USER_SESSION_FAILED'));
  }

  const data = await readApiJson<UserSessionResponse>(res);
  await auth.currentUser?.getIdToken(true);
  return data;
}

/**
 * Resolve admin profile — ONLY phone allowlist, no Firestore `admins/{uid}` read.
 */
export async function resolveAdminProfile(uid: string): Promise<UserProfile | null> {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) return null;

  const authPhone = user.phoneNumber ? normalizePhoneE164(user.phoneNumber) : '';
  if (!isAuthorizedAdminPhone(authPhone)) {
    return null;
  }

  return buildSuperAdminProfile(uid, authPhone);
}

export async function hasAdminClaim(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  if (!isAuthorizedAdminPhone(user.phoneNumber)) return false;
  try {
    const token = await user.getIdTokenResult();
    if (token.claims.admin === true) return true;
  } catch {
    /* ignore */
  }
  // Allowlisted phone is treated as admin even before custom claims propagate.
  return true;
}
