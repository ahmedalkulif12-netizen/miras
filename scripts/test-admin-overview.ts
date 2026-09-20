#!/usr/bin/env tsx
/**
 * Admin overview auth + cache tests.
 * Run: npx tsx scripts/test-admin-overview.ts
 */
import { assert, assertEqual } from '../e2e/helpers/assert.ts';
import { emptyAdminOverview } from '../server/lib/adminOverview.ts';
import {
  decodeIdTokenPayload,
  isExpiredIdTokenError,
  isTransientFirebaseAuthError,
  isWithinClockSkew,
} from '../server/lib/idTokenVerify.ts';
import {
  adminOverviewRetryDelayMs,
  emptyAdminOverviewResponse,
  isRetryableAdminOverviewStatus,
  parseAdminOverviewCache,
  serializeAdminOverviewCache,
} from '../src/lib/adminOverviewCache.ts';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function run(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiredJwt = makeJwt({
    sub: 'admin-uid',
    user_id: 'admin-uid',
    phone_number: '+966541330720',
    admin: true,
    exp: nowSec - 90,
    iat: nowSec - 3600,
  });

  const superJwt = makeJwt({
    sub: 'admin-uid',
    superuser: true,
    role: 'admin',
    exp: nowSec + 3600,
    iat: nowSec,
  });
  const superClaims = decodeIdTokenPayload(superJwt);
  assert(superClaims?.superuser === true, 'superuser claim decoded');
  assertEqual(String(superClaims?.role || ''), 'admin', 'role=admin claim decoded');

  const claims = decodeIdTokenPayload(expiredJwt);
  assert(claims !== null, 'decode expired JWT payload');
  assertEqual(claims?.uid, 'admin-uid', 'uid from user_id/sub');
  assertEqual(claims?.phone_number, '+966541330720', 'phone_number claim');
  assert(claims?.admin === true, 'admin claim decoded');
  assert(isWithinClockSkew(claims!, 600, nowSec), '90s-expired token is within 10m skew');
  assert(!isWithinClockSkew(claims!, 30, nowSec), '90s-expired token is outside 30s skew');

  assert(isExpiredIdTokenError({ code: 'auth/id-token-expired' }), 'expired code');
  assert(
    isTransientFirebaseAuthError({ code: 'auth/internal-error' }),
    'internal-error is transient'
  );
  assert(
    isTransientFirebaseAuthError(new Error('Could not load the default credentials')),
    'missing ADC is transient'
  );
  assert(!isTransientFirebaseAuthError({ code: 'auth/argument-error' }), 'argument-error is not transient');

  assert(isRetryableAdminOverviewStatus(401), '401 retryable');
  assert(isRetryableAdminOverviewStatus(403), '403 retryable');
  assert(isRetryableAdminOverviewStatus(503), '503 retryable');
  assert(isRetryableAdminOverviewStatus(500), '500 retryable');
  assert(!isRetryableAdminOverviewStatus(404), '404 not retryable');
  assertEqual(adminOverviewRetryDelayMs(0), 400, 'first retry delay');
  assertEqual(adminOverviewRetryDelayMs(1), 800, 'second retry delay');
  assertEqual(adminOverviewRetryDelayMs(2), 1600, 'third retry delay');
  assertEqual(adminOverviewRetryDelayMs(9), 1600, 'delay caps at last slot');

  const empty = emptyAdminOverview();
  assertEqual(empty.stats.activeDrivers, 0, 'empty overview zeros');
  assertEqual(empty.recentOrders.length, 0, 'empty overview has no feed');
  assertEqual(emptyAdminOverviewResponse().stats.netRevenueSar, 0, 'client empty fallback');

  const live = {
    ...emptyAdminOverviewResponse(),
    stats: { ...emptyAdminOverviewResponse().stats, totalUsers: 12, pendingDrivers: 3 },
  };
  const raw = serializeAdminOverviewCache(live, 1_700_000_000_000);
  const parsed = parseAdminOverviewCache(raw);
  assertEqual(parsed?.stats.totalUsers, 12, 'cache round-trip totalUsers');
  assertEqual(parsed?.stats.pendingDrivers, 3, 'cache round-trip pendingDrivers');
  assert(parseAdminOverviewCache('not-json') === null, 'invalid cache is null');
  assert(parseAdminOverviewCache('{"nope":true}') === null, 'wrong shape is null');

  console.log('admin overview tests passed');
}

run();
