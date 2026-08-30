/**
 * Seed / overwrite Firestore pricing/{serviceType} docs with the 2026-08 tier matrix.
 *
 * Usage (from repo root, with GOOGLE_APPLICATION_CREDENTIALS or Firebase Admin env):
 *   npx tsx scripts/seed-pricing-tiers.ts
 */
import admin from 'firebase-admin';
import { firestorePricingDoc, PRICING_SEED_SERVICES } from '../src/lib/pricingDefaults.ts';

const SERVICES = PRICING_SEED_SERVICES;

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  const db = admin.firestore();

  for (const service of SERVICES) {
    const docId = service === 'default' ? 'default' : service;
    const payload =
      service === 'default'
        ? firestorePricingDoc('flatbed')
        : firestorePricingDoc(service);
    await db.collection('pricing').doc(docId).set(payload, { merge: true });
    console.log(`✓ pricing/${docId}`, {
      included_km: payload.included_km,
      tiers: Object.keys((payload.tier_prices as object) || {}),
    });
  }

  console.log('Done. Fee policy 2026-08 seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
