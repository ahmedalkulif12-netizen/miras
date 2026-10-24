#!/usr/bin/env tsx
/**
 * Pin iOS + JS client to the live Miras App Firebase project (hamula-cfc6c).
 * Run: npx tsx scripts/test-ios-firebase-align.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, assertEqual } from '../e2e/helpers/assert.ts';
import { resolveApiOriginFrom } from '../src/lib/apiUrl.ts';
import {
  MIRAS_IOS_BUNDLE_ID,
  MIRAS_IOS_GOOGLE_APP_ID,
  MIRAS_PRODUCTION_API_ORIGIN,
  MIRAS_PRODUCTION_AUTH_DOMAIN,
  PRODUCTION_PRIVACY_URL,
  PRODUCTION_TERMS_URL,
  PRODUCTION_WEB_URL,
  MIRAS_PRODUCTION_FIREBASE_PROJECT_ID,
  MIRAS_PRODUCTION_MESSAGING_SENDER_ID,
  MIRAS_PRODUCTION_STORAGE_BUCKET,
} from '../src/lib/mirasProductionFirebase.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function plistString(xml: string, key: string): string {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1]?.trim() || '';
}

function run(): void {
  const canon = JSON.parse(
    fs.readFileSync(path.join(root, 'config', 'miras-production.json'), 'utf8')
  ) as Record<string, string>;

  assertEqual(canon.projectId, MIRAS_PRODUCTION_FIREBASE_PROJECT_ID, 'TS project id matches JSON');
  assertEqual(canon.storageBucket, MIRAS_PRODUCTION_STORAGE_BUCKET, 'TS bucket matches JSON');
  assertEqual(canon.messagingSenderId, MIRAS_PRODUCTION_MESSAGING_SENDER_ID, 'TS sender matches JSON');
  assertEqual(canon.authDomain, MIRAS_PRODUCTION_AUTH_DOMAIN, 'TS auth domain matches JSON');
  assertEqual(canon.publicAppOrigin, MIRAS_PRODUCTION_API_ORIGIN, 'TS API origin matches JSON');
  assertEqual(canon.publicWebUrl, PRODUCTION_WEB_URL, 'public website matches the registration URL');
  assertEqual(canon.privacyPolicyUrl, PRODUCTION_PRIVACY_URL, 'privacy URL is under the production site');
  assertEqual(canon.termsUrl, PRODUCTION_TERMS_URL, 'terms URL is under the production site');
  assert(PRODUCTION_WEB_URL === 'https://hamula-cfc6c.web.app', 'production website has no trailing slash');

  const registration = JSON.parse(
    fs.readFileSync(path.join(root, 'config', 'production-web-url.json'), 'utf8')
  ) as Record<string, string>;
  const firebaseJson = JSON.parse(
    fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')
  ) as { hosting?: { site?: string } };
  const hostingSite = firebaseJson.hosting?.site || '';
  assertEqual(
    `https://${hostingSite}.web.app`,
    PRODUCTION_WEB_URL,
    'firebase.json hosting site is the production website'
  );
  assertEqual(registration.productionWebUrl, PRODUCTION_WEB_URL, 'registration export matches the production website');
  assertEqual(registration.privacyPolicyUrl, PRODUCTION_PRIVACY_URL, 'registration privacy URL');
  assertEqual(registration.termsUrl, PRODUCTION_TERMS_URL, 'registration terms URL');
  assertEqual(canon.iosBundleId, MIRAS_IOS_BUNDLE_ID, 'TS iOS bundle matches JSON');
  assertEqual(canon.iosGoogleAppId, MIRAS_IOS_GOOGLE_APP_ID, 'TS iOS app id matches JSON');

  const plistPath = path.join(root, 'ios', 'App', 'App', 'GoogleService-Info.plist');
  assert(fs.existsSync(plistPath), 'GoogleService-Info.plist exists for local validation');
  const xml = fs.readFileSync(plistPath, 'utf8');
  assertEqual(plistString(xml, 'PROJECT_ID'), canon.projectId, 'plist PROJECT_ID');
  assertEqual(plistString(xml, 'STORAGE_BUCKET'), canon.storageBucket, 'plist STORAGE_BUCKET');
  assertEqual(plistString(xml, 'GCM_SENDER_ID'), canon.messagingSenderId, 'plist GCM_SENDER_ID');
  assertEqual(plistString(xml, 'BUNDLE_ID'), canon.iosBundleId, 'plist BUNDLE_ID');
  assertEqual(plistString(xml, 'GOOGLE_APP_ID'), canon.iosGoogleAppId, 'plist GOOGLE_APP_ID');
  assertEqual(plistString(xml, 'API_KEY'), canon.iosApiKey, 'plist API_KEY is iOS key');
  assert(!xml.includes(canon.webAppId), 'plist does not embed the Web app id');

  assertEqual(
    resolveApiOriginFrom({
      isNative: true,
      envApiOrigin: '',
      publicAppOrigin: '',
      windowOrigin: 'capacitor://localhost',
    }),
    MIRAS_PRODUCTION_API_ORIGIN,
    'native fetch origin is live Miras Hosting'
  );

  const cap = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8');
  assert(cap.includes(`hostname: '${canon.projectId}.web.app'`), 'Capacitor hostname is Miras Hosting');

  console.log('iOS Firebase alignment: OK');
  console.log(`  project=${canon.projectId} bundle=${canon.iosBundleId} api=${canon.publicAppOrigin}`);
}

run();
