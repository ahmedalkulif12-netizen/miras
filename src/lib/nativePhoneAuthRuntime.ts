/**
 * Native iOS Phone Auth is required because capacitor:// WebViews cannot
 * complete Firebase JS RecaptchaVerifier (auth/internal-error).
 *
 * Capacitor iOS always uses iosScheme `capacitor`. The bridge may report
 * platform=web until it is ready, so protocol is part of the match.
 */
export function shouldUseNativeIosPhoneAuth(runtime: {
  isNative?: boolean;
  platform?: string;
  protocol?: string;
}): boolean {
  const platform = (runtime.platform || '').toLowerCase();
  if (platform === 'ios') {
    return true;
  }
  if (platform === 'android') {
    return false;
  }
  const protocol = (runtime.protocol || '').toLowerCase();
  return protocol === 'capacitor:' || protocol === 'ionic:';
}
