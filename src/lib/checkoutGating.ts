/**
 * Production builds never skip Moyasar or invent paid orders from local drafts.
 * Local/demo checkout is limited to Vite DEV (and explicit localhost bypass).
 */

import { isProductionClient } from '@/lib/appCheck/guard';
import { isDevBypassAuthSession } from '@/lib/authApi';

export function isLockedCheckoutDeploy(): boolean {
  if (isProductionClient()) return true;
  const deploy =
    import.meta.env.VITE_MIRAS_DEPLOY_ENV || import.meta.env.VITE_HAMOULA_DEPLOY_ENV;
  return deploy === 'production' || deploy === 'staging';
}

/** True only for local `npm run dev` / screenshot bypass — never store builds. */
export function allowsDemoCheckout(): boolean {
  if (isLockedCheckoutDeploy()) return false;
  return import.meta.env.DEV || isDevBypassAuthSession();
}

export function isDemoMoyasarId(id?: string | null): boolean {
  if (!id) return false;
  return id === 'demo' || id.startsWith('demo-');
}
