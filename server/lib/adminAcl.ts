import admin from 'firebase-admin';

export interface AdminRecord {
  uid: string;
  name: string;
  phone: string;
  email?: string;
  active: boolean;
}

/**
 * Sole authorized Miras Admin phone numbers (E.164).
 * Local form `0541330720` normalizes to `+966541330720`.
 * This phone is an unconditional super-admin — no ACL document required.
 */
export const AUTHORIZED_ADMIN_PHONES: readonly string[] = Object.freeze([
  '+966541330720',
]);

/** @deprecated Use AUTHORIZED_ADMIN_PHONES — kept for call-site compatibility. */
export const HARDCODED_SUPER_ADMIN_PHONES = AUTHORIZED_ADMIN_PHONES;

/** Normalize Saudi / E.164 phones for ACL comparison. */
export function normalizeAdminPhoneE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+') && digits.startsWith('966') && digits.length >= 12) {
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

  return trimmed.startsWith('+') ? trimmed : null;
}

/** True when the phone is the sole authorized Miras Admin number. */
export function isAuthorizedAdminPhone(phone: string | null | undefined): boolean {
  const e164 = normalizeAdminPhoneE164(phone);
  if (!e164) return false;
  return AUTHORIZED_ADMIN_PHONES.includes(e164);
}

/** @deprecated Use isAuthorizedAdminPhone. */
export function isHardcodedSuperAdminPhone(phone: string | null | undefined): boolean {
  return isAuthorizedAdminPhone(phone);
}

function superAdminRecord(
  uid: string,
  phone: string,
  extras?: { name?: string; email?: string }
): AdminRecord {
  return {
    uid,
    name: extras?.name || 'Miras Admin',
    phone,
    email: extras?.email,
    active: true,
  };
}

/**
 * Best-effort upsert of `admins/{uid}` for the allowlisted phone.
 * Firestore failures never block super-admin login — phone allowlist is enough.
 */
export async function ensureAuthorizedAdminRecord(
  db: admin.firestore.Firestore,
  uid: string,
  authPhone: string
): Promise<AdminRecord> {
  const phone = normalizeAdminPhoneE164(authPhone);
  if (!phone || !isAuthorizedAdminPhone(phone)) {
    throw Object.assign(new Error('Phone is not authorized for Miras Admin'), {
      statusCode: 403,
      code: 'ADMIN_PHONE_NOT_AUTHORIZED',
    });
  }

  try {
    const ref = db.collection('admins').doc(uid);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    const name = existing?.name ? String(existing.name) : 'Miras Admin';
    const email = existing?.email ? String(existing.email) : undefined;

    await ref.set(
      {
        uid,
        name,
        phone,
        active: true,
        superAdmin: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(snap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
        ...(email ? { email } : {}),
      },
      { merge: true }
    );

    return superAdminRecord(uid, phone, { name, email });
  } catch (err) {
    console.warn(
      '[adminAcl] admins/{uid} upsert soft-failed — granting in-memory super-admin record:',
      err
    );
    return superAdminRecord(uid, phone);
  }
}

/** @deprecated Use ensureAuthorizedAdminRecord. */
export async function ensureHardcodedSuperAdminRecord(
  db: admin.firestore.Firestore,
  uid: string,
  authPhone: string
): Promise<AdminRecord> {
  return ensureAuthorizedAdminRecord(db, uid, authPhone);
}

/**
 * Load `admins/{uid}` — only returned when the document phone is the sole allowlisted admin.
 */
export async function loadAdminRecord(
  db: admin.firestore.Firestore,
  uid: string
): Promise<AdminRecord | null> {
  try {
    const snap = await db.collection('admins').doc(uid).get();
    if (!snap.exists) return null;

    const data = snap.data() as Record<string, unknown>;
    if (data.active === false) return null;

    const phone = normalizeAdminPhoneE164(
      data.phone ? String(data.phone) : data.phoneNumber ? String(data.phoneNumber) : null
    );
    if (!phone || !isAuthorizedAdminPhone(phone)) {
      return null;
    }

    return {
      uid,
      name: String(data.name || 'Miras Admin'),
      phone,
      email: data.email ? String(data.email) : undefined,
      active: true,
    };
  } catch (err) {
    console.warn('[adminAcl] loadAdminRecord failed:', err);
    return null;
  }
}

/**
 * Resolve admin for session — allowlisted phone only; no ACL doc required.
 */
export async function resolveAdminRecordForSession(
  db: admin.firestore.Firestore,
  uid: string,
  authPhone: string | null
): Promise<AdminRecord | null> {
  if (!isAuthorizedAdminPhone(authPhone)) {
    return null;
  }
  return ensureAuthorizedAdminRecord(db, uid, authPhone!);
}

/**
 * Auth phone must be the sole authorized admin number.
 */
export function assertAdminPhoneMatches(
  record: AdminRecord,
  authPhone: string | null | undefined
): void {
  const authE164 = normalizeAdminPhoneE164(authPhone);
  if (!isAuthorizedAdminPhone(authE164)) {
    throw Object.assign(
      new Error('Admin phone is not authorized for Miras Admin'),
      { statusCode: 403, code: 'ADMIN_PHONE_NOT_AUTHORIZED' }
    );
  }
  // Super-admin: phone allowlist is enough (record phone may be auto-healed).
}

/** Load Firebase Auth user phone (E.164) for ACL verification. */
export async function getAuthUserPhone(
  auth: admin.auth.Auth,
  uid: string
): Promise<string | null> {
  const user = await auth.getUser(uid);
  return normalizeAdminPhoneE164(user.phoneNumber ?? null);
}

/** Grant admin custom claims after allowlist validation (server-only). */
export async function grantAdminCustomClaims(
  auth: admin.auth.Auth,
  uid: string
): Promise<void> {
  const user = await auth.getUser(uid);
  if (!isAuthorizedAdminPhone(user.phoneNumber)) {
    throw Object.assign(new Error('Cannot grant admin claims to unauthorized phone'), {
      statusCode: 403,
      code: 'ADMIN_PHONE_NOT_AUTHORIZED',
    });
  }
  const existing = user.customClaims ?? {};
  await auth.setCustomUserClaims(uid, {
    ...existing,
    admin: true,
    role: 'admin',
  });
}

/**
 * Strip admin privileges entirely.
 * The sole authorized admin phone keeps `admin: true`.
 */
export async function clearAdminCustomClaims(
  auth: admin.auth.Auth,
  uid: string
): Promise<void> {
  const user = await auth.getUser(uid);
  if (isAuthorizedAdminPhone(user.phoneNumber)) {
    await auth.setCustomUserClaims(uid, {
      ...(user.customClaims ?? {}),
      admin: true,
      role: 'admin',
    });
    return;
  }

  const existing = user.customClaims ?? {};
  const { admin: _a, role: _r, ...rest } = existing as Record<string, unknown>;
  await auth.setCustomUserClaims(uid, {
    ...rest,
    admin: false,
  });
}

/**
 * Remove admin privileges from token when using non-admin login paths.
 * Sole authorized admin keeps `admin: true`.
 */
export async function revokeAdminCustomClaims(
  auth: admin.auth.Auth,
  uid: string,
  role: 'b2c_client' | 'b2c_driver' | 'b2b_corporate' | 'b2b_operator'
): Promise<void> {
  const user = await auth.getUser(uid);
  if (isAuthorizedAdminPhone(user.phoneNumber)) {
    await auth.setCustomUserClaims(uid, {
      ...(user.customClaims ?? {}),
      admin: true,
      role: 'admin',
    });
    return;
  }

  const existing = user.customClaims ?? {};
  await auth.setCustomUserClaims(uid, {
    ...existing,
    admin: false,
    role,
  });
}

/**
 * Strict admin gate: Auth phone MUST be +966541330720 (0541330720).
 * Firestore ACL upsert is best-effort and never blocks this phone.
 */
export async function verifyAdminAccess(
  db: admin.firestore.Firestore,
  decodedToken: admin.auth.DecodedIdToken,
  authSdk?: admin.auth.Auth
): Promise<AdminRecord> {
  let authPhone = normalizeAdminPhoneE164(
    typeof decodedToken.phone_number === 'string' ? decodedToken.phone_number : null
  );
  if (authSdk) {
    authPhone = (await getAuthUserPhone(authSdk, decodedToken.uid)) ?? authPhone;
  }

  if (!isAuthorizedAdminPhone(authPhone)) {
    throw Object.assign(
      new Error('Admin access restricted to the authorized Miras Admin phone only'),
      { statusCode: 403, code: 'ADMIN_PHONE_NOT_AUTHORIZED' }
    );
  }

  if (decodedToken.admin !== true && authSdk) {
    try {
      await grantAdminCustomClaims(authSdk, decodedToken.uid);
    } catch (err) {
      console.warn('[verifyAdminAccess] grantAdminCustomClaims soft-fail:', err);
    }
  }

  return ensureAuthorizedAdminRecord(db, decodedToken.uid, authPhone!);
}
