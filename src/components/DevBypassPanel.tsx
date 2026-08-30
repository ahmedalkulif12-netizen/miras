import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, User, Contact } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import { getRoleHomePath } from '@/lib/authRouting';
import {
  DEMO_LOGIN_ROLES,
  DEV_BYPASS_ROLES,
  isDevAuthBypassEnabled,
} from '@/lib/devAuthBypass';
import { APP_ROLES, ROLE_META, type AppRole } from '@/domain/user-schema';
import { B2B_MODULES_ENABLED, isB2bSurfaceRole } from '@/lib/launchFlags';

interface DevBypassPanelProps {
  /** When set, only show that role (e.g. admin page → admin only). */
  onlyRole?: AppRole;
  isRtl?: boolean;
  /** Compact strip for dashboard sidebars. */
  variant?: 'full' | 'compact';
}

/**
 * Local-only screenshot / demo login — never renders unless the bypass gate passes.
 * Signs in with Firebase Anonymous Auth so `auth.currentUser` is real when possible.
 */
export const DevBypassPanel: React.FC<DevBypassPanelProps> = ({
  onlyRole,
  isRtl = false,
  variant = 'full',
}) => {
  const { loginAsDevBypass, profile } = useAuth();
  const navigate = useNavigate();
  const [busyRole, setBusyRole] = useState<AppRole | null>(null);

  if (!isDevAuthBypassEnabled()) {
    return null;
  }

  const extraRoles = (onlyRole
    ? DEV_BYPASS_ROLES.filter((r) => r === onlyRole)
    : DEV_BYPASS_ROLES
  ).filter(
    (role) =>
      !DEMO_LOGIN_ROLES.includes(role as (typeof DEMO_LOGIN_ROLES)[number]) &&
      (B2B_MODULES_ENABLED || !isB2bSurfaceRole(role))
  );

  const showPrimary = !onlyRole || DEMO_LOGIN_ROLES.includes(onlyRole as (typeof DEMO_LOGIN_ROLES)[number]);
  const primaryRoles = onlyRole
    ? DEMO_LOGIN_ROLES.filter((r) => r === onlyRole)
    : [...DEMO_LOGIN_ROLES];

  const enterAs = async (role: AppRole) => {
    if (busyRole) return;
    if (profile?.role === role) {
      navigate(getRoleHomePath(profile), { replace: true });
      return;
    }
    setBusyRole(role);
    try {
      const nextProfile = await loginAsDevBypass(role);
      if (!auth.currentUser) {
        toast.warning(
          isRtl
            ? 'دخول تجريبي محلي بدون Firebase. لقطات المتجر تعمل، لكن حفظ الطلبات في Firestore قد يفشل.'
            : 'Local demo session (no Firebase). Screenshots work; Firestore order writes may fail.'
        );
      } else {
        toast.success(
          isRtl
            ? `دخول تجريبي: ${ROLE_META[role].labelAr}`
            : `Demo login: ${ROLE_META[role].labelEn}`
        );
      }
      navigate(getRoleHomePath(nextProfile), { replace: true });
    } catch (error) {
      console.error('[DevBypass] login failed:', error);
      toast.error(isRtl ? 'فشل الدخول التجريبي' : 'Demo login failed');
    } finally {
      setBusyRole(null);
    }
  };

  if (variant === 'compact') {
    return (
      <div
        className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-3 space-y-2"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <p className="text-[10px] font-black uppercase tracking-wide text-amber-900">
          {isRtl ? 'دخول تجريبي (محلي)' : 'Demo login (local)'}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {primaryRoles.map((role) => (
            <button
              key={role}
              type="button"
              disabled={Boolean(busyRole)}
              onClick={() => void enterAs(role)}
              className={`rounded-lg px-2 py-2 text-[11px] font-bold border transition-all disabled:opacity-60 ${
                profile?.role === role
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-amber-950 border-amber-200 hover:border-amber-400'
              }`}
            >
              {busyRole === role
                ? isRtl
                  ? '…'
                  : '…'
                : role === APP_ROLES.B2C_CLIENT
                  ? isRtl
                    ? 'عميل'
                    : 'Customer'
                  : isRtl
                    ? 'سائق'
                    : 'Driver'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-4 space-y-3"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className={`flex items-start gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <Camera size={18} className="text-amber-800 shrink-0 mt-0.5" />
        <div className={isRtl ? 'text-right' : 'text-left'}>
          <p className="text-xs font-black text-amber-950 uppercase tracking-wide">
            {isRtl ? 'دخول تجريبي — لقطات المتجر' : 'Demo login — store screenshots'}
          </p>
          <p className="text-[11px] font-medium text-amber-800 leading-relaxed mt-0.5">
            {isRtl
              ? 'دخول فوري بدون رمز SMS. يعمل على هذا الجهاز وعلى الجوال عبر شبكة Wi‑Fi المحلية. لا يظهر في نسخة المتجر.'
              : 'Instant login without SMS. Works on this PC and on your phone via local Wi‑Fi. Hidden in store builds.'}
          </p>
        </div>
      </div>

      {showPrimary && primaryRoles.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {primaryRoles.map((role) => {
            const isCustomer = role === APP_ROLES.B2C_CLIENT;
            return (
              <button
                key={role}
                type="button"
                disabled={Boolean(busyRole)}
                onClick={() => void enterAs(role)}
                className="w-full rounded-2xl px-4 py-3.5 text-sm font-black bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-60 active:scale-[0.98] transition-all"
              >
                <span className={`flex items-center justify-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                  {isCustomer ? <User size={16} /> : <Contact size={16} />}
                  {busyRole === role
                    ? isRtl
                      ? 'جاري الدخول…'
                      : 'Signing in…'
                    : isRtl
                      ? isCustomer
                        ? 'دخول تجريبي — عميل'
                        : 'دخول تجريبي — سائق'
                      : isCustomer
                        ? 'Demo Login — Customer'
                        : 'Demo Login — Driver'}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {extraRoles.length > 0 ? (
        <div className={`grid gap-2 ${onlyRole ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {extraRoles.map((role) => (
            <button
              key={role}
              type="button"
              disabled={Boolean(busyRole)}
              onClick={() => void enterAs(role)}
              className={`w-full rounded-xl px-3 py-2.5 text-xs font-bold border transition-all text-left disabled:opacity-60 ${
                role === APP_ROLES.ADMIN
                  ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800'
                  : 'bg-white text-amber-950 border-amber-200 hover:border-amber-400'
              } ${isRtl ? 'text-right' : 'text-left'}`}
            >
              {busyRole === role
                ? isRtl
                  ? 'جاري الدخول…'
                  : 'Signing in…'
                : isRtl
                  ? ROLE_META[role].labelAr
                  : ROLE_META[role].labelEn}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
