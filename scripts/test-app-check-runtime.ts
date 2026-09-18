#!/usr/bin/env tsx
/**
 * App Check runtime helpers — native vs web provider selection.
 * Run: npx tsx scripts/test-app-check-runtime.ts
 */
import { assert, assertEqual } from '../e2e/helpers/assert.ts';
import {
  formatNativeAppCheckFailure,
  isAppCheckAttestationFailure,
  isNativeFirebaseAppId,
  isWebFirebaseAppId,
  looksLikeNativeCapacitorRuntime,
} from '../src/lib/appCheck/runtime.ts';
import { getPhoneAuthErrorCode } from '../src/lib/phoneAuthErrors.ts';

function run(): void {
  assert(looksLikeNativeCapacitorRuntime({ isNativePlatform: true }), 'native bridge is native');
  assert(looksLikeNativeCapacitorRuntime({ platform: 'ios' }), 'ios platform is native');
  assert(looksLikeNativeCapacitorRuntime({ platform: 'android' }), 'android platform is native');
  assert(
    looksLikeNativeCapacitorRuntime({ protocol: 'capacitor:' }),
    'capacitor:// WebView is native even if the bridge reports late'
  );
  assert(!looksLikeNativeCapacitorRuntime({ platform: 'web', protocol: 'https:' }), 'https web is not native');

  assert(isWebFirebaseAppId('1:191963635866:web:abcdef0123456789'), 'web app id');
  assert(!isWebFirebaseAppId('1:191963635866:ios:73a41da4e6ffe55734bf23'), 'ios is not web');
  assert(isNativeFirebaseAppId('1:191963635866:ios:73a41da4e6ffe55734bf23'), 'ios app id');
  assert(isNativeFirebaseAppId('1:191963635866:android:205571afa09c0d4634bf23'), 'android app id');
  assert(!isNativeFirebaseAppId('1:191963635866:web:abcdef0123456789'), 'web is not native');

  assert(
    isAppCheckAttestationFailure(new Error('App not registered: 1:191963635866:ios:73a41da4e6ffe55734bf23')),
    'unregistered iOS app is an attestation failure'
  );
  assert(
    isAppCheckAttestationFailure(new Error('400 FAILED_PRECONDITION')),
    'FAILED_PRECONDITION is an attestation failure'
  );
  assert(
    !isAppCheckAttestationFailure(new Error('APP_CHECK_REQUIRED_IN_PRODUCTION')),
    'must not swallow generic production App Check required errors'
  );

  const nativeMessage = formatNativeAppCheckFailure(
    'ios',
    new Error('App not registered: 1:191963635866:ios:73a41da4e6ffe55734bf23')
  );
  assert(!/reCAPTCHA v3 failed on production/i.test(nativeMessage), 'native failures must not look like reCAPTCHA');
  assert(/App Attest/i.test(nativeMessage), 'native message mentions App Attest');
  assertEqual(
    /Original error:/.test(nativeMessage),
    true,
    'native message keeps the original error'
  );

  assertEqual(
    getPhoneAuthErrorCode(new Error('400 FAILED_PRECONDITION')),
    'auth/failed-precondition',
    'FAILED_PRECONDITION maps to a stable auth code'
  );
  assertEqual(
    getPhoneAuthErrorCode(new Error('App not registered: 1:191963635866:ios:73a41da4e6ffe55734bf23')),
    'auth/failed-precondition',
    'unregistered iOS app maps to failed-precondition'
  );

  console.log('test-app-check-runtime: OK');
}

run();
