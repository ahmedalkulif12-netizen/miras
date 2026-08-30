import type { User } from 'firebase/auth';
import { resolveAdminProfile } from '@/lib/adminAuth';
import { resolveUserProfile } from '@/lib/resolveUserProfile';
import { loadCachedProfile, saveCachedProfile } from '@/lib/userProfileStorage';
import type { UserProfile } from '@/lib/userProfile';
import { APP_ROLES, isAdminRole, normalizeAppRole } from '@/domain/user-schema';

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
    if (resolved) {
      const role = normalizeAppRole(resolved.role) ?? resolved.role;
      const normalized = { ...resolved, role };
      if (!isAdminRole(normalized.role)) {
        // Merge non-role fields from cache (name polish) but never override Firestore role.
        const merged =
          cached && cached.uid === firebaseUser.uid
            ? {
                ...cached,
                ...normalized,
                role: normalized.role,
              }
            : normalized;
        saveCachedProfile(merged);
        return merged;
      }
      return normalized;
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
