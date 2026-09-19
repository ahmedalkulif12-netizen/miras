/**
 * Write ios/App/App/GoogleService-Info.plist from Codemagic/production env.
 * Uses the iOS Firebase app id (never the Web app id).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const googleAppId = (process.env.FIREBASE_IOS_GOOGLE_APP_ID || '').trim();
const apiKey = (process.env.FIREBASE_IOS_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
const projectId = (process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'hamula-cfc6c').trim();
const gcmSenderId = (process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '191963635866').trim();
const storageBucket = (process.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim();
const bundleId = (process.env.BUNDLE_ID || 'com.ahmed.miras').trim();
const clientId = (process.env.FIREBASE_IOS_CLIENT_ID || '').trim();
const reversedClientId = (process.env.FIREBASE_IOS_REVERSED_CLIENT_ID || '').trim();

if (!/:ios:/i.test(googleAppId)) {
  console.error('FIREBASE_IOS_GOOGLE_APP_ID must be the Firebase iOS app id (1:…:ios:…).');
  process.exit(1);
}
if (!apiKey) {
  console.error('FIREBASE_IOS_API_KEY or VITE_FIREBASE_API_KEY is required to write GoogleService-Info.plist.');
  process.exit(1);
}

const extra = [];
if (clientId) {
  extra.push(`	<key>CLIENT_ID</key>\n	<string>${xmlEscape(clientId)}</string>`);
}
if (reversedClientId) {
  extra.push(`	<key>REVERSED_CLIENT_ID</key>\n	<string>${xmlEscape(reversedClientId)}</string>`);
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>API_KEY</key>
	<string>${xmlEscape(apiKey)}</string>
	<key>GCM_SENDER_ID</key>
	<string>${xmlEscape(gcmSenderId)}</string>
	<key>PLIST_VERSION</key>
	<string>1</string>
	<key>BUNDLE_ID</key>
	<string>${xmlEscape(bundleId)}</string>
	<key>PROJECT_ID</key>
	<string>${xmlEscape(projectId)}</string>
	<key>STORAGE_BUCKET</key>
	<string>${xmlEscape(storageBucket)}</string>
	<key>IS_ADS_ENABLED</key>
	<false></false>
	<key>IS_ANALYTICS_ENABLED</key>
	<false></false>
	<key>IS_APPINVITE_ENABLED</key>
	<true></true>
	<key>IS_GCM_ENABLED</key>
	<true></true>
	<key>IS_SIGNIN_ENABLED</key>
	<true></true>
	<key>GOOGLE_APP_ID</key>
	<string>${xmlEscape(googleAppId)}</string>
${extra.join('\n')}
</dict>
</plist>
`;

const dest = path.join(root, 'ios', 'App', 'App', 'GoogleService-Info.plist');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, xml);

if (reversedClientId) {
  const infoPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');
  if (fs.existsSync(infoPath)) {
    let infoXml = fs.readFileSync(infoPath, 'utf8');
    if (!infoXml.includes(`<string>${reversedClientId}</string>`)) {
      infoXml = infoXml.replace(
        /(<key>CFBundleURLSchemes<\/key>\s*<array>)/,
        `$1\n\t\t\t\t<string>${xmlEscape(reversedClientId)}</string>`,
      );
      fs.writeFileSync(infoPath, infoXml);
    }
  }
}

const encodedAppScheme = `app-${googleAppId.replace(/:/g, '-')}`;
const looksInventedClientId = /-[0-9a-f]{20,}\.apps\.googleusercontent\.com$/i.test(clientId) &&
  googleAppId.split(':ios:')[1] &&
  clientId.includes(googleAppId.split(':ios:')[1]);
if (!clientId || looksInventedClientId) {
  console.warn(
    '[PhoneAuth] CLIENT_ID/REVERSED_CLIENT_ID missing or derived from GOOGLE_APP_ID. ' +
      'Safari reCAPTCHA needs the real iOS OAuth client from Firebase Console → Project settings → Your apps → Apple app. ' +
      `Encoded app URL scheme ${encodedAppScheme} is still registered as a fallback.`,
  );
}

console.log('Wrote ios/App/App/GoogleService-Info.plist for com.ahmed.miras');
