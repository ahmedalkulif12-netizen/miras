import type { E2eConfig } from '../config.ts';

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
}

export class E2eApiClient {
  constructor(private readonly config: E2eConfig) {}

  async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
      appCheckToken?: string | null;
      query?: Record<string, string>;
    } = {}
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.config.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const appCheck =
      options.appCheckToken === null
        ? undefined
        : options.appCheckToken ?? this.config.appCheckToken;
    if (appCheck) {
      headers['X-Firebase-AppCheck'] = appCheck;
    }

    const res = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    let body: T;
    const text = await res.text();
    try {
      body = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      body = { raw: text } as T;
    }

    return { status: res.status, ok: res.ok, body };
  }
}

export const SAMPLE_ORDER_PAYLOAD = {
  serviceType: 'flatbed',
  truckType: 'normal' as const,
  tripType: 'inside_city' as const,
  pickupAddress: 'E2E Pickup — Riyadh Al Olaya',
  dropoffAddress: 'E2E Dropoff — Riyadh Al Malaz',
  pickupLat: 24.7136,
  pickupLng: 46.6753,
  dropoffLat: 24.6877,
  dropoffLng: 46.7219,
  distanceKm: 12,
  pickupCity: 'Riyadh',
  dropoffCity: 'Riyadh',
  truckCount: 1,
};
