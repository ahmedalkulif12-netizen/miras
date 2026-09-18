export type CheckoutDeployEnv = 'development' | 'staging' | 'production';

export function readClientDeployEnv(raw?: string | null): CheckoutDeployEnv {
  if (raw === 'staging' || raw === 'production') return raw;
  return 'development';
}

/**
 * In-app sandbox checkout (no live charge). Local `npm run dev` / screenshot
 * demo only. Store and Hosting production builds always use Moyasar.
 */
export function sandboxCheckoutAllowed(input: {
  demoAllowed: boolean;
  isNative: boolean;
  deployEnv: CheckoutDeployEnv;
}): boolean {
  if (input.deployEnv === 'production' || input.deployEnv === 'staging') {
    return false;
  }
  return input.demoAllowed;
}
