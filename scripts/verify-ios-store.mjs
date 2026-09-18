/**
 * Fail the iOS store prep if Team ID, AASA, icon alpha, or Info.plist are wrong.
 * Does not print secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { readAppleTeamId } from './appleTeamId.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

async function main() {
  const failures = [];
  const teamId = readAppleTeamId(process.env);
  const aasa = JSON.parse(read('public/.well-known/apple-app-site-association'));
  const appId = aasa?.applinks?.details?.[0]?.appID || '';
  const xcconfig = read('ios/Config/Team.xcconfig');
  const exportOptions = read('ios/ExportOptions.plist');
  const infoPlist = read('ios/App/App/Info.plist');
  const iconPath = path.join(
    root,
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
  );

  if (!/^[A-Z0-9]{10}$/.test(teamId) && !/DEVELOPMENT_TEAM = [A-Z0-9]{10}/.test(xcconfig)) {
    failures.push('Apple Team ID missing. Run: node scripts/set-ios-team-id.mjs YOURTEAMID');
  }
  if (!appId.endsWith('.com.ahmed.miras') || appId.startsWith('TEAMID')) {
    failures.push(`AASA appID is not TeamID.com.ahmed.miras (${appId || 'empty'})`);
  }
  if (!exportOptions.includes('<string>4TRJXRYK8A</string>') && !/<string>[A-Z0-9]{10}<\/string>/.test(exportOptions)) {
    failures.push('ios/ExportOptions.plist teamID is still a placeholder');
  }
  const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
  if (!pbxproj.includes('PRODUCT_BUNDLE_IDENTIFIER = com.ahmed.miras;')) {
    failures.push('Xcode PRODUCT_BUNDLE_IDENTIFIER must be com.ahmed.miras');
  }
  if (!infoPlist.includes('com.ahmed.miras')) {
    failures.push('Info.plist URL scheme must include com.ahmed.miras');
  }
  if (!infoPlist.includes('com.googleusercontent.apps.')) {
    failures.push(
      'Info.plist URL schemes must include the Firebase REVERSED_CLIENT_ID (com.googleusercontent.apps.…) for native iOS Phone Auth reCAPTCHA fallback'
    );
  }
  if (!infoPlist.includes('<string>comgooglemaps</string>')) {
    failures.push('Info.plist LSApplicationQueriesSchemes must include comgooglemaps for Google Maps navigation');
  }
  const nativeMaps = read('src/lib/nativeMaps.ts');
  if (nativeMaps.includes('maps.apple.com') || /maps:0,0/.test(nativeMaps)) {
    failures.push('nativeMaps.ts must not open Apple Maps — iOS navigation must use Google Maps');
  }
  if (!nativeMaps.includes('https://www.google.com/maps/dir/?api=1&destination=')) {
    failures.push('nativeMaps.ts must use the Google Maps dir URL (api=1&destination=)');
  }
  if (!pbxproj.includes('MARKETING_VERSION = 1.0.1;')) {
    failures.push('Xcode MARKETING_VERSION must be 1.0.1 for this App Store submission');
  }
  const iosBuild = Number((pbxproj.match(/CURRENT_PROJECT_VERSION = (\d+);/) || [])[1] || 0);
  if (!Number.isFinite(iosBuild) || iosBuild < 2) {
    failures.push('Xcode CURRENT_PROJECT_VERSION must be >= 2 (1.0 already used build 1)');
  }
  if (!infoPlist.includes('<key>ITSAppUsesNonExemptEncryption</key>') || !infoPlist.includes('<false/>')) {
    failures.push('Info.plist must set ITSAppUsesNonExemptEncryption to false');
  }
  if (!infoPlist.includes('<key>NSLocationWhenInUseUsageDescription</key>')) {
    failures.push('Info.plist must include NSLocationWhenInUseUsageDescription');
  }
  if (infoPlist.includes('<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>')) {
    failures.push(
      'Info.plist must not declare Always location — the app only uses When In Use. Remove NSLocationAlways* keys.'
    );
  }
  const entitlements = read('ios/App/App/App.entitlements');
  // Codemagic profile "miras app store profile" does not include Associated
  // Domains. Keep entitlements empty of applinks until the App ID + profile
  // are regenerated with that capability.
  if (
    entitlements.includes('com.apple.developer.associated-domains') ||
    entitlements.includes('applinks:')
  ) {
    failures.push(
      'App.entitlements must not declare Associated Domains until Apple profile "miras app store profile" includes that capability'
    );
  }
  const capSpm = read('ios/App/CapApp-SPM/Package.swift');
  if (!capSpm.includes('path: "packages/CapacitorFirebaseAppCheck"')) {
    failures.push(
      'CapApp-SPM/Package.swift must point at packages/CapacitorFirebaseAppCheck (not node_modules/.../app-check)'
    );
  }
  if (
    !capSpm.includes('path: "packages/CapacitorFirebaseAuthentication"')
  ) {
    failures.push(
      'CapApp-SPM/Package.swift must point at packages/CapacitorFirebaseAuthentication for native iOS Phone Auth'
    );
  }
  if (/path:\s*"[^"]*\/app-check"/.test(capSpm)) {
    failures.push(
      'CapApp-SPM/Package.swift still ends in /app-check — that identity collides with firebase-ios-sdk AppCheckCore'
    );
  }
  if (
    !exists('ios/App/CapApp-SPM/packages/CapacitorFirebaseAuthentication/ios/Plugin/FirebaseAuthenticationPlugin.swift')
  ) {
    failures.push(
      'CapApp-SPM/packages/CapacitorFirebaseAuthentication native plugin sources are missing — run npm run cap:sync:ios'
    );
  }
  if (
    !exists(
      'ios/App/CapApp-SPM/packages/CapacitorFirebaseAuthentication/ios/Plugin/Handlers/PhoneAuthProviderHandler.swift'
    )
  ) {
    failures.push('PhoneAuthProviderHandler.swift is missing from the iOS SPM authentication package');
  }
  const copiedPlugin = path.join(root, 'ios', 'App', 'CapApp-SPM', 'packages', 'CapacitorFirebaseAppCheck');
  if (fs.existsSync(copiedPlugin) && fs.lstatSync(copiedPlugin).isSymbolicLink()) {
    failures.push(
      'packages/CapacitorFirebaseAppCheck must be a real directory copy, not a symlink (archive realpath restores identity app-check)'
    );
  }
  if (!exists('ios/App/App/PrivacyInfo.xcprivacy')) {
    failures.push('PrivacyInfo.xcprivacy is missing');
  }
  const plistRel = 'ios/App/App/GoogleService-Info.plist';
  if (exists(plistRel)) {
    const plist = read(plistRel);
    if (!plist.includes('<string>com.ahmed.miras</string>')) {
      failures.push('GoogleService-Info.plist BUNDLE_ID must be com.ahmed.miras');
    }
    if (!/GOOGLE_APP_ID[\s\S]*:ios:/.test(plist)) {
      failures.push('GoogleService-Info.plist GOOGLE_APP_ID must be the Firebase iOS app (1:…:ios:…)');
    }
  } else {
    console.warn(
      'GoogleService-Info.plist is not in the working tree (gitignored). Codemagic writes it from GOOGLE_SERVICE_INFO_PLIST before archive.'
    );
  }
  if (!fs.existsSync(iconPath)) {
    failures.push('AppIcon-512@2x.png is missing — run npm run generate:assets');
  } else {
    const meta = await sharp(iconPath).metadata();
    if (meta.hasAlpha || (meta.channels ?? 0) > 3) {
      failures.push(
        `App Store icon has transparency (channels=${meta.channels}, hasAlpha=${meta.hasAlpha}). Run npm run generate:assets`
      );
    }
  }

  const reviewNotes = read('fastlane/metadata/ios/review_information/notes.txt');
  if (
    reviewNotes.includes('no SMS is sent') ||
    reviewNotes.includes('static test account') ||
    reviewNotes.includes('+966500000000')
  ) {
    failures.push('App Review notes still advertise the removed mock OTP login');
  }

  if (failures.length) {
    console.error('iOS store checks failed:\n' + failures.map((line) => `  - ${line}`).join('\n'));
    process.exit(1);
  }
  console.log('iOS store in-repo checks passed (icon opaque, AASA, encryption, privacy manifest).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
