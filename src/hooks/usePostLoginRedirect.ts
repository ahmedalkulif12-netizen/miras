import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isGuestAuthSurface, resolvePostLoginPath } from '@/lib/authRouting';

/**
 * Redirects away from guest/login routes once an active session + profile exist.
 * Honors a safe `?next=` return path when it belongs to the signed-in role home.
 *
 * Skip while `needsOnboarding` so new users can finish the registration form.
 */
export function usePostLoginRedirect(enabled = true): void {
  const { user, profile, loading, needsOnboarding, hasPendingOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');

  useEffect(() => {
    if (!enabled || loading || needsOnboarding || hasPendingOtp) {
      return;
    }
    if (!user || !profile) {
      return;
    }
    const dest = resolvePostLoginPath(profile, next);
    const destPath = dest.split('?')[0];
    const destSearch = dest.includes('?') ? dest.slice(dest.indexOf('?')) : '';
    if (location.pathname === destPath && location.search === destSearch) {
      return;
    }
    console.info('[auth] post-login redirect', {
      role: profile.role,
      from: `${location.pathname}${location.search}`,
      to: dest,
    });
    navigate(dest, { replace: true });
  }, [
    enabled,
    loading,
    needsOnboarding,
    hasPendingOtp,
    user,
    profile,
    navigate,
    next,
    location.pathname,
    location.search,
  ]);
}

/**
 * App-wide listener (Firebase session via AuthProvider / onAuthStateChanged).
 * Signed-in clients → /b2c/client, drivers → /b2c/driver, etc.
 * Never leaves an authenticated user on `/` or `/login`.
 */
export function useAuthSurfaceRedirect(): void {
  const { user, profile, loading, needsOnboarding, hasPendingOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');

  useEffect(() => {
    if (loading || !user || !profile || needsOnboarding || hasPendingOtp) {
      return;
    }
    if (!isGuestAuthSurface(location.pathname)) {
      return;
    }
    const dest = resolvePostLoginPath(profile, next);
    console.info('[auth] session redirect', {
      role: profile.role,
      from: location.pathname,
      to: dest,
    });
    navigate(dest, { replace: true });
  }, [
    loading,
    user,
    profile,
    needsOnboarding,
    hasPendingOtp,
    location.pathname,
    next,
    navigate,
  ]);
}
