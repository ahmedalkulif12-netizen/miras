/**
 * Static App Store review login — no SMS.
 * Only +966500000000 + OTP 123456. Real numbers still use Firebase Phone Auth.
 */
import { APP_ROLES, type AppRole } from '@/domain/user-schema';
import type { UserProfile } from '@/lib/userProfile';
import { toFirebasePhoneE164 } from '@/lib/phoneUtils';

export const APP_REVIEW_PHONE_E164 = '+966500000000';
export const APP_REVIEW_PHONE_LOCAL = '0500000000';
export const APP_REVIEW_OTP = '123456';

const SESSION_KEY = 'miras_app_review_auth';
const PENDING_ROLE_KEY = 'miras_app_review_pending_role';

export function matchAppReviewTestPhone(input: string): boolean {
  try {
    return toFirebasePhoneE164(input) === APP_REVIEW_PHONE_E164;
  } catch {
    return false;
  }
}

export function isValidAppReviewOtp(code: string): boolean {
  return code.replace(/\D/g, '') === APP_REVIEW_OTP;
}

function isKnownRole(value: string | null | undefined): value is AppRole {
  return Boolean(value && Object.values(APP_ROLES).includes(value as AppRole));
}

export function savePendingAppReviewRole(role: AppRole): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(PENDING_ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}

export function peekPendingAppReviewRole(): AppRole | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PENDING_ROLE_KEY);
    return isKnownRole(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function consumePendingAppReviewRole(): AppRole | null {
  const role = peekPendingAppReviewRole();
  if (typeof sessionStorage === 'undefined') return role;
  try {
    sessionStorage.removeItem(PENDING_ROLE_KEY);
  } catch {
    /* ignore */
  }
  return role;
}

export function saveAppReviewSession(profile: UserProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

export function loadAppReviewSession(): UserProfile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (!parsed?.uid || !isKnownRole(parsed.role)) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function clearAppReviewSession(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(PENDING_ROLE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function resolveAppReviewGuestRole(): AppRole | null {
  return peekPendingAppReviewRole() || loadAppReviewSession()?.role || null;
}
