import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth';
import { auth, ensureFirebaseReady } from '@/lib/firebase';
import { sendPhoneOtp, confirmPhoneOtp, resetPhoneAuthFlow } from '@/lib/phoneAuth';
import {
  loadCachedProfile,
  saveCachedProfile,
  clearCachedProfile,
} from '@/lib/userProfileStorage';
import type { UserProfile, LoginRole } from '@/lib/userProfile';
import { syncUserProfileToFirestore } from '@/lib/syncUserProfile';
import { submitDriverRegistrationToApi } from '@/lib/submitDriverRegistration';
import { deleteAccountSecure } from '@/lib/accountService';
import { restorePersistedUserProfile } from '@/lib/restorePersistedSession';
import { resolveUserProfile } from '@/lib/resolveUserProfile';
import {
  establishAdminSession,
  establishUserSession,
  AdminAccessDeniedError,
  buildSuperAdminProfile,
  isAuthorizedAdminPhone,
} from '@/lib/adminAuth';
import {
  normalizePhoneE164,
  resolvePostOtpAuth,
  type AuthEntryMode,
} from '@/lib/authRouting';
import {
  clearAllOnboardingState,
  loadPendingOnboarding,
  resolveOnboardingIntent,
  saveLoginIntent,
  savePendingOnboarding,
  type PendingOnboarding,
} from '@/lib/pendingOnboarding';
import {
  APP_ROLES,
  isRegistrableRole,
  normalizeAppRole,
  type AppRole,
} from '@/domain/user-schema';
import {
  buildDevBypassProfile,
  clearDevBypassProfile,
  clearLocalGuestRole,
  createDevBypassUser,
  isDevAuthBypassEnabled,
  consumePendingGuestRole,
  loadDevBypassProfile,
  resolveGuestRole,
  saveDevBypassProfile,
  saveLocalGuestRole,
  savePendingGuestRole,
} from '@/lib/devAuthBypass';

export type { UserProfile };
export { AdminAccessDeniedError };

function getAlreadyAuthCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: string }).code || '') || null;
  }
  return null;
}

interface PendingRegistration {
  phone: string;
  phoneE164: string;
  role: LoginRole;
}

export type VerifyOtpResult =
  | { isNewUser: false; profile: UserProfile }
  | { isNewUser: true; profile: null; intendedRole: LoginRole };

interface PendingAdminLogin {
  phone: string;
  phoneE164: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  /** True after OTP SMS was sent and before verify succeeds or flow is reset. */
  hasPendingOtp: boolean;
  isAdmin: boolean;
  /** True when using temporary local screenshot bypass (no Firebase OTP). */
  isDevBypass: boolean;
  /**
   * Start phone OTP. Does not create a profile — after verify, existing users
   * go to their dashboard and new users complete registration.
   */
  loginWithPhone: (
    phone: string,
    role: LoginRole,
    recaptchaContainerId?: string,
    mode?: AuthEntryMode
  ) => Promise<void>;
  loginAdminWithPhone: (phone: string, recaptchaContainerId?: string) => Promise<void>;
  /**
   * Completes OTP, then looks up Firestore.
   * Existing UID/phone → session + profile (skip onboarding).
   * Brand-new user → pending onboarding (no Firestore write yet).
   */
  verifyOtp: (otp: string) => Promise<VerifyOtpResult>;
  verifyAdminOtp: (otp: string) => Promise<UserProfile>;
  /** New users only — writes Firestore profile after the registration form. */
  completeRegistration: (input: {
    role: LoginRole;
    name: string;
    extraData?: Partial<UserProfile>;
  }) => Promise<UserProfile>;
  /** Re-sends SMS once for the current pending OTP session (same phone). */
  resendOtp: () => Promise<void>;
  /** True when Firebase session + role profile are ready (skip login/OTP). */
  isAuthenticated: boolean;
  /** OTP-verified Firebase user with no Firestore profile yet. */
  needsOnboarding: boolean;
  pendingOnboarding: PendingOnboarding | null;
  /**
   * Instant mock login for localhost E2E testing (skips Phone Auth / reCAPTCHA / SMS).
   * Supports all AppRoles including admin. Only when `isDevAuthBypassEnabled()`.
   */
  loginAsDevBypass: (role: AppRole) => Promise<UserProfile>;
  /** Merge profile fields locally + Firestore (drivers/clients updating their data). */
  updateProfile: (patch: Partial<UserProfile>) => Promise<UserProfile>;
  cancelPhoneOtpFlow: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDevBypass, setIsDevBypass] = useState(false);
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistration | null>(null);
  const [pendingAdminLogin, setPendingAdminLogin] = useState<PendingAdminLogin | null>(null);
  const [pendingOnboarding, setPendingOnboarding] = useState<PendingOnboarding | null>(
    () => loadPendingOnboarding()
  );

  const beginOnboarding = useCallback((value: PendingOnboarding) => {
    savePendingOnboarding(value);
    setPendingOnboarding(value);
  }, []);

  const clearOnboarding = useCallback(() => {
    clearAllOnboardingState();
    setPendingOnboarding(null);
  }, []);

  const applyDevBypass = useCallback((bypassProfile: UserProfile) => {
    const stub = createDevBypassUser(bypassProfile);
    saveDevBypassProfile(bypassProfile);
    saveCachedProfile(bypassProfile);
    setUser(stub);
    setProfile(bypassProfile);
    setIsDevBypass(true);
    setPendingRegistration(null);
    setPendingAdminLogin(null);
    clearAllOnboardingState();
    setPendingOnboarding(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      // Restore screenshot bypass session before Firebase settles (avoids login flash).
      if (isDevAuthBypassEnabled()) {
        const bypass = loadDevBypassProfile();
        if (bypass && !cancelled) {
          applyDevBypass(bypass);
        }
      }

      try {
        await ensureFirebaseReady();
      } catch (err) {
        console.error('[auth] Firebase bootstrap failed:', err);
      }

      if (cancelled) {
        return;
      }

      // Firebase Auth state → immediately resolve role from Firestore / cache
      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          if (isDevAuthBypassEnabled() && firebaseUser.isAnonymous) {
            const guestRole = resolveGuestRole(firebaseUser.uid);
            consumePendingGuestRole();
            if (guestRole) {
              const guestProfile = {
                ...buildDevBypassProfile(guestRole),
                uid: firebaseUser.uid,
              };
              saveDevBypassProfile(guestProfile);
              saveLocalGuestRole(firebaseUser.uid, guestRole);
              saveCachedProfile(guestProfile);
              setUser(firebaseUser);
              setProfile(guestProfile);
              setIsDevBypass(true);
              setPendingRegistration(null);
              setPendingAdminLogin(null);
              clearAllOnboardingState();
              setPendingOnboarding(null);
              setLoading(false);
              if (isRegistrableRole(guestRole)) {
                void syncUserProfileToFirestore(guestProfile).catch((err) =>
                  console.warn('[auth] guest profile sync failed:', err)
                );
              }
              return;
            }
            // Leftover anonymous session without a chosen guest role.
            void signOut(auth).catch(() => undefined);
            return;
          }

          // Real phone/OTP auth wins over a stub-only bypass.
          clearDevBypassProfile();
          setIsDevBypass(false);
          setUser(firebaseUser);

          // Allowlisted admin: restore instantly from phone (no cache, no OTP).
          if (isAuthorizedAdminPhone(firebaseUser.phoneNumber)) {
            const adminProfile = buildSuperAdminProfile(
              firebaseUser.uid,
              firebaseUser.phoneNumber
            );
            setProfile(adminProfile);
            setPendingRegistration(null);
            setPendingAdminLogin(null);
            clearAllOnboardingState();
            setPendingOnboarding(null);
          } else {
            const cached = loadCachedProfile(firebaseUser.uid);
            if (cached) {
              const role = normalizeAppRole(cached.role) ?? cached.role;
              setProfile({ ...cached, role });
              // Existing persisted session — abandon any in-memory OTP intent so
              // guest routes redirect to the dashboard instead of showing login.
              setPendingRegistration(null);
              setPendingAdminLogin(null);
              clearAllOnboardingState();
              setPendingOnboarding(null);
            }
          }

          try {
            const resolved = await restorePersistedUserProfile(firebaseUser);
            setProfile((prev) => {
              if (resolved) {
                const role = normalizeAppRole(resolved.role) ?? resolved.role;
                return { ...resolved, role };
              }
              if (prev?.uid === firebaseUser.uid) {
                return prev;
              }
              return null;
            });

            if (resolved) {
              // Confirmed session profile — do not allow OTP login UI to stay open.
              setPendingRegistration(null);
              setPendingAdminLogin(null);
              clearAllOnboardingState();
              setPendingOnboarding(null);
            } else if (!isAuthorizedAdminPhone(firebaseUser.phoneNumber)) {
              const cachedAfter = loadCachedProfile(firebaseUser.uid);
              if (!cachedAfter) {
                // OTP-verified (or persisted) Auth user with no Firestore profile —
                // keep the session and finish registration instead of sending another SMS.
                beginOnboarding(
                  resolveOnboardingIntent({
                    uid: firebaseUser.uid,
                    phone: firebaseUser.phoneNumber,
                  })
                );
              }
            }

            if (resolved && isRegistrableRole(resolved.role)) {
              syncUserProfileToFirestore(resolved).catch((err) =>
                console.warn('users/{uid} sync failed:', err)
              );
              establishUserSession(resolved.role).catch((err) =>
                console.warn('[auth] background session refresh failed:', err)
              );
            }
          } catch (err) {
            console.warn('[auth] profile restore failed:', err);
            setProfile((prev) => {
              if (prev?.uid === firebaseUser.uid) {
                return prev;
              }
              const fallback = loadCachedProfile(firebaseUser.uid);
              if (fallback) {
                const role = normalizeAppRole(fallback.role) ?? fallback.role;
                // Never restore admin from cache after a failed resolve.
                if (role === APP_ROLES.ADMIN) {
                  return null;
                }
                return { ...fallback, role };
              }
              return null;
            });
          }
        } else {
          // Keep localhost screenshot session if Firebase has no user
          const bypass = loadDevBypassProfile();
          if (bypass && isDevAuthBypassEnabled()) {
            applyDevBypass(bypass);
            return;
          }
          setIsDevBypass(false);
          setUser(null);
          setProfile(null);
        }

        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [applyDevBypass, beginOnboarding]);

  /**
   * Active Firebase sessions must not request a new OTP.
   * User must explicitly logout before logging in again.
   */
  const assertCanRequestOtp = async (): Promise<void> => {
    await ensureFirebaseReady();
    const current = auth.currentUser;
    if (!current) {
      return;
    }

    // Allowlisted admin session is always "already authenticated" — never re-OTP.
    if (isAuthorizedAdminPhone(current.phoneNumber)) {
      const adminProfile = buildSuperAdminProfile(current.uid, current.phoneNumber);
      setUser(current);
      setProfile(adminProfile);
      setPendingRegistration(null);
      setPendingAdminLogin(null);
      clearOnboarding();
      throw Object.assign(new Error('ALREADY_AUTHENTICATED'), {
        code: 'ALREADY_AUTHENTICATED',
        profile: adminProfile,
      });
    }

    const cached = loadCachedProfile(current.uid);
    if (cached) {
      const role = normalizeAppRole(cached.role) ?? cached.role;
      setUser(current);
      setProfile({ ...cached, role });
      setPendingRegistration(null);
      setPendingAdminLogin(null);
      clearOnboarding();
      throw Object.assign(new Error('ALREADY_AUTHENTICATED'), {
        code: 'ALREADY_AUTHENTICATED',
        profile: { ...cached, role },
      });
    }

    try {
      const resolved = await restorePersistedUserProfile(current);
      if (resolved) {
        const role = normalizeAppRole(resolved.role) ?? resolved.role;
        const profileWithRole = { ...resolved, role };
        setUser(current);
        setProfile(profileWithRole);
        if (isRegistrableRole(profileWithRole.role)) {
          saveCachedProfile(profileWithRole);
        }
        setPendingRegistration(null);
        setPendingAdminLogin(null);
        clearOnboarding();
        throw Object.assign(new Error('ALREADY_AUTHENTICATED'), {
          code: 'ALREADY_AUTHENTICATED',
          profile: profileWithRole,
        });
      }
    } catch (error) {
      if (getAlreadyAuthCode(error) === 'ALREADY_AUTHENTICATED') {
        throw error;
      }
      console.warn('[auth] assertCanRequestOtp profile probe failed:', error);
    }

    // Firebase session exists but no role profile — finish registration, do not send OTP.
    setUser(current);
    setProfile(null);
    setPendingRegistration(null);
    setPendingAdminLogin(null);
    beginOnboarding(
      resolveOnboardingIntent({
        uid: current.uid,
        phone: current.phoneNumber,
      })
    );
    throw Object.assign(new Error('NEEDS_ONBOARDING'), {
      code: 'NEEDS_ONBOARDING',
    });
  };

  const loginWithPhone = async (
    phone: string,
    role: LoginRole,
    recaptchaContainerId?: string,
    mode?: AuthEntryMode
  ) => {
    // Do not toggle global `loading` here — AuthGuestRoute unmounts login pages while
    // loading is true, which drops local step state before setStep('otp') can run.
    await assertCanRequestOtp();
    const phoneE164 = await sendPhoneOtp(phone, recaptchaContainerId);
    saveLoginIntent(role, phoneE164, mode);
    setPendingRegistration({ phone, phoneE164, role });
    setPendingAdminLogin(null);
  };

  const loginAdminWithPhone = async (phone: string, recaptchaContainerId?: string) => {
    await assertCanRequestOtp();
    // Reject before SMS so unauthorized numbers never receive an admin OTP.
    if (!isAuthorizedAdminPhone(phone)) {
      throw new AdminAccessDeniedError('This phone number is not authorized for Miras Admin');
    }
    const phoneE164 = await sendPhoneOtp(phone, recaptchaContainerId);
    setPendingAdminLogin({ phone, phoneE164 });
    setPendingRegistration(null);
  };

  /** One SMS for the current pending phone — used by Resend OTP (cooldown enforced in UI). */
  const resendOtp = async (): Promise<void> => {
    // Resend is only for an in-progress OTP challenge (not yet signed in).
    if (auth.currentUser) {
      throw Object.assign(new Error('ALREADY_AUTHENTICATED'), {
        code: 'ALREADY_AUTHENTICATED',
      });
    }
    if (pendingRegistration) {
      await sendPhoneOtp(pendingRegistration.phoneE164);
      return;
    }
    if (pendingAdminLogin) {
      await sendPhoneOtp(pendingAdminLogin.phoneE164);
      return;
    }
    throw Object.assign(new Error('NO_OTP_SESSION'), { code: 'NO_OTP_SESSION' });
  };

  const persistExistingSession = async (sessionProfile: UserProfile): Promise<UserProfile> => {
    const role = normalizeAppRole(sessionProfile.role) ?? sessionProfile.role;
    const profileWithRole = { ...sessionProfile, role };
    setProfile(profileWithRole);
    if (isRegistrableRole(profileWithRole.role)) {
      saveCachedProfile(profileWithRole);
    }
    setPendingRegistration(null);
    setPendingAdminLogin(null);
    clearOnboarding();

    if (isRegistrableRole(profileWithRole.role)) {
      try {
        await establishUserSession(profileWithRole.role);
      } catch (error) {
        console.warn('[auth] establishUserSession failed after OTP — continuing with local profile:', error);
      }
      try {
        await syncUserProfileToFirestore(profileWithRole);
      } catch (error) {
        console.warn('[auth] users/{uid} sync failed after OTP:', error);
      }
    }

    return profileWithRole;
  };

  const verifyOtp = async (otp: string): Promise<VerifyOtpResult> => {
    if (!pendingRegistration) {
      throw Object.assign(new Error('NO_OTP_SESSION'), { code: 'NO_OTP_SESSION' });
    }

    const pending = pendingRegistration;

    const firebaseUser = await confirmPhoneOtp(otp);
    setUser(firebaseUser);

    let existingProfile: UserProfile | null = null;
    try {
      existingProfile = await resolveUserProfile(firebaseUser);
    } catch (err) {
      console.warn('[auth] existing profile lookup failed after OTP:', err);
    }

    const decision = resolvePostOtpAuth({
      existingProfile,
      intendedRole: pending.role,
    });

    if (decision.kind === 'existing') {
      const profile = await persistExistingSession({
        ...decision.profile,
        uid: firebaseUser.uid,
        phone: decision.profile.phone || firebaseUser.phoneNumber || pending.phone,
      });
      return { isNewUser: false, profile };
    }

    // Brand-new user — do not write Firestore or ask for KYC until the form is submitted.
    beginOnboarding({
      uid: firebaseUser.uid,
      phone: firebaseUser.phoneNumber || pending.phoneE164 || pending.phone,
      intendedRole: decision.intendedRole,
    });
    setPendingRegistration(null);
    setProfile(null);
    return { isNewUser: true, profile: null, intendedRole: decision.intendedRole };
  };

  const completeRegistration = async (input: {
    role: LoginRole;
    name: string;
    extraData?: Partial<UserProfile>;
  }): Promise<UserProfile> => {
    const firebaseUser = auth.currentUser;
    const onboarding = pendingOnboarding || loadPendingOnboarding();
    if (!firebaseUser || !onboarding || onboarding.uid !== firebaseUser.uid) {
      throw Object.assign(new Error('NO_ONBOARDING_SESSION'), {
        code: 'NO_ONBOARDING_SESSION',
      });
    }

    const name = input.name.trim();
    if (name.length < 3) {
      throw Object.assign(new Error('INVALID_REGISTRATION_NAME'), {
        code: 'INVALID_REGISTRATION_NAME',
      });
    }

    const role: LoginRole = isRegistrableRole(input.role)
      ? input.role
      : onboarding.intendedRole;

    const newProfile: UserProfile = {
      uid: firebaseUser.uid,
      phone: firebaseUser.phoneNumber || onboarding.phone,
      role,
      name,
      ...(input.extraData || {}),
    };

    setProfile(newProfile);
    saveCachedProfile(newProfile);
    setUser(firebaseUser);
    setPendingRegistration(null);
    clearOnboarding();

    try {
      await establishUserSession(newProfile.role as LoginRole);
    } catch (error) {
      console.warn('[auth] establishUserSession failed after registration:', error);
    }

    try {
      await syncUserProfileToFirestore(newProfile);
    } catch (error) {
      console.warn('[auth] users/{uid} sync failed after registration:', error);
    }

    if (normalizeAppRole(newProfile.role) === APP_ROLES.B2C_DRIVER) {
      try {
        await submitDriverRegistrationToApi(newProfile);
      } catch (error) {
        console.warn('[auth] driver registration API upsert failed — retrying once:', error);
        try {
          await submitDriverRegistrationToApi(newProfile);
        } catch (retryError) {
          console.error('[auth] driver registration API upsert failed:', retryError);
        }
      }
    }

    return newProfile;
  };

  const verifyAdminOtp = async (otp: string): Promise<UserProfile> => {
    if (!pendingAdminLogin) {
      throw Object.assign(new Error('NO_OTP_SESSION'), { code: 'NO_OTP_SESSION' });
    }

    const pending = pendingAdminLogin;

    let firebaseUser;
    try {
      firebaseUser = await confirmPhoneOtp(otp);
    } catch (error) {
      throw error;
    }

    const authPhone =
      firebaseUser.phoneNumber || pending.phoneE164 || pending.phone;

    // Super-admin phone: grant immediately — never block on /api or Firestore ACL.
    if (isAuthorizedAdminPhone(authPhone)) {
      let sessionName = 'Miras Admin';
      let sessionPhone = normalizePhoneE164(authPhone);
      try {
        const session = await establishAdminSession();
        sessionName = session.name || sessionName;
        sessionPhone = session.phone || sessionPhone;
      } catch (err) {
        console.warn(
          '[verifyAdminOtp] establishAdminSession soft-fail for super-admin — continuing:',
          err
        );
      }

      const adminProfile: UserProfile = {
        uid: firebaseUser.uid,
        phone: sessionPhone,
        role: APP_ROLES.ADMIN,
        name: sessionName,
      };

      setProfile(adminProfile);
      setPendingAdminLogin(null);
      setUser(firebaseUser);
      return adminProfile;
    }

    // Any other phone is denied for admin portal.
    setPendingAdminLogin(null);
    setProfile(null);
    setUser(null);
    clearCachedProfile();
    try {
      await signOut(auth);
    } catch {
      /* ignore */
    }
    throw new AdminAccessDeniedError(
      'This account is not authorized for admin access'
    );
  };

  const cancelPhoneOtpFlow = useCallback(async () => {
    setPendingRegistration(null);
    setPendingAdminLogin(null);
    await resetPhoneAuthFlow();
  }, []);

  const loginAsDevBypass = useCallback(
    async (role: AppRole): Promise<UserProfile> => {
      if (!isDevAuthBypassEnabled()) {
        throw new Error('DEV_BYPASS_DISABLED');
      }

      await ensureFirebaseReady();
      savePendingGuestRole(role);

      try {
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
          await signOut(auth);
        }
        if (!auth.currentUser) {
          const credential = await signInAnonymously(auth);
          console.info('[auth] localhost guest session', credential.user.uid);
        }
      } catch (error) {
        console.warn(
          '[auth] Anonymous sign-in failed — enable Anonymous in Firebase Console, or add test phone numbers. Falling back to local stub (Firestore writes will fail).',
          error
        );
        const stubProfile = buildDevBypassProfile(role);
        applyDevBypass(stubProfile);
        return stubProfile;
      }

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        const stubProfile = buildDevBypassProfile(role);
        applyDevBypass(stubProfile);
        return stubProfile;
      }

      const guestProfile = {
        ...buildDevBypassProfile(role),
        uid: firebaseUser.uid,
      };
      saveLocalGuestRole(firebaseUser.uid, role);
      saveDevBypassProfile(guestProfile);
      saveCachedProfile(guestProfile);
      setUser(firebaseUser);
      setProfile(guestProfile);
      setIsDevBypass(true);
      setPendingRegistration(null);
      setPendingAdminLogin(null);
      clearAllOnboardingState();
      setPendingOnboarding(null);
      setLoading(false);
      if (isRegistrableRole(role)) {
        try {
          await syncUserProfileToFirestore(guestProfile);
        } catch (err) {
          console.warn('[auth] guest profile sync failed:', err);
        }
      }
      console.info('[auth] guest login ready', {
        uid: firebaseUser.uid,
        role,
        isAnonymous: firebaseUser.isAnonymous,
        authCurrentUser: Boolean(auth.currentUser),
      });
      return guestProfile;
    },
    [applyDevBypass, clearAllOnboardingState]
  );

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>): Promise<UserProfile> => {
      if (!profile) {
        throw new Error('NOT_AUTHENTICATED');
      }

      const next: UserProfile = {
        ...profile,
        ...patch,
        uid: profile.uid,
        role: profile.role,
        phone: profile.phone,
      };

      setProfile(next);
      saveCachedProfile(next);

      if (isDevBypass) {
        saveDevBypassProfile(next);
        return next;
      }

      try {
        await syncUserProfileToFirestore(next);
      } catch (error) {
        console.error('[useAuth] updateProfile Firestore sync failed:', error);
        // Keep local/cache update so the UI still reflects the change offline.
      }

      return next;
    },
    [profile, isDevBypass]
  );

  const logout = async () => {
    try {
      await cancelPhoneOtpFlow();
      const uid = auth.currentUser?.uid;
      clearDevBypassProfile();
      clearLocalGuestRole(uid);
      setIsDevBypass(false);
      if (auth.currentUser) {
        await signOut(auth);
      }
      clearCachedProfile();
      clearOnboarding();
      setProfile(null);
      setUser(null);
      setPendingRegistration(null);
      setPendingAdminLogin(null);
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear local screenshot session on logout errors
      clearDevBypassProfile();
      clearLocalGuestRole();
      setIsDevBypass(false);
      clearCachedProfile();
      clearOnboarding();
      setProfile(null);
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    if (isDevBypass) {
      await logout();
      return;
    }
    if (!auth.currentUser) {
      throw new Error('NOT_AUTHENTICATED');
    }

    try {
      await deleteAccountSecure();
      await resetPhoneAuthFlow();
      try {
        await signOut(auth);
      } catch (signOutError) {
        console.warn('signOut after deletion:', signOutError);
      }
      clearCachedProfile();
      clearOnboarding();
      setProfile(null);
      setUser(null);
      setPendingRegistration(null);
      setPendingAdminLogin(null);
    } catch (error) {
      throw error;
    }
  };

  const getIdToken = async (forceRefresh = false) => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken(forceRefresh);
  };

  const isAdmin = profile?.role === APP_ROLES.ADMIN;
  const hasPendingOtp = pendingRegistration !== null || pendingAdminLogin !== null;
  const needsOnboarding = Boolean(user && !profile && pendingOnboarding);
  const isAuthenticated = Boolean(user && profile);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        hasPendingOtp,
        isAdmin,
        isDevBypass,
        isAuthenticated,
        needsOnboarding,
        pendingOnboarding,
        loginWithPhone,
        loginAdminWithPhone,
        verifyOtp,
        verifyAdminOtp,
        completeRegistration,
        resendOtp,
        loginAsDevBypass,
        updateProfile,
        cancelPhoneOtpFlow,
        logout,
        deleteAccount,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
