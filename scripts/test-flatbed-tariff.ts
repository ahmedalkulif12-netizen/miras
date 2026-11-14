/**
 * Flatbed tariff: distance is pickup → drop-off, not a fixed Al-Ahsa origin.
 * Run: npx tsx scripts/test-flatbed-tariff.ts
 */
import { flatbedConfigNodes, quoteFlatbed, readFlatbedTariff } from '../src/domain/flatbedTariff';
import { computeTripFare } from '../src/domain/pricing-engine';
import { defaultPricingForService } from '../src/lib/pricingDefaults';
import { parseEnglishNumber, toEnglishDigits } from '../src/lib/englishDigits';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const hydraulicAhsaDammam = quoteFlatbed({
  distanceKm: 150,
  pickupCity: 'Al-Ahsa',
  dropoffCity: 'Dammam',
  truckType: 'hydraulic',
  tiresIntact: true,
});
assert(hydraulicAhsaDammam.sameCity === false, 'Ahsa to Dammam is inter-city');
assert(hydraulicAhsaDammam.tripFare === 400, `150 km hydraulic should be 400, got ${hydraulicAhsaDammam.tripFare}`);

const riyadh = quoteFlatbed({
  distanceKm: 330,
  pickupCity: 'الأحساء',
  dropoffCity: 'الرياض',
  truckType: 'hydraulic',
});
assert(riyadh.tripFare === 796, `330 km should be 796, got ${riyadh.tripFare}`);

const jeddah = quoteFlatbed({
  distanceKm: 1280,
  pickupCity: 'Hofuf',
  dropoffCity: 'Jeddah',
  truckType: 'hydraulic',
});
assert(jeddah.tripFare === 2886, `1280 km should be 2886, got ${jeddah.tripFare}`);

const standard = quoteFlatbed({
  distanceKm: 150,
  pickupCity: 'Al-Ahsa',
  dropoffCity: 'Dammam',
  truckType: 'normal',
});
assert(standard.tripFare === 300, `standard offset should be 300, got ${standard.tripFare}`);

const box = quoteFlatbed({
  distanceKm: 150,
  pickupCity: 'Al-Ahsa',
  dropoffCity: 'Dammam',
  truckType: 'box',
  tiresIntact: false,
});
assert(box.tripFare === 750, `box + damaged tires should be 750, got ${box.tripFare}`);

const workshop = quoteFlatbed({
  distanceKm: 8,
  pickupCity: 'Riyadh',
  dropoffCity: 'الرياض',
  truckType: 'hydraulic',
  intraCityService: 'workshop',
});
assert(workshop.sameCity && workshop.tripFare === 150, `8 km workshop stays on the 150 base, got ${workshop.tripFare}`);

const workshopExtra = quoteFlatbed({
  distanceKm: 40,
  pickupCity: 'Riyadh',
  dropoffCity: 'الرياض',
  truckType: 'hydraulic',
  intraCityService: 'workshop',
});
assert(
  workshopExtra.billableKm === 15 && workshopExtra.tripFare === 172.5,
  `40 km workshop should be 172.5, got ${workshopExtra.tripFare}`
);

const industrial = quoteFlatbed({
  distanceKm: 18,
  pickupCity: 'Jeddah',
  dropoffCity: 'Jeddah',
  truckType: 'normal',
  intraCityService: 'industrial',
  tiresIntact: false,
});
assert(industrial.tripFare === 150, `industrial standard stays on the 50 floor or the price, got ${industrial.tripFare}`);
// 150 - 100 = 50, plus 100 damaged = 150.

const taqdeer = quoteFlatbed({
  distanceKm: 6,
  pickupCity: 'Makkah',
  dropoffCity: 'مكة',
  truckType: 'box',
  intraCityService: 'taqdeer',
});
assert(taqdeer.tripFare === 500, `taqdeer box should be 500, got ${taqdeer.tripFare}`);

const shortHaul = quoteFlatbed({
  distanceKm: 20,
  pickupCity: 'Tabuk',
  dropoffCity: 'Jeddah',
  truckType: 'hydraulic',
});
assert(shortHaul.tripFare === 350, 'inter-city fare respects the 350 floor');

const pricing = defaultPricingForService('flatbed');
const viaEngine = computeTripFare(pricing, {
  distance: 150,
  serviceType: 'flatbed',
  truckType: 'hydraulic',
  pickupCity: 'Dammam',
  dropoffCity: 'Riyadh',
  tiresIntact: true,
});
assert(viaEngine.tripFare === 400, 'engine uses the tariff for flatbed');
assert(viaEngine.tripType === 'outside_city', 'different cities are outside the city');
assert(viaEngine.pricingScope === 'inter_city', 'different cities use the inter-city node');
assert(viaEngine.driverCommissionPercentage === 15, 'inter-city driver commission defaults to 15%');
assert(viaEngine.customerServiceFeePercentage === 5, 'inter-city customer fee defaults to 5%');
assert(workshop.pricingScope === 'intra_city' && workshop.driverCommissionPercentage === 10, 'workshop uses the 10% intra-city commission');

const separated = readFlatbedTariff({
  flatbed_tariff: { intraBasePrice: 150, intercityBaseFee: 70 },
  intra_city: {
    basePrice: 180,
    includedKm: 30,
    extraKmRate: 2,
    driverCommissionPercentage: 8,
    customerServiceFeePercentage: 4,
    taqdeerPrice: 260,
  },
  inter_city: {
    basePrice: 90,
    ratePerKm: 3,
    minimumFare: 400,
    driverCommissionPercentage: 12,
    customerServiceFeePercentage: 6,
  },
  flatbed_modifiers: {
    offsets: { hydraulic: 0, normal: -100, box: 250 },
    tireDamageSurcharge: 100,
  },
});
assert(separated.intraBasePrice === 180 && separated.intraIncludedKm === 30, 'intra_city node overrides the flat tariff');
assert(separated.intercityRatePerKm === 3 && separated.intercityDriverCommissionPercentage === 12, 'inter_city node is read on its own');
assert(separated.offsets.box === 250 && separated.intraCity.taqdeer === 260, 'modifiers and taqdeer stay attached to their nodes');
const saved = flatbedConfigNodes(separated);
const roundTrip = readFlatbedTariff(saved);
assert(roundTrip.intraExtraKmRate === 2 && roundTrip.intercityCustomerServiceFeePercentage === 6, 'saved nodes round-trip');
assert(toEnglishDigits('١٥٠') === '150' && parseEnglishNumber('٢٫٥'.replace('٫', '.')) === 2.5, 'eastern digits become English digits');

const furniture = computeTripFare(defaultPricingForService('furniture_moving'), {
  distance: 30,
  serviceType: 'furniture_moving',
  option: 'small_van',
});
const furnitureTier = defaultPricingForService('furniture_moving').tier_prices?.small_van;
assert(furnitureTier, 'furniture tier exists');
const expectedFurniture =
  furnitureTier.base_price + Math.max(0, 30 - 25) * furnitureTier.price_per_km;
assert(
  Math.abs(furniture.tripFare - expectedFurniture) < 0.02,
  'furniture still uses the 25 km included formula'
);

console.log('flatbed tariff checks passed');
