/**
 * Miras (مراس) — Firestore users collection schema + RBAC config (STEP 1).
 *
 * Canonical roles stored in `users/{uid}.role`:
 *   - b2c_client     → Individual Customer
 *   - b2c_driver     → Street / Individual Driver
 *   - b2b_corporate  → Company requesting fleets / contracts
 *   - b2b_operator   → Fleet owner / executing company
 *
 * Platform operators still use `admin` (admins/{uid} ACL + custom claims).
 * Legacy docs may still contain `customer` / `driver` — normalize on read.
 */

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

export const APP_ROLES = {
  B2C_CLIENT: 'b2c_client',
  B2C_DRIVER: 'b2c_driver',
  B2B_CORPORATE: 'b2b_corporate',
  B2B_OPERATOR: 'b2b_operator',
  ADMIN: 'admin',
} as const;

/** Roles that end-users may self-register into (never `admin`). */
export const REGISTRABLE_ROLES = [
  APP_ROLES.B2C_CLIENT,
  APP_ROLES.B2C_DRIVER,
  APP_ROLES.B2B_CORPORATE,
  APP_ROLES.B2B_OPERATOR,
] as const;

export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];
export type AppRole = RegistrableRole | typeof APP_ROLES.ADMIN;

/** Pre-RBAC document values still present in production Firestore. */
export type LegacyAppRole = 'customer' | 'driver';

export type AnyStoredRole = AppRole | LegacyAppRole;

// ---------------------------------------------------------------------------
// Role metadata (labels + dashboard homes)
// ---------------------------------------------------------------------------

export interface RoleMeta {
  role: AppRole;
  labelEn: string;
  labelAr: string;
  /** Post-login destination path */
  homePath: string;
  /** Companion Firestore collection updated on registration (null for admin) */
  profileCollection: string | null;
}

export const ROLE_META: Record<AppRole, RoleMeta> = {
  b2c_client: {
    role: 'b2c_client',
    labelEn: 'Individual Customer',
    labelAr: 'عميل فردي',
    homePath: '/b2c/client',
    profileCollection: 'customers',
  },
  b2c_driver: {
    role: 'b2c_driver',
    labelEn: 'Individual Driver',
    labelAr: 'سائق فردي',
    homePath: '/b2c/driver?online=1',
    profileCollection: 'drivers',
  },
  b2b_corporate: {
    role: 'b2b_corporate',
    labelEn: 'Corporate Portal',
    labelAr: 'بوابة الشركات',
    homePath: '/b2b/corporate',
    profileCollection: 'corporates',
  },
  b2b_operator: {
    role: 'b2b_operator',
    labelEn: 'Fleet Operator Panel',
    labelAr: 'لوحة مشغل الأسطول',
    homePath: '/b2b/operator',
    profileCollection: 'operators',
  },
  admin: {
    role: 'admin',
    labelEn: 'Platform Admin',
    labelAr: 'مدير المنصة',
    homePath: '/admin',
    profileCollection: null,
  },
};

// ---------------------------------------------------------------------------
// Firestore document shapes
// ---------------------------------------------------------------------------

/** Account lifecycle flags shared across user docs. */
export type UserAccountStatus =
  | 'active'
  | 'pending'
  | 'pending_review'
  | 'ready_for_review'
  | 'suspended'
  | 'deleted';

/**
 * Canonical `users/{uid}` document — RBAC source of truth for security rules.
 * Written by `syncUserProfileToFirestore` after OTP / session restore.
 */
export interface FirestoreUserDocument {
  uid: string;
  phone: string;
  /** Always write canonical roles (`b2c_*` / `b2b_*` / `admin`). */
  role: AppRole;
  name: string;
  /** Profile avatar download URL (GCS signed URL). */
  photoURL?: string;
  photoStoragePath?: string;
  accountStatus?: UserAccountStatus;
  /** Optional B2C driver vehicle fields (also mirrored on drivers/{uid}). */
  vehicleType?: string;
  vehicleOption?: string;
  plateNumber?: string;
  /** Optional B2B organization fields (also mirrored on corporates|operators). */
  companyName?: string;
  commercialRegistration?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** `customers/{uid}` — B2C client registration profile. */
export interface FirestoreCustomerDocument {
  uid: string;
  fullName: string;
  phone: string;
  role?: typeof APP_ROLES.B2C_CLIENT;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** `drivers/{uid}` — B2C driver KYC / ops profile. */
export interface FirestoreDriverDocument {
  uid: string;
  fullName: string;
  phone: string;
  role?: typeof APP_ROLES.B2C_DRIVER;
  vehicleType: string;
  vehicleSize: string;
  plateNumber: string;
  nationalId?: string;
  registrationSerial?: string;
  documents?: Record<string, 'not_uploaded' | 'uploaded'>;
  accountStatus?: UserAccountStatus | 'approved' | 'rejected';
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** `corporates/{uid}` — B2B company requesting fleets / contracts. */
export interface FirestoreCorporateDocument {
  uid: string;
  companyName: string;
  contactName: string;
  phone: string;
  commercialRegistration?: string;
  role: typeof APP_ROLES.B2B_CORPORATE;
  accountStatus?: UserAccountStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** `operators/{uid}` — B2B fleet owner / executing company. */
export interface FirestoreOperatorDocument {
  uid: string;
  companyName: string;
  contactName: string;
  phone: string;
  commercialRegistration?: string;
  fleetSize?: number;
  role: typeof APP_ROLES.B2B_OPERATOR;
  accountStatus?: UserAccountStatus | 'pending' | 'approved' | 'rejected';
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_ALIASES: Record<string, AppRole> = {
  customer: APP_ROLES.B2C_CLIENT,
  driver: APP_ROLES.B2C_DRIVER,
  b2c_client: APP_ROLES.B2C_CLIENT,
  b2c_driver: APP_ROLES.B2C_DRIVER,
  b2b_corporate: APP_ROLES.B2B_CORPORATE,
  b2b_operator: APP_ROLES.B2B_OPERATOR,
  admin: APP_ROLES.ADMIN,
};

/** Map legacy or canonical role strings → AppRole (null if unknown). */
export function normalizeAppRole(role: unknown): AppRole | null {
  if (typeof role !== 'string') return null;
  return ROLE_ALIASES[role] ?? null;
}

export function isRegistrableRole(role: unknown): role is RegistrableRole {
  const normalized = normalizeAppRole(role);
  return (
    normalized !== null &&
    (REGISTRABLE_ROLES as readonly string[]).includes(normalized)
  );
}

export function isClientRole(role: unknown): boolean {
  return normalizeAppRole(role) === APP_ROLES.B2C_CLIENT;
}

export function isDriverRole(role: unknown): boolean {
  return normalizeAppRole(role) === APP_ROLES.B2C_DRIVER;
}

export function isCorporateRole(role: unknown): boolean {
  return normalizeAppRole(role) === APP_ROLES.B2B_CORPORATE;
}

export function isOperatorRole(role: unknown): boolean {
  return normalizeAppRole(role) === APP_ROLES.B2B_OPERATOR;
}

export function isAdminRole(role: unknown): boolean {
  return normalizeAppRole(role) === APP_ROLES.ADMIN;
}

/** Dashboard / post-login path for a normalized role. */
export function getHomePathForRole(role: AppRole): string {
  return ROLE_META[role].homePath;
}

/** Human-readable role label. */
export function getRoleLabel(role: AppRole, locale: 'ar' | 'en' = 'ar'): string {
  const meta = ROLE_META[role];
  return locale === 'ar' ? meta.labelAr : meta.labelEn;
}

/**
 * Roles allowed on client create of `users/{uid}` (never admin).
 * Kept in sync with firestore.rules `request.resource.data.role in [...]`.
 */
export const FIRESTORE_CLIENT_WRITABLE_ROLES: RegistrableRole[] = [...REGISTRABLE_ROLES];
