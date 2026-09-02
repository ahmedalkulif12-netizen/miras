import { loadServerEnv, getServerConfig } from '../server/config/env.ts';

export interface StagingGuardResult {
  projectId: string;
  baseUrl: string;
  appCheckEnforce: boolean;
  moyasarIsTestKey: boolean;
}

/**
 * Hard safety gate — E2E must never run against production payment keys or
 * production hosts unless every guard below is explicitly satisfied.
 */
export function assertStagingEnvironment(): StagingGuardResult {
  loadServerEnv();
  const config = getServerConfig();

  if (process.env.E2E_STAGING !== 'true') {
    throw new Error(
      'E2E blocked: set E2E_STAGING=true to confirm you intend staging validation only.'
    );
  }

  const deployEnv = (
    process.env.MIRAS_DEPLOY_ENV ||
    process.env.HAMOULA_DEPLOY_ENV
  )
    ?.trim()
    .toLowerCase() || 'development';
  if (deployEnv === 'production') {
    throw new Error(
      'E2E blocked: MIRAS_DEPLOY_ENV=production — run smoke tests only against staging deploy target.'
    );
  }

  const allowedProject = process.env.E2E_ALLOWED_FIREBASE_PROJECT?.trim();
  const projectId = config.firebaseProjectId;
  if (!allowedProject) {
    throw new Error(
      'E2E blocked: set E2E_ALLOWED_FIREBASE_PROJECT to your staging Firebase project id.'
    );
  }
  if (projectId !== allowedProject) {
    throw new Error(
      `E2E blocked: FIREBASE_PROJECT_ID "${projectId}" does not match E2E_ALLOWED_FIREBASE_PROJECT "${allowedProject}".`
    );
  }

  const moyasarKey = config.moyasarSecretKey;
  if (moyasarKey.startsWith('sk_live_')) {
    throw new Error('E2E blocked: Moyasar live secret key (sk_live_*) is not allowed for automated tests.');
  }

  const baseUrl = (process.env.E2E_BASE_URL || config.appUrl || 'http://localhost:3000').replace(/\/$/, '');
  const productionHostPattern = /^https:\/\/(?!staging\.|.*\.staging\.)/i;
  if (config.isProduction && productionHostPattern.test(baseUrl) && process.env.E2E_ALLOW_PROD_HOST !== 'yes') {
    throw new Error(
      'E2E blocked: production NODE_ENV with a production-looking APP_URL. Set E2E_ALLOW_PROD_HOST=yes only for dedicated staging hosts.'
    );
  }

  for (const name of ['E2E_CUSTOMER_UID', 'E2E_DRIVER_A_UID', 'E2E_DRIVER_B_UID'] as const) {
    if (!process.env[name]?.trim()) {
      throw new Error(`E2E blocked: ${name} is required (dedicated staging test Firebase UIDs).`);
    }
  }

  const prefix = process.env.E2E_UID_PREFIX?.trim();
  if (prefix) {
    for (const name of ['E2E_CUSTOMER_UID', 'E2E_DRIVER_A_UID', 'E2E_DRIVER_B_UID'] as const) {
      const uid = process.env[name]!.trim();
      if (!uid.startsWith(prefix)) {
        throw new Error(`E2E blocked: ${name} "${uid}" must start with E2E_UID_PREFIX "${prefix}".`);
      }
    }
  }

  return {
    projectId,
    baseUrl,
    appCheckEnforce: config.appCheckEnforce,
    moyasarIsTestKey: !moyasarKey || moyasarKey.startsWith('sk_test_'),
  };
}
