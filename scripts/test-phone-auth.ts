#!/usr/bin/env tsx
/**
 * Saudi E.164 formatting + native iOS Phone Auth routing.
 * Run: npx tsx scripts/test-phone-auth.ts
 */
import { assert, assertEqual } from '../e2e/helpers/assert.ts';
import { shouldUseNativeIosPhoneAuth } from '../src/lib/nativePhoneAuthRuntime.ts';
import { toFirebasePhoneE164, isValidSaudiPhoneInput } from '../src/lib/phoneUtils.ts';

function run(): void {
  assert(shouldUseNativeIosPhoneAuth({ isNative: true, platform: 'ios' }), 'iOS Capacitor uses native phone auth');
  assert(
    !shouldUseNativeIosPhoneAuth({ isNative: true, platform: 'android' }),
    'Android keeps the JS Phone Auth path'
  );
  assert(
    !shouldUseNativeIosPhoneAuth({ isNative: false, platform: 'web' }),
    'web uses RecaptchaVerifier'
  );

  const admin = '+966541330720';
  assertEqual(toFirebasePhoneE164('0541330720'), admin, 'local 05…');
  assertEqual(toFirebasePhoneE164('541330720'), admin, 'national 5…');
  assertEqual(toFirebasePhoneE164('+966541330720'), admin, 'already E.164');
  assertEqual(toFirebasePhoneE164('966541330720'), admin, 'country code without plus');
  assertEqual(toFirebasePhoneE164('00966541330720'), admin, '00 international prefix');
  assertEqual(toFirebasePhoneE164('+966 54 133 0720'), admin, 'spaced E.164');
  assertEqual(toFirebasePhoneE164('٠٥٤١٣٣٠٧٢٠'), admin, 'Arabic-Indic digits');
  assert(isValidSaudiPhoneInput('0541330720'), 'valid local admin number');
  assert(!isValidSaudiPhoneInput('123'), 'short number rejected');

  console.log('test-phone-auth: OK');
}

run();
