#!/usr/bin/env tsx
/**
 * Saudi E.164 formatting + native iOS Phone Auth routing + Play reviewer bypass.
 * Run: npx tsx scripts/test-phone-auth.ts
 */
import { assert, assertEqual } from '../e2e/helpers/assert.ts';
import { shouldUseNativeIosPhoneAuth } from '../src/lib/nativePhoneAuthRuntime.ts';
import { toFirebasePhoneE164, isValidSaudiPhoneInput } from '../src/lib/phoneUtils.ts';
import {
  isPlayReviewPhone,
  isPlayReviewOtp,
  isPlayReviewCredentials,
  PLAY_REVIEW_OTP,
  PLAY_REVIEW_PHONE_E164,
} from '../src/lib/playReviewAuth.ts';
import {
  consumePlayReviewRateLimit,
  isPlayReviewCredentials as serverPlayReviewCredentials,
} from '../server/lib/playReviewAuth.ts';

function run(): void {
  assert(shouldUseNativeIosPhoneAuth({ isNative: true, platform: 'ios' }), 'iOS Capacitor uses native phone auth');
  assert(
    shouldUseNativeIosPhoneAuth({ isNative: false, platform: 'ios' }),
    'platform=ios uses native even if the bridge reports late'
  );
  assert(
    shouldUseNativeIosPhoneAuth({ isNative: false, platform: 'web', protocol: 'capacitor:' }),
    'capacitor:// WebView uses native iOS phone auth'
  );
  assert(
    shouldUseNativeIosPhoneAuth({ isNative: true, platform: 'android' }),
    'Android Capacitor uses native phone auth'
  );
  assert(
    !shouldUseNativeIosPhoneAuth({ isNative: false, platform: 'web' }),
    'web uses RecaptchaVerifier'
  );
  assert(
    !shouldUseNativeIosPhoneAuth({ isNative: false, platform: 'web', protocol: 'https:' }),
    'https web stays on JS Phone Auth'
  );

  const admin = '+966541330720';
  assertEqual(toFirebasePhoneE164('0541330720'), admin, 'local 05…');
  assertEqual(toFirebasePhoneE164('0541330720'), admin, 'local 054…');
  assertEqual(toFirebasePhoneE164('541330720'), admin, 'national 5…');
  assertEqual(toFirebasePhoneE164('54 133 0720'), admin, 'national 54… with spaces');
  assertEqual(toFirebasePhoneE164('+966541330720'), admin, 'already E.164');
  assertEqual(toFirebasePhoneE164('+966 54 133 0720'), admin, 'spaced +966 54…');
  assertEqual(toFirebasePhoneE164('+9660541330720'), admin, 'E.164 with extra trunk 0');
  assertEqual(toFirebasePhoneE164('966541330720'), admin, 'country code without plus');
  assertEqual(toFirebasePhoneE164('00966541330720'), admin, '00 international prefix');
  assertEqual(toFirebasePhoneE164('+966 54 133 0720'), admin, 'spaced E.164');
  assertEqual(toFirebasePhoneE164('٠٥٤١٣٣٠٧٢٠'), admin, 'Arabic-Indic digits');
  assert(isValidSaudiPhoneInput('0541330720'), 'valid local admin number');
  assert(isValidSaudiPhoneInput('541330720'), 'valid national 54… number');
  assert(isValidSaudiPhoneInput('+966541330720'), 'valid E.164');
  assert(!isValidSaudiPhoneInput('123'), 'short number rejected');
  assert(!isValidSaudiPhoneInput('041330720'), 'non-mobile 04… rejected');

  assert(isValidSaudiPhoneInput('0500000000'), 'Play reviewer local number is valid');
  assertEqual(toFirebasePhoneE164('0500000000'), '+966500000000', 'Play reviewer E.164');
  assertEqual(toFirebasePhoneE164('+966500000000'), '+966500000000', 'Play reviewer already E.164');
  assert(isPlayReviewPhone('0500000000'), '0500000000 is the reviewer phone');
  assert(isPlayReviewPhone('+966500000000'), '+966500000000 is the reviewer phone');
  assert(!isPlayReviewPhone('+966541330720'), 'admin phone is not the reviewer bypass');
  assert(!isPlayReviewPhone('+966511111111'), 'random number is not the reviewer bypass');
  assert(isPlayReviewOtp(PLAY_REVIEW_OTP), 'static reviewer OTP accepted');
  assert(isPlayReviewOtp('123456'), '123456 is the reviewer OTP');
  assert(!isPlayReviewOtp('000000'), 'wrong OTP rejected');
  assert(!isPlayReviewOtp('1234'), '4-digit OTP rejected');
  assert(isPlayReviewCredentials(PLAY_REVIEW_PHONE_E164, '123456'), 'phone+OTP pair matches');
  assert(
    !isPlayReviewCredentials('+966511111111', '123456'),
    'correct OTP on another phone is rejected'
  );
  assert(serverPlayReviewCredentials('0500000000', '123456'), 'server accepts reviewer pair');
  assert(!serverPlayReviewCredentials('+966511111111', '123456'), 'server rejects other phones');
  const rateKey = `test-${Date.now()}`;
  for (let i = 0; i < 12; i += 1) {
    assert(consumePlayReviewRateLimit(rateKey, 1_000, 60_000, 12), `rate hit ${i + 1} allowed`);
  }
  assert(!consumePlayReviewRateLimit(rateKey, 1_000, 60_000, 12), '13th reviewer attempt is limited');

  console.log('test-phone-auth: OK');
}

run();
