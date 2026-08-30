/**
 * Opt-in local auth bypass for screenshots and UI testing without SMS OTP.
 *
 * Hard-gated: Vite DEV (or VITE_ENABLE_DEV_AUTH_BYPASS) on loopback / private LAN only.
 * Never enable in staging or production store builds.
 */

import { readStorageWithLegacy } from '@/lib/storageMigration';
import type { User } from 'firebase/auth';
import type { UserProfile } from '@/lib/userProfile';
import { EMPTY_DRIVER_DOCUMENTS } from '@/lib/userProfile';
import { APP_ROLES, type AppRole } from '@/domain/user-schema';
import { isLocalDemoHost } from '@/lib/localDevRuntime';

const DEV_BYPASS_KEY = 'miras_dev_auth_bypass';
const LEGACY_DEV_BYPASS_KEY = 'hamula_dev_auth_bypass';

function isProductionClientDeploy(): boolean {
  const deploy =
    import.meta.env.VITE_MIRAS_DEPLOY_ENV || import.meta.env.VITE_HAMOULA_DEPLOY_ENV;
  return deploy === 'production';
}

export function isDevAuthBypassEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.PROD || isProductionClientDeploy()) {
    return false;
  }
  if (!isLocalDemoHost()) return false;
  // Vite `npm run dev` allows demo login on loopback and LAN — no .env flag required.
  if (import.meta.env.DEV) return true;
  return import.meta.env.VITE_ENABLE_DEV_AUTH_BYPASS === 'true';
}

export const DEMO_OTP_CODE = '123456';

function saudiPhoneDigits(value: string): string {
  return value.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
}

/** Local demo numbers — skip SMS entirely (not Firebase Console test numbers). */
export const LOCALHOST_TEST_PHONES = [
  { role: APP_ROLES.B2C_CLIENT, e164: '+966500000000', local: '0500000000', code: DEMO_OTP_CODE, labelAr: 'دخول تجريبي', labelEn: 'Demo number' },
  { role: APP_ROLES.B2C_CLIENT, e164: '+966500000001', local: '0500000001', code: DEMO_OTP_CODE, labelAr: 'عميل تجريبي', labelEn: 'Demo customer' },
  { role: APP_ROLES.B2C_DRIVER, e164: '+966500000002', local: '0500000002', code: DEMO_OTP_CODE, labelAr: 'سائق تجريبي', labelEn: 'Demo driver' },
] as const;

export function matchDemoBypassPhone(input: string) {
  const digits = saudiPhoneDigits(input);
  if (!digits) return null;
  return (
    LOCALHOST_TEST_PHONES.find(
      (entry) =>
        saudiPhoneDigits(entry.e164) === digits || saudiPhoneDigits(entry.local) === digits
    ) ?? null
  );
}

/** Roles shown as one-tap screenshot login (customer + driver). */
export const DEMO_LOGIN_ROLES = [APP_ROLES.B2C_CLIENT, APP_ROLES.B2C_DRIVER] as const;

const GUEST_ROLE_PREFIX = 'miras_dev_guest_role_';
const PENDING_GUEST_ROLE_KEY = 'miras_dev_pending_guest_role';

function isKnownAppRole(value: string | null | undefined): value is AppRole {
  return Boolean(value && Object.values(APP_ROLES).includes(value as AppRole));
}

export function savePendingGuestRole(role: AppRole): void {
  if (!isDevAuthBypassEnabled()) return;
  try {
    sessionStorage.setItem(PENDING_GUEST_ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}

export function peekPendingGuestRole(): AppRole | null {
  if (!isDevAuthBypassEnabled()) return null;
  try {
    const raw = sessionStorage.getItem(PENDING_GUEST_ROLE_KEY);
    return isKnownAppRole(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function consumePendingGuestRole(): AppRole | null {
  const role = peekPendingGuestRole();
  try {
    sessionStorage.removeItem(PENDING_GUEST_ROLE_KEY);
  } catch {
    /* ignore */
  }
  return role;
}

export function saveLocalGuestRole(uid: string, role: AppRole): void {
  if (!uid || !isDevAuthBypassEnabled()) return;
  try {
    localStorage.setItem(`${GUEST_ROLE_PREFIX}${uid}`, role);
  } catch {
    /* ignore */
  }
}

export function loadLocalGuestRole(uid: string): AppRole | null {
  if (!uid || !isDevAuthBypassEnabled()) return null;
  try {
    const raw = localStorage.getItem(`${GUEST_ROLE_PREFIX}${uid}`);
    if (isKnownAppRole(raw)) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearLocalGuestRole(uid?: string): void {
  try {
    if (uid) {
      localStorage.removeItem(`${GUEST_ROLE_PREFIX}${uid}`);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(GUEST_ROLE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

const MOCK_PROFILES: Record<AppRole, UserProfile> = {
  [APP_ROLES.B2C_CLIENT]: {
    uid: 'dev-bypass-b2c-client',
    phone: '+966500000000',
    role: APP_ROLES.B2C_CLIENT,
    name: 'Ahmed Al-Harbi',
  },
  [APP_ROLES.B2C_DRIVER]: {
    uid: 'dev-bypass-b2c-driver',
    phone: '+966500000002',
    role: APP_ROLES.B2C_DRIVER,
    name: 'محمد العتيبي',
    vehicleType: 'flatbed',
    vehicleOption: 'normal',
    plateNumber: 'ABC 4521',
    nationalId: '1000000002',
    registrationSerial: 'REG-DEV-002',
    accountStatus: 'approved',
    documentExpiries: {
      id: '2030-01-01',
      registration: '2030-01-01',
      permit: '2030-01-01',
      license: '2030-01-01',
    },
    documentUploadStatuses: {
      ...EMPTY_DRIVER_DOCUMENTS,
      license: 'uploaded',
      id: 'uploaded',
      registration: 'uploaded',
      permit: 'uploaded',
    },
  },
  [APP_ROLES.B2B_CORPORATE]: {
    uid: 'dev-bypass-b2b-corporate',
    phone: '+966500000003',
    role: APP_ROLES.B2B_CORPORATE,
    name: 'Sara Al-Qahtani',
    companyName: 'Riyadh Logistics Corp',
    commercialRegistration: '1010123456',
  },
  [APP_ROLES.B2B_OPERATOR]: {
    uid: 'dev-bypass-b2b-operator',
    phone: '+966500000004',
    role: APP_ROLES.B2B_OPERATOR,
    name: 'Khalid Al-Dossari',
    companyName: 'Najd Fleet Operators',
    commercialRegistration: '1010987654',
  },
  [APP_ROLES.ADMIN]: {
    uid: 'dev-bypass-admin',
    phone: '+966541330720',
    role: APP_ROLES.ADMIN,
    name: 'Dev Super Admin',
  },
};

/** All roles available for one-click local login. */
export const DEV_BYPASS_ROLES: readonly AppRole[] = [
  APP_ROLES.B2C_CLIENT,
  APP_ROLES.B2C_DRIVER,
  APP_ROLES.B2B_CORPORATE,
  APP_ROLES.B2B_OPERATOR,
  APP_ROLES.ADMIN,
] as const;

export function buildDevBypassProfile(role: AppRole): UserProfile {
  const base = MOCK_PROFILES[role];
  if (!base) {
    throw new Error(`DEV_BYPASS_UNKNOWN_ROLE:${role}`);
  }
  return { ...base };
}

export function saveDevBypassProfile(profile: UserProfile): void {
  if (!isDevAuthBypassEnabled()) return;
  localStorage.setItem(DEV_BYPASS_KEY, JSON.stringify(profile));
  localStorage.removeItem(LEGACY_DEV_BYPASS_KEY);
}

export function loadDevBypassProfile(): UserProfile | null {
  if (!isDevAuthBypassEnabled()) return null;
  try {
    const raw = readStorageWithLegacy(localStorage, DEV_BYPASS_KEY, LEGACY_DEV_BYPASS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    localStorage.removeItem(DEV_BYPASS_KEY);
    localStorage.removeItem(LEGACY_DEV_BYPASS_KEY);
    return null;
  }
}

export function resolveGuestRole(uid?: string | null): AppRole | null {
  if (!isDevAuthBypassEnabled()) return null;
  return (uid ? loadLocalGuestRole(uid) : null)
    || peekPendingGuestRole()
    || loadDevBypassProfile()?.role
    || null;
}

export function clearDevBypassProfile(): void {
  localStorage.removeItem(DEV_BYPASS_KEY);
  localStorage.removeItem(LEGACY_DEV_BYPASS_KEY);
  try {
    sessionStorage.removeItem(PENDING_GUEST_ROLE_KEY);
  } catch {
    /* ignore */
  }
}

/** Minimal Firebase User stub so route guards see a signed-in session. */
export function createDevBypassUser(profile: UserProfile): User {
  const isAdmin = profile.role === APP_ROLES.ADMIN;
  return {
    uid: profile.uid,
    phoneNumber: profile.phone,
    displayName: profile.name,
    email: null,
    emailVerified: false,
    isAnonymous: false,
    metadata: {} as User['metadata'],
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => undefined,
    getIdToken: async () => 'dev-bypass-token',
    getIdTokenResult: async () =>
      ({
        token: 'dev-bypass-token',
        claims: {
          role: profile.role,
          admin: isAdmin,
          devBypass: true,
        },
        authTime: new Date().toISOString(),
        issuedAtTime: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 3600_000).toISOString(),
        signInProvider: 'dev-bypass',
        signInSecondFactor: null,
      }) as Awaited<ReturnType<User['getIdTokenResult']>>,
    reload: async () => undefined,
    toJSON: () => ({ uid: profile.uid }),
    providerId: 'dev-bypass',
  } as User;
}
