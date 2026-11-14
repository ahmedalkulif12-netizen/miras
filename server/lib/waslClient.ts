import axios from 'axios';
import { getServerConfig, type ServerConfig } from '../config/env.ts';
import {
  readWaslReference,
  waslCallSucceeded,
  type WaslWireResult,
} from '../../src/domain/wasl.ts';

/** Official ELM gateway. The path prefix selects tracking vs dispatching. */
export const DEFAULT_WASL_API_BASE_URL = 'https://wasl.api.elm.sa/api/tracking/v1';

export interface WaslClientConfig {
  baseUrl: string;
  apiKey: string;
  clientId: string;
  clientSecret: string;
  appId: string;
}

export function readWaslConfig(config: ServerConfig = getServerConfig()): WaslClientConfig {
  return {
    baseUrl: (config.waslApiBaseUrl || DEFAULT_WASL_API_BASE_URL).replace(/\/$/, ''),
    apiKey: config.waslApiKey,
    clientId: config.waslClientId,
    clientSecret: config.waslClientSecret,
    appId: config.waslAppId,
  };
}

export function isWaslConfigured(config: WaslClientConfig = readWaslConfig()): boolean {
  return Boolean(config.baseUrl && config.clientId && (config.clientSecret || config.apiKey));
}

/** Gateway credentials. The secret is never written to logs. */
export function waslAuthHeaders(config: WaslClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
  if (config.clientId) {
    headers['client-id'] = config.clientId;
    headers['X-IBM-Client-Id'] = config.clientId;
  }
  if (config.clientSecret) {
    headers['app-key'] = config.clientSecret;
    headers['X-IBM-Client-Secret'] = config.clientSecret;
  }
  if (config.appId) headers['app-id'] = config.appId;
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers['x-api-key'] = config.apiKey;
  }
  return headers;
}

function waslUrl(config: WaslClientConfig, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${config.baseUrl}${suffix}`;
}

/**
 * POST/PUT a prepared WASL body. Missing credentials return skipped so trip
 * updates still succeed before the TGA key is issued.
 */
export async function callWasl(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: Record<string, unknown> | unknown[],
  config: WaslClientConfig = readWaslConfig()
): Promise<WaslWireResult> {
  if (!isWaslConfigured(config)) {
    return { ok: false, skipped: true, reason: 'WASL_NOT_CONFIGURED', reference: null };
  }
  try {
    const response = await axios.request({
      method,
      url: waslUrl(config, path),
      data: method === 'GET' ? undefined : body,
      timeout: 12_000,
      headers: waslAuthHeaders(config),
    });
    const data = response.data;
    const ok = waslCallSucceeded(data, response.status);
    return {
      ok,
      reference: readWaslReference(data),
      httpStatus: response.status,
      error: ok ? null : 'WASL_REJECTED',
      body: data,
    };
  } catch (error) {
    const httpStatus = (error as { response?: { status?: number } }).response?.status ?? null;
    const data = (error as { response?: { data?: unknown } }).response?.data;
    const message =
      data && typeof data === 'object'
        ? String(
            (data as { message?: string; resultCode?: string }).message ||
              (data as { resultCode?: string }).resultCode ||
              'WASL_REQUEST_FAILED'
          )
        : error instanceof Error
          ? error.message
          : 'WASL_REQUEST_FAILED';
    console.error('[wasl] request failed', { path, httpStatus, message });
    return { ok: false, reference: null, httpStatus, error: message, body: data };
  }
}
