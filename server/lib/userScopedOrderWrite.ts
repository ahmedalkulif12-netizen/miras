/**
 * Local-dev order write using the caller's Firebase ID token (Firestore REST).
 * Bypasses Admin SDK when no service-account JSON / ADC is available.
 */

import { buildBroadcastingOrderPlainDocument } from './checkoutDraft.ts';
import {
  validateCreateOrderPayload,
  type CreateOrderPayload,
} from './createOrder.ts';
import { canonicalizeServiceType } from '../../src/domain/serviceCategories.ts';
import { OrderStatus } from './orderStatus.ts';

const DEV_BYPASS_BEARER = 'dev-bypass-token';

export function isDevBypassBearer(token: string): boolean {
  return token.trim() === DEV_BYPASS_BEARER;
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof value === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      fields[key] = toFirestoreValue(nested);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toDocumentFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

function readStringField(
  fields: Record<string, unknown> | undefined,
  key: string
): string {
  const raw = fields?.[key] as { stringValue?: string } | undefined;
  return String(raw?.stringValue || '');
}

async function firestoreRest(
  projectId: string,
  idToken: string,
  method: string,
  pathAndQuery: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents${pathAndQuery}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { ok: response.ok, status: response.status, json };
}

export async function publishAfterLocalCheckoutAsUser(input: {
  projectId: string;
  idToken: string;
  userId: string;
  draftId: string;
  moyasarId?: string;
  payload?: CreateOrderPayload;
  financials?: Record<string, unknown>;
  testMode?: boolean;
}): Promise<{ orderId: string; status: string }> {
  if (!input.payload || !input.financials) {
    throw Object.assign(
      new Error('Checkout draft payload is required to publish order'),
      { statusCode: 400 }
    );
  }

  validateCreateOrderPayload(input.payload);
  const serviceType =
    canonicalizeServiceType(input.payload.serviceType) || input.payload.serviceType;
  if (!canonicalizeServiceType(serviceType)) {
    throw Object.assign(new Error(`Invalid serviceType: ${input.payload.serviceType}`), {
      statusCode: 400,
    });
  }

  const orderId = input.draftId;
  const existing = await firestoreRest(
    input.projectId,
    input.idToken,
    'GET',
    `/orders/${encodeURIComponent(orderId)}`
  );
  if (existing.ok) {
    const fields = existing.json.fields as Record<string, unknown> | undefined;
    return {
      orderId,
      status: readStringField(fields, 'status') || OrderStatus.BROADCASTING,
    };
  }

  let customerPhone = '';
  let customerName = '';
  try {
    const userDoc = await firestoreRest(
      input.projectId,
      input.idToken,
      'GET',
      `/users/${encodeURIComponent(input.userId)}`
    );
    if (userDoc.ok) {
      const fields = userDoc.json.fields as Record<string, unknown> | undefined;
      customerPhone =
        readStringField(fields, 'phone') || readStringField(fields, 'phoneE164');
      customerName = readStringField(fields, 'name');
    }
  } catch {
    /* optional enrichment */
  }

  const isLocalId = orderId.startsWith('draft-') || orderId.startsWith('demo-');
  const document = buildBroadcastingOrderPlainDocument({
    userId: input.userId,
    payload: { ...input.payload, serviceType },
    financials: input.financials,
    checkoutDraftId: orderId,
    moyasarId: input.moyasarId,
    testMode: input.testMode === true || isLocalId,
    customerPhone,
    customerName,
  });

  const created = await firestoreRest(
    input.projectId,
    input.idToken,
    'POST',
    `/orders?documentId=${encodeURIComponent(orderId)}`,
    { fields: toDocumentFields(document) }
  );

  if (!created.ok) {
    const message = String(
      (created.json.error as { message?: string } | undefined)?.message ||
        `Firestore REST create failed (${created.status})`
    );
    if (/already exists|ALREADY_EXISTS/i.test(message)) {
      return { orderId, status: OrderStatus.BROADCASTING };
    }
    throw Object.assign(new Error(message), { statusCode: created.status || 500 });
  }

  console.info('[orders] Broadcasting order written via user token', orderId, {
    serviceType,
  });
  return { orderId, status: OrderStatus.BROADCASTING };
}
