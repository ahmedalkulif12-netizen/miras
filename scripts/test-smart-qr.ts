/**
 * Self-test for Smart QR User-Agent routing.
 * Run: npx tsx scripts/test-smart-qr.ts
 */
import {
  DEFAULT_IOS_APP_STORE_URL,
  DEFAULT_PLAY_STORE_URL,
  detectSmartQrPlatform,
  resolveAndroidPlayStoreUrl,
  resolveIosAppStoreUrl,
  resolveSmartQrLandingUrl,
  resolveSmartQrRedirectUrl,
} from '../src/lib/smartQrRedirect.ts';

let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok  ${message}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL  ${message}`);
}

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

assert(detectSmartQrPlatform(IPHONE) === 'ios', 'iPhone UA is ios');
assert(detectSmartQrPlatform(IPAD) === 'ios', 'iPad UA is ios');
assert(detectSmartQrPlatform('iPod touch') === 'ios', 'iPod UA is ios');
assert(detectSmartQrPlatform(ANDROID) === 'android', 'Android UA is android');
assert(detectSmartQrPlatform(DESKTOP) === 'other', 'Windows Chrome is other');
assert(detectSmartQrPlatform(MAC_SAFARI) === 'other', 'Mac Safari (no iPad token) is other');
assert(detectSmartQrPlatform('') === 'other', 'empty UA is other');

const landing = 'https://hamula-cfc6c.web.app';
assert(
  resolveSmartQrRedirectUrl(IPHONE, { appUrl: landing }) === DEFAULT_IOS_APP_STORE_URL,
  'iPhone redirects to default App Store search until Apple ID is set'
);
assert(
  resolveSmartQrRedirectUrl(ANDROID, { appUrl: landing }) === DEFAULT_PLAY_STORE_URL,
  'Android redirects to Play listing for com.miras.app'
);
assert(
  resolveSmartQrRedirectUrl(DESKTOP, { appUrl: landing }) === landing,
  'desktop redirects to public landing origin'
);
assert(
  resolveSmartQrRedirectUrl(DESKTOP, { appUrl: 'https://hamula-cfc6c.web.app/' }) === landing,
  'landing URL strips a trailing slash'
);

const customEnv = {
  IOS_APP_STORE_URL: 'https://apps.apple.com/app/id1234567890',
  ANDROID_PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.miras.app&hl=ar',
};
assert(
  resolveSmartQrRedirectUrl(IPHONE, { env: customEnv, appUrl: landing }) ===
    customEnv.IOS_APP_STORE_URL,
  'IOS_APP_STORE_URL overrides the iOS destination'
);
assert(
  resolveSmartQrRedirectUrl(ANDROID, { env: customEnv, appUrl: landing }) ===
    customEnv.ANDROID_PLAY_STORE_URL,
  'ANDROID_PLAY_STORE_URL overrides the Android destination'
);

assert(
  resolveIosAppStoreUrl({ APP_STORE_APPLE_ID: 'id999888777' }) === 'https://apps.apple.com/app/id999888777',
  'APP_STORE_APPLE_ID builds apps.apple.com/app/id…'
);
assert(
  resolveIosAppStoreUrl({ VITE_APP_STORE_APPLE_ID: '12345' }) === 'https://apps.apple.com/app/id12345',
  'VITE_APP_STORE_APPLE_ID is accepted'
);
assert(
  resolveAndroidPlayStoreUrl({ ANDROID_PLAY_STORE_URL: 'javascript:alert(1)' }) ===
    DEFAULT_PLAY_STORE_URL,
  'javascript: store URLs are rejected'
);
assert(
  resolveSmartQrLandingUrl({ APP_URL: 'https://hamula-cfc6c.web.app' }) === landing,
  'APP_URL is the desktop landing origin'
);

const { default: express } = await import('express');
const app = express();
app.get(['/qr', '/download'], (req, res) => {
  const location = resolveSmartQrRedirectUrl(String(req.get('user-agent') || ''), {
    appUrl: landing,
  });
  res.setHeader('Vary', 'User-Agent');
  res.redirect(302, location);
});
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', () => resolve());
  server.once('error', reject);
});
const port = (server.address() as { port: number }).port;

async function probe(path: string, ua: string): Promise<{ status: number; location: string | null; vary: string | null }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
    headers: { 'User-Agent': ua },
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    vary: res.headers.get('vary'),
  };
}

try {
  const iosHit = await probe('/qr', IPHONE);
  assert(iosHit.status === 302, 'Express /qr returns 302 for iPhone');
  assert(iosHit.location === DEFAULT_IOS_APP_STORE_URL, 'Express /qr Location is the iOS store URL');
  assert((iosHit.vary || '').toLowerCase().includes('user-agent'), 'Express /qr varies on User-Agent');

  const androidHit = await probe('/download', ANDROID);
  assert(androidHit.status === 302, 'Express /download returns 302 for Android');
  assert(androidHit.location === DEFAULT_PLAY_STORE_URL, 'Express /download Location is the Play URL');

  const desktopHit = await probe('/qr', DESKTOP);
  assert(desktopHit.status === 302, 'Express /qr returns 302 for desktop');
  assert(desktopHit.location === landing, 'Express /qr Location is the landing origin on desktop');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

if (failed) {
  console.error(`\n${failed} Smart QR assertion(s) failed`);
  process.exit(1);
}
console.log('\nSmart QR routing assertions passed');
