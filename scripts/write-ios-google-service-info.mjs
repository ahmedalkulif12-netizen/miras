/**
 * Write ios/App/App/GoogleService-Info.plist from Codemagic/production env.
 * Uses the iOS Firebase app id (never the Web app id).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMirasProduction } from './loadMirasProduction.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plistString(xml, key) {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1]?.trim() || '';
}

function iosAppHash(googleAppId) {
  return (String(googleAppId).split(':ios:')[1] || '').trim();
}

const OAUTH_PLACEHOLDER = 'DISABLED_USE_BUNDLED_PLIST';

function isDisabledOAuthPlaceholder(id) {
  const value = String(id || '').trim();
  return !value || value === OAUTH_PLACEHOLDER || /^DISABLED_/i.test(value);
}

/** Invented IDs were `{projectNumber}-{GOOGLE_APP_ID hash}` — they cause auth/invalid-oauth-client-id. */
function isInventedIosOAuthClient(id, googleAppId) {
  const hash = iosAppHash(googleAppId);
  return Boolean(id && hash && id.includes(hash));
}

const dest = path.join(root, 'ios', 'App', 'App', 'GoogleService-Info.plist');
const existingXml = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';

const canon = loadMirasProduction();

const envProject = (process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
if (envProject && envProject !== canon.projectId) {
  console.error(
    `Refusing iOS plist for PROJECT_ID=${envProject}. Live Miras App is ${canon.projectId}.`
  );
  process.exit(1);
}

const googleAppId = (
  process.env.FIREBASE_IOS_GOOGLE_APP_ID ||
  plistString(existingXml, 'GOOGLE_APP_ID') ||
  canon.iosGoogleAppId
).trim();
const apiKey = (
  process.env.FIREBASE_IOS_API_KEY ||
  plistString(existingXml, 'API_KEY') ||
  canon.iosApiKey
).trim();
const projectId = canon.projectId;
const gcmSenderId = canon.messagingSenderId;
const storageBucket = canon.storageBucket;
const bundleId = (process.env.BUNDLE_ID || canon.iosBundleId).trim();
let clientId = (process.env.FIREBASE_IOS_CLIENT_ID || '').trim();
let reversedClientId = (process.env.FIREBASE_IOS_REVERSED_CLIENT_ID || '').trim();
if (isDisabledOAuthPlaceholder(clientId)) {
  clientId = plistString(existingXml, 'CLIENT_ID');
}
if (isDisabledOAuthPlaceholder(reversedClientId)) {
  reversedClientId = plistString(existingXml, 'REVERSED_CLIENT_ID');
}

if (!/:ios:/i.test(googleAppId)) {
  console.error('FIREBASE_IOS_GOOGLE_APP_ID must be the Firebase iOS app id (1:…:ios:…).');
  process.exit(1);
}
if (googleAppId !== canon.iosGoogleAppId) {
  console.error(
    `GOOGLE_APP_ID must be the Miras App iOS id (${canon.iosGoogleAppId}), got ${googleAppId}.`
  );
  process.exit(1);
}
if (!apiKey) {
  console.error('FIREBASE_IOS_API_KEY is required to write GoogleService-Info.plist.');
  process.exit(1);
}
if (apiKey === String(process.env.VITE_FIREBASE_API_KEY || '').trim() && apiKey !== canon.iosApiKey) {
  console.error('Refusing to write the Web VITE_FIREBASE_API_KEY into GoogleService-Info.plist.');
  process.exit(1);
}
if (apiKey !== canon.iosApiKey) {
  console.error('FIREBASE_IOS_API_KEY must match the live Miras App iOS GoogleService-Info.plist API_KEY.');
  process.exit(1);
}
if (bundleId !== canon.iosBundleId) {
  console.error(`BUNDLE_ID must be ${canon.iosBundleId} (got ${bundleId}).`);
  process.exit(1);
}

if (isDisabledOAuthPlaceholder(clientId)) clientId = '';
if (isDisabledOAuthPlaceholder(reversedClientId)) reversedClientId = '';
if (isInventedIosOAuthClient(clientId, googleAppId) || isInventedIosOAuthClient(reversedClientId, googleAppId)) {
  console.warn(
    '[PhoneAuth] dropping invented FIREBASE_IOS_CLIENT_ID / REVERSED_CLIENT_ID (GOOGLE_APP_ID hash). ' +
      'That value is not a Google OAuth client and causes auth/invalid-oauth-client-id.',
  );
  clientId = '';
  reversedClientId = '';
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
if (!clientId) {
  console.warn(
    '[PhoneAuth] CLIENT_ID omitted — using API_KEY + GOOGLE_APP_ID from GoogleService-Info.plist. ' +
      `Encoded app URL scheme ${encodedAppScheme} remains registered. ` +
      'Add the real iOS OAuth client (Firebase Console → Project settings → Your apps → Apple app) when Console provides CLIENT_ID.',
  );
}

console.log(
  `Wrote ios/App/App/GoogleService-Info.plist bundle=${bundleId} googleAppId=${googleAppId} ` +
    `apiKeyPrefix=${apiKey.slice(0, 8)} clientId=${clientId ? 'from-plist' : 'omitted'}`,
);
