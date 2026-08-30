import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePostLoginRedirect } from '@/hooks/usePostLoginRedirect';
import {
  parseAuthEntryMode,
  resolvePostLoginPath,
  type AuthEntryMode,
} from '@/lib/authRouting';
import { User, Contact, Phone, Lock, LogIn, UserPlus, ChevronLeft, Shield } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SERVICE_OPTIONS, OPTION_LABELS, SERVICE_KEY_MAP } from '@/constants';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
  stabilizeRecaptchaForOtpEntry,
} from '@/lib/phoneAuth';
import { isValidSaudiPhoneInput, toFirebasePhoneE164 } from '@/lib/phoneUtils';
import { getPhoneAuthErrorCode, getPhoneAuthErrorMessage } from '@/lib/phoneAuthErrors';
import { PhoneAuthRecaptcha } from '@/components/PhoneAuthRecaptcha';
import {
  EMPTY_DRIVER_DOCUMENTS,
  type DriverDocumentKey,
  type DriverDocumentUploadStatuses,
  type LoginRole,
  type UserProfile,
} from '@/lib/userProfile';
import { APP_ROLES, REGISTRABLE_ROLES, ROLE_META } from '@/domain/user-schema';
import { B2B_MODULES_ENABLED, isB2bSurfaceRole } from '@/lib/launchFlags';
import {
  getDriverValidationMessage,
  formatSaudiPlateForDisplay,
  normalizeNationalId,
  normalizeRegistrationSerial,
  inspectDriverDocumentFile,
  assertRequiredDriverDocumentFiles,
  validateDriverRegistrationInput,
} from '@/lib/driverDocumentValidation';
import {
  uploadDriverDocumentFiles,
  documentFilesToUploadStatuses,
} from '@/lib/driverDocumentUpload';
import { RequiredDriverDocumentsFields } from '@/components/RequiredDriverDocumentsFields';
import { TermsConsent } from '@/components/TermsConsent';
import { DevBypassPanel } from '@/components/DevBypassPanel';
import {
  DEMO_OTP_CODE,
  LOCALHOST_TEST_PHONES,
  isDevAuthBypassEnabled,
  matchDemoBypassPhone,
} from '@/lib/devAuthBypass';

/** Resolve landing CTA deep-links (`?role=`) to a registrable login role. */
function parseLoginRoleParam(value: string | null): LoginRole | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if ((REGISTRABLE_ROLES as readonly string[]).includes(normalized)) {
    if (!B2B_MODULES_ENABLED && isB2bSurfaceRole(normalized)) {
      return null;
    }
    return normalized as LoginRole;
  }
  if (normalized === 'customer' || normalized === 'client') return APP_ROLES.B2C_CLIENT;
  if (
    normalized === 'driver' ||
    normalized === 'partner' ||
    normalized === 'partners'
  ) {
    return APP_ROLES.B2C_DRIVER;
  }
  return null;
}

function resolveInitialAuthMode(searchParams: URLSearchParams): AuthEntryMode | null {
  const explicit = parseAuthEntryMode(searchParams.get('mode'));
  if (explicit) return explicit;
  if (searchParams.get('role') || searchParams.get('next')) return 'login';
  return null;
}

function resolveInitialAuthStep(searchParams: URLSearchParams): 'choose' | 'role' | 'phone' {
  const mode = resolveInitialAuthMode(searchParams);
  if (mode === 'register') {
    return parseLoginRoleParam(searchParams.get('role')) ? 'phone' : 'role';
  }
  if (mode === 'login') return 'phone';
  return 'choose';
}

const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState('flatbed');
  const [vehicleOption, setVehicleOption] = useState('normal');
  const [plateNumber, setPlateNumber] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [registrationSerial, setRegistrationSerial] = useState('');
  const [documentExpiries, setDocumentExpiries] = useState({
    id: '',
    registration: '',
    permit: '',
    license: '',
  });
  const [otp, setOtp] = useState('');
  const [searchParams] = useSearchParams();
  const [authMode, setAuthMode] = useState<AuthEntryMode | null>(() =>
    resolveInitialAuthMode(searchParams)
  );
  const [step, setStep] = useState<'choose' | 'role' | 'phone' | 'otp' | 'register'>(() =>
    resolveInitialAuthStep(searchParams)
  );
  const [role, setRole] = useState<LoginRole>(
    () => parseLoginRoleParam(searchParams.get('role')) ?? APP_ROLES.B2C_CLIENT
  );
  const [companyName, setCompanyName] = useState('');
  const [commercialRegistration, setCommercialRegistration] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [documentUploadStatuses, setDocumentUploadStatuses] =
    useState<DriverDocumentUploadStatuses>(EMPTY_DRIVER_DOCUMENTS);
  const [documentFiles, setDocumentFiles] = useState<
    Partial<Record<DriverDocumentKey, File>>
  >({});
  const {
    loginWithPhone,
    verifyOtp,
    completeRegistration,
    resendOtp,
    hasPendingOtp,
    needsOnboarding,
    pendingOnboarding,
    cancelPhoneOtpFlow,
    logout,
    loginAsDevBypass,
    user,
    profile,
  } = useAuth();
  const navigate = useNavigate();

  const isDriverRole = role === APP_ROLES.B2C_DRIVER;
  const isB2BRole =
    role === APP_ROLES.B2B_CORPORATE || role === APP_ROLES.B2B_OPERATOR;

  usePostLoginRedirect(!needsOnboarding);

  const goToRoleHome = (sessionProfile: UserProfile) => {
    const dest = resolvePostLoginPath(sessionProfile, searchParams.get('next'));
    console.info('[auth] login handler redirect', {
      role: sessionProfile.role,
      to: dest,
    });
    navigate(dest, { replace: true });
  };

  const applyAuthMode = (mode: AuthEntryMode, nextStep?: 'phone' | 'choose' | 'role') => {
    const params = new URLSearchParams(searchParams);
    params.set('mode', mode);
    if (mode === 'login') {
      params.delete('role');
    }
    navigate(`/login?${params.toString()}`, { replace: true });
    setAuthMode(mode);
    setStep(nextStep ?? (mode === 'register' ? 'role' : 'phone'));
  };

  useEffect(() => {
    const fromQuery = parseLoginRoleParam(searchParams.get('role'));
    if (fromQuery) {
      setRole(fromQuery);
    }
    const modeFromQuery = parseAuthEntryMode(searchParams.get('mode'));
    if (modeFromQuery && modeFromQuery !== authMode) {
      setAuthMode(modeFromQuery);
      setStep((current) => {
        if (current === 'otp' || current === 'register') return current;
        if (modeFromQuery === 'register') {
          return parseLoginRoleParam(searchParams.get('role')) ? 'phone' : 'role';
        }
        return 'phone';
      });
    }
  }, [searchParams, authMode]);

  useEffect(() => {
    if (!B2B_MODULES_ENABLED && isB2bSurfaceRole(role)) {
      setRole(APP_ROLES.B2C_CLIENT);
    }
  }, [role]);

  useEffect(() => {
    if (hasPendingOtp) {
      setStep('otp');
    }
  }, [hasPendingOtp]);

  useEffect(() => {
    if (!needsOnboarding || !user || !pendingOnboarding) return;
    if (authMode === 'login') return;
    setAuthMode('register');
    setRole(pendingOnboarding.intendedRole);
    if (pendingOnboarding.phone) {
      setPhone(pendingOnboarding.phone.replace(/^\+966/, '0'));
    }
    setStep('register');
  }, [needsOnboarding, user, pendingOnboarding, authMode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const locale = isRtl ? 'ar' : 'en';

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidSaudiPhoneInput(phone)) {
      toast.error(isRtl ? 'يرجى إدخال رقم جوال سعودي صحيح (05xxxxxxxx)' : 'Enter a valid Saudi mobile number');
      return;
    }

    const demoNumber = isDevAuthBypassEnabled() ? matchDemoBypassPhone(phone) : null;
    if (demoNumber) {
      if (isSubmitting) return;
      try {
        setIsSubmitting(true);
        const targetRole =
          demoNumber.local === '0500000000' &&
          (role === APP_ROLES.B2C_CLIENT || role === APP_ROLES.B2C_DRIVER)
            ? role
            : demoNumber.role;
        const session = await loginAsDevBypass(targetRole);
        toast.success(
          isRtl ? 'تم الدخول التجريبي بدون رمز تحقق' : 'Demo login without SMS verification'
        );
        goToRoleHome(session);
      } catch (error) {
        console.error('[Login] demo bypass failed:', error);
        toast.error(isRtl ? 'فشل الدخول التجريبي' : 'Demo login failed');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!acceptedTerms) {
      toast.error(isRtl ? 'يرجى الموافقة على الشروط والأحكام' : 'Please accept the Terms & Conditions');
      return;
    }

    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      const formattedPhone = toFirebasePhoneE164(phone);
      await loginWithPhone(
        formattedPhone,
        role,
        PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
        authMode ?? 'login'
      );
      stabilizeRecaptchaForOtpEntry(PHONE_AUTH_RECAPTCHA_CONTAINER_ID);
      setStep('otp');
      setResendCooldown(30);
      toast.success(isRtl ? 'تم إرسال رمز التحقق إلى جوالك' : 'Verification code sent to your phone');
    } catch (error: unknown) {
      console.error('[Login] OTP send failed:', getPhoneAuthErrorCode(error), error);
      const code = getPhoneAuthErrorCode(error);
      if (code === 'ALREADY_AUTHENTICATED') {
        const fromError =
          error && typeof error === 'object' && 'profile' in error
            ? (error as { profile?: UserProfile }).profile
            : undefined;
        const session = fromError || profile;
        if (session) {
          goToRoleHome(session);
        }
        return;
      }
      if (code === 'NEEDS_ONBOARDING') {
        if (authMode === 'login') {
          await logout();
          toast.error(t('auth_login_unknown'));
          setStep('phone');
          return;
        }
        applyAuthMode('register');
        setStep('register');
        toast.success(
          isRtl
            ? 'تم التحقق من جوالك سابقاً. أكمل بياناتك لإنشاء الحساب.'
            : 'Phone already verified. Complete your profile to create the account.'
        );
        return;
      }
      toast.error(getPhoneAuthErrorMessage(error, locale));
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
      toast.error(isRtl ? 'أدخل رمز التحقق المكون من 6 أرقام' : 'Enter the 6-digit verification code');
      return;
    }

    const demoNumber = isDevAuthBypassEnabled() ? matchDemoBypassPhone(phone) : null;
    if (demoNumber && (code === demoNumber.code || code === DEMO_OTP_CODE)) {
      try {
        setIsSubmitting(true);
        const targetRole =
          demoNumber.local === '0500000000' &&
          (role === APP_ROLES.B2C_CLIENT || role === APP_ROLES.B2C_DRIVER)
            ? role
            : demoNumber.role;
        const session = await loginAsDevBypass(targetRole);
        toast.success(isRtl ? 'تم تسجيل الدخول بنجاح' : 'Signed in successfully');
        goToRoleHome(session);
      } catch (error) {
        console.error('[Login] demo OTP bypass failed:', error);
        toast.error(isRtl ? 'فشل الدخول التجريبي' : 'Demo login failed');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await verifyOtp(code);

      if (result.isNewUser) {
        if (authMode === 'login') {
          await logout();
          setOtp('');
          setStep('phone');
          toast.error(t('auth_login_unknown'));
          return;
        }
        applyAuthMode('register');
        setStep('register');
        toast.success(
          isRtl
            ? 'تم التحقق من الجوال. أكمل بياناتك لإنشاء الحساب.'
            : 'Phone verified. Complete your profile to create the account.'
        );
        return;
      }

      if (authMode === 'register') {
        toast.success(t('auth_register_existing'));
      } else {
        toast.success(isRtl ? 'تم تسجيل الدخول بنجاح' : 'Signed in successfully');
      }
      if (result.profile) {
        goToRoleHome(result.profile);
      }
    } catch (error: unknown) {
      const errCode = getPhoneAuthErrorCode(error);
      toast.error(getPhoneAuthErrorMessage(error, locale));
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildRegistrationExtraData = (): Partial<UserProfile> => {
    if (isDriverRole) {
      const driverCheck = validateDriverRegistrationInput({
        plateNumber,
        nationalId,
        registrationSerial,
        vehicleType,
        documentUploadStatuses,
        documentFiles,
      });
      const normalized = driverCheck.normalized!;
      return {
        vehicleType,
        vehicleOption,
        plateNumber: normalized.plateNumber,
        nationalId: normalized.nationalId,
        registrationSerial: normalized.registrationSerial,
        documentExpiries: {
          id: documentExpiries.id,
          registration: documentExpiries.registration,
          permit: documentExpiries.permit,
          license: documentExpiries.license,
        },
        documentUploadStatuses,
      };
    }
    if (isB2BRole) {
      return {
        companyName: companyName.trim(),
        ...(commercialRegistration.trim()
          ? { commercialRegistration: commercialRegistration.trim() }
          : {}),
      };
    }
    return {};
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.length < 3) {
      toast.error(isRtl ? 'يرجى إدخال الاسم الكامل' : 'Please enter full name');
      return;
    }

    if (isDriverRole) {
      const driverCheck = validateDriverRegistrationInput({
        plateNumber,
        nationalId,
        registrationSerial,
        vehicleType,
        documentUploadStatuses,
        documentFiles,
      });
      if (!driverCheck.ok) {
        toast.error(getDriverValidationMessage(driverCheck, locale));
        return;
      }
      const docsCheck = await assertRequiredDriverDocumentFiles(documentFiles);
      if (!docsCheck.ok) {
        toast.error(getDriverValidationMessage(docsCheck, locale));
        return;
      }
      if (!documentExpiries.id || !documentExpiries.registration || !documentExpiries.permit || !documentExpiries.license) {
        toast.error(
          isRtl
            ? 'يرجى إدخال تواريخ انتهاء الهوية/الإقامة والاستمارة وكرت التشغيل ورخصة القيادة'
            : 'Enter expiry dates for ID/Iqama, Istimara, operating card, and driver\'s license'
        );
        return;
      }
    }

    if (isB2BRole && companyName.trim().length < 2) {
      toast.error(isRtl ? 'يرجى إدخال اسم الشركة' : 'Please enter company name');
      return;
    }

    if (!acceptedTerms) {
      toast.error(isRtl ? 'يرجى الموافقة على الشروط والأحكام' : 'Please accept terms and conditions');
      return;
    }

    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      const extraData = buildRegistrationExtraData();
      const uid = pendingOnboarding?.uid || user?.uid;

      if (isDriverRole) {
        if (!uid) {
          toast.error(
            isRtl
              ? 'انتهت جلسة التسجيل. يرجى التحقق من رقم الجوال مرة أخرى.'
              : 'Registration session expired. Please verify your phone number again.'
          );
          return;
        }
        try {
          const uploaded = await uploadDriverDocumentFiles(uid, documentFiles);
          extraData.documentFiles = uploaded;
          extraData.documentUploadStatuses = documentFilesToUploadStatuses(uploaded);
          extraData.accountStatus = 'ready_for_review';
        } catch (uploadError) {
          console.error('[login] driver document upload failed:', uploadError);
          toast.error(
            isRtl
              ? 'فشل رفع المستندات. تأكد أن الصور JPEG أو PNG ثم أعد المحاولة.'
              : 'Document upload failed. Use JPEG or PNG images and try again.'
          );
          return;
        }
      }

      const finalProfile = await completeRegistration({
        role,
        name,
        extraData,
      });

      if (role === APP_ROLES.B2C_DRIVER) {
        toast.success(
          isRtl
            ? 'تم التسجيل بنجاح: طلبك جاهز للمراجعة — لا يتم التفعيل إلا بعد اعتماد الإدارة'
            : 'Registration successful: your application is Ready for Review. Activation requires admin approval.',
          { duration: 8000 }
        );
      } else {
        toast.success(isRtl ? 'تم إنشاء الحساب بنجاح' : 'Account created successfully');
      }
      goToRoleHome(finalProfile);
    } catch (error: unknown) {
      toast.error(getPhoneAuthErrorMessage(error, locale));
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
      toast.success(t('otp_resent'));
    } catch (error: unknown) {
      console.error('[Login] OTP resend failed:', getPhoneAuthErrorCode(error), error);
      toast.error(getPhoneAuthErrorMessage(error, locale));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh grid lg:grid-cols-2 bg-[var(--color-background)]">
      <PhoneAuthRecaptcha id={PHONE_AUTH_RECAPTCHA_CONTAINER_ID} />

      <div className="flex items-center justify-center p-8">
        <div className="max-w-md w-full flex flex-col gap-8 bg-white p-10 rounded-[40px] shadow-xl shadow-stone-200/50 border border-stone-100">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 mb-4">
              <BrandLogo size={36} withChip withWordmark />
              <LanguageToggle />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-neutral-900">
              {step === 'choose'
                ? t('auth_choose_title')
                : step === 'role'
                  ? t('auth_register_role_title')
                : step === 'register'
                  ? t('complete_profile')
                  : authMode === 'register'
                    ? t('auth_register')
                    : t('auth_login')}
            </h1>
            <p className="text-neutral-500 font-medium">
              {step === 'choose'
                ? t('auth_choose_desc')
                : step === 'role'
                  ? t('auth_register_role_desc')
                : step === 'register'
                  ? t('complete_profile_desc')
                  : authMode === 'register'
                    ? t('auth_register_desc')
                    : t('auth_login_desc')}
            </p>
          </div>

          <DevBypassPanel isRtl={isRtl} />

          {typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '[::1]') && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-xs font-bold leading-relaxed">
                {isRtl
                  ? `Firebase يمنع مصادقة الهاتف على localhost. افتح http://127.0.0.1:${window.location.port || '3000'}/login وأضف 127.0.0.1 في Authorized domains.`
                  : `Firebase blocks Phone Auth on "localhost". Open http://127.0.0.1:${window.location.port || '3000'}/login and add 127.0.0.1 under Authentication → Authorized domains.`}
              </div>
            )}

          <AnimatePresence mode="wait">
            {step === 'choose' ? (
              <motion.div
                key="choose-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col gap-4"
              >
                <button
                  type="button"
                  onClick={() => applyAuthMode('login')}
                  className="w-full py-5 bg-white border-2 border-neutral-200 text-neutral-900 rounded-2xl font-bold flex items-center justify-center gap-2 hover:border-neutral-900 transition-all shadow-sm active:scale-[0.98]"
                >
                  <LogIn size={20} className="text-primary" />
                  {t('auth_login')}
                </button>
                <p className="text-xs text-neutral-400 font-bold text-center px-2">
                  {t('auth_login_cta')}
                </p>
                <button
                  type="button"
                  onClick={() => applyAuthMode('register')}
                  className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all shadow-xl shadow-neutral-900/10 active:scale-[0.98]"
                >
                  <UserPlus size={20} className="text-primary" />
                  {t('auth_register')}
                </button>
                <p className="text-xs text-neutral-400 font-bold text-center px-2">
                  {t('auth_register_cta')}
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="w-full py-3 text-neutral-400 text-sm font-bold hover:text-neutral-900 transition-colors uppercase tracking-widest"
                >
                  {t('back_home')}
                </button>
              </motion.div>
            ) : step === 'role' ? (
              <motion.div
                key="role-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col gap-5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole(APP_ROLES.B2C_CLIENT)}
                    className={`flex flex-col items-start gap-3 p-5 rounded-2xl border-2 text-start transition-all ${
                      role === APP_ROLES.B2C_CLIENT
                        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10'
                        : 'border-stone-100 bg-white hover:border-stone-300'
                    }`}
                  >
                    <User size={22} className={role === APP_ROLES.B2C_CLIENT ? 'text-neutral-900' : 'text-stone-400'} />
                    <span className="text-sm font-black text-neutral-900">
                      {isRtl ? ROLE_META.b2c_client.labelAr : ROLE_META.b2c_client.labelEn}
                    </span>
                    <span className="text-[11px] font-bold text-stone-500 leading-relaxed">
                      {t('auth_role_customer_hint')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole(APP_ROLES.B2C_DRIVER)}
                    className={`flex flex-col items-start gap-3 p-5 rounded-2xl border-2 text-start transition-all ${
                      role === APP_ROLES.B2C_DRIVER
                        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10'
                        : 'border-stone-100 bg-white hover:border-stone-300'
                    }`}
                  >
                    <Contact size={22} className={role === APP_ROLES.B2C_DRIVER ? 'text-neutral-900' : 'text-stone-400'} />
                    <span className="text-sm font-black text-neutral-900">
                      {isRtl ? ROLE_META.b2c_driver.labelAr : ROLE_META.b2c_driver.labelEn}
                    </span>
                    <span className="text-[11px] font-bold text-stone-500 leading-relaxed">
                      {t('auth_role_driver_hint')}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams);
                    params.set('mode', 'register');
                    params.set('role', role);
                    navigate(`/login?${params.toString()}`, { replace: true });
                    setAuthMode('register');
                    setStep('phone');
                  }}
                  className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold hover:bg-neutral-800 transition-all shadow-xl shadow-neutral-900/10 active:scale-[0.98]"
                >
                  {t('auth_register_continue')}
                </button>
                <button
                  type="button"
                  onClick={() => applyAuthMode('login')}
                  className="w-full py-3 text-sm font-bold text-neutral-500 hover:text-neutral-900"
                >
                  {t('auth_have_account')} {t('auth_login')}
                </button>
              </motion.div>
            ) : step === 'phone' ? (
              <motion.form
                key="phone-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handlePhoneSubmit}
                className="flex flex-col gap-6"
              >
                {authMode === 'register' ? (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-stone-50 border border-stone-100">
                    <p className="text-xs font-bold text-neutral-700">
                      {role === APP_ROLES.B2C_DRIVER
                        ? isRtl
                          ? ROLE_META.b2c_driver.labelAr
                          : ROLE_META.b2c_driver.labelEn
                        : isRtl
                          ? ROLE_META.b2c_client.labelAr
                          : ROLE_META.b2c_client.labelEn}
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep('role')}
                      className="text-xs font-black text-neutral-900 underline underline-offset-2"
                    >
                      {isRtl ? 'تغيير' : 'Change'}
                    </button>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">{t('phone_number')}</label>
                  <div className="relative">
                    <Phone className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-stone-300`} size={18} />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder={t('phone_placeholder')}
                      className={`w-full ${isRtl ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800`}
                    />
                  </div>
                  {isDevAuthBypassEnabled() && (
                    <div className="rounded-xl border border-dashed border-sky-300 bg-sky-50 px-3 py-2 space-y-2">
                      <p className="text-[11px] font-bold text-sky-900 leading-relaxed">
                        {isRtl
                          ? 'أرقام تجريبية محلية (بدون SMS). 0500000000 يدخل مباشرة. يعمل أيضاً على الجوال عبر نفس شبكة Wi‑Fi.'
                          : 'Local demo numbers (no SMS). 0500000000 signs in immediately. Also works on your phone on the same Wi‑Fi.'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {LOCALHOST_TEST_PHONES.map((entry) => (
                          <button
                            key={entry.e164}
                            type="button"
                            onClick={() => {
                              setPhone(entry.local.replace(/\D/g, ''));
                              if (entry.role === APP_ROLES.B2C_CLIENT || entry.role === APP_ROLES.B2C_DRIVER) {
                                setRole(entry.role);
                              }
                            }}
                            className="rounded-lg bg-white border border-sky-200 px-2.5 py-1.5 text-[11px] font-bold text-sky-900 hover:border-sky-400"
                          >
                            {isRtl ? entry.labelAr : entry.labelEn} · {entry.local}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <TermsConsent checked={acceptedTerms} onChange={setAcceptedTerms} disabled={isSubmitting} />
                  <button
                    type="submit"
                    disabled={isSubmitting || !acceptedTerms}
                    className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-neutral-900/10 active:scale-[0.98]"
                  >
                    {isSubmitting ? t('sending') : t('send_otp')}
                    <LogIn size={20} className="text-primary" />
                  </button>
                  <p className="text-sm font-bold text-neutral-500 text-center">
                    {authMode === 'register' ? t('auth_have_account') : t('auth_no_account')}{' '}
                    <button
                      type="button"
                      onClick={() =>
                        applyAuthMode(authMode === 'register' ? 'login' : 'register')
                      }
                      className="text-neutral-900 underline underline-offset-4"
                    >
                      {authMode === 'register' ? t('auth_login') : t('auth_register')}
                    </button>
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="w-full py-3 text-neutral-400 text-sm font-bold hover:text-neutral-900 transition-colors uppercase tracking-widest"
                  >
                    {t('back_home')}
                  </button>
                </div>
              </motion.form>
            ) : step === 'otp' ? (
              <motion.form
                key="otp-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
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
                  className="flex items-center gap-2 text-sm text-neutral-400 font-bold hover:text-neutral-900 transition-colors"
                >
                  <ChevronLeft size={16} className={`${isRtl ? 'rotate-180' : ''}`} /> {t('change_number')} ({phone})
                </button>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">{t('otp_label')}</label>
                  <div className="relative">
                    <Lock className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-stone-300`} size={18} />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      maxLength={6}
                      autoComplete="one-time-code"
                      className="w-full pr-12 pl-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all text-center tracking-[0.5em] font-black text-xl text-neutral-900"
                    />
                  </div>
                  {isDevAuthBypassEnabled() && matchDemoBypassPhone(phone) && (
                      <p className="text-[11px] font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                        {isRtl
                          ? `رمز الدخول التجريبي: ${DEMO_OTP_CODE}`
                          : `Demo verification code: ${DEMO_OTP_CODE}`}
                      </p>
                    )}
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-neutral-900/10 active:scale-[0.98]"
                >
                  {isSubmitting ? t('verifying') : t('confirm_otp')}
                  <LogIn size={20} className="text-primary" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleResendOtp()}
                  disabled={isSubmitting || resendCooldown > 0}
                  className="w-full py-3 text-sm font-bold text-neutral-500 hover:text-neutral-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0
                    ? t('resend_otp_in', { seconds: resendCooldown })
                    : t('resend_otp')}
                </button>
              </motion.form>
            ) : (
              <motion.form
                key="register-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleRegisterSubmit}
                className="flex flex-col gap-6"
              >
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    setStep('phone');
                    setOtp('');
                    setResendCooldown(0);
                  }}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 text-sm text-neutral-400 font-bold hover:text-neutral-900 transition-colors"
                >
                  <ChevronLeft size={16} className={`${isRtl ? 'rotate-180' : ''}`} /> {t('change_number')} ({phone})
                </button>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">{t('phone_number')}</label>
                  <input
                    type="tel"
                    value={phone}
                    readOnly
                    className="w-full px-4 py-3 rounded-2xl border border-stone-100 bg-stone-50 text-neutral-600 font-medium"
                  />
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-neutral-700">{t('full_name')}</label>
                    <div className="relative">
                      <User className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-stone-300`} size={18} />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('full_name_placeholder')}
                        className={`w-full ${isRtl ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800`}
                      />
                    </div>
                  </div>

                  {isB2BRole && (
                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-neutral-700">
                          {isRtl ? 'اسم الشركة' : 'Company Name'}
                        </label>
                        <input
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder={isRtl ? 'شركة النقل المحدودة' : 'Acme Logistics Co.'}
                          className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-neutral-700">
                          {isRtl ? 'السجل التجاري (اختياري)' : 'Commercial Registration (optional)'}
                        </label>
                        <input
                          type="text"
                          value={commercialRegistration}
                          onChange={(e) => setCommercialRegistration(e.target.value)}
                          placeholder="1010xxxxxx"
                          className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800"
                        />
                      </div>
                    </div>
                  )}

                  {isDriverRole && (
                    <div className="space-y-4 pt-2">
                      <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 flex gap-3 text-right">
                        <Shield className="text-blue-500 shrink-0" size={20} />
                        <p className={`text-[10px] text-blue-700 font-bold leading-relaxed ${isRtl ? 'text-right' : 'text-left'}`}>
                          {isRtl
                            ? 'ملاحظة: بصفتك شريك سائق، سيتم مراجعة بياناتك من قبل فريق الإدارة وتفعيل حسابك خلال 24 ساعة.'
                            : 'Note: As a driver partner, your data will be reviewed within 24 hours.'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-neutral-700">{isRtl ? 'نوع الخدمة' : 'Service Type'}</label>
                          <select
                            value={vehicleType}
                            onChange={(e) => {
                              const newType = e.target.value;
                              setVehicleType(newType);
                              const sk = SERVICE_KEY_MAP[newType] || newType;
                              const options = (SERVICE_OPTIONS as Record<string, string[]>)[sk] || [];
                              setVehicleOption(options[0] || '');
                            }}
                            className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800 bg-white text-xs"
                          >
                            <option value="furniture_moving">{isRtl ? 'نقل عفش' : 'Furniture Moving'}</option>
                            <option value="flatbed">{isRtl ? 'نقل سطحه' : 'Flatbed'}</option>
                            <option value="water_tanker">{isRtl ? 'صهريج مياه' : 'Water Tanker'}</option>
                            <option value="heavy_equipment">{isRtl ? 'معدات ثقيلة' : 'Heavy Equipment'}</option>
                            <option value="refrigerated">{isRtl ? 'نقل مبرد' : 'Refrigerated'}</option>
                            <option value="goods_transport">{isRtl ? 'نقل بضائع' : 'Cargo Transport'}</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-neutral-700">{isRtl ? 'النوع الفرعي' : 'Subtype'}</label>
                          <select
                            value={vehicleOption}
                            onChange={(e) => setVehicleOption(e.target.value)}
                            className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800 bg-white text-xs"
                          >
                            {(() => {
                              const sk = SERVICE_KEY_MAP[vehicleType] || vehicleType;
                              const options = (SERVICE_OPTIONS as Record<string, string[]>)[sk] || [];
                              return options.map((opt: string) => (
                                <option key={opt} value={opt}>
                                  {t(OPTION_LABELS[opt] || opt)}
                                </option>
                              ));
                            })()}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-neutral-700">{t('plate_number')}</label>
                        <input
                          type="text"
                          value={plateNumber}
                          onChange={(e) => setPlateNumber(formatSaudiPlateForDisplay(e.target.value))}
                          placeholder={isRtl ? 'أ ب ج 1234' : 'A B C 1234'}
                          autoComplete="off"
                          dir="ltr"
                          className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800 tracking-[0.2em]"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-neutral-700">
                          {isRtl ? 'رقم الهوية / الإقامة' : 'National ID / Iqama'}
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={nationalId}
                          onChange={(e) => setNationalId(normalizeNationalId(e.target.value).slice(0, 10))}
                          placeholder={isRtl ? '1xxxxxxxxx أو 2xxxxxxxxx' : '1xxxxxxxxx or 2xxxxxxxxx'}
                          autoComplete="off"
                          maxLength={10}
                          className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800 tracking-widest"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-neutral-700">
                          {isRtl ? 'رقم الاستمارة / الإمارة' : 'Istimara / Emarah serial'}
                        </label>
                        <input
                          type="text"
                          value={registrationSerial}
                          onChange={(e) =>
                            setRegistrationSerial(normalizeRegistrationSerial(e.target.value).slice(0, 15))
                          }
                          placeholder={isRtl ? 'رقم الاستمارة' : 'Registration serial'}
                          autoComplete="off"
                          maxLength={15}
                          className="w-full px-4 py-4 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800"
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="text-sm font-bold text-neutral-700">
                          {isRtl ? 'تواريخ انتهاء المستندات' : 'Document expiry dates'}
                        </label>
                        <div className="grid gap-3">
                          {(
                            [
                              { key: 'id' as const, ar: 'انتهاء الهوية / الإقامة', en: 'ID / Iqama expiry' },
                              { key: 'registration' as const, ar: 'انتهاء الاستمارة / الإمارة', en: 'Istimara / Emarah expiry' },
                              { key: 'permit' as const, ar: 'انتهاء كرت التشغيل', en: 'Operating card expiry' },
                              { key: 'license' as const, ar: 'انتهاء رخصة القيادة', en: "Driver's license expiry" },
                            ] as const
                          ).map((field) => (
                            <div key={field.key} className="space-y-1">
                              <label className="text-[11px] font-bold text-stone-500">
                                {isRtl ? field.ar : field.en}
                              </label>
                              <input
                                type="date"
                                value={documentExpiries[field.key]}
                                onChange={(e) =>
                                  setDocumentExpiries((prev) => ({
                                    ...prev,
                                    [field.key]: e.target.value,
                                  }))
                                }
                                className="w-full px-4 py-3 rounded-2xl border border-stone-200 focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium text-neutral-800 text-sm"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <RequiredDriverDocumentsFields
                          isRtl={isRtl}
                          files={documentFiles}
                          onSelect={(key, file) => {
                            if (!file) {
                              setDocumentUploadStatuses((prev) => ({
                                ...prev,
                                [key]: 'not_uploaded',
                              }));
                              setDocumentFiles((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                              return;
                            }
                            void inspectDriverDocumentFile(file).then((fileCheck) => {
                              if (!fileCheck.ok) {
                                toast.error(
                                  getDriverValidationMessage(
                                    { ...fileCheck, invalidDoc: key },
                                    locale
                                  )
                                );
                                return;
                              }
                              setDocumentFiles((prev) => ({ ...prev, [key]: file }));
                              setDocumentUploadStatuses((prev) => ({
                                ...prev,
                                [key]: 'uploaded',
                              }));
                            });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <TermsConsent checked={acceptedTerms} onChange={setAcceptedTerms} disabled={isSubmitting} />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || !acceptedTerms}
                  className="w-full py-5 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-neutral-900/10 active:scale-[0.98]"
                >
                  {isSubmitting ? t('creating_account') : t('create_account')}
                  <LogIn size={20} className="text-primary" />
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="hidden lg:block relative bg-neutral-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-neutral-900/90 z-10"></div>
        <img
          src="https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&q=80&w=1200"
          alt="Trucking Logistics"
          className="w-full h-full object-cover brightness-75 transition-all duration-1000 saturate-[0.8]"
          referrerPolicy="no-referrer"
        />
        <div className={`absolute bottom-16 ${isRtl ? 'right-16' : 'left-16'} z-20 text-white max-w-sm`}>
          <div className="w-12 h-1 bg-primary mb-6"></div>
          <h2 className="text-5xl font-black mb-6 leading-tight tracking-tight">{t('logistics_solutions')}</h2>
          <p className="text-neutral-400 font-medium text-lg leading-relaxed">{t('logistics_desc')}</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
