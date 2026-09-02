import type { E2eConfig } from '../config.ts';
import type { AdminContext } from '../helpers/adminContext.ts';
import { E2eApiClient, SAMPLE_ORDER_PAYLOAD } from '../helpers/apiClient.ts';
import { assert } from '../helpers/assert.ts';
import { mintIdToken } from '../helpers/adminContext.ts';
import type { ScenarioResult } from './fullLifecycle.ts';

/**
 * App Check compatibility:
 * - When enforcement is OFF, APIs accept Bearer-only requests (staging default).
 * - When enforcement is ON, missing App Check header must be rejected unless debug token supplied.
 */
export async function runAppCheckCompatScenario(
  ctx: AdminContext,
  config: E2eConfig
): Promise<ScenarioResult> {
  const started = Date.now();
  const name = 'appCheckCompat';
  const api = new E2eApiClient(config);

  try {
    const customerToken = await mintIdToken(ctx, config.actors.customerUid, config.firebaseApiKey);

    if (!config.appCheckEnforce) {
      const res = await api.request('/api/orders', {
        method: 'POST',
        token: customerToken,
        appCheckToken: null,
        body: SAMPLE_ORDER_PAYLOAD,
      });

      if (res.status === 201 && (res.body as { orderId?: string }).orderId) {
        ctx.artifacts.orderIds.push((res.body as { orderId: string }).orderId);
      }

      assert(
        res.status === 201,
        `expected order create without App Check when enforcement disabled, got ${res.status}`
      );

      return {
        name,
        passed: true,
        durationMs: Date.now() - started,
        risky: config.appCheckToken
          ? undefined
          : 'APP_CHECK_ENFORCE=false — production rollout still requires enforced Console + E2E_APP_CHECK_TOKEN retest.',
      };
    }

    const missing = await api.request('/api/orders', {
      method: 'POST',
      token: customerToken,
      appCheckToken: null,
      body: SAMPLE_ORDER_PAYLOAD,
    });
    assert(missing.status === 401, 'missing App Check must return 401 when enforced');

    if (!config.appCheckToken) {
      return {
        name,
        passed: true,
        durationMs: Date.now() - started,
        risky: 'APP_CHECK_ENFORCE=true but E2E_APP_CHECK_TOKEN not set — could not verify valid token path.',
      };
    }

    const withToken = await api.request('/api/orders', {
      method: 'POST',
      token: customerToken,
      appCheckToken: config.appCheckToken,
      body: SAMPLE_ORDER_PAYLOAD,
    });
    assert(withToken.status === 201, `valid App Check token should pass, got ${withToken.status}`);
    if ((withToken.body as { orderId?: string }).orderId) {
      ctx.artifacts.orderIds.push((withToken.body as { orderId: string }).orderId);
    }

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

export async function runHealthScenario(config: E2eConfig): Promise<ScenarioResult> {
  const started = Date.now();
  const name = 'health';
  try {
    const api = new E2eApiClient(config);
    const res = await api.request<{ ok?: boolean }>('/health');
    assert(res.status === 200 && res.body.ok === true, `health check failed: ${res.status}`);
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
