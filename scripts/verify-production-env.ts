#!/usr/bin/env tsx
/**
 * Pre-deploy verifier — run on CI or locally before promoting a build.
 * Reads process.env only; never prints secret values.
 */
import {
  loadServerEnv,
  getServerConfig,
  assertProductionSecrets,
  applyMoyasarWebhookSecretFallback,
  resetServerConfigCache,
  STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK,
} from '../server/config/env.ts';
import { getDeployEnvironment } from '../server/config/deployEnv.ts';
import { validateRecaptchaSiteKey } from '../src/lib/appCheck/config.ts';

type Check = { name: string; ok: boolean; detail: string };

function push(checks: Check[], name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function has(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function main(): number {
  const target = (process.argv[2] || 'production').toLowerCase();
  if (target !== 'production' && target !== 'staging') {
    console.error('Usage: tsx scripts/verify-production-env.ts [production|staging]');
    return 1;
  }

  process.env.MIRAS_DEPLOY_ENV = target;
  process.env.HAMOULA_DEPLOY_ENV = target;
  process.env.NODE_ENV = 'production';
  resetServerConfigCache();

  const checks: Check[] = [];

  loadServerEnv();
  // Staging verify: ensure webhook secret exists (real value or safe dummy fallback).
  if (target === 'staging') {
    applyMoyasarWebhookSecretFallback('staging');
  }

  const config = getServerConfig();

  push(checks, 'deployEnv', getDeployEnvironment() === target, `MIRAS_DEPLOY_ENV=${getDeployEnvironment()}`);

  for (const key of [
    'APP_URL',
    'FIREBASE_PROJECT_ID',
    'MOYASAR_SECRET_KEY',
    'MOYASAR_WEBHOOK_SECRET',
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_APP_ID',
    'VITE_GOOGLE_MAPS_PLATFORM_KEY',
  ] as const) {
    const present = has(key);
    const detail =
      key === 'MOYASAR_WEBHOOK_SECRET' &&
      present &&
      process.env.MOYASAR_WEBHOOK_SECRET === STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK
        ? 'set (staging fallback whsec_test_dummy)'
        : present
          ? 'set'
          : 'missing';
    push(checks, key, present, detail);
  }

  if (target === 'production') {
    push(
      checks,
      'APP_URL https',
      config.appUrl.startsWith('https://'),
      config.appUrl || '(empty)'
    );
    push(
      checks,
      'Moyasar live key',
      config.moyasarSecretKey.startsWith('sk_live_'),
      config.moyasarSecretKey.startsWith('sk_live_') ? 'sk_live_* present' : 'must be sk_live_*'
    );
    push(checks, 'App Check enforce', config.appCheckEnforce, String(config.appCheckEnforce));
    push(
      checks,
      'No App Check debug token',
      !process.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim(),
      process.env.VITE_APP_CHECK_DEBUG_TOKEN ? 'VITE_APP_CHECK_DEBUG_TOKEN must be unset' : 'ok'
    );
    const siteKeyRaw = process.env.VITE_APP_CHECK_RECAPTCHA_SITE_KEY?.trim();
    const siteKeyCheck = validateRecaptchaSiteKey(siteKeyRaw);
    push(
      checks,
      'reCAPTCHA site key',
      siteKeyCheck.ok,
      siteKeyCheck.ok
        ? 'VITE_APP_CHECK_RECAPTCHA_SITE_KEY valid (reCAPTCHA v3)'
        : siteKeyCheck.error ?? 'VITE_APP_CHECK_RECAPTCHA_SITE_KEY required for web production'
    );
  } else {
    push(
      checks,
      'Staging Moyasar test key',
      !config.moyasarSecretKey || config.moyasarSecretKey.startsWith('sk_test_'),
      config.moyasarSecretKey.startsWith('sk_live_') ? 'sk_live_* not allowed on staging' : 'ok'
    );
    push(checks, 'E2E project pin optional', true, 'Set E2E_ALLOWED_FIREBASE_PROJECT for smoke tests');
  }

  let startupOk = true;
  try {
    assertProductionSecrets(config);
  } catch (error) {
    startupOk = false;
    push(
      checks,
      'assertProductionSecrets',
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  if (startupOk) {
    push(checks, 'assertProductionSecrets', true, 'passed');
  }

  console.log(`\nMiras deploy verification (${target})\n`);
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);

  return failed.length > 0 ? 1 : 0;
}

process.exitCode = main();
