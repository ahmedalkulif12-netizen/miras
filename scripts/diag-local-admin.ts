/**
 * Local diagnostic: Firebase Admin must not attach ADC on a developer machine.
 * Run: npx tsx scripts/diag-local-admin.ts
 */
import { initFirebaseAdmin, canUseAdminFirestore, getAdminCredentialMode } from '../server/lib/firebaseAdmin.ts';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'hamula-cfc6c';
initFirebaseAdmin(projectId);

const mode = getAdminCredentialMode();
const ready = canUseAdminFirestore();

console.log(JSON.stringify({ projectId, mode, adminFirestoreReady: ready }, null, 2));

if (mode === 'project-only' && ready) {
  console.error('FAIL: project-only init must not mark Admin Firestore ready');
  process.exit(1);
}

if (mode === 'project-only') {
  console.log('OK: local Admin is project-only — publish-after-checkout will not 500 on missing ADC');
  process.exit(0);
}

if (ready && (mode === 'cert' || mode === 'adc')) {
  console.log('OK: Admin credentials are present');
  process.exit(0);
}

console.error('FAIL: unexpected Admin credential state');
process.exit(1);
