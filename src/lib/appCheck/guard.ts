type AppCheckDebugGlobal = typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
};

/** True for `vite build` output — never uses debug tokens. */
export function isProductionClient(): boolean {
  return import.meta.env.PROD || !import.meta.env.DEV;
}

/** True only for `vite dev` — local debug token allowed. */
export function isAppCheckDebugModeAllowed(): boolean {
  return import.meta.env.DEV && !import.meta.env.PROD;
}

/**
 * DEV: stamp debug token as early as this module loads (before firebase/app-check).
 * Prefer the registered UUID from VITE_APP_CHECK_DEBUG_TOKEN so the SDK does not mint
 * a different unregistered token.
 */
function installEarlyDevDebugTokenFlag(): void {
  if (!isAppCheckDebugModeAllowed()) {
    return;
  }
  const registered = import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN?.trim();
  const value: string | boolean = registered || true;
  for (const target of getDebugGlobalTargets()) {
    try {
      target.FIREBASE_APPCHECK_DEBUG_TOKEN = value;
    } catch {
      /* ignore */
    }
  }
}

function getDebugGlobalTargets(): AppCheckDebugGlobal[] {
  const targets: AppCheckDebugGlobal[] = [globalThis as AppCheckDebugGlobal];
  if (typeof self !== 'undefined') {
    targets.push(self as AppCheckDebugGlobal);
  }
  if (typeof window !== 'undefined') {
    targets.push(window as AppCheckDebugGlobal);
  }
  return targets;
}

/** Removes FIREBASE_APPCHECK_DEBUG_TOKEN from all global targets. */
export function clearAppCheckDebugToken(): void {
  for (const target of getDebugGlobalTargets()) {
    try {
      delete target.FIREBASE_APPCHECK_DEBUG_TOKEN;
    } catch {
      target.FIREBASE_APPCHECK_DEBUG_TOKEN = undefined;
    }
  }
}

/**
 * Production: block reads/writes so Firebase SDK cannot enter debug-token mode.
 * Safe to call multiple times.
 */
export function lockAppCheckDebugTokenDisabled(): void {
  if (!import.meta.env.PROD) {
    return;
  }

  for (const target of getDebugGlobalTargets()) {
    try {
      delete target.FIREBASE_APPCHECK_DEBUG_TOKEN;
    } catch {
      /* ignore */
    }

    try {
      Object.defineProperty(target, 'FIREBASE_APPCHECK_DEBUG_TOKEN', {
        configurable: true,
        enumerable: false,
        get(): undefined {
          return undefined;
        },
        set(): void {
          /* Production uses ReCaptchaV3Provider only. */
        },
      });
    } catch {
      /* Some runtimes disallow defineProperty on self/window. */
    }
  }
}

/** Run before any firebase/app-check import on production builds. */
export function enforceProductionAppCheckGuard(): void {
  if (!import.meta.env.PROD) {
    return;
  }
  clearAppCheckDebugToken();
  lockAppCheckDebugTokenDisabled();
}

// Side-effect: lock debug mode as early as this module loads in production bundles.
enforceProductionAppCheckGuard();
// Side-effect: enable debug-token generation before App Check SDK imports (vite dev only).
installEarlyDevDebugTokenFlag();
