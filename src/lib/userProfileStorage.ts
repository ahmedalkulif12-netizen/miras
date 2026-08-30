import type { UserProfile } from '@/lib/userProfile';
import { isAdminRole, normalizeAppRole } from '@/domain/user-schema';
import { readStorageWithLegacy } from '@/lib/storageMigration';

const PROFILE_KEY = 'miras_profile';
const LEGACY_PROFILE_KEY = 'hamoula_profile';

/** Profile cache only — never used as authentication proof. */
export function loadCachedProfile(expectedUid: string): UserProfile | null {
  try {
    const raw = readStorageWithLegacy(localStorage, PROFILE_KEY, LEGACY_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (parsed.uid !== expectedUid) {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(LEGACY_PROFILE_KEY);
      return null;
    }
    // Admin role must never be restored from client cache (P0-14).
    if (isAdminRole(parsed.role)) {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(LEGACY_PROFILE_KEY);
      return null;
    }
    const role = normalizeAppRole(parsed.role);
    if (!role || isAdminRole(role)) {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(LEGACY_PROFILE_KEY);
      return null;
    }
    return { ...parsed, role };
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(LEGACY_PROFILE_KEY);
    return null;
  }
}

export function saveCachedProfile(profile: UserProfile): void {
  if (isAdminRole(profile.role)) return;
  const role = normalizeAppRole(profile.role) ?? profile.role;
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, role }));
  localStorage.removeItem(LEGACY_PROFILE_KEY);
}

export function clearCachedProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_PROFILE_KEY);
  localStorage.removeItem('user');
  localStorage.removeItem('isAuthenticated');
}
