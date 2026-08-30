import type { UserProfile } from '@/lib/userProfile';
import {
  APP_ROLES,
  getHomePathForRole,
  isRegistrableRole,
  normalizeAppRole,
  type AppRole,
  type RegistrableRole,
} from '@/domain/user-schema';
import { B2B_MODULES_ENABLED, isB2bSurfaceRole } from '@/lib/launchFlags';

/** Customer operational home — booking UI with the 6-service grid. */
export const CUSTOMER_SERVICES_PATH = '/b2c/client';

/** Client order history — post-payment landing. */
export const CLIENT_ORDERS_PATH = '/b2c/client/orders';

export function buildClientOrdersPath(opts?: {
  placed?: string;
  payment?: 'success' | 'failed';
}): string {
  const params = new URLSearchParams();
  if (opts?.placed) params.set('placed', opts.placed);
  if (opts?.payment) params.set('payment', opts.payment);
  const query = params.toString();
  return query ? `${CLIENT_ORDERS_PATH}?${query}` : CLIENT_ORDERS_PATH;
}

/** Normalize phone strings toward E.164 for display / comparison helpers. */
export function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (phone.startsWith('+') && digits.startsWith('966')) {
    return `+${digits}`;
  }
  if (digits.startsWith('966') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('05') && digits.length === 10) {
    return `+966${digits.slice(1)}`;
  }
  if (digits.startsWith('5') && digits.length === 9) {
    return `+966${digits}`;
  }

  return phone.trim();
}

/**
 * Auth routing switcher — maps Firebase-loaded role → dashboard home path.
 *
 *   b2c_client      → /b2c/client
 *   b2c_driver      → /b2c/driver?online=1
 *   b2b_corporate   → /b2b/corporate
 *   b2b_operator    → /b2b/operator
 *   admin           → /admin
 *
 * Legacy `customer` / `driver` values are normalized before mapping.
 *
 * Admin access is NEVER granted by a hard-coded phone — only via `admins/{uid}` ACL.
 */
export function getRoleHomePath(profile: Pick<UserProfile, 'role'>): string {
  const role: AppRole = normalizeAppRole(profile.role) ?? 'b2c_client';
  if (!B2B_MODULES_ENABLED && isB2bSurfaceRole(role)) {
    return '/login';
  }
  return getHomePathForRole(role);
}

/**
 * Safe in-app return path for post-login redirects (`?next=`).
 * Rejects absolute URLs / protocol-relative targets.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('://')) {
    return null;
  }
  // Keep guests off login/admin-login loops after successful auth.
  if (decoded === '/login' || decoded.startsWith('/login?')) return null;
  if (decoded === '/admin/login' || decoded.startsWith('/admin/login?')) return null;
  return decoded;
}

/** True for marketing/login surfaces that signed-in users should not stay on. */
export function isGuestAuthSurface(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/' || path === '/login' || path === '/admin/login';
}

export type AuthEntryMode = 'login' | 'register';

export function parseAuthEntryMode(
  value: string | null | undefined
): AuthEntryMode | null {
  if (value === 'login' || value === 'register') return value;
  return null;
}

function withAuthEntry(options: {
  mode: AuthEntryMode;
  role?: RegistrableRole;
  nextPath?: string;
}): string {
  const params = new URLSearchParams({ mode: options.mode });
  if (options.role) params.set('role', options.role);
  if (options.nextPath) params.set('next', options.nextPath);
  return `/login?${params.toString()}`;
}

function withLoginIntent(role: RegistrableRole, nextPath: string): string {
  return withAuthEntry({ mode: 'login', role, nextPath });
}

/** Landing / header: existing-user login (phone + OTP only). */
export function resolveLoginEntryPath(
  profile: Pick<UserProfile, 'role'> | null | undefined
): string {
  if (!profile) {
    return withAuthEntry({ mode: 'login' });
  }
  return getRoleHomePath(profile);
}

/** Landing / header: new-user registration + onboarding. */
export function resolveRegisterEntryPath(
  profile: Pick<UserProfile, 'role'> | null | undefined
): string {
  if (!profile) {
    return withAuthEntry({ mode: 'register' });
  }
  return getRoleHomePath(profile);
}

/**
 * Landing CTA: "Order a Shipment Now".
 * Guests must authenticate as customers first; signed-in customers skip login
 * and land on the services grid.
 */
export function resolveCustomerOrderPath(
  profile: Pick<UserProfile, 'role'> | null | undefined
): string {
  if (!profile) {
    return withLoginIntent(APP_ROLES.B2C_CLIENT, CUSTOMER_SERVICES_PATH);
  }
  const role = normalizeAppRole(profile.role) ?? profile.role;
  if (role === APP_ROLES.B2C_CLIENT) {
    return CUSTOMER_SERVICES_PATH;
  }
  // Already authenticated under another role — send to that role's ops home.
  return getRoleHomePath(profile);
}

/**
 * Landing CTA: partners & drivers login.
 * Guests authenticate as drivers; signed-in partners go straight to their panel.
 */
export function resolvePartnerEntryPath(
  profile: Pick<UserProfile, 'role'> | null | undefined
): string {
  if (!profile) {
    return withLoginIntent(APP_ROLES.B2C_DRIVER, getHomePathForRole(APP_ROLES.B2C_DRIVER));
  }
  return getRoleHomePath(profile);
}

/** Prefer a safe `next` destination when it matches the signed-in role home prefix. */
export function resolvePostLoginPath(
  profile: Pick<UserProfile, 'role'>,
  nextRaw?: string | null
): string {
  const home = getRoleHomePath(profile);
  const next = sanitizeReturnPath(nextRaw);
  if (!next) return home;

  const homePathOnly = home.split('?')[0];
  const nextPathOnly = next.split('?')[0];
  // Allow deep links under the role home (e.g. /b2c/client/orders).
  if (nextPathOnly === homePathOnly || nextPathOnly.startsWith(`${homePathOnly}/`)) {
    return next;
  }
  return home;
}

/**
 * Post-OTP auth router — Firestore profile presence decides login vs registration.
 *
 * Existing phone/UID in users|customers|drivers|corporates|operators
 *   → skip onboarding, go to that role's dashboard (UI tab is ignored).
 * Brand-new Firebase user (no profile doc)
 *   → registration form for the intended role only.
 */
export type PostOtpAuthDecision =
  | { kind: 'existing'; profile: UserProfile; path: string }
  | { kind: 'onboarding'; intendedRole: RegistrableRole };

export function resolvePostOtpAuth(options: {
  existingProfile: UserProfile | null | undefined;
  intendedRole: RegistrableRole;
  nextRaw?: string | null;
}): PostOtpAuthDecision {
  const existing = options.existingProfile;
  if (existing?.uid) {
    const role = normalizeAppRole(existing.role) ?? existing.role;
    const profile = { ...existing, role };
    return {
      kind: 'existing',
      profile,
      path: resolvePostLoginPath(profile, options.nextRaw),
    };
  }

  const intended: RegistrableRole = isRegistrableRole(options.intendedRole)
    ? options.intendedRole
    : APP_ROLES.B2C_CLIENT;

  return { kind: 'onboarding', intendedRole: intended };
}

/** True when Firestore (or a restored cache) already has a role profile for this UID. */
export function isExistingRegisteredUser(
  profile: UserProfile | null | undefined
): profile is UserProfile {
  if (!profile?.uid) return false;
  return normalizeAppRole(profile.role) !== null;
}

/** Build guest login URL when a protected route blocks an unauthenticated user. */
export function buildLoginRedirectPath(options: {
  requiredRole?: AppRole;
  returnTo?: string;
  mode?: AuthEntryMode;
}): string {
  if (options.requiredRole === APP_ROLES.ADMIN) {
    return '/admin/login';
  }

  const requested = options.requiredRole;
  const role: RegistrableRole =
    requested === APP_ROLES.B2C_CLIENT ||
    requested === APP_ROLES.B2C_DRIVER ||
    (B2B_MODULES_ENABLED &&
      (requested === APP_ROLES.B2B_CORPORATE || requested === APP_ROLES.B2B_OPERATOR))
      ? (requested as RegistrableRole)
      : APP_ROLES.B2C_CLIENT;

  const next =
    sanitizeReturnPath(options.returnTo) ||
    (role === APP_ROLES.B2C_CLIENT
      ? CUSTOMER_SERVICES_PATH
      : getHomePathForRole(role));

  return withAuthEntry({
    mode: options.mode ?? 'login',
    role,
    nextPath: next,
  });
}
