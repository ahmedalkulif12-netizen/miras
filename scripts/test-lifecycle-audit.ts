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
    'custom scheme maps to SPA path'
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

  console.log('lifecycle-audit: all checks passed');
}

run();
