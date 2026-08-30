import type { Request, Response, NextFunction } from 'express';

/**
 * Baseline security headers for production/staging hosts behind HTTPS terminators.
 * Does not break SPA routing or Moyasar payment redirects.
 */
export function securityHeaders(isProductionNode: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!isProductionNode) return next();

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    // HSTS — only safe when TLS terminates correctly (see deploy/nginx example).
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    next();
  };
}
