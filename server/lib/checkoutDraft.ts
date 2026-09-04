/**
 * Pre-payment checkout drafts — stored outside `orders` so drivers never see them.
 * Finalized into a broadcasting `orders` document only after successful payment.
 */

import admin from 'firebase-admin';
import type { PricingService } from './pricingService.ts';
import {
  validateCreateOrderPayload,
  type CreateOrderPayload,
} from './createOrder.ts';
import { canonicalizeServiceType } from '../../src/domain/serviceCategories.ts';
import { buildOrderDispatch } from '../../src/domain/dispatchMatching.ts';
import { normalizeWaterTankerCapacity } from '../../src/lib/pricingDefaults.ts';
import { appendStatusHistory, OrderStatus } from './orderStatus.ts';
import { assertCustomerCanBook } from './adminCustomers.ts';
import { normalizeWaterServiceType } from '../../src/lib/waterTankerCatalog.ts';
import { canUseAdminFirestore } from './firebaseAdmin.ts';
import { countPaidCustomerOrders } from './customerOrderCount.ts';
import { debitCustomerWalletOnOrder } from './customerWallet.ts';
import { toPersistedOrderMoneyFields, normalizeTripFinancials, shouldWaiveServiceFee } from '../../src/domain/financials.ts';

export interface CheckoutDraftRecord {
  draftId: string;
  userId: string;
  payload: CreateOrderPayload;
  financials: Record<string, unknown>;
  quote: Record<string, unknown>;
  status: 'awaiting_payment';
  previousPaidOrderCount?: number;
  serviceFeeWaived?: boolean;
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
}

export async function createCheckoutDraft(
  db: admin.firestore.Firestore,
  pricingService: PricingService,
  userId: string,
  body: CreateOrderPayload
): Promise<{
  draftId: string;
  orderId: string;
  financials: Record<string, unknown>;
  quote: Record<string, unknown>;
  distanceKm: number;
  createdAt: string;
  paymentPending: true;
  previousPaidOrderCount?: number;
  serviceFeeWaived?: boolean;
}> {
  validateCreateOrderPayload(body);
  if (canUseAdminFirestore()) {
    await assertCustomerCanBook(db, userId);
  }

  const serviceType = canonicalizeServiceType(body.serviceType) || body.serviceType;
  body.serviceType = serviceType;

  let previousOrdersCount = 0;
  if (canUseAdminFirestore()) {
    try {
      previousOrdersCount = await countPaidCustomerOrders(db, userId);
    } catch (error) {
      console.warn('[checkout-draft] previous-orders lookup skipped:', error);
    }
  }

  const rawOption =
    typeof body.serviceDetails?.capacity === 'string'
      ? body.serviceDetails.capacity
      : typeof body.serviceDetails?.type === 'string'
        ? body.serviceDetails.type
        : serviceType === 'water_tanker'
          ? undefined
          : body.truckType;

  const capacity =
    serviceType === 'water_tanker'
      ? normalizeWaterTankerCapacity(rawOption)
      : undefined;

  const waterType =
    serviceType === 'water_tanker'
      ? normalizeWaterServiceType(
          typeof body.serviceDetails?.waterType === 'string'
            ? body.serviceDetails.waterType
            : undefined
        )
      : undefined;

  const quote = await pricingService.calculatePrice({
    distance: body.distanceKm,
    serviceType,
    truckType: body.truckType || 'normal',
    truckCount: body.truckCount ?? 1,
    previousOrdersCount,
    userId,
    capacity,
    option: capacity || rawOption,
    waterType,
  });

  const financialsRaw = (quote as unknown as { financials?: Record<string, unknown> }).financials;
  if (!financialsRaw) {
    throw Object.assign(new Error('Pricing calculation failed'), { statusCode: 500 });
  }
  const financials = {
    ...normalizeTripFinancials(financialsRaw),
  };
  const serviceFeeWaived = shouldWaiveServiceFee(previousOrdersCount);

  if (!canUseAdminFirestore()) {
    const draftId = `draft-${Date.now()}`;
    console.info('[checkout-draft] Local draft (no Admin credentials)', draftId);
    return {
      draftId,
      orderId: draftId,
      financials,
      quote: quote as Record<string, unknown>,
      distanceKm: body.distanceKm,
      createdAt: new Date().toISOString(),
      paymentPending: true,
      previousPaidOrderCount: previousOrdersCount,
      serviceFeeWaived,
    };
  }

  const draftRef = db.collection('checkout_drafts').doc();
  const draftId = draftRef.id;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await draftRef.set({
    draftId,
    userId,
    payload: {
      ...body,
      serviceType,
      serviceDetails: {
        ...(body.serviceDetails || {}),
        ...(capacity ? { capacity, type: capacity } : {}),
        ...(waterType ? { waterType } : {}),
      },
    },
    financials,
    quote,
    status: 'awaiting_payment',
    previousPaidOrderCount: previousOrdersCount,
    serviceFeeWaived,
    createdAt: now,
    updatedAt: now,
  });

  return {
    draftId,
    orderId: draftId,
    financials,
    quote: quote as Record<string, unknown>,
    distanceKm: body.distanceKm,
    createdAt: new Date().toISOString(),
    paymentPending: true,
    previousPaidOrderCount: previousOrdersCount,
    serviceFeeWaived,
  };
}

/**
 * After successful payment — create the real `orders` doc as broadcasting.
 * Idempotent: if an order already exists for this draft/payment, reuse it.
 */
export async function finalizeOrderFromCheckoutDraft(
  db: admin.firestore.Firestore,
  input: {
    userId: string;
    draftId: string;
    paymentId?: string;
    moyasarId?: string;
    testMode?: boolean;
  }
): Promise<{ orderId: string; status: string }> {
  const draftRef = db.collection('checkout_drafts').doc(input.draftId);
  const draftSnap = await draftRef.get();
  if (!draftSnap.exists) {
    throw Object.assign(new Error('Checkout draft not found'), { statusCode: 404 });
  }

  const draft = draftSnap.data() as CheckoutDraftRecord;
  if (draft.userId !== input.userId) {
    throw Object.assign(new Error('Draft does not belong to authenticated user'), {
      statusCode: 403,
    });
  }

  // Already finalized?
  const existingOrderId = (draft as { orderId?: string }).orderId;
  if (existingOrderId) {
    const existing = await db.collection('orders').doc(existingOrderId).get();
    if (existing.exists) {
      return {
        orderId: existingOrderId,
        status: String(existing.data()?.status || OrderStatus.BROADCASTING),
      };
    }
  }

  const body = draft.payload;
  const financials = {
    ...draft.financials,
    ...(typeof draft.previousPaidOrderCount === 'number'
      ? { previousPaidOrderCount: draft.previousPaidOrderCount }
      : {}),
  };
  const published = await writeBroadcastingOrder(db, {
    userId: input.userId,
    payload: body,
    financials,
    checkoutDraftId: input.draftId,
    paymentId: input.paymentId,
    moyasarId: input.moyasarId,
    testMode: input.testMode,
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await draftRef.set(
    {
      orderId: published.orderId,
      status: 'paid_finalized',
      updatedAt: now,
    },
    { merge: true }
  );

  return published;
}

/** Plain broadcasting order fields (ISO dates) — Admin SDK or user-token REST / client write. */
export function buildBroadcastingOrderPlainDocument(input: {
  userId: string;
  payload: CreateOrderPayload;
  financials: Record<string, unknown>;
  checkoutDraftId?: string;
  paymentId?: string;
  moyasarId?: string;
  testMode?: boolean;
  customerPhone?: string;
  customerName?: string;
  nowIso?: string;
}): Record<string, unknown> {
  const serviceType =
    canonicalizeServiceType(input.payload.serviceType) || input.payload.serviceType;
  const body: CreateOrderPayload = { ...input.payload, serviceType };
  const money = toPersistedOrderMoneyFields(normalizeTripFinancials(input.financials));
  const nowIso = input.nowIso || new Date().toISOString();
  const customerPhone = input.customerPhone || '';
  const customerName = input.customerName || '';

  return {
    userId: input.userId,
    clientId: input.userId,
    customerId: input.userId,
    serviceType,
    requiredVehicleType: serviceType,
    truckType: body.truckType || 'normal',
    tripType: body.tripType || 'inside_city',
    serviceDetails: {
      ...(body.serviceDetails || {}),
      ...(body.vehicleFieldNotes ? { vehicleFieldNotes: body.vehicleFieldNotes } : {}),
    },
    ...(body.vehicleFieldNotes ? { vehicleFieldNotes: body.vehicleFieldNotes } : {}),
    pickupAddress: body.pickupAddress,
    dropoffAddress: body.dropoffAddress,
    deliveryOnly: body.deliveryOnly === true || serviceType === 'water_tanker',
    locationMode:
      body.locationMode ||
      (serviceType === 'water_tanker' ? 'delivery_only' : 'pickup_destination'),
    pickup: {
      address: body.pickupAddress,
      lat: body.pickupLat,
      lng: body.pickupLng,
      city: body.pickupCity || '',
    },
    destination: {
      address: body.dropoffAddress,
      lat: body.dropoffLat,
      lng: body.dropoffLng,
      city: body.dropoffCity || '',
    },
    pickupLat: body.pickupLat,
    pickupLng: body.pickupLng,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    distanceKm: body.distanceKm,
    distance: body.distanceKm,
    ...(body.matchedDriverId ? { matchedDriverId: body.matchedDriverId } : {}),
    ...money,
    ...(typeof (input.financials as { previousPaidOrderCount?: unknown }).previousPaidOrderCount === 'number'
      ? {
          previousPaidOrderCount: Number(
            (input.financials as { previousPaidOrderCount: number }).previousPaidOrderCount
          ),
        }
      : {}),
    status: OrderStatus.BROADCASTING,
    paymentStatus: 'authorized',
    ...(customerPhone ? { customerPhone } : {}),
    ...(customerName ? { customerName } : {}),
    ...(input.checkoutDraftId ? { checkoutDraftId: input.checkoutDraftId } : {}),
    ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    ...(input.moyasarId ? { moyasarId: input.moyasarId } : {}),
    ...(input.testMode ? { testMode: true } : {}),
    statusHistory: [
      {
        status: OrderStatus.BROADCASTING,
        at: nowIso,
        by: 'system',
        byRole: 'system',
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
    promotedAt: nowIso,
    dispatch: buildOrderDispatch({
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupCity: body.pickupCity,
      startedAt: nowIso,
    }),
  };
}

/**
 * Build + write a live `orders` doc as `broadcasting` with canonical serviceType.
 * Used by draft finalize and local/demo checkout publish (Admin SDK bypasses rules).
 */
export async function writeBroadcastingOrder(
  db: admin.firestore.Firestore,
  input: {
    userId: string;
    payload: CreateOrderPayload;
    financials: Record<string, unknown>;
    checkoutDraftId?: string;
    paymentId?: string;
    moyasarId?: string;
    /** Keep a stable id for local `draft-*` tracking URLs when safe. */
    preferredOrderId?: string;
    testMode?: boolean;
  }
): Promise<{ orderId: string; status: string }> {
  if (input.checkoutDraftId) {
    const existingByDraft = await db
      .collection('orders')
      .where('checkoutDraftId', '==', input.checkoutDraftId)
      .limit(1)
      .get();
    if (!existingByDraft.empty) {
      const doc = existingByDraft.docs[0];
      await debitCustomerWalletOnOrder(db, {
        userId: input.userId,
        orderId: doc.id,
        amount: Number(input.financials?.customerTotal || doc.data()?.financials?.customerTotal || 0),
      });
      return {
        orderId: doc.id,
        status: String(doc.data()?.status || OrderStatus.BROADCASTING),
      };
    }
  }

  const serviceType =
    canonicalizeServiceType(input.payload.serviceType) || input.payload.serviceType;
  if (!canonicalizeServiceType(serviceType)) {
    throw Object.assign(new Error(`Invalid serviceType: ${input.payload.serviceType}`), {
      statusCode: 400,
    });
  }

  const preferLocalId =
    input.preferredOrderId &&
    (input.preferredOrderId.startsWith('draft-') ||
      input.preferredOrderId.startsWith('demo-'));
  const orderRef = preferLocalId
    ? db.collection('orders').doc(input.preferredOrderId!)
    : db.collection('orders').doc();

  if (preferLocalId) {
    const existing = await orderRef.get();
    if (existing.exists) {
      await debitCustomerWalletOnOrder(db, {
        userId: input.userId,
        orderId: orderRef.id,
        amount: Number(input.financials?.customerTotal || existing.data()?.financials?.customerTotal || 0),
      });
      return {
        orderId: orderRef.id,
        status: String(existing.data()?.status || OrderStatus.BROADCASTING),
      };
    }
  }

  let customerPhone = '';
  let customerName = '';
  try {
    const userSnap = await db.collection('users').doc(input.userId).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      customerPhone = String(u.phone || u.phoneE164 || '');
      customerName = String(u.name || '');
    }
  } catch {
    /* optional enrichment */
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const orderDoc = {
    ...buildBroadcastingOrderPlainDocument({
      userId: input.userId,
      payload: { ...input.payload, serviceType },
      financials: input.financials,
      checkoutDraftId: input.checkoutDraftId,
      paymentId: input.paymentId,
      moyasarId: input.moyasarId,
      testMode: input.testMode,
      customerPhone,
      customerName,
    }),
    statusHistory: appendStatusHistory([], {
      status: OrderStatus.BROADCASTING,
      by: 'system',
      byRole: 'system',
    }),
    createdAt: now,
    updatedAt: now,
    promotedAt: now,
  };

  await orderRef.set(orderDoc);
  console.info('[orders] Broadcasting order written', orderRef.id, { serviceType });
  await debitCustomerWalletOnOrder(db, {
    userId: input.userId,
    orderId: orderRef.id,
    amount: Number(input.financials?.customerTotal || 0),
  });
  return { orderId: orderRef.id, status: OrderStatus.BROADCASTING };
}

/**
 * Local/demo payment gateway confirm — create broadcasting order without Moyasar payment doc.
 * Prefer existing `checkout_drafts` row; otherwise accept validated session payload.
 */
export async function publishAfterLocalCheckout(
  db: admin.firestore.Firestore,
  input: {
    userId: string;
    draftId: string;
    moyasarId?: string;
    payload?: CreateOrderPayload;
    financials?: Record<string, unknown>;
    testMode?: boolean;
  }
): Promise<{ orderId: string; status: string }> {
  const draftId = input.draftId;
  const isLocalId = draftId.startsWith('draft-') || draftId.startsWith('demo-');

  if (!isLocalId) {
    try {
      return await finalizeOrderFromCheckoutDraft(db, {
        userId: input.userId,
        draftId,
        moyasarId: input.moyasarId,
        testMode: input.testMode,
      });
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode !== 404 || !input.payload || !input.financials) {
        throw err;
      }
      // Server draft missing — fall through to session payload.
    }
  }

  if (!input.payload || !input.financials) {
    throw Object.assign(
      new Error('Checkout draft payload is required to publish order'),
      { statusCode: 400 }
    );
  }

  validateCreateOrderPayload(input.payload);

  return writeBroadcastingOrder(db, {
    userId: input.userId,
    payload: input.payload,
    financials: input.financials,
    checkoutDraftId: draftId,
    moyasarId: input.moyasarId,
    preferredOrderId: isLocalId ? draftId : undefined,
    testMode: input.testMode === true || isLocalId,
  });
}
