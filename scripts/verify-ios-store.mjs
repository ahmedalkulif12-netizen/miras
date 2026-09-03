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
  if (!entitlements.includes('applinks:hamula-cfc6c.web.app')) {
    failures.push('App.entitlements must include applinks:hamula-cfc6c.web.app');
  }
  if (!entitlements.includes('applinks:hamula-cfc6c.firebaseapp.com')) {
    failures.push('App.entitlements must include applinks:hamula-cfc6c.firebaseapp.com');
  }
  const capSpm = read('ios/App/CapApp-SPM/Package.swift');
  if (!capSpm.includes('path: "packages/CapacitorFirebaseAppCheck"')) {
    failures.push(
      'CapApp-SPM/Package.swift must point at packages/CapacitorFirebaseAppCheck (not node_modules/.../app-check)'
    );
  }
  if (/path:\s*"[^"]*\/app-check"/.test(capSpm)) {
    failures.push(
      'CapApp-SPM/Package.swift still ends in /app-check — that identity collides with firebase-ios-sdk AppCheckCore'
    );
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
  const demoUser = read('fastlane/metadata/ios/review_information/demo_user.txt').trim();
  const demoOtp = read('fastlane/metadata/ios/review_information/demo_password.txt').trim();
  if (demoUser !== '+966500000000' || demoOtp !== '123456') {
    failures.push('App Review demo login must be +966500000000 / 123456');
  }
  if (reviewNotes.includes('REPLACE_WITH_FIREBASE_TEST_PHONE')) {
    failures.push('App Review notes still contain Firebase test-phone placeholders');
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
