/**
 * Local-only development helpers. Never true in production/staging builds.
 * Loopback and private LAN (phone on same Wi-Fi) are allowed during `npm run dev`.
 */

const LOCAL_WORK_PREFIX = 'miras_local_dev_work_';

function isProductionClientDeploy(): boolean {
  const deploy =
    import.meta.env.VITE_MIRAS_DEPLOY_ENV || import.meta.env.VITE_HAMOULA_DEPLOY_ENV;
  return deploy === 'production' || deploy === 'staging';
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '::ffff:127.0.0.1'
  );
}

/** RFC1918 LAN + loopback — used so a phone can open http://192.168.x.x:3000 during Vite DEV. */
export function isPrivateLanOrLoopbackHostname(hostname: string): boolean {
  if (isLoopbackHostname(hostname)) return true;
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isLocalDemoHost(): boolean {
  if (typeof window === 'undefined') return false;
  return isPrivateLanOrLoopbackHostname(window.location.hostname);
}

export function isLocalDevRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isLocalDemoHost()) return false;
  // `npm run dev` is local testing even when .env has VITE_MIRAS_DEPLOY_ENV=staging.
  if (import.meta.env.DEV) return true;
  if (import.meta.env.PROD || isProductionClientDeploy()) return false;
  return true;
}

export function readLocalDevWorkEnabled(uid: string): boolean {
  if (!isLocalDevRuntime() || !uid) return false;
  try {
    return localStorage.getItem(`${LOCAL_WORK_PREFIX}${uid}`) === '1';
  } catch {
    return false;
  }
}

export function persistLocalDevWorkEnabled(uid: string): void {
  if (!isLocalDevRuntime() || !uid) return;
  try {
    localStorage.setItem(`${LOCAL_WORK_PREFIX}${uid}`, '1');
  } catch {
    /* ignore quota */
  }
}

/** Pending/review drivers may go online on localhost without changing admin review status. */
export function canStartWorkLocally(accountStatus: string): boolean {
  if (accountStatus === 'approved' || accountStatus === 'active') return true;
  if (accountStatus === 'suspended' || accountStatus === 'banned') return false;
  return isLocalDevRuntime();
}
