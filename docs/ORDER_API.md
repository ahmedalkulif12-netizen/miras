# Secure Order API (P0-8)

## POST `/api/orders`

- **Auth:** `Authorization: Bearer <Firebase ID token>`
- **Creates:** Firestore `orders/{id}` via Admin SDK
- **Pricing:** Calculated on server only; `financials` + `pricing_snapshot` stored on document

### Request body

Trip fields: `serviceType`, `pickupAddress`, `dropoffAddress`, `pickupLat/Lng`, `dropoffLat/Lng`, `distanceKm`, optional `truckType`, `tripType`, `serviceDetails`, `truckCount`, cities.

### Response `201`

```json
{
  "orderId": "...",
  "financials": { "tripFare", "serviceFee", "customerTotal", ... },
  "quote": { ... }
}
```

## Payment

`POST /api/create-payment-intent` requires `orderId`. Charge amount = `order.financials.customerTotal` (not client input).
