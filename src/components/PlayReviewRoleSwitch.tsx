import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { APP_ROLES } from '@/domain/user-schema';
import { getRoleHomePath } from '@/lib/authRouting';
import { parsePlayReviewRole, type PlayReviewRole } from '@/lib/playReviewAuth';

/**
 * Store-reviewer only: switch the same 0500000000 account between Customer and Driver.
 */
export const PlayReviewRoleSwitch: React.FC = () => {
  const { profile, switchPlayReviewRole } = useAuth();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const [busy, setBusy] = useState(false);

  if (!profile?.playReview) return null;

  const current = parsePlayReviewRole(profile.role);

  const switchTo = async (role: PlayReviewRole) => {
    if (role === current || busy) return;
    setBusy(true);
    try {
      const next = await switchPlayReviewRole(role);
      toast.success(
        role === APP_ROLES.B2C_DRIVER
          ? isRtl
            ? 'تم التحويل إلى لوحة السائق'
            : 'Switched to the driver panel'
          : isRtl
            ? 'تم التحويل إلى لوحة العميل'
            : 'Switched to the customer panel'
      );
      navigate(getRoleHomePath(next), { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 ${
        isRtl ? 'text-right' : 'text-left'
      }`}
    >
      <p className="text-xs font-bold mb-2">
        {isRtl
          ? 'حساب تجريبي (0500000000) — اختر لوحة التحكم'
          : 'Review account (0500000000) — choose a control panel'}
      </p>
      <div className={`flex gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void switchTo(APP_ROLES.B2C_CLIENT)}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
            current === APP_ROLES.B2C_CLIENT
              ? 'bg-black text-white'
              : 'bg-white text-neutral-700 border border-stone-200'
          }`}
        >
          {isRtl ? 'عميل' : 'Customer'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void switchTo(APP_ROLES.B2C_DRIVER)}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
            current === APP_ROLES.B2C_DRIVER
              ? 'bg-black text-white'
              : 'bg-white text-neutral-700 border border-stone-200'
          }`}
        >
          {isRtl ? 'سائق' : 'Driver'}
        </button>
      </div>
    </div>
  );
};
