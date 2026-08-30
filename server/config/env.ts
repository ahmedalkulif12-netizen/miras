/**
 * P0-15: Server-side environment configuration.
 * Secrets live ONLY in process.env — never import VITE_* or client bundles here.
 */
import {
  assertDeployEnvironment,
  getDeployEnvironment,
  type DeployEnvironment,
} from './deployEnv.ts';
import { loadProjectEnv } from './loadProjectEnv.ts';

/** Safe placeholder for staging/local when Moyasar webhook secret is not configured yet. */
export const STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK = 'whsec_test_dummy';

export interface ServerConfig {
  nodeEnv: string;
  deployEnv: DeployEnvironment;
  isProduction: boolean;
  isDevelopment: boolean;
  isProductionDeploy: boolean;
  isStagingDeploy: boolean;
  port: number;
  appUrl: string;
  moyasarSecretKey: string;
  moyasarWebhookSecret: string;
  appCheckEnforce: boolean;
  firebaseProjectId: string;
  googleApplicationCredentials?: string;
  firebaseClientEmail?: string;
}

let loaded = false;
let cached: ServerConfig | null = null;

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Staging / local: fill MOYASAR_WEBHOOK_SECRET so verify + Cloud Run boot don't fail
 * when the operator has not created a Moyasar webhook yet.
 * Production always requires an explicit real secret.
 */
export function applyMoyasarWebhookSecretFallback(
  deployEnv: DeployEnvironment = getDeployEnvironment()
): string {
  const existing = readEnv('MOYASAR_WEBHOOK_SECRET');
  if (existing) {
    return existing;
  }

  if (deployEnv === 'production') {
    return '';
  }

  process.env.MOYASAR_WEBHOOK_SECRET = STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK;
  console.warn(
    `[env] MOYASAR_WEBHOOK_SECRET unset — using staging fallback "${STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK}". Replace with your Moyasar dashboard webhook secret before enabling live webhooks.`
  );
  return STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK;
}

/** Invalidate cached config (used by verify scripts after mutating process.env). */
export function resetServerConfigCache(): void {
  cached = null;
  loaded = false;
}

/** Load env files once using Vite merge rules (.env + .env.local + mode files). */
export function loadServerEnv(): void {
  if (loaded) return;
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  loadProjectEnv(mode);
  applyMoyasarWebhookSecretFallback(getDeployEnvironment());
  loaded = true;
}

export function getServerConfig(): ServerConfig {
  if (cached) return cached;

  loadServerEnv();

  const nodeEnv = readEnv('NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';
  const deployEnv = getDeployEnvironment();
  const moyasarWebhookSecret = applyMoyasarWebhookSecretFallback(deployEnv);

  cached = {
    nodeEnv,
    deployEnv,
    isProduction,
    isDevelopment: !isProduction,
    isProductionDeploy: deployEnv === 'production',
    isStagingDeploy: deployEnv === 'staging',
    port: Number(process.env.PORT || readEnv('PORT') || '8080'),
    appUrl: readEnv('APP_URL') || 'http://localhost:3000',
    moyasarSecretKey: readEnv('MOYASAR_SECRET_KEY'),
    moyasarWebhookSecret,
    appCheckEnforce: readEnv('APP_CHECK_ENFORCE') === 'true',
    firebaseProjectId:
      readEnv('FIREBASE_PROJECT_ID') || readEnv('VITE_FIREBASE_PROJECT_ID'),
    googleApplicationCredentials: readEnv('GOOGLE_APPLICATION_CREDENTIALS') || undefined,
    firebaseClientEmail: readEnv('FIREBASE_CLIENT_EMAIL') || undefined,
  };

  return cached;
}

/**
 * Fail fast when hosting a production/staging build (NODE_ENV=production).
 * Combines secret presence checks with deploy-target rules (HTTPS, live keys, App Check).
 */
export function assertProductionSecrets(config: ServerConfig = getServerConfig()): void {
  if (!config.isProduction) return;

  requireEnv('MOYASAR_SECRET_KEY');
  requireEnv('APP_URL');
  requireEnv('FIREBASE_PROJECT_ID');

  // Staging may use the dummy fallback; production must have a real webhook secret.
  if (config.deployEnv === 'production') {
    requireEnv('MOYASAR_WEBHOOK_SECRET');
    if (config.moyasarWebhookSecret === STAGING_MOYASAR_WEBHOOK_SECRET_FALLBACK) {
      throw new Error(
        'Production deploy cannot use the staging webhook fallback (whsec_test_dummy). Set MOYASAR_WEBHOOK_SECRET from Moyasar Dashboard.'
      );
    }
  } else {
    applyMoyasarWebhookSecretFallback(config.deployEnv);
    if (!readEnv('MOYASAR_WEBHOOK_SECRET')) {
      throw new Error('Missing required environment variable: MOYASAR_WEBHOOK_SECRET');
    }
  }

  const moyasarKey = config.moyasarSecretKey;

  // Legacy guard when MIRAS_DEPLOY_ENV is unset but NODE_ENV=production.
  if (config.deployEnv === 'development' && moyasarKey.startsWith('sk_test_')) {
    throw new Error(
      'NODE_ENV=production with sk_test_* — set MIRAS_DEPLOY_ENV=staging explicitly or use sk_live_* for production'
    );
  }

  assertDeployEnvironment(config);

  if (
    !config.googleApplicationCredentials &&
    !readEnv('FIREBASE_SERVICE_ACCOUNT_JSON') &&
    !readEnv('FIREBASE_SERVICE_ACCOUNT_BASE64') &&
    !readEnv('FIREBASE_CLIENT_EMAIL')
  ) {
    console.warn(
      '[env] No Firebase Admin service account set — using application default credentials. ' +
        'Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_CLIENT_EMAIL+FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS.'
    );
  }
}

/** Guard payment routes when Moyasar is not configured (dev-friendly). */
export function assertMoyasarConfigured(config: ServerConfig = getServerConfig()): void {
  if (!config.moyasarSecretKey) {
    throw Object.assign(new Error('MOYASAR_SECRET_KEY is not configured'), { statusCode: 503 });
  }
}
