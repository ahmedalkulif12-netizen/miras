/**
 * Live Tap merchant public key.
 * The secret key never ships in the client; Cloud Run keeps TAP_SECRET_KEY.
 * Live checkout always uses this key so a stale pk_test_ response cannot init the card SDK.
 */
export const LIVE_TAP_PUBLIC_KEY = 'pk_live_7aUaSASR05xvjIEultkP94AaCnDqQdV';

export function publicKeyForCheckout(input: {
  testMode?: boolean;
  publicKey?: string;
}): string {
  if (input.testMode && input.publicKey?.startsWith('pk_test_')) {
    return input.publicKey;
  }
  return LIVE_TAP_PUBLIC_KEY;
}
