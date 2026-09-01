/**
 * Prepare in-repo iOS store assets and print remaining manual steps.
 * Usage: npm run ios:prepare-store
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('generate-native-assets.mjs');
run('verify-ios-store.mjs');

console.log(`
iOS store prep finished (icon + in-repo checks).

Still manual (cannot be done in this repo):
  1. Copy .env.store.example → .env.production and fill Moyasar live keys, webhook secret, App Check.
  2. Create support@miras.com mailbox (or Gmail forward) and set SMTP_PASS / IMAP_PASS (App Password).
  3. Firebase Console → Phone numbers for testing → paste into fastlane/metadata/ios/review_information/
  4. npm run generate:store-screenshots (needs store/incoming captures) then upload 6.7" shots in App Store Connect.
  5. On a Mac: npm run cap:sync:ios → Xcode team 4TRJXRYK8A, bundle com.ahmed.miras → Archive → TestFlight.
  6. App Store Connect: app record, privacy nutrition labels, content rating, Saudi availability.
  7. firebase login then npm run deploy:hosting if AASA/hosting is stale.
`);
