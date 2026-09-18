/**
 * Native iOS Phone Auth is required because capacitor:// WebViews cannot
 * complete Firebase JS RecaptchaVerifier (auth/internal-error).
 */
export function shouldUseNativeIosPhoneAuth(runtime: {
  isNative: boolean;
  platform: string;
}): boolean {
  return runtime.isNative === true && runtime.platform === 'ios';
}
