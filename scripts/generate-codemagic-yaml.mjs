/**
 * Generate a self-contained Codemagic iOS workflow from local production client files.
 * Reads gitignored `.env.production` + `GoogleService-Info.plist` and writes `codemagic.yaml`.
 * Does not print secret values.
 *
 * Usage: node scripts/generate-codemagic-yaml.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMirasProduction } from './loadMirasProduction.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(rel) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function plistString(xml, key) {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1]?.trim() || '';
}

function yamlQuote(value, fallback = 'unset') {
  const trimmed = String(value ?? '').trim();
  return JSON.stringify(trimmed || fallback);
}

const prod = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.production'),
  ...readEnvFile('.env.production.local'),
};

const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_GOOGLE_MAPS_PLATFORM_KEY',
  'VITE_APP_CHECK_RECAPTCHA_SITE_KEY',
  'VITE_APP_URL',
];
const missing = required.filter((key) => !prod[key]);
if (missing.length) {
  console.error(`Missing production client keys: ${missing.join(', ')}`);
  process.exit(1);
}
if (!/:web:/i.test(prod.VITE_FIREBASE_APP_ID)) {
  console.error('VITE_FIREBASE_APP_ID must be the Web app id (1:…:web:…).');
  process.exit(1);
}

const plistPath = path.join(root, 'ios', 'App', 'App', 'GoogleService-Info.plist');
if (!fs.existsSync(plistPath)) {
  console.error('ios/App/App/GoogleService-Info.plist is required to generate the iOS workflow plist.');
  process.exit(1);
}
const plistXml = fs.readFileSync(plistPath, 'utf8');
const canon = loadMirasProduction();
const iosGoogleAppId = plistString(plistXml, 'GOOGLE_APP_ID');
const iosApiKey = plistString(plistXml, 'API_KEY') || canon.iosApiKey;
function isInventedIosOAuthClient(id, googleAppId) {
  const hash = (String(googleAppId).split(':ios:')[1] || '').trim();
  return Boolean(id && hash && id.includes(hash));
}
function isDisabledOAuthPlaceholder(id) {
  const value = String(id || '').trim();
  return !value || value === 'DISABLED_USE_BUNDLED_PLIST' || /^DISABLED_/i.test(value);
}
let iosClientId = plistString(plistXml, 'CLIENT_ID');
let iosReversedClientId = plistString(plistXml, 'REVERSED_CLIENT_ID');
if (isDisabledOAuthPlaceholder(iosClientId) || isInventedIosOAuthClient(iosClientId, iosGoogleAppId)) {
  iosClientId = '';
}
if (isDisabledOAuthPlaceholder(iosReversedClientId) || isInventedIosOAuthClient(iosReversedClientId, iosGoogleAppId)) {
  iosReversedClientId = '';
}
const iosBundleId = plistString(plistXml, 'BUNDLE_ID') || 'com.ahmed.miras';
if (!/:ios:/i.test(iosGoogleAppId)) {
  console.error('GoogleService-Info.plist GOOGLE_APP_ID must be an iOS app id.');
  process.exit(1);
}
if (iosBundleId !== canon.iosBundleId) {
  console.error(`GoogleService-Info.plist BUNDLE_ID must be ${canon.iosBundleId}.`);
  process.exit(1);
}
if (plistString(plistXml, 'PROJECT_ID') !== canon.projectId) {
  console.error(`GoogleService-Info.plist PROJECT_ID must be ${canon.projectId} (live Miras App).`);
  process.exit(1);
}
if (plistString(plistXml, 'STORAGE_BUCKET') !== canon.storageBucket) {
  console.error(`GoogleService-Info.plist STORAGE_BUCKET must be ${canon.storageBucket}.`);
  process.exit(1);
}
if (iosGoogleAppId !== canon.iosGoogleAppId) {
  console.error(`GoogleService-Info.plist GOOGLE_APP_ID must be ${canon.iosGoogleAppId}.`);
  process.exit(1);
}
if (iosApiKey !== canon.iosApiKey) {
  console.error('GoogleService-Info.plist API_KEY must be the Miras App iOS key, not the Web key.');
  process.exit(1);
}
if (prod.VITE_FIREBASE_PROJECT_ID !== canon.projectId) {
  console.error(`VITE_FIREBASE_PROJECT_ID must be ${canon.projectId} (live Miras App).`);
  process.exit(1);
}
if (prod.VITE_APP_URL !== canon.publicAppOrigin) {
  console.error(`VITE_APP_URL must be ${canon.publicAppOrigin}.`);
  process.exit(1);
}

const mapsKey = prod.VITE_GOOGLE_MAPS_PLATFORM_KEY || prod.VITE_GOOGLE_MAPS_API_KEY;
const measurementId = prod.VITE_FIREBASE_MEASUREMENT_ID || '';

const yaml = `# Codemagic CI — Capacitor iOS → App Store Connect (TestFlight)
# Production-ready: all client env + build scripts live in this file.
# Do not set VITE_* in the Codemagic web UI — UI values would override these.
#
# Still configured in Codemagic UI (Apple signing only, not app env):
#   integrations.app_store_connect name "codemagic"
#   iOS code signing identities for com.ahmed.miras (App Store distribution)

workflows:
  ios-testflight:
    name: Miras iOS TestFlight
    max_build_duration: 120
    instance_type: mac_mini_m2
    integrations:
      app_store_connect: codemagic
    environment:
      ios_signing:
        distribution_type: app_store
        bundle_identifier: ${canon.iosBundleId}
      vars:
        XCODE_PROJECT_PATH: ${yamlQuote('ios/App/App.xcodeproj')}
        XCODE_SCHEME: ${yamlQuote('App')}
        BUNDLE_ID: ${yamlQuote(canon.iosBundleId)}
        DEVELOPMENT_TEAM: ${yamlQuote('4TRJXRYK8A')}
        IOS_MARKETING_VERSION: ${yamlQuote('1.0.1')}
        NODE_ENV: ${yamlQuote('production')}
        CAPACITOR_BUILD: ${yamlQuote('1')}
        NPM_CONFIG_PRODUCTION: ${yamlQuote('false')}
        VITE_MIRAS_DEPLOY_ENV: ${yamlQuote('production')}
        MIRAS_DEPLOY_ENV: ${yamlQuote('production')}
        MIRAS_EXPECTED_FIREBASE_PROJECT: ${yamlQuote(canon.projectId)}
        FIREBASE_PROJECT_ID: ${yamlQuote(canon.projectId)}
        VITE_FIREBASE_API_KEY: ${yamlQuote(prod.VITE_FIREBASE_API_KEY)}
        VITE_FIREBASE_AUTH_DOMAIN: ${yamlQuote(canon.authDomain)}
        VITE_FIREBASE_PROJECT_ID: ${yamlQuote(canon.projectId)}
        VITE_FIREBASE_STORAGE_BUCKET: ${yamlQuote(canon.storageBucket)}
        VITE_FIREBASE_MESSAGING_SENDER_ID: ${yamlQuote(canon.messagingSenderId)}
        VITE_FIREBASE_APP_ID: ${yamlQuote(prod.VITE_FIREBASE_APP_ID)}
        VITE_FIREBASE_MEASUREMENT_ID: ${yamlQuote(measurementId, 'G-04GKH516ND')}
        VITE_GOOGLE_MAPS_PLATFORM_KEY: ${yamlQuote(mapsKey)}
        VITE_APP_CHECK_RECAPTCHA_SITE_KEY: ${yamlQuote('6Lf0czctAAAAAF7EECTuyfcTMJpA7HCTBlLp7Syb')}
        VITE_APP_CHECK_DISABLED: ${yamlQuote('false')}
        VITE_APP_URL: ${yamlQuote(canon.publicAppOrigin)}
        VITE_API_ORIGIN: ${yamlQuote(canon.publicAppOrigin)}
        VITE_IOS_TEAM_ID: ${yamlQuote('4TRJXRYK8A')}
        VITE_SUPPORT_EMAIL: ${yamlQuote('support@miras.com')}
        FIREBASE_IOS_GOOGLE_APP_ID: ${yamlQuote(iosGoogleAppId)}
        FIREBASE_IOS_API_KEY: ${yamlQuote(iosApiKey)}
        FIREBASE_IOS_CLIENT_ID: ${yamlQuote(iosClientId, 'DISABLED_USE_BUNDLED_PLIST')}
        FIREBASE_IOS_REVERSED_CLIENT_ID: ${yamlQuote(iosReversedClientId, 'DISABLED_USE_BUNDLED_PLIST')}
      node: 22
      xcode: latest
    scripts:
      - name: Force production client env
        script: |
          set -euo pipefail
          unset VITE_ENABLE_DEV_AUTH_BYPASS VITE_PHONE_AUTH_TESTING VITE_APP_CHECK_DEBUG_TOKEN APPLE_REVIEW_PHONE APPLE_REVIEW_OTP
          export NODE_ENV=production
          export CAPACITOR_BUILD=1
          export VITE_MIRAS_DEPLOY_ENV=production
          export MIRAS_DEPLOY_ENV=production
          export VITE_APP_CHECK_DISABLED=false
          echo "VITE_MIRAS_DEPLOY_ENV=$VITE_MIRAS_DEPLOY_ENV"
          echo "VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID"
          echo "VITE_FIREBASE_APP_ID kind=web"
      - name: Install npm dependencies
        script: |
          set -euo pipefail
          export NPM_CONFIG_PRODUCTION=false
          npm ci --include=dev
      - name: Write native Firebase iOS plist
        script: |
          set -euo pipefail
          node scripts/write-ios-google-service-info.mjs
          test -f "$CM_BUILD_DIR/ios/App/App/GoogleService-Info.plist"
          if grep -E -q '191963635866-73a41da4e6ffe55734bf23' \\
            "$CM_BUILD_DIR/ios/App/App/GoogleService-Info.plist" \\
            "$CM_BUILD_DIR/ios/App/App/Info.plist"; then
            echo "error: invented iOS OAuth CLIENT_ID present (auth/invalid-oauth-client-id)"
            exit 1
          fi
      - name: Verify production store client env
        script: |
          set -euo pipefail
          unset VITE_ENABLE_DEV_AUTH_BYPASS VITE_PHONE_AUTH_TESTING VITE_APP_CHECK_DEBUG_TOKEN APPLE_REVIEW_PHONE APPLE_REVIEW_OTP
          export NODE_ENV=production
          export VITE_MIRAS_DEPLOY_ENV=production
          export VITE_APP_CHECK_DISABLED=false
          npx tsx scripts/verify-store-client.ts
      - name: Build web assets and sync Capacitor iOS
        script: |
          set -euo pipefail
          unset VITE_ENABLE_DEV_AUTH_BYPASS VITE_PHONE_AUTH_TESTING VITE_APP_CHECK_DEBUG_TOKEN APPLE_REVIEW_PHONE APPLE_REVIEW_OTP
          export NODE_ENV=production
          export CAPACITOR_BUILD=1
          export VITE_MIRAS_DEPLOY_ENV=production
          export MIRAS_DEPLOY_ENV=production
          export VITE_APP_CHECK_DISABLED=false
          export VITE_IOS_TEAM_ID="\${VITE_IOS_TEAM_ID:-\$DEVELOPMENT_TEAM}"
          npm run cap:sync:ios
          test -f dist/index.html
          test -d ios/App/CapApp-SPM/packages/CapacitorFirebaseAppCheck
          grep -q 'path: "packages/CapacitorFirebaseAppCheck"' ios/App/CapApp-SPM/Package.swift
          test -d ios/App/CapApp-SPM/packages/CapacitorFirebaseAuthentication
          grep -q 'path: "packages/CapacitorFirebaseAuthentication"' ios/App/CapApp-SPM/Package.swift
          node scripts/verify-ios-store.mjs
      - name: Install signing certificates and profiles
        script: |
          xcode-project use-profiles \\
            --project "$CM_BUILD_DIR/$XCODE_PROJECT_PATH" \\
            --custom-export-options='{"method":"app-store","signingStyle":"manual","teamID":"'"$DEVELOPMENT_TEAM"'","compileBitcode":false}'
          sed -i '' 's/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Manual;/g' \\
            "$CM_BUILD_DIR/ios/App/App.xcodeproj/project.pbxproj"
      - name: Increment iOS build number
        script: |
          cd "$CM_BUILD_DIR/ios/App"
          LATEST=0
          if [ -n "\${APP_STORE_APPLE_ID:-}" ]; then
            LATEST=$(app-store-connect get-latest-testflight-build-number "$APP_STORE_APPLE_ID" || true)
            if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
              LATEST=$(app-store-connect get-latest-app-store-build-number "$APP_STORE_APPLE_ID" || true)
            fi
          fi
          if [ -z "$LATEST" ] || [ "$LATEST" = "None" ] || [ "$LATEST" = "0" ]; then
            LATEST=$(app-store-connect get-latest-testflight-build-number --bundle-id "$BUNDLE_ID" || true)
          fi
          if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
            LATEST=$(app-store-connect get-latest-app-store-build-number --bundle-id "$BUNDLE_ID" || true)
          fi
          case "$LATEST" in
            ''|None|none) LATEST=0 ;;
          esac
          NEW_BUILD=$((LATEST + 1))
          if [ "$NEW_BUILD" -lt "\${BUILD_NUMBER:-1}" ]; then
            NEW_BUILD=$BUILD_NUMBER
          fi
          if [ "$NEW_BUILD" -lt 2 ]; then
            NEW_BUILD=2
          fi
          MARKETING="\${IOS_MARKETING_VERSION:-1.0.1}"
          agvtool new-version -all "$NEW_BUILD"
          agvtool new-marketing-version "$MARKETING"
          echo "Using CFBundleShortVersionString=$MARKETING CFBundleVersion=$NEW_BUILD"
      - name: Resolve packages and verify Xcode can read settings
        script: |
          set -euo pipefail
          cd "$CM_BUILD_DIR/ios/App"
          PACKAGES_DIR="$CM_BUILD_DIR/build/ios/SourcePackages"
          mkdir -p "$PACKAGES_DIR"
          xcodebuild -list -project App.xcodeproj
          xcodebuild -project App.xcodeproj -scheme "$XCODE_SCHEME" \\
            -clonedSourcePackagesDirPath "$PACKAGES_DIR" \\
            -skipPackagePluginValidation \\
            -resolvePackageDependencies
          xcodebuild -project App.xcodeproj -scheme "$XCODE_SCHEME" \\
            -configuration Release \\
            -sdk iphoneos \\
            -destination 'generic/platform=iOS' \\
            -clonedSourcePackagesDirPath "$PACKAGES_DIR" \\
            DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \\
            CODE_SIGN_STYLE=Manual \\
            SWIFT_ENABLE_EXPLICIT_MODULES=NO \\
            -showBuildSettings
      - name: Archive and export signed IPA
        script: |
          set -euo pipefail
          PROJECT="$CM_BUILD_DIR/$XCODE_PROJECT_PATH"
          ARCHIVE_PATH="$CM_BUILD_DIR/build/ios/xcarchive/App.xcarchive"
          IPA_DIR="$CM_BUILD_DIR/ios/App/build/ios/ipa"
          PACKAGES_DIR="$CM_BUILD_DIR/build/ios/SourcePackages"
          mkdir -p "$(dirname "$ARCHIVE_PATH")" "$IPA_DIR" "$PACKAGES_DIR"
          xcodebuild archive \\
            -project "$PROJECT" \\
            -scheme "$XCODE_SCHEME" \\
            -configuration Release \\
            -sdk iphoneos \\
            -destination 'generic/platform=iOS' \\
            -archivePath "$ARCHIVE_PATH" \\
            -clonedSourcePackagesDirPath "$PACKAGES_DIR" \\
            -skipPackagePluginValidation \\
            -skipPackageUpdates \\
            DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \\
            CODE_SIGN_STYLE=Manual \\
            CODE_SIGN_IDENTITY="Apple Distribution" \\
            SWIFT_ENABLE_EXPLICIT_MODULES=NO \\
            ENABLE_MODULE_VERIFIER=NO \\
            BUILD_LIBRARY_FOR_DISTRIBUTION=NO \\
            ENABLE_APPINTENTS_METADATA_EXTRACTION=NO \\
            COMPILER_INDEX_STORE_ENABLE=NO
          EXPORT_PLIST="/Users/builder/export_options.plist"
          if [ ! -f "$EXPORT_PLIST" ]; then
            EXPORT_PLIST="$CM_BUILD_DIR/ios/ExportOptions.codemagic.plist"
          fi
          xcodebuild -exportArchive \\
            -archivePath "$ARCHIVE_PATH" \\
            -exportOptionsPlist "$EXPORT_PLIST" \\
            -exportPath "$IPA_DIR"
          ls -la "$IPA_DIR"
    artifacts:
      - ios/App/build/ios/ipa/*.ipa
      - build/ios/xcarchive/*.xcarchive
      - /tmp/xcodebuild_logs/*.log
      - $HOME/Library/Developer/Xcode/DerivedData/**/Build/**/*.dSYM
    publishing:
      email:
        recipients:
          - support@miras.com
        notify:
          success: true
          failure: true
      app_store_connect:
        auth: integration
        submit_to_testflight: true
        submit_to_app_store: false

  android-internal:
    name: Miras Android Play internal
    max_build_duration: 90
    instance_type: linux_x2
    environment:
      groups:
        - miras_client
      vars:
        PACKAGE_NAME: ${yamlQuote('com.miras.app')}
        NODE_ENV: ${yamlQuote('production')}
        CAPACITOR_BUILD: ${yamlQuote('1')}
        VITE_MIRAS_DEPLOY_ENV: ${yamlQuote('production')}
        MIRAS_DEPLOY_ENV: ${yamlQuote('production')}
        FIREBASE_PROJECT_ID: ${yamlQuote(canon.projectId)}
        VITE_FIREBASE_API_KEY: ${yamlQuote(prod.VITE_FIREBASE_API_KEY)}
        VITE_FIREBASE_AUTH_DOMAIN: ${yamlQuote(canon.authDomain)}
        VITE_FIREBASE_PROJECT_ID: ${yamlQuote(canon.projectId)}
        VITE_FIREBASE_STORAGE_BUCKET: ${yamlQuote(canon.storageBucket)}
        VITE_FIREBASE_MESSAGING_SENDER_ID: ${yamlQuote(canon.messagingSenderId)}
        VITE_FIREBASE_APP_ID: ${yamlQuote(prod.VITE_FIREBASE_APP_ID)}
        VITE_FIREBASE_MEASUREMENT_ID: ${yamlQuote(measurementId, 'G-04GKH516ND')}
        VITE_GOOGLE_MAPS_PLATFORM_KEY: ${yamlQuote(mapsKey)}
        VITE_APP_CHECK_RECAPTCHA_SITE_KEY: ${yamlQuote('6Lf0czctAAAAAF7EECTuyfcTMJpA7HCTBlLp7Syb')}
        VITE_APP_CHECK_DISABLED: ${yamlQuote('false')}
        VITE_APP_URL: ${yamlQuote(canon.publicAppOrigin)}
        VITE_API_ORIGIN: ${yamlQuote(canon.publicAppOrigin)}
      node: 22
      java: 21
    scripts:
      - name: Install npm dependencies
        script: |
          set -euo pipefail
          export NPM_CONFIG_PRODUCTION=false
          npm ci --include=dev
      - name: Require production client env
        script: |
          unset VITE_ENABLE_DEV_AUTH_BYPASS VITE_PHONE_AUTH_TESTING VITE_APP_CHECK_DEBUG_TOKEN APPLE_REVIEW_PHONE APPLE_REVIEW_OTP
          export NODE_ENV=production
          export CAPACITOR_BUILD=1
          export VITE_MIRAS_DEPLOY_ENV=production
          npx tsx scripts/verify-store-client.ts
      - name: Write google-services.json
        script: |
          if [ -n "\${GOOGLE_SERVICES_JSON:-}" ]; then
            echo "$GOOGLE_SERVICES_JSON" | base64 --decode > android/app/google-services.json
          fi
          if [ ! -f android/app/google-services.json ]; then
            echo "android/app/google-services.json missing. iOS workflow is self-contained; Android still needs GOOGLE_SERVICES_JSON or a checked-in file."
            exit 1
          fi
      - name: Build web and sync Android
        script: |
          set -euo pipefail
          unset VITE_ENABLE_DEV_AUTH_BYPASS VITE_PHONE_AUTH_TESTING VITE_APP_CHECK_DEBUG_TOKEN APPLE_REVIEW_PHONE APPLE_REVIEW_OTP
          export NODE_ENV=production
          export CAPACITOR_BUILD=1
          export VITE_MIRAS_DEPLOY_ENV=production
          npm run cap:sync:android
          test -f dist/index.html
      - name: Assemble release bundle
        script: |
          cd android
          chmod +x gradlew
          ./gradlew bundleRelease
    artifacts:
      - android/app/build/outputs/bundle/release/*.aab
`;

fs.writeFileSync(path.join(root, 'codemagic.yaml'), yaml);
console.log('Wrote production-ready codemagic.yaml (iOS workflow has no miras_client group).');
