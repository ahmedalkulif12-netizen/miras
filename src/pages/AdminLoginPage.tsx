import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Shield, Phone, Lock, LogIn, ChevronLeft } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { usePostLoginRedirect } from '@/hooks/usePostLoginRedirect';
import { getRoleHomePath } from '@/lib/authRouting';
import { isValidSaudiPhoneInput, toFirebasePhoneE164 } from '@/lib/phoneUtils';
import { AdminAccessDeniedError, isAuthorizedAdminPhone } from '@/lib/adminAuth';
import { getPhoneAuthErrorCode, getPhoneAuthErrorMessage } from '@/lib/phoneAuthErrors';
import { PhoneAuthRecaptcha } from '@/components/PhoneAuthRecaptcha';
import { DevBypassPanel } from '@/components/DevBypassPanel';
import { APP_ROLES } from '@/domain/user-schema';
import { useTranslation } from 'react-i18next';

/**
 * Admin login — phone OTP in production.
 * Localhost may use DevBypassPanel when VITE_ENABLE_DEV_AUTH_BYPASS=true.
 */
const AdminLoginPage: React.FC = () => {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { loginAdminWithPhone, verifyAdminOtp, resendOtp, hasPendingOtp, cancelPhoneOtpFlow } = useAuth();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  usePostLoginRedirect();

  useEffect(() => {
    if (hasPendingOtp) {
      setStep('otp');
    }
  }, [hasPendingOtp]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const onLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '[::1]');

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidSaudiPhoneInput(phone)) {
      toast.error('Enter a valid Saudi mobile number');
      return;
    }

    if (onLocalhost) {
      toast.error(
        `Phone Auth requires http://127.0.0.1:${window.location.port || '3000'}/admin/login`
      );
      return;
    }

    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      // Normalize once so Auth always receives E.164 (+9665…).
      const phoneE164 = toFirebasePhoneE164(phone);
      // Client gate — server still enforces the same allowlist.
      if (!isAuthorizedAdminPhone(phoneE164)) {
        toast.error('This phone number is not authorized for Miras Admin');
        return;
      }
      await loginAdminWithPhone(phoneE164);
      setStep('otp');
      setResendCooldown(30);
      toast.success('Verification code sent');
    } catch (error) {
      if (error instanceof AdminAccessDeniedError) {
        toast.error(error.message || 'This phone number is not authorized for Miras Admin');
        return;
      }
      console.error('[AdminLogin] OTP send failed:', getPhoneAuthErrorCode(error), error);
      toast.error(getPhoneAuthErrorMessage(error, 'en'));
      if (getPhoneAuthErrorCode(error) === 'ALREADY_AUTHENTICATED') {
        return;
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) {
      return;
    }

    const code = otp.replace(/\D/g, '');
    if (code.length < 6) {
      toast.error('Enter the 6-digit verification code');
      return;
    }

    try {
      setIsSubmitting(true);
      const resolvedProfile = await verifyAdminOtp(code);
      toast.success('Admin access granted');
      navigate(getRoleHomePath(resolvedProfile), { replace: true });
    } catch (error) {
      if (error instanceof AdminAccessDeniedError) {
        toast.error('This account is not authorized for admin access');
      } else {
        const errCode = getPhoneAuthErrorCode(error);
        toast.error(getPhoneAuthErrorMessage(error, 'en'));
        if (
          errCode === 'auth/code-expired' ||
          errCode === 'auth/session-expired' ||
          errCode === 'auth/invalid-verification-id' ||
          errCode === 'NO_OTP_SESSION' ||
          errCode === 'OTP_CONFIRM_TIMEOUT'
        ) {
          setOtp('');
          setResendCooldown(0);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (isSubmitting || resendCooldown > 0) {
      return;
    }

    try {
      setIsSubmitting(true);
      await resendOtp();
      setOtp('');
      setResendCooldown(30);
      toast.success('A new verification code was sent');
    } catch (error) {
      console.error('[AdminLogin] OTP resend failed:', getPhoneAuthErrorCode(error), error);
      toast.error(getPhoneAuthErrorMessage(error, 'en'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--color-background)] p-6 sm:p-8">
      <PhoneAuthRecaptcha />

      <div className="max-w-md w-full flex flex-col gap-8 bg-white p-10 rounded-[40px] shadow-xl border border-stone-100">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <BrandLogo size={36} withChip withWordmark />
              <span className="text-sm font-black text-neutral-400 tracking-widest uppercase">Admin</span>
            </div>
            <LanguageToggle />
          </div>
          <div className="bg-primary/5 p-6 rounded-3xl border border-primary/20 flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center text-black">
              <Shield size={24} />
            </div>
            <div className="text-center">
              <h4 className="font-bold text-neutral-900">Secure Admin Portal</h4>
              <p className="text-[10px] text-neutral-400 font-bold tracking-widest uppercase">
                Authorized operators only
              </p>
            </div>
          </div>
        </div>

        <DevBypassPanel onlyRole={APP_ROLES.ADMIN} isRtl={isRtl} />

        {onLocalhost && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-xs font-bold leading-relaxed">
            Firebase blocks Phone Auth on localhost. Open{' '}
            <a
              className="underline"
              href={`http://127.0.0.1:${window.location.port || '3000'}/admin/login`}
            >
              http://127.0.0.1:{window.location.port || '3000'}/admin/login
            </a>
            .
          </div>
        )}

        {step === 'phone' ? (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handlePhoneSubmit}
            className="flex flex-col gap-6"
          >
            <div className="space-y-2">
              <label className="text-sm font-bold text-neutral-700">Phone number</label>
              <div className="relative">
                <Phone className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-300" size={18} />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="05xxxxxxxx"
                  className="w-full pr-12 pl-4 py-4 rounded-2xl border border-stone-200 outline-none font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || onLocalhost}
              className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? 'Sending…' : 'Send OTP'}
              <LogIn size={20} className="text-primary" />
            </button>

            <Link to="/" className="text-center text-sm text-neutral-400 font-bold hover:text-neutral-900">
              Back to home
            </Link>
          </motion.form>
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleOtpSubmit}
            className="flex flex-col gap-6"
          >
            <button
              type="button"
              onClick={async () => {
                await cancelPhoneOtpFlow();
                setStep('phone');
                setOtp('');
                setResendCooldown(0);
              }}
              disabled={isSubmitting}
              className="flex items-center gap-2 text-sm text-neutral-400 font-bold"
            >
              <ChevronLeft size={16} className="rotate-180" /> Change number ({phone})
            </button>

            <div className="space-y-2">
              <label className="text-sm font-bold text-neutral-700">Verification code</label>
              <div className="relative">
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-300" size={18} />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full pr-12 pl-4 py-4 rounded-2xl border border-stone-200 outline-none text-center tracking-[0.5em] font-black text-xl"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? 'Verifying…' : 'Sign in as Admin'}
              <LogIn size={20} className="text-primary" />
            </button>

            <button
              type="button"
              onClick={() => void handleResendOtp()}
              disabled={isSubmitting || resendCooldown > 0}
              className="w-full py-3 text-sm font-bold text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </motion.form>
        )}
      </div>
    </div>
  );
};

export default AdminLoginPage;
