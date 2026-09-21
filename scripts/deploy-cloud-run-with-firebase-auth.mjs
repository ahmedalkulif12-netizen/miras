import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = path.join(process.env.TEMP || process.env.TMP || '', 'miras-fb-tools', 'node_modules');
const require = createRequire(path.join(toolsRoot, 'firebase-tools', 'package.json'));

const auth = require('firebase-tools/lib/auth.js');
const scopes = require('firebase-tools/lib/scopes.js');

const account = auth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) {
  throw new Error('Firebase CLI is not logged in. Run: npx firebase-tools login');
}

const tokenResult = await auth.getAccessToken(account.tokens.refresh_token, [
  scopes.CLOUD_PLATFORM,
]);
const accessToken = tokenResult?.access_token || tokenResult;
if (!accessToken || typeof accessToken !== 'string') {
  throw new Error('Could not mint a Google access token from the Firebase CLI session');
}

const gcloud = path.join(
  process.env.LOCALAPPDATA || '',
  'Google',
  'Cloud SDK',
  'google-cloud-sdk',
  'bin',
  'gcloud.cmd'
);

console.log('Deploying hamula-api from the Firebase CLI Google session (existing Cloud Run secrets kept).');

const args = [
  'run',
  'deploy',
  'hamula-api',
  '--project=hamula-cfc6c',
  '--region=us-central1',
  `--source=${root}`,
  '--platform=managed',
  '--allow-unauthenticated',
  '--port=8080',
  '--memory=512Mi',
  '--cpu=1',
  '--min-instances=0',
  '--max-instances=10',
  '--quiet',
  '--update-env-vars=NODE_ENV=production,MIRAS_PROCESS_ROLE=api,MIRAS_DEPLOY_ENV=staging,HAMOULA_DEPLOY_ENV=staging,FIREBASE_PROJECT_ID=hamula-cfc6c,MIRAS_EXPECTED_FIREBASE_PROJECT=hamula-cfc6c,HAMOULA_EXPECTED_FIREBASE_PROJECT=hamula-cfc6c,APP_URL=https://hamula-cfc6c.web.app,APP_CHECK_ENFORCE=false,APP_STORE_APPLE_ID=6807503584',
];

const child = spawn(`"${gcloud}" ${args.map((a) => `"${a}"`).join(' ')}`, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    CLOUDSDK_AUTH_ACCESS_TOKEN: accessToken,
    CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
