import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import type { UserProfile, DriverDocumentKey } from '@/lib/userProfile';
import { DRIVER_REVIEW_SLA_HOURS } from '@/lib/driverKyc';
import {
  APP_ROLES,
  isRegistrableRole,
  normalizeAppRole,
  type AnyStoredRole,
  type FirestoreUserDocument,
} from '@/domain/user-schema';

const DRIVER_DOC_KEYS: DriverDocumentKey[] = ['license', 'id', 'registration', 'permit'];

function buildDriverDocumentsPayload(profile: UserProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DRIVER_DOC_KEYS) {
    const file = profile.documentFiles?.[key];
    if (file?.storagePath) {
      out[key] = {
        status: 'uploaded',
        storagePath: file.storagePath,
        url: file.url || null,
        contentType: file.contentType || null,
        fileName: file.fileName || null,
        uploadedAt: file.uploadedAt || null,
      };
    }
  }
  return out;
}
/**
 * Syncs login profile to Firestore after OTP verification / session restore.
 *
 * Collections touched (created automatically on first write):
 *   - users/{uid}        — RBAC role + profile (security-rules source of truth)
 *   - customers/{uid}    — b2c_client registration
 *   - drivers/{uid}      — b2c_driver registration + KYC fields
 *   - corporates/{uid}   — b2b_corporate company profile
 *   - operators/{uid}    — b2b_operator fleet-owner profile
 *
 * Admin profiles are never written from the client (admins/{uid} is server-seeded).
 */
export async function syncUserProfileToFirestore(profile: UserProfile): Promise<void> {
  const role = normalizeAppRole(profile.role);
  if (!role || role === APP_ROLES.ADMIN) {
    return;
  }

  await ensureFirebaseReady();

  const userRef = doc(db, 'users', profile.uid);
  const existing = await getDoc(userRef);
  if (existing.exists() && existing.data()?.accountStatus === 'deleted') {
    return;
  }

  const now = serverTimestamp();
  const isNewUser = !existing.exists();

  // Preserve existing Firestore role forever — clients must not switch roles on re-login.
  // Rules also reject role changes; keep write aligned so sync does not soft-fail.
  const existingRoleRaw = existing.exists()
    ? (existing.data()?.role as string | undefined)
    : undefined;
  const existingNormalized = existingRoleRaw ? normalizeAppRole(existingRoleRaw) : null;
  const roleForWrite: AnyStoredRole =
    existingNormalized && isRegistrableRole(existingNormalized)
      ? (existingRoleRaw as AnyStoredRole)
      : role;

  // --- users/{uid} (always) -------------------------------------------------
  const userDoc: Omit<FirestoreUserDocument, 'role'> & { role: AnyStoredRole } = {
    uid: profile.uid,
    phone: profile.phone,
    role: roleForWrite,
    name: profile.name,
    ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
    ...(profile.vehicleType ? { vehicleType: profile.vehicleType } : {}),
    ...(profile.vehicleOption ? { vehicleOption: profile.vehicleOption } : {}),
    ...(profile.plateNumber ? { plateNumber: profile.plateNumber } : {}),
    ...(profile.nationalId ? { nationalId: profile.nationalId } : {}),
    ...(profile.registrationSerial
      ? { registrationSerial: profile.registrationSerial }
      : {}),
    ...(profile.companyName ? { companyName: profile.companyName } : {}),
    ...(profile.commercialRegistration
      ? { commercialRegistration: profile.commercialRegistration }
      : {}),
    ...(isNewUser
      ? {
          accountStatus:
            role === APP_ROLES.B2C_DRIVER ? 'pending' : 'active',
          createdAt: now,
        }
      : {}),
    updatedAt: now,
  };

  await setDoc(userRef, userDoc, { merge: true });

  // --- Role-specific companion collections ----------------------------------
  if (role === APP_ROLES.B2C_CLIENT) {
    const customerRef = doc(db, 'customers', profile.uid);
    const existingCustomer = await getDoc(customerRef);

    await setDoc(
      customerRef,
      {
        uid: profile.uid,
        fullName: profile.name,
        phone: profile.phone,
        role: APP_ROLES.B2C_CLIENT,
        ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
        ...(existingCustomer.exists() ? {} : { createdAt: now }),
        updatedAt: now,
      },
      { merge: true }
    );
    return;
  }

  if (role === APP_ROLES.B2C_DRIVER) {
    const documents = buildDriverDocumentsPayload(profile);
    const driverRef = doc(db, 'drivers', profile.uid);
    const existingDriver = await getDoc(driverRef);

    await setDoc(
      driverRef,
      {
        uid: profile.uid,
        fullName: profile.name,
        phone: profile.phone,
        role: APP_ROLES.B2C_DRIVER,
        vehicleType: profile.vehicleType ?? '',
        vehicleSize: profile.vehicleOption ?? '',
        plateNumber: profile.plateNumber ?? '',
        ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
        ...(profile.nationalId ? { nationalId: profile.nationalId } : {}),
        ...(profile.registrationSerial
          ? { registrationSerial: profile.registrationSerial }
          : {}),
        ...(profile.documentExpiries ? { documentExpiries: profile.documentExpiries } : {}),
        ...(Object.keys(documents).length ? { documents } : {}),
        reviewSlaHours: DRIVER_REVIEW_SLA_HOURS,
        ...(existingDriver.exists()
          ? {}
          : {
              accountStatus: 'pending',
              submittedAt: now,
              createdAt: now,
              reviewDueAt: new Date(
                Date.now() + DRIVER_REVIEW_SLA_HOURS * 60 * 60 * 1000
              ).toISOString(),
            }),
        updatedAt: now,
      },
      { merge: true }
    );
    return;
  }

  if (role === APP_ROLES.B2B_CORPORATE) {
    const corporateRef = doc(db, 'corporates', profile.uid);
    const existingCorporate = await getDoc(corporateRef);

    await setDoc(
      corporateRef,
      {
        uid: profile.uid,
        companyName: profile.companyName || profile.name,
        contactName: profile.name,
        phone: profile.phone,
        role: APP_ROLES.B2B_CORPORATE,
        ...(profile.commercialRegistration
          ? { commercialRegistration: profile.commercialRegistration }
          : {}),
        ...(existingCorporate.exists()
          ? {}
          : { accountStatus: 'active', createdAt: now }),
        updatedAt: now,
      },
      { merge: true }
    );
    return;
  }

  if (role === APP_ROLES.B2B_OPERATOR) {
    const operatorRef = doc(db, 'operators', profile.uid);
    const existingOperator = await getDoc(operatorRef);

    await setDoc(
      operatorRef,
      {
        uid: profile.uid,
        companyName: profile.companyName || profile.name,
        contactName: profile.name,
        phone: profile.phone,
        role: APP_ROLES.B2B_OPERATOR,
        ...(profile.commercialRegistration
          ? { commercialRegistration: profile.commercialRegistration }
          : {}),
        ...(existingOperator.exists()
          ? {}
          : { accountStatus: 'pending', createdAt: now }),
        updatedAt: now,
      },
      { merge: true }
    );
  }
}
