import { resolveApiUrl } from '@/lib/apiUrl';
import { readApiErrorMessage, readApiJson } from '@/lib/apiResponse';

/** Unauthenticated fetch — always resolves through VITE_API_ORIGIN / Hosting rewrites. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(resolveApiUrl(path), init);
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  errorFallback = `Request failed: ${path}`
): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, errorFallback));
  }
  return readApiJson<T>(res);
}
