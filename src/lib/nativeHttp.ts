/**
 * Native API transport — Capacitor WKWebView `fetch` is subject to CORS and
 * often drops `Authorization` on capacitor:// origins. CapacitorHttp uses the
 * OS stack (URLSession / OkHttp) so Bearer tokens reach Cloud Run.
 *
 * Do NOT enable global CapacitorHttp fetch patching — that can break Firebase Auth/Firestore.
 */
import { Capacitor, CapacitorHttp, type HttpOptions } from '@capacitor/core';

export function shouldUseNativeHttp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  const authorization = out.Authorization || out.authorization;
  if (authorization) {
    out.Authorization = authorization;
  }
  return out;
}

function serializeBody(body: BodyInit | null | undefined, headers: Record<string, string>): HttpOptions['data'] {
  if (body == null) return undefined;
  if (typeof body === 'string') {
    const contentType = headers['Content-Type'] || headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(body) as HttpOptions['data'];
      } catch {
        return body;
      }
    }
    return body;
  }
  if (body instanceof URLSearchParams) return body.toString();
  return body as HttpOptions['data'];
}

export async function platformFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!shouldUseNativeHttp()) {
    return fetch(url, init);
  }

  const method = String(init.method || 'GET').toUpperCase();
  const headers = headersInitToRecord(init.headers);
  let result: Awaited<ReturnType<typeof CapacitorHttp.request>>;
  try {
    result = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: method === 'GET' || method === 'HEAD' ? undefined : serializeBody(init.body, headers),
      connectTimeout: 25_000,
      readTimeout: 25_000,
      responseType: 'text',
    });
  } catch (error) {
    console.warn('[nativeHttp] CapacitorHttp failed — falling back to fetch:', error);
    return fetch(url, init);
  }

  const raw =
    typeof result.data === 'string'
      ? result.data
      : result.data == null
        ? ''
        : JSON.stringify(result.data);

  const status = Number(result.status);
  return new Response(raw, {
    status: Number.isFinite(status) && status > 0 ? status : 502,
    headers: new Headers(result.headers || {}),
  });
}
