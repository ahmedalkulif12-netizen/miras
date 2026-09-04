/**
 * Checkout locks: live production never skips Moyasar.
 * TestFlight / Play internals are vite PROD + staging — those may use a
 * sandbox in-app checkout when Moyasar is unreachable so App Review can pass.
 */

import { Capacitor } from '@capacitor/core';
import { isProductionClient } from '@/lib/appCheck/guard';
import { isDevBypassAuthSession } from '@/lib/authApi';
import {
  readClientDeployEnv,
  sandboxCheckoutAllowed,
} from '@/lib/checkoutGatingCore';

export type { CheckoutDeployEnv } from '@/lib/checkoutGatingCore';
export { readClientDeployEnv, sandboxCheckoutAllowed } from '@/lib/checkoutGatingCore';

export function isNativeClient(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isLockedCheckoutDeploy(): boolean {
  if (isProductionClient()) return true;
  const deploy = readClientDeployEnv(
    import.meta.env.VITE_MIRAS_DEPLOY_ENV || import.meta.env.VITE_HAMOULA_DEPLOY_ENV
  );
  return deploy === 'production' || deploy === 'staging';
}

/** True only for local `npm run dev` / screenshot bypass — never store builds. */
export function allowsDemoCheckout(): boolean {
  if (isLockedCheckoutDeploy()) return false;
  return import.meta.env.DEV || isDevBypassAuthSession();
}

export function allowsSandboxCheckout(): boolean {
  return sandboxCheckoutAllowed({
    demoAllowed: allowsDemoCheckout(),
    isNative: isNativeClient(),
    deployEnv: readClientDeployEnv(
      import.meta.env.VITE_MIRAS_DEPLOY_ENV || import.meta.env.VITE_HAMOULA_DEPLOY_ENV
    ),
  });
}

export function isDemoMoyasarId(id?: string | null): boolean {
  if (!id) return false;
  return id === 'demo' || id.startsWith('demo-');
}
