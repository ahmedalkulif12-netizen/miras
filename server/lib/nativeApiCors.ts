/**
 * CORS for Capacitor / TestFlight calling the public HTTPS API origin.
 * Hosting same-origin SPA requests have no Origin that needs echoing.
 */
import type { Request, Response, NextFunction } from 'express';
import { isLoopbackHostname } from './moyasarCallback.ts';

export function isAllowedNativeApiOrigin(origin: string, appUrl: string): boolean {
  const value = (origin || '').trim();
  if (!value) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = parsed.hostname.toLowerCase();

  if (protocol === 'capacitor' || protocol === 'ionic') return true;
  if (protocol === 'http' && isLoopbackHostname(host)) return true;
  if (protocol !== 'https') return false;

  if (host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')) return true;

  try {
    return new URL(appUrl).origin === parsed.origin;
  } catch {
    return false;
  }
}

export function nativeApiCors(appUrl: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = String(req.headers.origin || '');
    if (isAllowedNativeApiOrigin(origin, appUrl)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Firebase-AppCheck, X-Dev-Bypass-Uid'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  };
}
