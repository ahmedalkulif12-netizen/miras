import type { ServerConfig } from './env.ts';

/** Logical deploy target — independent of NODE_ENV (staging can use production builds). */
export type DeployEnvironment = 'development' | 'staging' | 'production';

export function getDeployEnvironment(): DeployEnvironment {
  const raw = (
    process.env.MIRAS_DEPLOY_ENV ||
    process.env.HAMOULA_DEPLOY_ENV
  )
    ?.trim()
    .toLowerCase();
  if (raw === 'staging' || raw === 'production') return raw;
  return 'development';
}

export function isProductionDeploy(deployEnv: DeployEnvironment = getDeployEnvironment()): boolean {
  return deployEnv === 'production';
}

export function isStagingDeploy(deployEnv: DeployEnvironment = getDeployEnvironment()): boolean {
  return deployEnv === 'staging';
}

function requireHttpsUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid URL (got "${url}")`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS in production (got "${url}")`);
  }
}

/**
 * Production deploy safety — fail fast before serving traffic or processing payments.
 * Keeps staging/dev permissive while production requires live Moyasar + App Check + HTTPS.
 */
export function assertDeployEnvironment(config: ServerConfig): void {
  const deployEnv = getDeployEnvironment();

  if (deployEnv === 'development') {
    return;
  }

  if (!config.firebaseProjectId) {
    throw new Error(`MIRAS_DEPLOY_ENV=${deployEnv}: FIREBASE_PROJECT_ID is required`);
  }

  // Optional hard pin — prevents pointing production build at wrong Firebase project.
  const expectedProject = (
    process.env.MIRAS_EXPECTED_FIREBASE_PROJECT ||
    process.env.HAMOULA_EXPECTED_FIREBASE_PROJECT
  )?.trim();
  if (expectedProject && config.firebaseProjectId !== expectedProject) {
    throw new Error(
      `Firebase project mismatch: FIREBASE_PROJECT_ID="${config.firebaseProjectId}" but MIRAS_EXPECTED_FIREBASE_PROJECT="${expectedProject}"`
    );
  }

  if (deployEnv === 'staging') {
    if (!config.moyasarSecretKey) {
      console.warn(
        '[env] Staging: MOYASAR_SECRET_KEY unset — payment routes will return 503 until a sk_test_* key is set.'
      );
      return;
    }
    if (config.moyasarSecretKey.startsWith('sk_live_')) {
      throw new Error(
        'Staging deploy cannot use Moyasar live key (sk_live_*). Use sk_test_* on staging hosts.'
      );
    }
    if (!config.moyasarSecretKey.startsWith('sk_test_')) {
      throw new Error(
        'Staging deploy requires Moyasar test secret key (sk_test_*). See deploy/cloud-run.env.example'
      );
    }
    // Live Firebase Hosting / custom domain should still use HTTPS for Moyasar callbacks.
    if (config.appUrl && !config.appUrl.startsWith('http://localhost') && !config.appUrl.startsWith('http://127.0.0.1')) {
      requireHttpsUrl(config.appUrl, 'APP_URL');
    }
    return;
  }

  // --- production ---
  requireHttpsUrl(config.appUrl, 'APP_URL');

  if (!config.moyasarSecretKey.startsWith('sk_live_')) {
    throw new Error('Production deploy requires Moyasar live secret key (sk_live_*)');
  }

  if (!config.appCheckEnforce) {
    throw new Error(
      'Production deploy requires APP_CHECK_ENFORCE=true (enable Firebase App Check in Console first)'
    );
  }

  if (process.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim()) {
    throw new Error(
      'Production deploy cannot ship with VITE_APP_CHECK_DEBUG_TOKEN — remove from host/build env'
    );
  }
}
