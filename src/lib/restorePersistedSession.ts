import type { User } from 'firebase/auth';
import { resolveAdminProfile } from '@/lib/adminAuth';
import { resolveUserProfile } from '@/lib/resolveUserProfile';
import { loadCachedProfile, saveCachedProfile } from '@/lib/userProfileStorage';
import type { UserProfile } from '@/lib/userProfile';
import { APP_ROLES, isAdminRole, normalizeAppRole } from '@/domain/user-schema';
import {
  PLAY_REVIEW_NAME,
  PLAY_REVIEW_PHONE_E164,
  playReviewRoleFromTokenClaims,
} from '@/lib/playReviewAuth';

/**
 * Restores user profile when Firebase Auth persists the session across app opens.
 * Firestore is the source of truth for role — cache is only a fast fallback.
 */
export async function restorePersistedUserProfile(firebaseUser: User): Promise<UserProfile | null> {
  try {
    const adminProfile = await resolveAdminProfile(firebaseUser.uid);
    if (adminProfile) {
      return adminProfile;
    }
  } catch (err) {
    console.warn('[restorePersistedUserProfile] admin resolve failed:', err);
  }

  const cached = loadCachedProfile(firebaseUser.uid);

  try {
    const resolved = await resolveUserProfile(firebaseUser);
    let tokenClaims: Record<string, unknown> | null = null;
    try {
      tokenClaims = (await firebaseUser.getIdTokenResult()).claims as Record<string, unknown>;
    } catch {
      tokenClaims = null;
    }
    const reviewRole = playReviewRoleFromTokenClaims(tokenClaims);

    if (resolved) {
      const role = reviewRole ?? normalizeAppRole(resolved.role) ?? resolved.role;
      const normalized: UserProfile = {
        ...resolved,
        role,
        ...(reviewRole ? { playReview: true } : {}),
      };
      if (!isAdminRole(normalized.role)) {
        // Merge non-role fields from cache (name polish) but never override Firestore role
        // except the store-review account, whose role is minted on the ID token.
        const merged =
          cached && cached.uid === firebaseUser.uid
            ? {
                ...cached,
                ...normalized,
                role: normalized.role,
                ...(reviewRole ? { playReview: true } : {}),
              }
            : normalized;
        saveCachedProfile(merged);
        return merged;
      }
      return normalized;
    }

    if (reviewRole) {
      const seeded: UserProfile = {
        uid: firebaseUser.uid,
        phone: firebaseUser.phoneNumber || PLAY_REVIEW_PHONE_E164,
        role: reviewRole,
        name: cached?.name || PLAY_REVIEW_NAME,
        playReview: true,
        ...(reviewRole === APP_ROLES.B2C_DRIVER
          ? { vehicleType: cached?.vehicleType || 'flatbed', accountStatus: 'approved' }
          : { accountStatus: 'active' }),
      };
      saveCachedProfile(seeded);
      return seeded;
    }
  } catch (err) {
    console.warn('[restorePersistedUserProfile] Firestore resolve failed:', err);
  }

  if (cached) {
    const role = normalizeAppRole(cached.role) ?? cached.role;
    if (isAdminRole(role) || role === APP_ROLES.ADMIN) {
      return null;
    }
    return { ...cached, role };
  }

  return null;
}
