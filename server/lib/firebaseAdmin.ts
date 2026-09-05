import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin';

function readEnv(name: string): string {
  return process.env[name]?.trim() || '';
}

function unescapePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function serviceAccountFromObject(raw: Record<string, unknown>): ServiceAccount | null {
  const projectId = String(raw.project_id || raw.projectId || '');
  const clientEmail = String(raw.client_email || raw.clientEmail || '');
  const privateKey = unescapePrivateKey(String(raw.private_key || raw.privateKey || ''));
  if (!clientEmail || !privateKey) return null;
  return {
    projectId: projectId || undefined,
    clientEmail,
    privateKey,
  };
}

function loadServiceAccountFromEnv(): ServiceAccount | null {
  const inlineJson = readEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (inlineJson) {
    const parsed = parseJsonObject(inlineJson);
    if (parsed) return serviceAccountFromObject(parsed);
  }

  const inlineB64 = readEnv('FIREBASE_SERVICE_ACCOUNT_BASE64');
  if (inlineB64) {
    try {
      const decoded = Buffer.from(inlineB64, 'base64').toString('utf8');
      const parsed = parseJsonObject(decoded);
      if (parsed) return serviceAccountFromObject(parsed);
    } catch {
      /* ignore invalid base64 */
    }
  }

  const clientEmail = readEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = unescapePrivateKey(readEnv('FIREBASE_PRIVATE_KEY'));
  if (clientEmail && privateKey) {
    return {
      projectId: readEnv('FIREBASE_PROJECT_ID') || readEnv('VITE_FIREBASE_PROJECT_ID') || undefined,
      clientEmail,
      privateKey,
    };
  }

  return null;
}

function loadServiceAccountFromFile(filePath: string): ServiceAccount | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const parsed = parseJsonObject(fs.readFileSync(filePath, 'utf8'));
    return parsed ? serviceAccountFromObject(parsed) : null;
  } catch {
    return null;
  }
}

function candidateCredentialFiles(): string[] {
  const fromEnv = readEnv('GOOGLE_APPLICATION_CREDENTIALS');
  const cwd = process.cwd();
  return [
    fromEnv,
    path.resolve(cwd, 'secrets', 'firebase-service-account.json'),
    path.resolve(cwd, 'firebase-service-account.json'),
  ].filter(Boolean);
}

export type AdminCredentialMode = 'cert' | 'adc' | 'project-only';

let credentialMode: AdminCredentialMode = 'project-only';
let adminFirestoreReady = false;

function isCloudRuntime(): boolean {
  return Boolean(
    process.env.K_SERVICE ||
      process.env.FUNCTION_TARGET ||
      process.env.CLOUD_RUN_JOB ||
      process.env.K_REVISION
  );
}

/** Local `tsx server.ts` / Vite — never attach ADC (Windows throws on first Firestore write). */
function shouldSkipApplicationDefault(): boolean {
  if (readEnv('FORCE_FIREBASE_ADC') === 'true') return false;
  if (isCloudRuntime()) return false;
  return true;
}

export function canUseAdminFirestore(): boolean {
  return adminFirestoreReady;
}

export function getAdminCredentialMode(): AdminCredentialMode {
  return credentialMode;
}

/**
 * Initialize Firebase Admin with explicit credentials.
 * Order: service-account env/file → ADC (Cloud Run only) → projectId-only (token verify, no Admin writes).
 */
export function initFirebaseAdmin(projectId: string): admin.app.App {
  if (admin.apps.length) {
    return admin.app();
  }

  const fromEnv = loadServiceAccountFromEnv();
  if (fromEnv) {
    adminFirestoreReady = true;
    credentialMode = 'cert';
    console.info('[firebase-admin] Initialized with service account env credentials');
    return admin.initializeApp({
      credential: admin.credential.cert(fromEnv),
      projectId: fromEnv.projectId || projectId || undefined,
    });
  }

  for (const filePath of candidateCredentialFiles()) {
    const fromFile = loadServiceAccountFromFile(filePath);
    if (fromFile) {
      adminFirestoreReady = true;
      credentialMode = 'cert';
      console.info('[firebase-admin] Initialized with service account file');
      return admin.initializeApp({
        credential: admin.credential.cert(fromFile),
        projectId: fromFile.projectId || projectId || undefined,
      });
    }
  }

  if (!shouldSkipApplicationDefault()) {
    try {
      const app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: projectId || undefined,
      });
      adminFirestoreReady = true;
      credentialMode = 'adc';
      console.info('[firebase-admin] Initialized with application default credentials');
      return app;
    } catch (error) {
      console.warn(
        '[firebase-admin] ADC unavailable — initializing with projectId only.',
        error
      );
    }
  }

  adminFirestoreReady = false;
  credentialMode = 'project-only';
  console.warn(
    '[firebase-admin] No service account on this machine — Admin Firestore writes are disabled. ' +
      'publish-after-checkout will use the caller ID token or return clientWriteRequired (no 500).'
  );
  return admin.initializeApp(projectId ? { projectId } : undefined);
}

export function isFirebaseAdminCredentialError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /default credentials|Could not load the default credentials|unable to detect a Project Id|UNAUTHENTICATED|PERMISSION_DENIED|Missing or insufficient permissions/i.test(
    message
  );
}
