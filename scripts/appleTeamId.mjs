/**
 * Shared Apple App Site Association + Digital Asset Links emitters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ANDROID_PACKAGE = 'com.miras.app';
const SHA256_RE = /^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/;

export function parseAndroidSha256Fingerprints(env = process.env) {
  const raw = String(
    env.VITE_ANDROID_SHA256_CERT_FINGERPRINTS || env.ANDROID_SHA256_CERT_FINGERPRINTS || ''
  );
  return raw
    .split(/[,;\s]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

export function assertAndroidSha256Fingerprints(fingerprints) {
  if (!fingerprints.length) {
    throw new Error(
      'VITE_ANDROID_SHA256_CERT_FINGERPRINTS is empty. In Play Console → App integrity → App signing, copy the SHA-256 certificate fingerprint (colon-separated) into Codemagic group miras_client and .env.production.'
    );
  }
  const invalid = fingerprints.filter((value) => !SHA256_RE.test(value));
  if (invalid.length) {
    throw new Error(
      `Android SHA-256 fingerprints must be 32 colon-separated hex bytes (AA:BB:…). Invalid: ${invalid.length} value(s).`
    );
  }
  return fingerprints;
}

export function buildDigitalAssetLinks(fingerprints) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

const BUNDLE_ID = 'com.ahmed.miras';
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;

export function readAppleTeamId(env = process.env) {
  const raw = String(env.VITE_IOS_TEAM_ID || env.IOS_TEAM_ID || '').trim().toUpperCase();
  return TEAM_ID_RE.test(raw) ? raw : '';
}

export function assertAppleTeamId(teamId) {
  if (!TEAM_ID_RE.test(teamId)) {
    throw new Error(
      'Apple Team ID must be 10 characters (A–Z / 0–9). Find it at https://developer.apple.com/account → Membership.'
    );
  }
  return teamId;
}

export function buildAppleAppSiteAssociation(teamId) {
  const appId = `${teamId}.${BUNDLE_ID}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          appID: appId,
          paths: ['/payment-callback', '/payment-callback/*'],
          components: [{ '/': '/payment-callback' }, { '/': '/payment-callback/*' }],
        },
      ],
    },
  };
}

export function writeAppleAppSiteAssociationFiles(teamId, rootDir) {
  assertAppleTeamId(teamId);
  const json = `${JSON.stringify(buildAppleAppSiteAssociation(teamId), null, 2)}\n`;
  const targets = [
    path.join(rootDir, 'public', '.well-known', 'apple-app-site-association'),
    path.join(rootDir, 'public', 'apple-app-site-association'),
    path.join(rootDir, 'ios', 'App', 'App', 'public', '.well-known', 'apple-app-site-association'),
  ];
  for (const file of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json, 'utf8');
  }
  return targets;
}

export function writeTeamXcconfig(teamId, rootDir) {
  assertAppleTeamId(teamId);
  const file = path.join(rootDir, 'ios', 'Config', 'Team.xcconfig');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `// Apple Developer Team ID (public). Applied ${new Date().toISOString().slice(0, 10)}.\nDEVELOPMENT_TEAM = ${teamId}\n`,
    'utf8'
  );
  return file;
}

export function writeExportOptionsTeam(teamId, rootDir) {
  assertAppleTeamId(teamId);
  const file = path.join(rootDir, 'ios', 'ExportOptions.plist');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${teamId}</string>
	<key>uploadSymbols</key>
	<true/>
	<key>compileBitcode</key>
	<false/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
`;
  fs.writeFileSync(file, xml, 'utf8');
  return file;
}

export function projectRootFrom(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..');
}
