/**
 * Maps Firebase Phone Auth / reCAPTCHA errors to operator-friendly messages.
 * Admin login previously swallowed these as generic "Failed to send OTP".
 */
export function getPhoneAuthErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: string }).code || '').trim();
    if (code) return code;
  }
  if (error instanceof Error && error.message) {
    // Prefer structured Firebase codes embedded in message when `.code` is missing.
    const match = error.message.match(/auth\/[a-z0-9-]+/i);
    if (match) return match[0];
    return error.message;
  }
  return 'unknown';
}

export function getPhoneAuthErrorMessage(
  error: unknown,
  locale: 'en' | 'ar' = 'en'
): string {
  const code = getPhoneAuthErrorCode(error);

  const en: Record<string, string> = {
    'auth/invalid-phone-number': 'Invalid phone number format.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/quota-exceeded': 'SMS quota exceeded. Use a Firebase test phone number in Console.',
    'auth/captcha-check-failed':
      'reCAPTCHA hostname mismatch (Hostname match not found). On production, open https://hamula-cfc6c.web.app and ensure that host (plus hamula-cfc6c.firebaseapp.com) is listed under Authentication → Settings → Authorized domains, and on the App Check reCAPTCHA v3 key Domains list. Locally use http://127.0.0.1:3000 with 127.0.0.1 authorized. Then hard-refresh and retry Send OTP.',
    RECAPTCHA_CONTAINER_REMOVED:
      'reCAPTCHA container was removed from the page. Refresh and try again.',
    RECAPTCHA_ALREADY_RENDERED:
      'reCAPTCHA conflict. Wait a moment and tap Send OTP again.',
    'auth/missing-client-identifier':
      'reCAPTCHA could not verify this browser session. Confirm the page hostname is in Authentication → Settings → Authorized domains (hamula-cfc6c.web.app / firebaseapp.com / 127.0.0.1), then refresh and retry.',
    'auth/missing-phone-number': 'Phone number is required.',
    'auth/operation-not-allowed': 'Phone sign-in is disabled in Firebase Console → Authentication.',
    'auth/invalid-app-credential':
      'Phone Auth rejected this origin (auth/invalid-app-credential). Add the exact browser hostname under Authentication → Settings → Authorized domains (no https://, no path). Production: hamula-cfc6c.web.app. Local: 127.0.0.1 (not localhost).',
    PHONE_AUTH_LOCALHOST_BLOCKED:
      'Firebase blocks Phone Auth on "localhost". Open http://127.0.0.1:3000/login and add 127.0.0.1 to Authentication → Settings → Authorized domains.',
    PHONE_AUTH_HOSTNAME_MISMATCH:
      'This page hostname is not authorized for Phone Auth reCAPTCHA. Add it under Authentication → Settings → Authorized domains and on the App Check reCAPTCHA key Domains list.',
    'auth/app-check-token-is-invalid': 'App Check failed. Add VITE_APP_CHECK_DEBUG_TOKEN for localhost (see docs/FIREBASE_AUTH_SETUP.md).',
    'auth/app-check-token-is-missing': 'App Check token missing. Register a debug token for local dev or disable Auth App Check enforcement in Console.',
    APP_CHECK_NOT_INITIALIZED:
      'App Check did not start. Set VITE_APP_CHECK_DEBUG_TOKEN + VITE_APP_CHECK_RECAPTCHA_SITE_KEY in .env, or VITE_APP_CHECK_DISABLED=true with Auth App Check unenforced in Console.',
    APP_CHECK_TOKEN_EXCHANGE_FAILED:
      'App Check debug token exchange failed. Re-register the UUID in Firebase Console and allow localhost on the Browser API key.',
    APP_CHECK_INIT_FAILED:
      'App Check failed to initialize. See browser console for [App Check] details.',
    APP_CHECK_SITE_KEY_MISSING:
      'VITE_APP_CHECK_RECAPTCHA_SITE_KEY is missing. Copy the reCAPTCHA v3 site key from Firebase Console → App Check → Web app.',
    APP_CHECK_REQUIRED_IN_PRODUCTION:
      'App Check must be enabled in production. Remove VITE_APP_CHECK_DISABLED and configure VITE_APP_CHECK_RECAPTCHA_SITE_KEY.',
    APP_CHECK_NOT_CONFIGURED:
      'App Check env vars missing. See .env.example (VITE_APP_CHECK_DEBUG_TOKEN + VITE_APP_CHECK_RECAPTCHA_SITE_KEY).',
    'auth/network-request-failed': 'Network error reaching Firebase. Check connection and authorized domains.',
    'auth/invalid-api-key':
      'Firebase API key rejected for Authentication. In Google Cloud Console → Credentials → Browser key → API restrictions, enable Identity Toolkit API and Token Service API.',
    'auth/internal-error':
      'Phone verification failed (internal error). Confirm the number is E.164 (+9665XXXXXXXX), refresh the page, and retry. Check reCAPTCHA and App Check settings for localhost.',
    'auth/invalid-verification-code': 'Invalid verification code. Check the SMS and try again.',
    'auth/code-expired': 'This code has expired. Request a new OTP.',
    'auth/session-expired': 'Verification session expired. Request a new OTP.',
    'auth/invalid-verification-id': 'Verification session is no longer valid. Request a new OTP.',
    NO_OTP_SESSION: 'No active verification session. Request a new OTP.',
    OTP_SEND_TIMEOUT: 'Sending the code took too long. Check your connection and try again.',
    OTP_CONFIRM_TIMEOUT: 'Verifying the code took too long. Try again or request a new OTP.',
    ALREADY_AUTHENTICATED:
      'You are already signed in. Open your dashboard, or sign out first to use a different account.',
    NEEDS_ONBOARDING:
      'Your phone is verified. Complete your profile to finish registration.',
    NO_ONBOARDING_SESSION:
      'Registration session expired. Sign in with your phone number again.',
    INVALID_REGISTRATION_NAME: 'Please enter your full name.',
    INVALID_SA_PHONE: 'Enter a valid Saudi mobile number (05xxxxxxxx).',
    RECAPTCHA_CONTAINER_MISSING: 'Internal error: reCAPTCHA container missing from page.',
  };

  const ar: Record<string, string> = {
    'auth/invalid-phone-number': 'صيغة رقم الجوال غير صحيحة.',
    'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.',
    'auth/quota-exceeded': 'تم تجاوز حصة SMS. استخدم رقم اختبار في Firebase Console.',
    'auth/captcha-check-failed':
      'فشل reCAPTCHA (Hostname match not found). على الإنتاج افتح https://hamula-cfc6c.web.app وتأكد أن النطاق مضاف في Authentication → Settings → Authorized domains وفي نطاقات مفتاح App Check reCAPTCHA. محلياً استخدم http://127.0.0.1:3000 ثم حدّث الصفحة وأعد المحاولة.',
    RECAPTCHA_CONTAINER_REMOVED: 'تمت إزالة حاوية reCAPTCHA. حدّث الصفحة وحاول مجدداً.',
    RECAPTCHA_ALREADY_RENDERED: 'تعارض reCAPTCHA. انتظر لحظة ثم أعد إرسال رمز التحقق.',
    'auth/missing-client-identifier':
      'فشل التحقق من reCAPTCHA. أضف نطاق الصفحة الحالي في Authorized domains ثم حدّث الصفحة.',
    'auth/missing-phone-number': 'رقم الجوال مطلوب.',
    'auth/operation-not-allowed': 'تسجيل الدخول بالجوال غير مفعّل في Firebase Console.',
    'auth/invalid-app-credential':
      'رُفض طلب OTP. أضف اسم المضيف الحالي في Authentication → Settings → Authorized domains (مثل hamula-cfc6c.web.app أو 127.0.0.1).',
    PHONE_AUTH_LOCALHOST_BLOCKED:
      'Firebase يمنع مصادقة الهاتف على localhost. افتح http://127.0.0.1:3000/login وأضف 127.0.0.1 في Authorized domains.',
    PHONE_AUTH_HOSTNAME_MISMATCH:
      'نطاق الصفحة غير مصرّح به لـ Phone Auth. أضفه في Authorized domains وفي نطاقات مفتاح reCAPTCHA.',
    'auth/app-check-token-is-invalid': 'فشل App Check. أضف VITE_APP_CHECK_DEBUG_TOKEN للتطوير المحلي.',
    'auth/app-check-token-is-missing': 'رمز App Check مفقود. سجّل debug token أو عطّل فرض App Check على Auth مؤقتاً.',
    APP_CHECK_NOT_INITIALIZED:
      'App Check لم يبدأ. أضف VITE_APP_CHECK_DEBUG_TOKEN + VITE_APP_CHECK_RECAPTCHA_SITE_KEY في .env.',
    APP_CHECK_TOKEN_EXCHANGE_FAILED:
      'فشل تبادل debug token. أعد تسجيل UUID في Firebase Console.',
    APP_CHECK_INIT_FAILED: 'فشل تهيئة App Check. راجع وحدة التحكم في المتصفح.',
    APP_CHECK_SITE_KEY_MISSING: 'VITE_APP_CHECK_RECAPTCHA_SITE_KEY مفقود.',
    APP_CHECK_REQUIRED_IN_PRODUCTION:
      'يجب تفعيل App Check في الإنتاج. أزل VITE_APP_CHECK_DISABLED واضبط VITE_APP_CHECK_RECAPTCHA_SITE_KEY.',
    APP_CHECK_NOT_CONFIGURED: 'متغيرات App Check مفقودة. راجع .env.example.',
    'auth/network-request-failed': 'خطأ شبكة. تحقق من الاتصال والنطاقات المصرّح بها.',
    'auth/invalid-api-key':
      'مفتاح Firebase مرفوض لخدمة المصادقة. في Google Cloud Console فعّل Identity Toolkit API و Token Service API لمفتاح المتصفح.',
    'auth/internal-error':
      'فشل التحقق من الجوال (خطأ داخلي). تأكد من صيغة الرقم (+9665XXXXXXXX) وحدّث الصفحة وحاول مجدداً.',
    'auth/invalid-verification-code': 'رمز التحقق غير صحيح. راجع الرسالة وحاول مجدداً.',
    'auth/code-expired': 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.',
    'auth/session-expired': 'انتهت جلسة التحقق. اطلب رمزاً جديداً.',
    'auth/invalid-verification-id': 'جلسة التحقق لم تعد صالحة. اطلب رمزاً جديداً.',
    NO_OTP_SESSION: 'لا توجد جلسة تحقق نشطة. اطلب رمزاً جديداً.',
    OTP_SEND_TIMEOUT: 'استغرق إرسال الرمز وقتاً طويلاً. تحقق من الاتصال وحاول مجدداً.',
    OTP_CONFIRM_TIMEOUT: 'استغرق التحقق وقتاً طويلاً. حاول مجدداً أو اطلب رمزاً جديداً.',
    ALREADY_AUTHENTICATED:
      'أنت مسجّل الدخول بالفعل. انتقل إلى لوحة التحكم، أو سجّل الخروج أولاً لاستخدام حساب آخر.',
    NEEDS_ONBOARDING: 'تم التحقق من جوالك. أكمل بياناتك لإنهاء التسجيل.',
    NO_ONBOARDING_SESSION: 'انتهت جلسة التسجيل. سجّل الدخول برقم الجوال مجدداً.',
    INVALID_REGISTRATION_NAME: 'يرجى إدخال الاسم الكامل.',
    INVALID_SA_PHONE: 'أدخل رقم جوال سعودي صحيح (05xxxxxxxx).',
    RECAPTCHA_CONTAINER_MISSING: 'خطأ داخلي: حاوية reCAPTCHA غير موجودة.',
  };

  const table = locale === 'ar' ? ar : en;
  if (table[code]) {
    // Prefer detailed App Check failure text from ensureAppCheckTokenForAuth when present.
    if (
      code.startsWith('APP_CHECK_') &&
      error instanceof Error &&
      error.message.length > 40 &&
      error.message !== code
    ) {
      return error.message;
    }
    return table[code];
  }
  return locale === 'ar' ? 'تعذر إكمال التحقق' : 'Phone verification failed';
}
