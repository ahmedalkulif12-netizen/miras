import { computeTripFare } from '../src/domain/pricing-engine.ts';
import { defaultPricingForService, SERVICE_TIER_PRICES } from '../src/lib/pricingDefaults.ts';
import { buildTripFinancials } from '../src/domain/financials.ts';

const cases: Array<[string, string, number]> = [
  ['furniture_moving', 'small_truck', 25],
  ['furniture_moving', 'small_truck', 40],
  ['flatbed', 'hydraulic', 40],
  ['flatbed', 'box', 30],
  ['water_tanker', '3000L', 50],
  ['heavy_equipment', 'heavy_equip', 25],
  ['heavy_equipment', 'heavy_equip', 35],
  ['refrigerated', 'frozen', 45],
  ['goods_transport', 'van', 60],
  ['goods_transport', 'trailer', 100],
];

let failed = 0;
for (const [svc, tier, km] of cases) {
  const pricing = defaultPricingForService(svc);
  const fare = computeTripFare(pricing, { distance: km, serviceType: svc, option: tier });
  const fin = buildTripFinancials(fare.tripFare);
  const expectedBase = SERVICE_TIER_PRICES[svc][tier].base_price;
  const expectedRate = SERVICE_TIER_PRICES[svc][tier].price_per_km;
  const expectedExtra = Math.round(Math.max(0, km - 25) * expectedRate * 100) / 100;
  const expectedTrip = Math.round((expectedBase + expectedExtra) * 100) / 100;
  const ok =
    fare.base === expectedBase &&
    fare.extraKmCost === expectedExtra &&
    fare.tripFare === expectedTrip &&
    fare.includedKm === 25;
  if (!ok) failed += 1;
  console.log(ok ? 'OK' : 'FAIL', svc, tier, `${km}km`, {
    base: fare.base,
    extra: fare.extraKmCost,
    trip: fare.tripFare,
    customer: fin.customerTotal,
    driverNet: fin.driverNet,
    expectedTrip,
  });
}

// Explicit example from docs: hydraulic 40km → 165 / 173.25 / 140.25
const ex = computeTripFare(defaultPricingForService('flatbed'), {
  distance: 40,
  serviceType: 'flatbed',
  option: 'hydraulic',
});
const exFin = buildTripFinancials(ex.tripFare);
console.log('DOC EXAMPLE', {
  tripFare: ex.tripFare,
  serviceFee: exFin.serviceFee,
  customerTotal: exFin.customerTotal,
  driverNet: exFin.driverNet,
});
if (ex.tripFare !== 165 || exFin.customerTotal !== 173.25 || exFin.driverNet !== 140.25) {
  failed += 1;
  console.log('DOC EXAMPLE FAILED');
}

process.exit(failed ? 1 : 0);
