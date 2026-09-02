# Firestore Schema (Phase A + STEP 1 RBAC)

Types:

- Orders: `src/domain/order-schema.ts`
- Users / RBAC: `src/domain/user-schema.ts`

## Collections

| Collection | Document | Notes |
|------------|----------|-------|
| `users/{uid}` | Profile + **role** | RBAC source of truth (security rules) |
| `customers/{uid}` | B2C client registration | Written when role = `b2c_client` |
| `drivers/{uid}` | B2C driver KYC / online | Written when role = `b2c_driver`; may include `bankDetails` |
| `corporates/{uid}` | B2B company profile | Written when role = `b2b_corporate` |
| `operators/{uid}` | B2B fleet operator profile | Written when role = `b2b_operator`; may include `fleetSize` |
| `operators/{uid}/vehicles/{vehicleId}` | Fleet vehicles | Client-writable by owning operator |
| `corporate_contracts/{id}` | Corporate contract registration | Corporate creates (`pending`); admin activates/suspends + pricing |
| `admins/{uid}` | Platform admin ACL | Server-seeded only; never client-writable |
| `orders/{id}` | Trip + `financials` + `status` | Migrate writes in Phase B |
| `payments/{id}` | Moyasar + `financials` snapshot | Server writes |
| `wallets/{driverId}` | Balance | Server only (capture credit / withdrawal hold+refund) |
| `withdrawals/{id}` | Driver payout requests | Server only; admin approve/reject |
| `pricing/{serviceType}` | Rates | Existing |

## User roles (canonical)

Stored on `users/{uid}.role`:

| Role | Audience | Post-login path |
|------|----------|-----------------|
| `b2c_client` | Individual customer | `/b2c/client` |
| `b2c_driver` | Street / individual driver | `/b2c/driver` |
| `b2b_corporate` | Company requesting fleets/contracts | `/b2b/corporate` |
| `b2b_operator` | Fleet owner / executing company | `/b2b/operator` |
| `admin` | Platform operator | `/admin` |

Legacy documents may still use `customer` / `driver`. Clients normalize these via `normalizeAppRole()` in `src/domain/user-schema.ts`. New writes always use the canonical role strings.

### `users/{uid}` shape

```json
{
  "uid": "firebaseUid",
  "phone": "+9665xxxxxxxx",
  "role": "b2c_client",
  "name": "Display Name",
  "accountStatus": "active",
  "companyName": "Optional for B2B",
  "commercialRegistration": "Optional for B2B",
  "vehicleType": "Optional for drivers",
  "vehicleOption": "Optional for drivers",
  "plateNumber": "Optional for drivers",
  "createdAt": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>"
}
```

Profile sync entry point: `src/lib/syncUserProfile.ts` (called after OTP verify and on session restore).

## Order `financials` (required on new server creates)

```json
{
  "currency": "SAR",
  "feePolicyVersion": "2026-08",
  "tripFare": 165,
  "serviceFee": 8.25,
  "customerTotal": 173.25,
  "platformFee": 24.75,
  "driverNet": 140.25
}
```

`tripFare = basePrice + max(0, distanceKm − 25) × tierExtraKmRate`.

Legacy flat fields (`totalPrice`, `commission_amount`, `driver_earning`) should mirror `financials` until rules are updated in Phase B.

## Pricing documents `pricing/{serviceType}`

One doc per core service: `furniture_moving`, `flatbed`, `water_tanker`, `heavy_equipment`, `refrigerated`, `goods_transport`, plus optional `default`.

```json
{
  "included_km": 25,
  "free_km": 25,
  "base_price": 110,
  "price_per_km": 0.75,
  "minimum_price": 110,
  "surge_multiplier": 1.0,
  "platform_commission_percentage": 15,
  "customer_service_fee_percentage": 5,
  "fee_policy_version": "2026-08",
  "tier_prices": {
    "normal": { "base_price": 110, "price_per_km": 0.75 },
    "hydraulic": { "base_price": 150, "price_per_km": 1.0 },
    "box": { "base_price": 200, "price_per_km": 1.5 }
  },
  "heavy_multiplier": 1,
  "cold_multiplier": 1,
  "hydraulic_multiplier": 1
}
```

Orders store the resolved tier on `serviceDetails.type` (and `capacity` for water tankers) plus an immutable `pricing_snapshot` with `tier`, `included_km`, `line_base`, `line_extra_km_cost`.

## Driver withdrawals `withdrawals/{id}`

Created by `POST /api/driver/withdrawals`. Processed by admin at `/admin/withdrawals`.

```json
{
  "driverId": "uid",
  "driverName": "…",
  "driverPhone": "+9665…",
  "amount": 250,
  "currency": "SAR",
  "status": "pending",
  "bankName": "Al Rajhi Bank",
  "iban": "SA0380000000608010167519",
  "accountHolderName": "…",
  "walletBalanceBefore": 500,
  "walletBalanceAfter": 250,
  "createdAt": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>",
  "processedAt": null,
  "processedBy": null,
  "rejectionReason": null
}
```

Statuses: `pending` → `paid` (تم التحويل) or `rejected` (refund held amount to `wallets/{driverId}`).

Bank snapshot also stored on `drivers/{uid}.bankDetails`.

## Operator fleet vehicles `operators/{uid}/vehicles/{vehicleId}`

Created from the Fleet Operator panel (**أسطولي** → إضافة مركبة). Client writes via `src/lib/fleetVehicleService.ts`.

```json
{
  "operatorId": "uid",
  "plateNumber": "ABC 1234",
  "type": "السطحات — سطحة هيدروليك",
  "serviceType": "flatbed",
  "serviceOption": "hydraulic",
  "category": "flatbed",
  "subtype": "hydraulic",
  "model": "Isuzu NPR",
  "year": "2022",
  "driverName": "Mohammed Al-Otaibi",
  "status": "available",
  "createdAt": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>"
}
```

`serviceType` / `serviceOption` are the canonical matching keys (6 core services + tiers).  
`operators/{uid}.fleetSize` is incremented on each successful create.  
`operators/{uid}.fleetCapacity` is a map of `serviceType → [serviceOption, …]` for capacity matching.

Catalog: `src/lib/fleetServiceCatalog.ts`.

## Corporate contracts `corporate_contracts/{id}`

Submitted from Corporate Portal → **تسجيل العقد**. Reviewed at `/admin/corporate-contracts`.

```json
{
  "corporateId": "uid",
  "companyName": "…",
  "commercialRegistration": "CR-…",
  "vatNumber": "3…",
  "contactPerson": "…",
  "contactPhone": "+9665…",
  "billingAddress": "…",
  "contractType": "monthly | annual | project",
  "startDate": "2026-01-01",
  "endDate": "2026-12-31",
  "services": [
    {
      "serviceType": "flatbed",
      "enabled": true,
      "monthlyTrips": 40,
      "capacityNote": "4 hydraulic flatbeds"
    }
  ],
  "paymentTerms": "net30 | prepaid",
  "discountRate": 5,
  "customPricingNotes": "…",
  "adminPricingRules": "…",
  "status": "pending | active | suspended | rejected",
  "adminNotes": null,
  "reviewedBy": null,
  "reviewedAt": null,
  "createdAt": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>"
}
```

On create/update, `corporates/{uid}` mirrors `contractAccountStatus` and `activeContractId`.

## Status field

Store canonical values (`broadcasting`, `assigned`, …) on new writes. Readers use `normalizeOrderStatus()` for legacy documents.
