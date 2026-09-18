import React, { useEffect } from 'react';
import {
  ensurePersistentRecaptchaContainer,
  PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
} from '@/lib/phoneAuth';
import { shouldUseNativeIosPhoneAuth } from '@/lib/nativePhoneAuth';

/**
 * Ensures the Phone Auth reCAPTCHA container exists on document.body.
 * The widget itself is created in phoneAuth.ts on OTP submit — not here.
 * Native iOS uses CapacitorFirebaseAuthentication and skips JS reCAPTCHA.
 */
export const PhoneAuthRecaptcha: React.FC<{ id?: string }> = ({
  id = PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
}) => {
  useEffect(() => {
    if (shouldUseNativeIosPhoneAuth()) {
      console.info('[PhoneAuth] Init', 'skipping JS reCAPTCHA on native iOS');
      return;
    }
    ensurePersistentRecaptchaContainer(id);
  }, [id]);

  return null;
};
