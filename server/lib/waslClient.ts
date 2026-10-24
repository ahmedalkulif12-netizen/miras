import axios from 'axios';
import { getServerConfig, type ServerConfig } from '../config/env.ts';
import {
  readWaslReference,
  waslCallSucceeded,
  type WaslWireResult,
} from '../../src/domain/wasl.ts';

export interface WaslClientConfig {
  baseUrl: string;
  apiKey: string;
  clientId: string;
  appId: string;
}

export function readWaslConfig(config: ServerConfig = getServerConfig()): WaslClientConfig {
  return {
    baseUrl: config.waslApiBaseUrl.replace(/\/$/, ''),
    apiKey: config.waslApiKey,
    clientId: config.waslClientId,
    appId: config.waslAppId,
  };
}

export function isWaslConfigured(config: WaslClientConfig = readWaslConfig()): boolean {
  return Boolean(config.baseUrl && (config.apiKey || config.clientId));
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
  method: 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown>,
  config: WaslClientConfig = readWaslConfig()
): Promise<WaslWireResult> {
  if (!isWaslConfigured(config)) {
    return { ok: false, skipped: true, reason: 'WASL_NOT_CONFIGURED', reference: null };
  }
  try {
    const response = await axios.request({
      method,
      url: waslUrl(config, path),
      data: body,
      timeout: 12_000,
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
        ...(config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}`, 'x-api-key': config.apiKey, 'app-key': config.apiKey }
          : {}),
        ...(config.clientId ? { 'client-id': config.clientId } : {}),
        ...(config.appId ? { 'app-id': config.appId } : {}),
      },
    });
    const data = response.data;
    const ok = waslCallSucceeded(data, response.status);
    return {
      ok,
      reference: readWaslReference(data),
      httpStatus: response.status,
      error: ok ? null : 'WASL_REJECTED',
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
    return { ok: false, reference: null, httpStatus, error: message };
  }
}
