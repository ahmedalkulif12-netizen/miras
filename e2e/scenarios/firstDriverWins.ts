import type { E2eConfig } from '../config.ts';
import type { AdminContext } from '../helpers/adminContext.ts';
import { E2eApiClient, SAMPLE_ORDER_PAYLOAD } from '../helpers/apiClient.ts';
import { assert, assertEqual } from '../helpers/assert.ts';
import {
  mintIdToken,
  seedPaymentFixture,
  waitForOrderStatus,
} from '../helpers/adminContext.ts';
import { postMoyasarWebhook } from '../helpers/moyasarWebhook.ts';
import type { ScenarioResult } from './fullLifecycle.ts';

/**
 * Two drivers race to accept the same broadcasting order.
 * Exactly one must win (200); the other must receive 409.
 */
export async function runFirstDriverWinsScenario(
  ctx: AdminContext,
  config: E2eConfig
): Promise<ScenarioResult> {
  const started = Date.now();
  const name = 'firstDriverWins';
  const api = new E2eApiClient(config);

  try {
    const customerToken = await mintIdToken(ctx, config.actors.customerUid, config.firebaseApiKey);
    const driverAToken = await mintIdToken(ctx, config.actors.driverAUid, config.firebaseApiKey);
    const driverBToken = await mintIdToken(ctx, config.actors.driverBUid, config.firebaseApiKey);

    const createRes = await api.request<{ orderId: string; financials: Record<string, unknown> }>(
      '/api/orders',
      { method: 'POST', token: customerToken, body: SAMPLE_ORDER_PAYLOAD }
    );
    assert(createRes.status === 201, `create order failed: ${createRes.status}`);
    const orderId = createRes.body.orderId;
    ctx.artifacts.orderIds.push(orderId);

    const { moyasarId } = await seedPaymentFixture(ctx, {
      orderId,
      userId: config.actors.customerUid,
      financials: createRes.body.financials,
    });

    const webhook = await postMoyasarWebhook(ctx, config.baseUrl, {
      id: moyasarId,
      status: 'authorized',
      amount: Math.round(Number(createRes.body.financials.customerTotal ?? 0) * 100),
      currency: 'SAR',
    });
    assertEqual(webhook.status, 200, 'webhook status');
    await waitForOrderStatus(ctx, orderId, 'broadcasting');

    const [acceptA, acceptB] = await Promise.all([
      api.request<{ status: string }>(`/api/orders/${orderId}/accept`, {
        method: 'POST',
        token: driverAToken,
        body: { driverName: 'Driver A', driverPhone: '+966500000002', truckDetails: 'A' },
      }),
      api.request<{ error?: string; status?: string }>(`/api/orders/${orderId}/accept`, {
        method: 'POST',
        token: driverBToken,
        body: { driverName: 'Driver B', driverPhone: '+966500000003', truckDetails: 'B' },
      }),
    ]);

    const statuses = [acceptA.status, acceptB.status].sort();
    assert(
      statuses[0] === 200 && statuses[1] === 409,
      `expected one 200 and one 409, got ${acceptA.status} / ${acceptB.status}`
    );

    const orderSnap = await ctx.db.collection('orders').doc(orderId).get();
    const assignedDriver = String(orderSnap.data()?.driverId || '');
    assert(
      assignedDriver === config.actors.driverAUid || assignedDriver === config.actors.driverBUid,
      'assigned driver must be one of the racing drivers'
    );

    return { name, passed: true, durationMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      passed: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
