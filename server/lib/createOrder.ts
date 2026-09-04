import admin from 'firebase-admin';
import type { PricingService } from './pricingService.ts';
import { assertCustomerCanBook } from './adminCustomers.ts';
import { normalizeWaterTankerCapacity } from '../../src/lib/pricingDefaults.ts';
import {
  WATER_TANKER_MOCK_DISTANCE_KM,
  sanitizeWaterTankerDistanceKm,
} from '../../src/lib/waterTankerDistance.ts';
import { canonicalizeServiceType } from '../../src/domain/serviceCategories.ts';
import { normalizeWaterServiceType } from '../../src/lib/waterTankerCatalog.ts';
import { countPaidCustomerOrders } from './customerOrderCount.ts';
import { normalizeTripFinancials, toPersistedOrderMoneyFields } from '../../src/domain/financials.ts';

/** Max trip / driver-to-client distance accepted (km). */
const MAX_DISTANCE_KM = 3000;
const MIN_DISTANCE_KM = 0;

export interface CreateOrderPayload {
  serviceType: string;
  truckType?: 'normal' | 'hydraulic' | 'box' | string;
  tripType?: 'inside_city' | 'outside_city';
  serviceDetails?: Record<string, unknown>;
  vehicleFieldNotes?: {
    keyInside?: boolean;
    tiresFlat?: boolean;
    brokenDown?: boolean;
    extraNotes?: string;
  };
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  /** Kilometers — for water_tanker this is nearest-driver → client, never liters. */
  distanceKm: number;
  pickupCity?: string;
  dropoffCity?: string;
  truckCount?: number;
  /** Optional nearest matched driver for dispatch hints. */
  matchedDriverId?: string;
  /** Water tanker: customer only sets drop-off; tanker drives there. */
  deliveryOnly?: boolean;
  locationMode?: 'pickup_destination' | 'delivery_only';
}

export interface CreateOrderResult {
  orderId: string;
  financials: Record<string, unknown>;
  quote: Record<string, unknown>;
}

function isValidCoord(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function sanitizeVehicleFieldNotes(
  notes: CreateOrderPayload['vehicleFieldNotes'] | undefined
): CreateOrderPayload['vehicleFieldNotes'] | undefined {
  if (!notes || typeof notes !== 'object') return undefined;
  const extraNotes =
    typeof notes.extraNotes === 'string' ? notes.extraNotes.trim().slice(0, 500) : '';
  const cleaned = {
    keyInside: Boolean(notes.keyInside),
    tiresFlat: Boolean(notes.tiresFlat),
    brokenDown: Boolean(notes.brokenDown),
    ...(extraNotes ? { extraNotes } : {}),
  };
  if (!cleaned.keyInside && !cleaned.tiresFlat && !cleaned.brokenDown && !extraNotes) {
    return undefined;
  }
  return cleaned;
}

/**
 * Validates trip inputs before any pricing or Firestore write.
 */
export function validateCreateOrderPayload(body: CreateOrderPayload): void {
  if (!body.serviceType || typeof body.serviceType !== 'string') {
    throw Object.assign(new Error('serviceType is required'), { statusCode: 400 });
  }
  const canonical = canonicalizeServiceType(body.serviceType);
  if (!canonical) {
    throw Object.assign(
      new Error(
        'serviceType must be one of: furniture_moving, flatbed, refrigerated, heavy_equipment, goods_transport, water_tanker'
      ),
      { statusCode: 400 }
    );
  }
  body.serviceType = canonical;

  if (!body.dropoffAddress?.trim() || body.dropoffAddress.trim().length < 3) {
    throw Object.assign(new Error('Valid dropoffAddress is required'), { statusCode: 400 });
  }
  if (!isValidCoord(body.dropoffLat, body.dropoffLng)) {
    throw Object.assign(new Error('Invalid dropoff coordinates'), { statusCode: 400 });
  }

  // Water tanker: customer only provides drop-off (موقع التنزيل). Pickup is the
  // nearest tanker origin when known; otherwise we synthesize from drop-off so
  // the document schema stays consistent without requiring a "from" address.
  if (canonical === 'water_tanker') {
    body.deliveryOnly = true;
    body.locationMode = 'delivery_only';
    if (!body.pickupAddress?.trim() || body.pickupAddress.trim().length < 3) {
      body.pickupAddress = 'صهريج مملوء — يتوجه لموقع التنزيل';
    }
    if (!isValidCoord(body.pickupLat, body.pickupLng)) {
      body.pickupLat = body.dropoffLat;
      body.pickupLng = body.dropoffLng;
    }
  } else {
    body.deliveryOnly = false;
    body.locationMode = 'pickup_destination';
    if (!body.pickupAddress?.trim() || body.pickupAddress.trim().length < 3) {
      throw Object.assign(new Error('Valid pickupAddress is required'), { statusCode: 400 });
    }
    if (!isValidCoord(body.pickupLat, body.pickupLng)) {
      throw Object.assign(new Error('Invalid pickup coordinates'), { statusCode: 400 });
    }
  }

  // Water tanker: coerce liter-as-km (1000/3000/5000) to a realistic geographic km first.
  if (body.serviceType === 'water_tanker' && typeof body.distanceKm === 'number') {
    body.distanceKm = sanitizeWaterTankerDistanceKm(
      body.distanceKm,
      WATER_TANKER_MOCK_DISTANCE_KM
    );
  } else if (typeof body.distanceKm === 'number' && Number.isFinite(body.distanceKm)) {
    body.distanceKm = Math.round(body.distanceKm * 10) / 10;
  }

  if (
    typeof body.distanceKm !== 'number' ||
    Number.isNaN(body.distanceKm) ||
    body.distanceKm < MIN_DISTANCE_KM ||
    body.distanceKm > MAX_DISTANCE_KM
  ) {
    throw Object.assign(
      new Error(`distanceKm must be between ${MIN_DISTANCE_KM} and ${MAX_DISTANCE_KM}`),
      { statusCode: 400 }
    );
  }
}

/**
 * Creates an order via Admin SDK with immutable financials snapshot (P0-8).
 */
export async function createOrderSecure(
  db: admin.firestore.Firestore,
  pricingService: PricingService,
  userId: string,
  body: CreateOrderPayload
): Promise<CreateOrderResult> {
  validateCreateOrderPayload(body);
  await assertCustomerCanBook(db, userId);

  const previousOrdersCount = await countPaidCustomerOrders(db, userId);

  const rawOption =
    (typeof body.serviceDetails?.capacity === 'string' && body.serviceDetails.capacity) ||
    (typeof body.serviceDetails?.type === 'string' && body.serviceDetails.type) ||
    (body.serviceType === 'water_tanker' ? undefined : body.truckType) ||
    undefined;
  const capacity =
    body.serviceType === 'water_tanker'
      ? normalizeWaterTankerCapacity(rawOption)
      : undefined;
  const waterType =
    body.serviceType === 'water_tanker'
      ? normalizeWaterServiceType(
          typeof body.serviceDetails?.waterType === 'string'
            ? body.serviceDetails.waterType
            : undefined
        )
      : undefined;
  const option = capacity || rawOption;

  const canonicalService =
    canonicalizeServiceType(body.serviceType) || body.serviceType;

  const quote = await pricingService.calculatePrice({
    distance: body.distanceKm,
    serviceType: canonicalService,
    truckType: body.truckType || 'normal',
    truckCount: body.truckCount ?? 1,
    previousOrdersCount,
    userId,
    capacity,
    option,
    waterType,
  });

  const financials = (quote as unknown as { financials?: Record<string, unknown> }).financials;
  if (!financials) {
    throw Object.assign(new Error('Pricing calculation failed'), { statusCode: 500 });
  }

  const money = toPersistedOrderMoneyFields(normalizeTripFinancials(financials));
  const now = admin.firestore.FieldValue.serverTimestamp();

  const vehicleFieldNotes = sanitizeVehicleFieldNotes(
    body.vehicleFieldNotes ||
      (body.serviceDetails?.vehicleFieldNotes as CreateOrderPayload['vehicleFieldNotes'])
  );

  const resolvedTier = (quote as { tier?: string; option?: string }).tier
    || (quote as { option?: string }).option
    || option;

  const serviceDetails = {
    ...(body.serviceDetails || {}),
    ...(resolvedTier ? { type: resolvedTier } : {}),
    ...(capacity ? { capacity, type: capacity } : {}),
    ...(waterType ? { waterType } : {}),
    ...(vehicleFieldNotes ? { vehicleFieldNotes } : {}),
  };

  const orderDoc = {
    userId,
    serviceType: canonicalService,
    truckType: body.truckType || 'normal',
    tripType: body.tripType || (quote as { tripType?: string }).tripType || 'inside_city',
    serviceDetails,
    ...(vehicleFieldNotes ? { vehicleFieldNotes } : {}),
    pickupAddress: body.pickupAddress.trim(),
    dropoffAddress: body.dropoffAddress.trim(),
    deliveryOnly: body.deliveryOnly === true || canonicalService === 'water_tanker',
    locationMode:
      body.locationMode ||
      (canonicalService === 'water_tanker' ? 'delivery_only' : 'pickup_destination'),
    pickup: {
      address: body.pickupAddress.trim(),
      lat: body.pickupLat,
      lng: body.pickupLng,
      city: body.pickupCity || '',
    },
    destination: {
      address: body.dropoffAddress.trim(),
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
    previousPaidOrderCount: previousOrdersCount,
    pricing_snapshot: (quote as { pricingSnapshot?: Record<string, unknown> }).pricingSnapshot || {},
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    statusHistory: [
      {
        status: 'awaiting_payment',
        at: now,
        by: userId,
        byRole: 'customer',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const ref = await db.collection('orders').add(orderDoc);

  return {
    orderId: ref.id,
    financials: { ...money.financials },
    quote: quote as Record<string, unknown>,
  };
}
