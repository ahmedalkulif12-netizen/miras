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
import { assertTrackingListenerReceivesUpdate } from '../helpers/firestoreListener.ts';

export interface ScenarioResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  risky?: string;
}

/**
 * End-to-end customer lifecycle:
 * create order → Moyasar webhook → payment return → driver accept →
 * status progression → live tracking listener → capture/complete.
 */
export async function runFullLifecycleScenario(
  ctx: AdminContext,
  config: E2eConfig
): Promise<ScenarioResult> {
  const started = Date.now();
  const name = 'fullLifecycle';
  const api = new E2eApiClient(config);

  try {
    const customerToken = await mintIdToken(ctx, config.actors.customerUid, config.firebaseApiKey);
    const driverToken = await mintIdToken(ctx, config.actors.driverAUid, config.firebaseApiKey);

    const createRes = await api.request<{ orderId: string; financials: Record<string, unknown> }>(
      '/api/orders',
      {
        method: 'POST',
        token: customerToken,
        body: SAMPLE_ORDER_PAYLOAD,
      }
    );
    assert(createRes.status === 201, `create order failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    const orderId = createRes.body.orderId;
    ctx.artifacts.orderIds.push(orderId);

    await waitForOrderStatus(ctx, orderId, 'awaiting_payment');

    const { paymentId, moyasarId } = await seedPaymentFixture(ctx, {
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
    assertEqual(webhook.status, 200, 'Moyasar webhook status');

    await waitForOrderStatus(ctx, orderId, 'broadcasting');

    const returnRes = await api.request<{ startTracking: boolean; orderStatus: string }>(
      '/api/payments/return',
      {
        token: customerToken,
        query: {
          orderId,
          moyasarId,
          status: 'paid',
        },
      }
    );
    assert(returnRes.status === 200, `payment return failed: ${returnRes.status}`);
    assert(returnRes.body.startTracking === true, 'payment return should enable tracking UI');

    const acceptRes = await api.request<{ status: string }>(`/api/orders/${orderId}/accept`, {
      method: 'POST',
      token: driverToken,
      body: {
        driverName: 'E2E Driver A',
        driverPhone: '+966500000002',
        truckDetails: 'flatbed E2E',
      },
    });
    assert(acceptRes.status === 200, `driver accept failed: ${acceptRes.status}`);
    await waitForOrderStatus(ctx, orderId, 'assigned');

    const arrivedRes = await api.request(`/api/orders/${orderId}/status`, {
      method: 'POST',
      token: driverToken,
      body: { status: 'driver_arrived' },
    });
    assert(arrivedRes.status === 200, `driver_arrived failed: ${arrivedRes.status}`);

    const transitRes = await api.request(`/api/orders/${orderId}/status`, {
      method: 'POST',
      token: driverToken,
      body: { status: 'in_transit' },
    });
    assert(transitRes.status === 200, `in_transit failed: ${transitRes.status}`);

    // Firestore listener + rules-enforced GPS write (payment + tracking together)
    await assertTrackingListenerReceivesUpdate(ctx, config, {
      orderId,
      customerUid: config.actors.customerUid,
      driverUid: config.actors.driverAUid,
      lat: 24.71,
      lng: 46.68,
    });

    const captureRes = await api.request('/api/capture-payment', {
      method: 'POST',
      token: driverToken,
      body: {
        paymentId,
        orderId,
        driverId: config.actors.driverAUid,
      },
    });
    assert(captureRes.status === 200, `capture failed: ${captureRes.status} ${JSON.stringify(captureRes.body)}`);
    await waitForOrderStatus(ctx, orderId, 'completed');

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
