/**
 * Development-only App Check debug token bootstrap.
 * Imported dynamically — never loaded on production code paths.
 *
 * Prefer a registered UUID from VITE_APP_CHECK_DEBUG_TOKEN (avoids exchangeDebugToken 403).
 * Fall back to `true` so Firebase prints a new UUID to register in Console.
 */
import { clearAppCheckDebugToken, isAppCheckDebugModeAllowed } from '@/lib/appCheck/guard';

function setDebugTokenOnGlobals(value: string | boolean): void {
  const targets: Array<Record<string, unknown>> = [globalThis as Record<string, unknown>];
  if (typeof self !== 'undefined') {
    targets.push(self as unknown as Record<string, unknown>);
  }
  if (typeof window !== 'undefined') {
    targets.push(window as unknown as Record<string, unknown>);
  }

  for (const target of targets) {
    try {
      target.FIREBASE_APPCHECK_DEBUG_TOKEN = value;
    } catch {
      /* ignore non-configurable targets */
    }
  }
}

export function installDevAppCheckDebugToken(): void {
  if (!isAppCheckDebugModeAllowed()) {
    clearAppCheckDebugToken();
    return;
  }

  const registered = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim();
  if (registered) {
    setDebugTokenOnGlobals(registered);
    console.info(
      `[App Check] Using registered debug token from VITE_APP_CHECK_DEBUG_TOKEN (…${registered.slice(-6)})`
    );
    return;
  }

  setDebugTokenOnGlobals(true);
  console.info(
    '[App Check] Debug mode ON (FIREBASE_APPCHECK_DEBUG_TOKEN=true). ' +
      'Look for "App Check debug token:" in this console, then register that UUID in Firebase ' +
      'and set VITE_APP_CHECK_DEBUG_TOKEN in .env.'
  );
}
