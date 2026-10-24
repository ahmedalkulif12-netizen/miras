import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import { DRIVER_DOCUMENT_KEYS, type UserProfile, type DriverDocumentKey } from '@/lib/userProfile';
import { DRIVER_REVIEW_SLA_HOURS } from '@/lib/driverKyc';
import {
  APP_ROLES,
  isRegistrableRole,
  normalizeAppRole,
  type AnyStoredRole,
  type FirestoreUserDocument,
} from '@/domain/user-schema';

const DRIVER_DOC_KEYS: DriverDocumentKey[] = DRIVER_DOCUMENT_KEYS;

function cleanStringMap(
  value: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (!value) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' && raw.trim()) out[key] = raw.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

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
    profile.playReview === true
      ? role
      : existingNormalized && isRegistrableRole(existingNormalized)
        ? (existingRoleRaw as AnyStoredRole)
        : role;

  // --- users/{uid} (always) -------------------------------------------------
  const userDoc: Omit<FirestoreUserDocument, 'role'> & { role: AnyStoredRole } = {
    uid: profile.uid,
    phone: profile.phone,
    role: roleForWrite,
    name: profile.name,
    ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
    ...(profile.vehiclePhotoURL ? { vehiclePhotoURL: profile.vehiclePhotoURL } : {}),
    ...(profile.vehicleType ? { vehicleType: profile.vehicleType } : {}),
    ...(profile.vehicleOption ? { vehicleOption: profile.vehicleOption } : {}),
    ...(profile.plateNumber ? { plateNumber: profile.plateNumber } : {}),
    ...(profile.nationalId ? { nationalId: profile.nationalId } : {}),
    ...(profile.dateOfBirth ? { dateOfBirth: profile.dateOfBirth } : {}),
    ...(profile.licenseNumber ? { licenseNumber: profile.licenseNumber } : {}),
    ...(profile.registrationSerial
      ? { registrationSerial: profile.registrationSerial }
      : {}),
    ...(profile.operatingCardNumber
      ? { operatingCardNumber: profile.operatingCardNumber }
      : {}),
    ...(profile.companyName ? { companyName: profile.companyName } : {}),
    ...(profile.bankDetails ? { bankDetails: profile.bankDetails } : {}),
    ...(profile.commercialRegistration
      ? { commercialRegistration: profile.commercialRegistration }
      : {}),
    ...(profile.playReview ? { playReview: true } : {}),
    ...(isNewUser
      ? {
          accountStatus:
            role === APP_ROLES.B2C_DRIVER ? 'pending_approval' : 'active',
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
    const documentExpiries = cleanStringMap(profile.documentExpiries);
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
        ...(profile.vehiclePhotoURL ? { vehiclePhotoURL: profile.vehiclePhotoURL } : {}),
        ...(profile.nationalId ? { nationalId: profile.nationalId } : {}),
        ...(profile.dateOfBirth ? { dateOfBirth: profile.dateOfBirth } : {}),
        ...(profile.licenseNumber ? { licenseNumber: profile.licenseNumber } : {}),
        ...(profile.registrationSerial
          ? { registrationSerial: profile.registrationSerial }
          : {}),
        ...(profile.vehicleSequenceNumber || profile.registrationSerial
          ? {
              vehicleSequenceNumber:
                profile.vehicleSequenceNumber || profile.registrationSerial,
            }
          : {}),
        ...(profile.plateLetterRight ? { plateLetterRight: profile.plateLetterRight } : {}),
        ...(profile.plateLetterMiddle ? { plateLetterMiddle: profile.plateLetterMiddle } : {}),
        ...(profile.plateLetterLeft ? { plateLetterLeft: profile.plateLetterLeft } : {}),
        ...(profile.plateDigits ? { plateDigits: profile.plateDigits } : {}),
        ...(profile.operatingCardNumber
          ? { operatingCardNumber: profile.operatingCardNumber }
          : {}),
        ...(profile.bankDetails ? { bankDetails: profile.bankDetails } : {}),
        ...(profile.operatorId
          ? { operatorId: profile.operatorId, payoutAccountKind: 'company' as const }
          : {}),
        ...(documentExpiries ? { documentExpiries } : {}),
        ...(Object.keys(documents).length ? { documents } : {}),
        reviewSlaHours: DRIVER_REVIEW_SLA_HOURS,
        ...(existingDriver.exists()
          ? {}
          : {
              accountStatus: 'pending_approval',
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
        ...(profile.bankDetails ? { bankDetails: profile.bankDetails } : {}),
        ...(profile.crDocument?.storagePath ? { documents: { cr: profile.crDocument } } : {}),
        ...(existingOperator.exists()
          ? {}
          : { accountStatus: 'pending', createdAt: now }),
        updatedAt: now,
      },
      { merge: true }
    );
  }
}
