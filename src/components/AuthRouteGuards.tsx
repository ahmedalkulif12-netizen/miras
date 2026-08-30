import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { buildLoginRedirectPath, getRoleHomePath, resolvePostLoginPath } from '@/lib/authRouting';
import { probeAdminAccess, isAuthorizedAdminPhone } from '@/lib/adminAuth';
import { BrandLogo } from '@/components/BrandLogo';
import {
  APP_ROLES,
  normalizeAppRole,
  type AppRole,
} from '@/domain/user-schema';

/** How long guards may wait for a profile before recovering from a half-auth trap. */
const PROFILE_RESOLVE_TIMEOUT_MS = 45_000;
/** Admin ACL probe must not hang forever (network / App Check stalls). */
const ADMIN_PROBE_TIMEOUT_MS = 12_000;

export const AuthLoadingScreen: React.FC = () => (
  <div className="flex items-center justify-center min-h-dvh bg-[#F8F9FB]">
    <div className="flex flex-col items-center gap-5">
      <BrandLogo size={72} withChip withWordmark wordmarkBelow />
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium text-neutral-600 animate-pulse">
        جاري التحميل... / Loading...
      </p>
    </div>
  </div>
);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label}_TIMEOUT`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Guest-only routes (login, admin login, marketing landing).
 *
 * Active Firebase session + profile → always redirect to role dashboard.
 * Login/OTP UI is only reachable after an explicit logout (no session).
 */
export const AuthGuestRoute: React.FC<{
  children: React.ReactNode;
  /** When false, render children during auth bootstrap (landing page). */
  waitForAuth?: boolean;
}> = ({ children, waitForAuth = true }) => {
  const { user, profile, loading, hasPendingOtp, needsOnboarding, pendingOnboarding } = useAuth();
  const location = useLocation();
  const [profileTimedOut, setProfileTimedOut] = useState(false);

  const onLoginPage =
    location.pathname === '/login' || location.pathname.startsWith('/login');
  const onAdminLogin = location.pathname === '/admin/login';

  // Mid-OTP challenge may briefly have a Firebase user before profile is written —
  // only treat as "stuck" when there is no pending OTP / onboarding intent.
  const stuckWithoutProfile = Boolean(
    user && !profile && !hasPendingOtp && !needsOnboarding
  );

  useEffect(() => {
    // Never clear a live Firebase session while auth bootstrap is still running.
    if (!stuckWithoutProfile || loading) {
      setProfileTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      console.warn(
        '[AuthGuestRoute] profile resolve timed out — keeping Firebase session; showing login after soft timeout'
      );
      // Soft recovery: do NOT signOut. Persisted Auth tokens must survive refresh.
      // User can finish restore on next navigation or explicit logout.
      setProfileTimedOut(true);
    }, PROFILE_RESOLVE_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [stuckWithoutProfile, loading]);

  if (loading) {
    return waitForAuth ? <AuthLoadingScreen /> : <>{children}</>;
  }

  // Hard rule: signed-in users with a role profile never see login/landing/OTP.
  if (user && profile) {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={resolvePostLoginPath(profile, next)} replace />;
  }

  // OTP-verified new users must complete registration on /login — do not spin.
  if (needsOnboarding || hasPendingOtp) {
    if (!onLoginPage && !onAdminLogin) {
      return (
        <Navigate
          to={buildLoginRedirectPath({
            requiredRole: pendingOnboarding?.intendedRole,
            mode: needsOnboarding ? 'register' : 'login',
          })}
          replace
        />
      );
    }
    return <>{children}</>;
  }

  // Signed in but profile still resolving — avoid flashing login.
  if (stuckWithoutProfile && !profileTimedOut) {
    return <AuthLoadingScreen />;
  }

  return <>{children}</>;
};

/**
 * Role-gated route guard.
 *
 * Unauthenticated users are sent to login with role + return path so that after
 * OTP they land on the intended operational screen (e.g. customer services grid).
 *
 * Admin routes re-validate against the server (`/api/admin/me`) so stale claims
 * or non-ACL phones cannot keep the admin UI open.
 */
export const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  /** Required canonical role (or omit to allow any authenticated user). */
  role?: AppRole;
}> = ({ children, role }) => {
  // Soft recovery never calls logout — keep Firebase Auth persistence intact.
  const { user, profile, loading, isAdmin, isDevBypass, logout, needsOnboarding } = useAuth();
  const location = useLocation();
  const [adminGate, setAdminGate] = useState<'idle' | 'checking' | 'ok' | 'denied'>(
    role === APP_ROLES.ADMIN ? 'checking' : 'idle'
  );
  const [profileTimedOut, setProfileTimedOut] = useState(false);

  const stuckWithoutProfile = Boolean(user && !profile && !needsOnboarding);

  useEffect(() => {
    if (!stuckWithoutProfile || loading) {
      setProfileTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      console.warn(
        '[ProtectedRoute] profile resolve timed out — redirecting without destroying Firebase session'
      );
      // Soft recovery only: do not logout/signOut on slow Firestore/App Check.
      setProfileTimedOut(true);
    }, PROFILE_RESOLVE_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [stuckWithoutProfile, loading]);

  useEffect(() => {
    if (role !== APP_ROLES.ADMIN) {
      setAdminGate('idle');
      return;
    }

    if (loading || !user || !profile) {
      return;
    }

    const userRole = normalizeAppRole(profile.role) ?? profile.role;
    if (!isAdmin || userRole !== APP_ROLES.ADMIN) {
      setAdminGate('denied');
      return;
    }

    // Allowlisted super-admin phone — never blocked by /api/admin/me (Hosting may lack API).
    if (isAuthorizedAdminPhone(user.phoneNumber) || isAuthorizedAdminPhone(profile.phone)) {
      setAdminGate('ok');
      return;
    }

    // Localhost developer bypass — skip live /api/admin/me (no Firebase token).
    if (isDevBypass) {
      setAdminGate('ok');
      return;
    }

    let cancelled = false;
    setAdminGate('checking');

    void (async () => {
      try {
        await withTimeout(probeAdminAccess(), ADMIN_PROBE_TIMEOUT_MS, 'ADMIN_PROBE');
        if (!cancelled) setAdminGate('ok');
      } catch (error) {
        console.warn('[ProtectedRoute] admin ACL probe failed:', error);
        if (!cancelled) {
          setAdminGate('denied');
          try {
            await logout();
          } catch {
            /* ignore */
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, loading, user, profile, isAdmin, isDevBypass, logout]);

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (needsOnboarding) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={buildLoginRedirectPath({
          requiredRole: role,
          returnTo,
          mode: 'register',
        })}
        replace
      />
    );
  }

  if (stuckWithoutProfile && !profileTimedOut) {
    return <AuthLoadingScreen />;
  }

  if (!user || !profile) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={buildLoginRedirectPath({ requiredRole: role, returnTo })}
        replace
      />
    );
  }

  const userRole = normalizeAppRole(profile.role) ?? profile.role;

  if (role === APP_ROLES.ADMIN) {
    if (adminGate === 'checking') {
      return <AuthLoadingScreen />;
    }
    if (adminGate === 'denied' || !isAdmin || userRole !== APP_ROLES.ADMIN) {
      return <Navigate to="/admin/login" replace />;
    }
  } else if (role && userRole !== role) {
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }

  return <>{children}</>;
};

/** Unknown URLs: signed-in users go to their role home instead of the public landing page. */
export const CatchAllRedirect: React.FC = () => {
  const { user, profile, loading, needsOnboarding } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (needsOnboarding) {
    return <Navigate to={buildLoginRedirectPath({ mode: 'register' })} replace />;
  }

  if (user && profile) {
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }

  return <Navigate to="/" replace />;
};
