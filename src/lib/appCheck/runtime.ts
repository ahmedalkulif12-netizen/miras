/**
 * Pure App Check runtime helpers — no Capacitor / Firebase imports so Node tests can run.
 */

export function isWebFirebaseAppId(appId: string | undefined): boolean {
  return typeof appId === 'string' && /:web:[0-9a-f]+$/i.test(appId.trim());
}

export function isNativeFirebaseAppId(appId: string | undefined): boolean {
  return typeof appId === 'string' && /:(ios|android):[0-9a-f]+$/i.test(appId.trim());
}

export function looksLikeNativeCapacitorRuntime(input: {
  isNativePlatform?: boolean;
  platform?: string;
  protocol?: string;
}): boolean {
  if (input.isNativePlatform) {
    return true;
  }
  const platform = (input.platform || '').toLowerCase();
  if (platform === 'ios' || platform === 'android') {
    return true;
  }
  const protocol = (input.protocol || '').toLowerCase();
  return protocol === 'capacitor:' || protocol === 'ionic:';
}

/** True when App Check failed because the native/web app is not registered or attestation was rejected. */
export function isAppCheckAttestationFailure(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? `${error.name} ${error.message} ${(error as { code?: string }).code ?? ''}`
      : String(error);
  return (
    /App not registered/i.test(raw) ||
    /FAILED_PRECONDITION/i.test(raw) ||
    /app-check-token/i.test(raw) ||
    /App Check reCAPTCHA v3 failed/i.test(raw) ||
    /attestation/i.test(raw) ||
    /APP_CHECK_NATIVE/i.test(raw) ||
    /APP_CHECK_WEB_APP_ID/i.test(raw)
  );
}

export function formatNativeAppCheckFailure(platform: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    `Native App Check (${platform}) failed. Register the iOS/Android app in Firebase Console → App Check ` +
    `(App Attest / DeviceCheck on iOS, Play Integrity on Android). ` +
    `Phone login will continue without an App Check token. Original error: ${raw}`
  );
}
