/**
 * Native Capacitor Phone Auth is required because WebView origins cannot
 * reliably complete Firebase JS RecaptchaVerifier (auth/internal-error,
 * Safari/Chrome custom-tab redirects).
 *
 * iOS uses iosScheme `capacitor`. Android uses https://hamula-cfc6c.web.app
 * but still prefers the native plugin so SMS is not interrupted by a browser sheet.
 * skipNativeAuth stays true so the JS Auth session (ID tokens) matches Web.
 *
 * Capacitor may report platform=web until the bridge is ready, so protocol is
 * part of the match (`capacitor:` / `ionic:`).
 */
export function shouldUseNativePhoneAuth(runtime: {
  isNative?: boolean;
  platform?: string;
  protocol?: string;
}): boolean {
  const platform = (runtime.platform || '').toLowerCase();
  if (platform === 'ios' || platform === 'android') {
    return true;
  }
  const protocol = (runtime.protocol || '').toLowerCase();
  return protocol === 'capacitor:' || protocol === 'ionic:';
}

/** @deprecated Use shouldUseNativePhoneAuth — kept as an alias for existing imports. */
export const shouldUseNativeIosPhoneAuth = shouldUseNativePhoneAuth;
