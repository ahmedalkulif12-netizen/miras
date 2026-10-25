/**
 * Gas cylinder quantities price before the customer fee and Tap split.
 * Run: npx tsx scripts/test-gas-cylinders.ts
 */
import assert from 'node:assert/strict';
import { computeTripFare } from '../src/domain/pricing-engine.ts';
import { buildTripFinancials, resolveDriverCommissionPercentage } from '../src/domain/financials.ts';
import { splitTapCharge } from '../src/domain/tapSplit.ts';
import {
  applyGasLinesToServiceDetails,
  normalizeGasQuantity,
  quoteGasCylinders,
} from '../src/domain/gasCylinders.ts';
import { defaultPricingForService } from '../src/lib/pricingDefaults.ts';

const pricing = defaultPricingForService('gas_delivery');

const singleSwap = computeTripFare(pricing, {
  distance: 12,
  serviceType: 'gas_delivery',
  option: 'cylinder_swap',
});
assert.equal(singleSwap.tripFare, 35, 'legacy swap stays base 20 + delivery 15');
assert.equal(singleSwap.gasLines, undefined);

const mixed = computeTripFare(pricing, {
  distance: 40,
  serviceType: 'gas_delivery',
  exchangeQuantity: 2,
  newCylinderQuantity: 1,
});
assert.equal(mixed.base, 120);
assert.equal(mixed.extraKmCost, 15);
assert.equal(mixed.tripFare, 135, '2×20 + 1×80 + one delivery fee');
assert.equal(mixed.gasLines?.exchangeLineTotal, 40);
assert.equal(mixed.gasLines?.newCylinderLineTotal, 80);
assert.equal(mixed.extraKm, 0, 'gas ignores route kilometers');

const clamped = quoteGasCylinders({
  exchangeUnitPrice: 20,
  newCylinderUnitPrice: 80,
  deliveryFee: 15,
  exchangeQuantity: 99,
  newCylinderQuantity: -3,
});
assert.equal(clamped.exchangeQuantity, 20);
assert.equal(clamped.newCylinderQuantity, 0);
assert.equal(normalizeGasQuantity(1.9), 1);

assert.equal(pricing.customer_service_fee_percentage, 1);
assert.equal(pricing.platform_commission_percentage, 2);
assert.equal(pricing.driver_commission_tiers?.[0]?.commission_percentage, 2);

const driverCommission = resolveDriverCommissionPercentage({
  completedOrdersCount: 0,
  tiers: pricing.driver_commission_tiers,
  basePercentage: pricing.platform_commission_percentage,
});
assert.equal(driverCommission, 2);
const financials = buildTripFinancials(mixed.tripFare, {
  waiveServiceFee: false,
  customerServiceFeePercentage: pricing.customer_service_fee_percentage,
  driverCommissionPercentage: driverCommission,
});
assert.equal(financials.tripFare, 135);
assert.equal(financials.serviceFee, 1.35);
assert.equal(financials.customerTotal, 136.35);
assert.equal(financials.platformFee, 2.7);
assert.equal(financials.driverNet, 132.3);

const split = splitTapCharge(financials.customerTotal, financials);
assert.equal(split.payeeAmount, 132.3);
assert.equal(split.platformAmount, 4.05);
assert.equal(split.source, 'financials');

const details = applyGasLinesToServiceDetails(
  { type: 'cylinder_swap', goodsType: 'gas' },
  mixed.gasLines!
);
assert.equal(details.type, undefined);
assert.equal(details.exchangeQuantity, 2);
assert.equal(details.newCylinderQuantity, 1);
assert.equal(details.goodsType, 'gas');

const swapOnly = applyGasLinesToServiceDetails({}, {
  ...mixed.gasLines!,
  exchangeQuantity: 3,
  newCylinderQuantity: 0,
  exchangeLineTotal: 60,
  newCylinderLineTotal: 0,
  cylinderSubtotal: 60,
  tripFare: 75,
});
assert.equal(swapOnly.type, 'cylinder_swap');

console.log('gas cylinder quantity checks passed');
