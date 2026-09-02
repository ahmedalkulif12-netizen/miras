# Miras Financial Model

Defined in `src/domain/financials.ts` and `src/domain/pricing-engine.ts`.
Enforced on server via `POST /api/calculate-price` and `POST /api/orders`.

## Universal trip formula (all 6 services)

```
tripFare = basePrice + max(0, totalDistanceKm − 25) × extraKmRate
```

- **Base distance:** first **25 km** included in the tier base price
- **Tier:** vehicle / capacity option selected by the customer (see matrix below)
- Distance is always geographic km (Google Routes or nearest-driver Haversine). Never liters or tons.

## Platform fees (server constants)

| Field | Rate | Applied to |
|-------|------|------------|
| Customer service fee | **5%** | `tripFare` |
| Driver platform commission | **15%** | `tripFare` |

## Amounts

- **tripFare** — base + extra km (driver gross before commission)
- **serviceFee** — `tripFare × 5%` (waived when `previousOrdersCount < 3`, legacy promo)
- **customerTotal** — charged via Moyasar (`tripFare + serviceFee`)
- **platformFee** — `tripFare × 15%` (deducted from driver)
- **driverNet** — `tripFare − platformFee`

Fee policy version: `2026-08`

## Service-tier matrix (SAR)

| Service | Tier | Base (≤25 km) | Extra SAR/km |
|---------|------|---------------|--------------|
| Moving (نقل العفش) | Small Van / دباب (`small_truck`) | 60 | 1.00 |
| | Medium Dyna / دينا (`medium_truck`) | 350 | 1.00 |
| | Large Trailer / تريلا (`large_truck`) | 750 | 0.75 |
| Towing (السطحات) | Normal (`normal`) | 110 | 0.75 |
| | Hydraulic (`hydraulic`) | 150 | 1.00 |
| | Box (`box`) | 200 | 1.50 |
| Water Tankers | 1,000L | 80 | 0.75 |
| | 3,000L | 120 | 1.20 |
| | 5,000L | 200 | 2.00 |
| Heavy Equipment | Light (`light_equip`) | 300 | 1.50 |
| | Medium (`medium_equip`) | 450 | 2.00 |
| | Heavy (`heavy_equip`) | 750 | 3.50 |
| Refrigerated | Light Cooling (`chilled`) | 300 | 1.00 |
| | Normal Cooling (`cold_normal`) | 400 | 1.50 |
| | Deep Frozen (`frozen`) | 550 | 2.00 |
| Cargo | Small Van (`van`) | 80 | 0.75 |
| | Medium Dyna (`dyna`) | 200 | 1.50 |
| | Large Trailer (`trailer`) | 750 | 2.00 |

Defaults live in `src/lib/pricingDefaults.ts` (`SERVICE_TIER_PRICES`).
Firestore overrides: `pricing/{serviceType}` with `tier_prices` + `included_km: 25`.

## Example

Flatbed hydraulic, 40 km:

- tripFare = 150 + (40 − 25) × 1.00 = **165 SAR**
- serviceFee = 165 × 0.05 = **8.25 SAR**
- customerTotal = **173.25 SAR**
- platformFee = 165 × 0.15 = **24.75 SAR**
- driverNet = **140.25 SAR**

## API compatibility

Responses include both:

- `financials` (canonical)
- `subtotal`, `total`, `commission_amount`, `driver_earning` (legacy aliases)
- `tier` / `includedKm` / `extraDistanceKm`

## UI rules

- Never show `%` to customers or drivers.
- Always show km (never tons) for distance line items.
- Use i18n labels: trip price, service fee, total / net earnings.
