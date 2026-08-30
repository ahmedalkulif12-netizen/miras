import React, { useEffect } from 'react';
import {
  ensurePersistentRecaptchaContainer,
  PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
} from '@/lib/phoneAuth';

/**
 * Ensures the Phone Auth reCAPTCHA container exists on document.body.
 * The widget itself is created in phoneAuth.ts on OTP submit — not here.
 */
export const PhoneAuthRecaptcha: React.FC<{ id?: string }> = ({
  id = PHONE_AUTH_RECAPTCHA_CONTAINER_ID,
}) => {
  useEffect(() => {
    ensurePersistentRecaptchaContainer(id);
  }, [id]);

  return null;
};
