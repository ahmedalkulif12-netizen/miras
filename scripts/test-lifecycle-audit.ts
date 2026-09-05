/**
 * Self-test for Miras order lifecycle helpers used on localhost.
 * Run: npx tsx scripts/test-lifecycle-audit.ts
 */
import {
  DRIVER_OFFER_STATUSES,
  isActiveTripStatus,
  isOpenOfferStatus,
  isTerminalOrderStatus,
  canRoleTransition,
} from '../src/domain/order-status.ts';
import {
  applyLocalWalletCredit,
  applyLocalWalletHold,
  loadLocalDriverWallet,
  mergeWalletViews,
  releaseLocalWalletHold,
  type DriverWalletView,
} from '../src/lib/localDriverWallet.ts';
import {
  isLoopbackHostname,
  nativeOpenUrlToSpaPath,
  resolvePublicAppOrigin,
  shouldApplyNativeDeepLink,
} from '../src/lib/appOrigin.ts';
import { resolveApiOriginFrom } from '../src/lib/apiUrl.ts';
import { sandboxCheckoutAllowed } from '../src/lib/checkoutGatingCore.ts';
import { isAllowedNativeApiOrigin } from '../server/lib/nativeApiCors.ts';
import {
  isDemoMoyasarId,
  resolveMoyasarCallbackUrl,
} from '../server/lib/moyasarCallback.ts';
import {
  isDemoDocumentId,
  isTestOrGhostRecord,
} from '../server/lib/testDataPatterns.ts';
import {
  isGhostAdminOrder,
  mergeAdminFeed,
  mapOrderDocToFeedItem,
  mapDriverApplicationToFeedItem,
} from '../server/lib/adminOrders.ts';
import {
  buildTripFinancials,
  shouldWaiveServiceFee,
  normalizeTripFinancials,
  FREE_SERVICE_FEE_ORDERS,
  toCustomerQuoteDisplay,
} from '../src/domain/financials.ts';
import { getDriverOfferMetrics } from '../src/lib/driverOfferMetrics.ts';
import { financialsToFirestorePricingFields } from '../src/domain/order-schema.ts';
import { getOrderPickupLatLng, getOrderDropoffLatLng } from '../src/lib/orderGeo.ts';
import { isValidMapsTarget } from '../src/lib/nativeMaps.ts';

const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() {
    return store.size;
  },
};
(globalThis as { localStorage?: typeof memoryStorage }).localStorage = memoryStorage;
(globalThis as { window?: { dispatchEvent: (event: Event) => boolean } }).window = {
  dispatchEvent: () => true,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emptyWallet(): DriverWalletView {
  return {
    balance: 0,
    totalEarnings: 0,
    platformCommission: 0,
    netEarnings: 0,
    lastPayoutAmount: 0,
    lastPayoutAt: null,
    payoutCount: 0,
    completedOrderCount: 0,
    creditedOrderIds: [],
    heldBalance: 0,
  };
}

function sortCreatedAtDesc(rows: Array<{ createdAt: string }>): string[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((row) => row.createdAt);
}

function run(): void {
  assert(DRIVER_OFFER_STATUSES.includes('broadcasting'), 'offers include broadcasting');
  assert(DRIVER_OFFER_STATUSES.includes('payment_authorized'), 'offers include payment_authorized');
  assert(DRIVER_OFFER_STATUSES.includes('searching_driver'), 'offers include searching_driver');
  assert(isOpenOfferStatus('broadcasting'), 'broadcasting is an open offer');
  assert(isOpenOfferStatus('payment_authorized'), 'payment_authorized is an open offer');
  assert(!isOpenOfferStatus('assigned'), 'assigned is not an open offer');
  assert(isActiveTripStatus('assigned'), 'assigned is an active trip');
  assert(isActiveTripStatus('accepted'), 'accepted is an active trip');
  assert(isTerminalOrderStatus('completed'), 'completed is terminal');
  assert(
    canRoleTransition('driver', 'in_transit', 'completed'),
    'driver can complete from in_transit'
  );
  assert(
    canRoleTransition('driver', 'broadcasting', 'assigned'),
    'driver can accept a broadcasting offer'
  );

  const newest = '2026-08-16T10:00:00.000Z';
  const older = '2026-08-16T08:00:00.000Z';
  const sorted = sortCreatedAtDesc([{ createdAt: older }, { createdAt: newest }]);
  assert(sorted[0] === newest, 'orders sort by createdAt descending');

  const first = applyLocalWalletCredit(
    'driver-1',
    { tripFare: 100, platformFee: 15, driverNet: 85 },
    'order-a'
  );
  assert(first.totalEarnings === 100, 'first credit adds trip fare');
  assert(first.platformCommission === 15, 'first credit adds commission');
  assert(first.netEarnings === 85, 'first credit adds net');
  assert(first.balance === 85, 'first credit adds available balance');
  assert(first.completedOrderCount === 1, 'completed counter increments');

  const replay = applyLocalWalletCredit(
    'driver-1',
    { tripFare: 100, platformFee: 15, driverNet: 85 },
    'order-a'
  );
  assert(replay.totalEarnings === 100, 'repeat complete is idempotent');
  assert(replay.completedOrderCount === 1, 'repeat complete does not increment again');

  const second = applyLocalWalletCredit(
    'driver-1',
    { tripFare: 50, platformFee: 7.5, driverNet: 42.5 },
    'order-b'
  );
  assert(second.totalEarnings === 150, 'second trip adds fare');
  assert(second.netEarnings === 127.5, 'second trip adds net');

  const persisted = loadLocalDriverWallet('driver-1');
  assert(persisted.creditedOrderIds.includes('order-a'), 'credited order ids persist');

  const merged = mergeWalletViews(
    { ...emptyWallet(), totalEarnings: 80, netEarnings: 60, balance: 60 },
    persisted
  );
  assert(merged.totalEarnings === 150, 'merge keeps the higher local earnings');
  assert(merged.creditedOrderIds.includes('order-b'), 'merge unions credited ids');

  assert(!isDemoDocumentId('draft-1710000000000'), 'paid checkout draft ids are not demo ghosts');
  assert(isDemoDocumentId('demo-trip-1'), 'demo- prefix remains a ghost id');
  assert(
    !isTestOrGhostRecord({ uid: 'real-uid-1', localSharedE2E: true }),
    'localSharedE2E alone does not ghost production orders'
  );

  assert(
    !isGhostAdminOrder('draft-1710000000000', {
      status: 'broadcasting',
      paymentStatus: 'authorized',
      userId: 'customer-abc',
      localSharedE2E: true,
    }),
    'live draft-* orders stay visible in admin'
  );
  assert(
    isGhostAdminOrder('demo-order-1', { status: 'broadcasting', userId: 'x' }),
    'demo- order ids stay hidden'
  );
  assert(
    isGhostAdminOrder('e2e-order-1', { status: 'completed', userId: 'e2e-customer-1' }),
    'e2e user ids stay hidden'
  );

  const feed = mergeAdminFeed(
    [
      mapOrderDocToFeedItem('ord-1', {
        status: 'assigned',
        userId: 'cust-1',
        serviceType: 'flatbed',
        createdAt: '2026-08-27T10:00:00.000Z',
        financials: { customerTotal: 120 },
      }),
    ],
    [
      mapDriverApplicationToFeedItem({
        id: 'drv-1',
        kind: 'b2c_driver',
        name: 'Ahmed',
        phone: '+966555123456',
        truck: 'flatbed',
        serviceType: 'flatbed',
        subtype: '',
        plateNumber: 'ABC 1234',
        status: 'ready_for_review',
        docsComplete: true,
        complaints: 0,
        createdAt: '2026-08-27T11:00:00.000Z',
        documents: {
          license: { status: 'uploaded' },
          id: { status: 'uploaded' },
          registration: { status: 'uploaded' },
          permit: { status: 'uploaded' },
        },
      }),
    ]
  );
  assert(feed.length === 2, 'admin feed includes orders and driver applications');
  assert(feed[0].kind === 'driver_registration', 'newer driver application sorts first');
  assert(feed[1].kind === 'order', 'transport order remains in the same feed');

  assert(isLoopbackHostname('localhost'), 'localhost is loopback');
  assert(isLoopbackHostname('127.0.0.1'), '127.0.0.1 is loopback');
  assert(!isLoopbackHostname('hamula-cfc6c.web.app'), 'hosting is not loopback');
  assert(
    resolvePublicAppOrigin({
      windowOrigin: 'https://localhost',
      isNative: true,
      isProdBuild: true,
      firebaseProjectId: 'hamula-cfc6c',
    }) === 'https://hamula-cfc6c.web.app',
    'native production origin is Firebase Hosting, not localhost'
  );
  assert(
    resolvePublicAppOrigin({
      envAppUrl: 'https://app.miras.sa',
      windowOrigin: 'capacitor://localhost',
      isNative: true,
    }) === 'https://app.miras.sa',
    'VITE_APP_URL wins over Capacitor origin'
  );
  assert(
    nativeOpenUrlToSpaPath(
      'https://hamula-cfc6c.web.app/payment-callback?id=pay_1&status=paid'
    ) === '/payment-callback?id=pay_1&status=paid',
    'https App Link maps to SPA path'
  );
  assert(
    nativeOpenUrlToSpaPath('com.miras.app://payment-callback?id=pay_1') ===
      '/payment-callback?id=pay_1',
    'Android custom scheme maps to SPA path'
  );
  assert(
    nativeOpenUrlToSpaPath('com.ahmed.miras://payment-callback?id=pay_1') ===
      '/payment-callback?id=pay_1',
    'iOS custom scheme maps to SPA path'
  );
  assert(shouldApplyNativeDeepLink('/payment-callback?id=1'), 'payment path is applied');
  assert(!shouldApplyNativeDeepLink('/'), 'root launch URL is ignored');

  assert(isDemoMoyasarId('demo-checkout-1'), 'demo checkout ids are detected');
  assert(
    resolveMoyasarCallbackUrl(
      'https://localhost/payment-callback',
      'https://hamula-cfc6c.web.app',
      { lockToAppUrl: true }
    ) === 'https://hamula-cfc6c.web.app/payment-callback',
    'production Moyasar callback is APP_URL, never localhost'
  );
  assert(
    resolveMoyasarCallbackUrl(
      'https://localhost/payment-callback',
      'https://hamula-cfc6c.web.app',
      { lockToAppUrl: true, draftId: 'draft-abc' }
    ) === 'https://hamula-cfc6c.web.app/payment-callback?draftId=draft-abc',
    'production Moyasar callback keeps checkout draftId'
  );

  assert(
    resolveApiOriginFrom({
      isNative: true,
      publicAppOrigin: 'https://hamula-cfc6c.web.app',
      windowOrigin: 'capacitor://hamula-cfc6c.web.app',
    }) === 'https://hamula-cfc6c.web.app',
    'native Capacitor API origin is Firebase Hosting'
  );
  assert(
    resolveApiOriginFrom({
      envApiOrigin: 'https://hamoula-api.example.run.app',
      isNative: true,
      publicAppOrigin: 'https://hamula-cfc6c.web.app',
    }) === 'https://hamoula-api.example.run.app',
    'VITE_API_ORIGIN wins on native'
  );
  assert(
    sandboxCheckoutAllowed({
      demoAllowed: false,
      isNative: true,
      deployEnv: 'staging',
    }),
    'TestFlight staging allows sandbox checkout'
  );
  assert(
    !sandboxCheckoutAllowed({
      demoAllowed: false,
      isNative: true,
      deployEnv: 'production',
    }),
    'live production never uses sandbox checkout'
  );
  assert(
    isAllowedNativeApiOrigin(
      'capacitor://hamula-cfc6c.web.app',
      'https://hamula-cfc6c.web.app'
    ),
    'CORS allows Capacitor origin'
  );

  applyLocalWalletCredit(
    'drv-test',
    { tripFare: 100, platformFee: 0, driverNet: 100 },
    'seed-order'
  );
  applyLocalWalletHold('drv-test', 40);
  const afterHold = loadLocalDriverWallet('drv-test');
  assert(afterHold.heldBalance === 40, 'hold parks wallet funds');
  assert(afterHold.balance === 60, 'hold reduces available balance');
  releaseLocalWalletHold('drv-test', 40);
  const afterRelease = loadLocalDriverWallet('drv-test');
  assert(afterRelease.heldBalance === 0, 'reject releases heldBalance');
  assert(afterRelease.balance === 100, 'reject restores available balance');

  assert(FREE_SERVICE_FEE_ORDERS === 3, 'promo covers first 3 paid orders');
  assert(shouldWaiveServiceFee(0), 'order 1 waives customer service fee');
  assert(shouldWaiveServiceFee(2), 'order 3 waives customer service fee');
  assert(!shouldWaiveServiceFee(3), 'order 4 applies customer service fee');

  const waived = buildTripFinancials(300, { waiveServiceFee: true });
  assert(waived.serviceFee === 0, 'first-3 promo zeroes customer service fee');
  assert(waived.customerTotal === 300, 'waived total equals trip fare');
  assert(waived.platformFee === 45, 'driver commission still 15% when fee is waived');
  assert(waived.driverNet === 255, 'driver net is tripFare minus commission');

  const charged = buildTripFinancials(300, { waiveServiceFee: false });
  assert(charged.serviceFee === 15, 'from 4th order customer pays 5%');
  assert(charged.customerTotal === 315, 'customer total is trip + service fee');
  assert(charged.platformFee === 45, 'driver commission is 15% of trip fare');
  assert(charged.driverNet === 255, 'driver net matches waived and charged trips');

  const recoveredWaived = normalizeTripFinancials({
    totalPrice: 300,
    serviceFee: 0,
  });
  assert(recoveredWaived.tripFare === 300, 'waived reconstruction does not divide by 1.05');
  assert(recoveredWaived.platformFee === 45, 'waived reconstruction still has commission');
  assert(recoveredWaived.customerTotal === 300, 'waived reconstruction keeps client total');

  const recoveredCharged = normalizeTripFinancials({
    customerTotal: 315,
    serviceFee: 15,
  });
  assert(recoveredCharged.tripFare === 300, 'charged reconstruction uses total minus fee');
  assert(recoveredCharged.platformFee === 45, 'charged reconstruction has commission');

  const persistedMoney = financialsToFirestorePricingFields(charged);
  assert(persistedMoney.totalPrice === 315, 'persisted total matches customer total');
  assert(persistedMoney.commission_amount === 45, 'persisted commission matches platform fee');
  assert(persistedMoney.driver_earning === 255, 'persisted driver earning matches net');
  assert(persistedMoney.price === 315, 'legacy price field stores customer total');

  const customerQuote = toCustomerQuoteDisplay(charged);
  assert(customerQuote.serviceFee === 15, 'customer quote shows 5% service fee');
  assert(customerQuote.total === 315, 'customer quote total is trip + service fee');
  assert(
    !('platformFee' in customerQuote) && !('driverNet' in customerQuote),
    'customer quote must not expose driver commission'
  );
  const waivedQuote = toCustomerQuoteDisplay(waived);
  assert(waivedQuote.serviceFee === 0, 'customer quote is free for first 3 orders');
  assert(waivedQuote.total === 300, 'waived customer quote total equals trip fare');

  const driverView = getDriverOfferMetrics({
    id: 'ord-1',
    financials: waived,
    totalPrice: 300,
    distanceKm: 40,
    pickupAddress: 'A',
    dropoffAddress: 'B',
    status: 'broadcasting',
  } as unknown as Parameters<typeof getDriverOfferMetrics>[0]);
  assert(driverView?.clientTotal === 300, 'driver card client total matches customer');
  assert(driverView?.platformFee === 45, 'driver card shows app commission');
  assert(driverView?.driverNet === 255, 'driver card shows net earning');
  assert(driverView?.tripFare === 300, 'driver card trip fare matches snapshot');

  const nestedPrice = getDriverOfferMetrics({
    id: 'ord-2',
    price: { total: 300 },
    serviceFee: 0,
    distanceKm: 12,
    status: 'broadcasting',
  } as unknown as Parameters<typeof getDriverOfferMetrics>[0]);
  assert(nestedPrice?.clientTotal === 300, 'object price.total is coerced');
  assert(nestedPrice?.platformFee === 45, 'object price still yields commission');
  assert(nestedPrice != null && nestedPrice.clientTotal > 250, 'never falls back to the old 240 mock');

  const nestedPickup = getOrderPickupLatLng({
    pickup: { address: 'Riyadh', location: { lat: 24.7136, lng: 46.6753 } },
  } as unknown as Parameters<typeof getOrderPickupLatLng>[0]);
  assert(nestedPickup?.lat === 24.7136 && nestedPickup?.lng === 46.6753, 'nested pickup location is read');
  const nestedDropoff = getOrderDropoffLatLng({
    destination: { latitude: 21.4858, longitude: 39.1925 },
  } as unknown as Parameters<typeof getOrderDropoffLatLng>[0]);
  assert(nestedDropoff?.lat === 21.4858 && nestedDropoff?.lng === 39.1925, 'nested dropoff lat/lng aliases are read');

  assert(isValidMapsTarget({ lat: 24.7136, lng: 46.6753 }), 'maps target accepts coordinates');
  assert(isValidMapsTarget({ address: 'الرياض' }), 'maps target accepts an address fallback');
  assert(!isValidMapsTarget({ lat: 0, lng: 0 }), 'maps target rejects null island');

  console.log('lifecycle-audit: all checks passed');
}

run();
