/**
 * Resolves API paths for same-origin (Express / Cloud Run behind Hosting) or split
 * deployments via VITE_API_ORIGIN.
 */
export function getApiOrigin(): string {
  const raw = import.meta.env.VITE_API_ORIGIN;
  return typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = getApiOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}
