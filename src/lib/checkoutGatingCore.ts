export type CheckoutDeployEnv = 'development' | 'staging' | 'production';

export function readClientDeployEnv(raw?: string | null): CheckoutDeployEnv {
  if (raw === 'staging' || raw === 'production') return raw;
  return 'development';
}

/**
 * In-app sandbox checkout (no live charge). Allowed for local DEV and for
 * native staging/TestFlight binaries. Never when deploy env is production.
 */
export function sandboxCheckoutAllowed(input: {
  demoAllowed: boolean;
  isNative: boolean;
  deployEnv: CheckoutDeployEnv;
}): boolean {
  if (input.demoAllowed) return true;
  if (input.deployEnv === 'production') return false;
  return input.isNative;
}
