import { doc, getDoc, type DocumentSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, ensureFirebaseReady } from '@/lib/firebase';
import { resolveAdminProfile } from '@/lib/adminAuth';
import { loadCachedProfile, saveCachedProfile } from '@/lib/userProfileStorage';
import type { UserProfile } from '@/lib/userProfile';
import { extractDriverKyc } from '@/lib/driverKyc';
import {
  APP_ROLES,
  isRegistrableRole,
  normalizeAppRole,
} from '@/domain/user-schema';

function attachDriverKyc(
  profile: UserProfile,
  data: Record<string, unknown>
): UserProfile {
  const kyc = extractDriverKyc({
    documentFiles: profile.documentFiles,
    documentUploadStatuses: profile.documentUploadStatuses,
    documents: data.documents,
  });
  return {
    ...profile,
    ...(data.accountStatus ? { accountStatus: String(data.accountStatus) } : {}),
    ...(data.nationalId ? { nationalId: String(data.nationalId) } : {}),
    ...(data.registrationSerial
      ? { registrationSerial: String(data.registrationSerial) }
      : {}),
    ...(data.documentExpiries && typeof data.documentExpiries === 'object'
      ? { documentExpiries: data.documentExpiries as UserProfile['documentExpiries'] }
      : {}),
    documentFiles: kyc.documentFiles,
    documentUploadStatuses: kyc.documentUploadStatuses,
  };
}

function readFirestoreProfile(
  firebaseUser: User,
  collection: 'users' | 'customers' | 'drivers' | 'corporates' | 'operators',
  snap: DocumentSnapshot
): UserProfile | null {
  if (!snap.exists()) {
    return null;
  }

  const data = snap.data() as Record<string, unknown>;
  const authPhone = firebaseUser.phoneNumber ?? '';
  const phone = String(data.phone || authPhone || '');

  if (collection === 'users') {
    if (data.accountStatus === 'deleted') {
      return null;
    }
    const role = normalizeAppRole(data.role);
    // Never elevate to admin from a users/{uid} document — ACL only.
    if (!role || role === APP_ROLES.ADMIN || !isRegistrableRole(role)) {
      return null;
    }
    const base: UserProfile = {
      uid: firebaseUser.uid,
      phone,
      role,
      name: String(data.name || 'User'),
      ...(data.photoURL ? { photoURL: String(data.photoURL) } : {}),
      ...(data.vehicleType ? { vehicleType: String(data.vehicleType) } : {}),
      ...(data.vehicleOption ? { vehicleOption: String(data.vehicleOption) } : {}),
      ...(data.plateNumber ? { plateNumber: String(data.plateNumber) } : {}),
      ...(data.nationalId ? { nationalId: String(data.nationalId) } : {}),
      ...(data.registrationSerial
        ? { registrationSerial: String(data.registrationSerial) }
        : {}),
      ...(data.companyName ? { companyName: String(data.companyName) } : {}),
      ...(data.commercialRegistration
        ? { commercialRegistration: String(data.commercialRegistration) }
        : {}),
    };
    return role === APP_ROLES.B2C_DRIVER ? attachDriverKyc(base, data) : base;
  }

  if (collection === 'customers') {
    return {
      uid: firebaseUser.uid,
      phone,
      role: APP_ROLES.B2C_CLIENT,
      name: String(data.fullName || data.name || 'Customer'),
      ...(data.photoURL ? { photoURL: String(data.photoURL) } : {}),
    };
  }

  if (collection === 'drivers') {
    return attachDriverKyc(
      {
        uid: firebaseUser.uid,
        phone,
        role: APP_ROLES.B2C_DRIVER,
        name: String(data.fullName || data.name || 'Driver'),
        ...(data.photoURL ? { photoURL: String(data.photoURL) } : {}),
        vehicleType: data.vehicleType ? String(data.vehicleType) : undefined,
        vehicleOption: data.vehicleSize ? String(data.vehicleSize) : undefined,
        plateNumber: data.plateNumber ? String(data.plateNumber) : undefined,
        nationalId: data.nationalId ? String(data.nationalId) : undefined,
        registrationSerial: data.registrationSerial
          ? String(data.registrationSerial)
          : undefined,
      },
      data
    );
  }

  if (collection === 'corporates') {
    return {
      uid: firebaseUser.uid,
      phone,
      role: APP_ROLES.B2B_CORPORATE,
      name: String(data.contactName || data.name || 'Corporate'),
      companyName: String(data.companyName || ''),
      commercialRegistration: data.commercialRegistration
        ? String(data.commercialRegistration)
        : undefined,
    };
  }

  return {
    uid: firebaseUser.uid,
    phone,
    role: APP_ROLES.B2B_OPERATOR,
    name: String(data.contactName || data.name || 'Operator'),
    companyName: String(data.companyName || ''),
    commercialRegistration: data.commercialRegistration
      ? String(data.commercialRegistration)
      : undefined,
  };
}

/**
 * Resolves the signed-in user's role/profile from Firestore (with cache fallback).
 * Admin ONLY for the sole allowlisted phone (+966541330720 / 0541330720).
 *
 * Priority: admin allowlist → users/{uid} → customers → drivers → corporates → operators → cache
 */
export async function resolveUserProfile(firebaseUser: User): Promise<UserProfile | null> {
  try {
    const adminProfile = await resolveAdminProfile(firebaseUser.uid);
    if (adminProfile) {
      return adminProfile;
    }
  } catch (err) {
    console.warn('[resolveUserProfile] admin resolve failed:', err);
  }

  await ensureFirebaseReady();

  try {
    const collections = [
      'users',
      'customers',
      'drivers',
      'corporates',
      'operators',
    ] as const;

    for (const collection of collections) {
      const snap = await getDoc(doc(db, collection, firebaseUser.uid));
      const resolved = readFirestoreProfile(firebaseUser, collection, snap);
      if (resolved) {
        let normalized: UserProfile = {
          ...resolved,
          role: normalizeAppRole(resolved.role) ?? resolved.role,
        };
        if (normalized.role === APP_ROLES.B2C_DRIVER && collection !== 'drivers') {
          try {
            const driverSnap = await getDoc(doc(db, 'drivers', firebaseUser.uid));
            if (driverSnap.exists()) {
              normalized = attachDriverKyc(
                normalized,
                driverSnap.data() as Record<string, unknown>
              );
            }
          } catch (err) {
            console.warn('[resolveUserProfile] drivers companion read failed:', err);
          }
        }
        saveCachedProfile(normalized);
        return normalized;
      }
    }
  } catch (err) {
    console.warn('[resolveUserProfile] Firestore read failed (App Check / rules):', err);
  }

  const cached = loadCachedProfile(firebaseUser.uid);
  if (cached) {
    const role = normalizeAppRole(cached.role);
    // Never restore admin from local cache — ACL must be revalidated.
    if (role === APP_ROLES.ADMIN || cached.role === APP_ROLES.ADMIN) {
      return null;
    }
    if (role) {
      return { ...cached, role };
    }
    return cached;
  }

  return null;
}
