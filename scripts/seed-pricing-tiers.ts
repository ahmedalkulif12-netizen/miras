/**
 * Seed / overwrite Firestore pricing/{serviceType} docs with the tier matrix
 * and the driver loyalty bands (15% / 12% / 10%) from pricingDefaults.
 *
 * Usage (from repo root, with GOOGLE_APPLICATION_CREDENTIALS or Firebase Admin env):
 *   npx tsx scripts/seed-pricing-tiers.ts
 */
import { loadProjectEnv } from '../server/config/loadProjectEnv.ts';
import { canUseAdminFirestore, initFirebaseAdmin } from '../server/lib/firebaseAdmin.ts';
import { firestorePricingDoc, PRICING_SEED_SERVICES } from '../src/lib/pricingDefaults.ts';

const SERVICES = PRICING_SEED_SERVICES;

async function main() {
  loadProjectEnv('production');
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'hamula-cfc6c';
  initFirebaseAdmin(projectId);
  if (!canUseAdminFirestore()) {
    throw new Error(
      'No Firebase Admin credentials. Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or a service account file, then rerun.'
    );
  }
  const { default: admin } = await import('firebase-admin');
  const db = admin.firestore();

  for (const service of SERVICES) {
    const docId = service === 'default' ? 'default' : service;
    const payload =
      service === 'default'
        ? firestorePricingDoc('flatbed')
        : firestorePricingDoc(service);
    await db.collection('pricing').doc(docId).set(payload, { merge: true });
    const tierPrices = (payload.tier_prices || {}) as Record<
      string,
      { base_price?: number; price_per_km?: number }
    >;
    console.log(`✓ pricing/${docId}`, {
      included_km: payload.included_km,
      customer_service_fee_percentage: payload.customer_service_fee_percentage,
      platform_commission_percentage: payload.platform_commission_percentage,
      driver_commission_tiers: payload.driver_commission_tiers,
      tiers: Object.fromEntries(
        Object.entries(tierPrices).map(([key, rate]) => [
          key,
          `${rate.base_price}/${rate.price_per_km}`,
        ])
      ),
    });
  }

  console.log('Done. Fee policy 2026-10 seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
