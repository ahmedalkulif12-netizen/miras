#!/usr/bin/env tsx
/**
 * Auth router tests — existing vs brand-new users after OTP.
 * Run: npx tsx scripts/test-auth-routing.ts
 */
import { APP_ROLES } from '../src/domain/user-schema.ts';
import {
  buildLoginRedirectPath,
  isExistingRegisteredUser,
  resolveLoginEntryPath,
  resolvePostLoginPath,
  resolvePostOtpAuth,
  resolveRegisterEntryPath,
} from '../src/lib/authRouting.ts';
import type { UserProfile } from '../src/lib/userProfile.ts';
import { assert, assertEqual } from '../e2e/helpers/assert.ts';

function profile(role: UserProfile['role'], uid = 'uid-1'): UserProfile {
  return {
    uid,
    phone: '+966500000001',
    role,
    name: 'Test User',
  };
}

function run(): void {
  // Existing client — skip onboarding, even if the login tab was "driver".
  const existingClient = resolvePostOtpAuth({
    existingProfile: profile(APP_ROLES.B2C_CLIENT),
    intendedRole: APP_ROLES.B2C_DRIVER,
  });
  assert(existingClient.kind === 'existing', 'existing client must skip onboarding');
  if (existingClient.kind === 'existing') {
    assertEqual(existingClient.profile.role, APP_ROLES.B2C_CLIENT, 'Firestore role wins over UI tab');
    assertEqual(existingClient.path, '/b2c/client', 'client dashboard path');
  }

  // Existing individual driver.
  const existingDriver = resolvePostOtpAuth({
    existingProfile: profile(APP_ROLES.B2C_DRIVER),
    intendedRole: APP_ROLES.B2C_CLIENT,
  });
  assert(existingDriver.kind === 'existing', 'existing driver must skip onboarding');
  if (existingDriver.kind === 'existing') {
    assertEqual(existingDriver.path.split('?')[0], '/b2c/driver', 'driver dashboard path');
  }

  // Existing company (corporate).
  const existingCorporate = resolvePostOtpAuth({
    existingProfile: profile(APP_ROLES.B2B_CORPORATE),
    intendedRole: APP_ROLES.B2C_CLIENT,
  });
  assert(existingCorporate.kind === 'existing', 'existing corporate must skip onboarding');
  if (existingCorporate.kind === 'existing') {
    assertEqual(existingCorporate.path, '/b2b/corporate', 'corporate dashboard path');
  }

  // Existing fleet operator.
  const existingOperator = resolvePostOtpAuth({
    existingProfile: profile(APP_ROLES.B2B_OPERATOR),
    intendedRole: APP_ROLES.B2C_DRIVER,
  });
  assert(existingOperator.kind === 'existing', 'existing operator must skip onboarding');
  if (existingOperator.kind === 'existing') {
    assertEqual(existingOperator.path, '/b2b/operator', 'operator dashboard path');
  }

  // Brand-new users — every registrable role goes to the registration form.
  for (const intendedRole of [
    APP_ROLES.B2C_CLIENT,
    APP_ROLES.B2C_DRIVER,
    APP_ROLES.B2B_CORPORATE,
    APP_ROLES.B2B_OPERATOR,
  ] as const) {
    const fresh = resolvePostOtpAuth({
      existingProfile: null,
      intendedRole,
    });
    assert(fresh.kind === 'onboarding', `new ${intendedRole} must see registration form`);
    if (fresh.kind === 'onboarding') {
      assertEqual(fresh.intendedRole, intendedRole, `onboarding role ${intendedRole}`);
    }
  }

  assertEqual(isExistingRegisteredUser(null), false, 'null is not an existing user');
  assertEqual(isExistingRegisteredUser(profile(APP_ROLES.B2C_CLIENT)), true, 'client profile exists');

  const withNext = resolvePostOtpAuth({
    existingProfile: profile(APP_ROLES.B2C_CLIENT),
    intendedRole: APP_ROLES.B2C_CLIENT,
    nextRaw: '/b2c/client/orders',
  });
  assert(withNext.kind === 'existing', 'existing + safe next stays existing');
  if (withNext.kind === 'existing') {
    assertEqual(withNext.path, '/b2c/client/orders', 'safe next path honored');
  }

  const hijack = resolvePostLoginPath(profile(APP_ROLES.B2C_CLIENT), '/b2c/driver');
  assertEqual(hijack, '/b2c/client', 'next path for a different role is rejected');

  assertEqual(resolveLoginEntryPath(null), '/login?mode=login', 'guest login entry');
  assertEqual(resolveRegisterEntryPath(null), '/login?mode=register', 'guest register entry');
  assertEqual(
    resolveLoginEntryPath(profile(APP_ROLES.B2C_CLIENT)),
    '/b2c/client',
    'signed-in login CTA goes home'
  );

  const protectedLogin = buildLoginRedirectPath({
    requiredRole: APP_ROLES.B2C_DRIVER,
    returnTo: '/b2c/driver',
  });
  assert(protectedLogin.includes('mode=login'), 'protected route uses login mode');
  const onboardingRedirect = buildLoginRedirectPath({
    requiredRole: APP_ROLES.B2C_DRIVER,
    mode: 'register',
  });
  assert(onboardingRedirect.includes('mode=register'), 'onboarding uses register mode');

  console.log('auth routing: existing users skip onboarding; new users register. OK');
}

run();
