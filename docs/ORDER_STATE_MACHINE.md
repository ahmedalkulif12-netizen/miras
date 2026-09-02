# Order State Machine (P0-12)

## Canonical lifecycle

```
awaiting_payment
  → payment_authorized (Moyasar webhook)
  → broadcasting (driver pool)
  → assigned (POST /api/orders/:id/accept — atomic)
    → driver_arrived (POST /api/orders/:id/status)   // arrived at pickup
    → in_transit (POST /api/orders/:id/status)       // arrived at dropoff / en route delivery
  → completed (POST /api/capture-payment)
```

Branches: `cancelled` from policy states (admin/customer).

## Driver embedded navigation (all services)

The driver dashboard keeps an **embedded map** (`DriverTripMap`) and advances a sequential CTA:

| Status | Map phase | Primary button (AR) |
|--------|-----------|---------------------|
| `broadcasting` (offer) | idle preview | موافقة الطلب |
| `assigned` | **to_pickup** — route to client pickup/loading | وصلت إلى موقع الاستلام |
| `driver_arrived` | **to_dropoff** — route to dropoff/delivery | وصلت إلى موقع التنزيل |
| `in_transit` | **to_dropoff** | إكمال المهمة |
| `completed` | idle — screen resets for next offer | تمت المهمة بنجاح |

Accept does **not** auto-open external Maps. Navigation stays in-dashboard; Google Maps remains an optional secondary link only.

Applies to Towing, Moving, Cargo, Heavy Equipment, Refrigerated, Water Tanker, etc.

## APIs

| Method | Path | Role |
|--------|------|------|
| POST | `/api/orders` | Customer — create with server pricing |
| POST | `/api/orders/:id/accept` | Driver — first wins transaction |
| POST | `/api/orders/:id/status` | Driver — `driver_arrived`, `in_transit` |
| POST | `/api/capture-payment` | Driver — completes + wallet credit (`driverNet`) |

## Duplicate accept prevention

`executeAcceptOrder` uses a Firestore **transaction**:

1. Read order
2. If `driverId` already set to another uid → **409**
3. If status not open → **400**
4. Else set `assigned` + `driverId` atomically

## Customer tracking

Firestore listener on order doc maps status → legacy UI steps via `mapOrderStatusToTrackingUI()`.
