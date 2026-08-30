import { APP_ROLES, isRegistrableRole, type RegistrableRole } from '@/domain/user-schema';
import type { AuthEntryMode } from '@/lib/authRouting';

const ONBOARDING_KEY = 'miras_pending_onboarding';
const LOGIN_INTENT_KEY = 'miras_login_intent';

/** OTP-verified Firebase user who still needs a Firestore profile. */
export interface PendingOnboarding {
  uid: string;
  phone: string;
  intendedRole: RegistrableRole;
}

interface LoginIntent {
  role: RegistrableRole;
  phone: string;
  mode?: AuthEntryMode;
}

function readJson<T>(key: string): T | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function saveLoginIntent(
  role: RegistrableRole,
  phone: string,
  mode?: AuthEntryMode
): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(
    LOGIN_INTENT_KEY,
    JSON.stringify({ role, phone, ...(mode ? { mode } : {}) } satisfies LoginIntent)
  );
}

export function loadLoginIntent(): LoginIntent | null {
  const parsed = readJson<LoginIntent>(LOGIN_INTENT_KEY);
  if (!parsed?.phone) return null;
  const role = isRegistrableRole(parsed.role) ? parsed.role : APP_ROLES.B2C_CLIENT;
  return {
    role,
    phone: String(parsed.phone),
    ...(parsed.mode === 'login' || parsed.mode === 'register'
      ? { mode: parsed.mode }
      : {}),
  };
}

export function clearLoginIntent(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(LOGIN_INTENT_KEY);
}

export function savePendingOnboarding(value: PendingOnboarding): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(ONBOARDING_KEY, JSON.stringify(value));
}

export function loadPendingOnboarding(): PendingOnboarding | null {
  const parsed = readJson<PendingOnboarding>(ONBOARDING_KEY);
  if (!parsed?.uid || !parsed?.phone) return null;
  const intendedRole = isRegistrableRole(parsed.intendedRole)
    ? parsed.intendedRole
    : APP_ROLES.B2C_CLIENT;
  return {
    uid: String(parsed.uid),
    phone: String(parsed.phone),
    intendedRole,
  };
}

export function clearPendingOnboarding(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(ONBOARDING_KEY);
}

export function clearAllOnboardingState(): void {
  clearPendingOnboarding();
  clearLoginIntent();
}

export function resolveOnboardingIntent(options: {
  uid: string;
  phone: string | null | undefined;
  fallbackRole?: RegistrableRole;
}): PendingOnboarding {
  const stored = loadPendingOnboarding();
  const intent = loadLoginIntent();
  const intendedRole =
    (stored?.uid === options.uid ? stored.intendedRole : null) ||
    intent?.role ||
    options.fallbackRole ||
    APP_ROLES.B2C_CLIENT;

  return {
    uid: options.uid,
    phone: options.phone || stored?.phone || intent?.phone || '',
    intendedRole: isRegistrableRole(intendedRole) ? intendedRole : APP_ROLES.B2C_CLIENT,
  };
}
