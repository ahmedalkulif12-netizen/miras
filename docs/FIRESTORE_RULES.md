# Firestore Rules

Deploy:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Security model (locked down)

| Collection | Client read | Client write |
|------------|-------------|--------------|
| `users/{uid}` | Own + admin | Own create/update (cannot set `role: admin`) |
| `admins/{uid}` | Own + admin | **Denied** (seed via console / Admin SDK) |
| `customers` / `drivers` / `corporates` / `operators` | Own + admin | Own profile only |
| `operators/{id}/vehicles/*` | Owner + admin | Owner operator |
| `corporate_contracts/*` | Own corporate + admin | Corporate creates `pending` only; admin updates |
| `orders/*` | Customer / assigned driver / drivers on open offers / admin | Prefer Admin SDK create; client may create own `broadcasting`+`authorized` only; narrow cancel / driver field updates |
| `orders/*/tracking/*` | Trip parties | Assigned driver |
| `orders/*/messages/*` | Trip parties + admin | Trip parties create only (own senderId); no update/delete |
| `payments/*` | Own + admin | Create denied; limited `orderId` merge |
| `checkout_drafts/*` | Own + admin | **Denied** (server only) |
| `wallets` / `withdrawals` | Own / admin | **Denied** (server only) |
| `pricing/*` | Public | Admin |
| `driver_presence/*` | Authenticated | Own driver |
| `webhook_events/*` | Denied | Denied |

`isAdmin()` = custom claim `admin: true` **or** active `admins/{uid}` document.

## Order acceptance (server)

`POST /api/orders/:orderId/accept` loads the driver’s registered `vehicleType` and rejects with `403 VEHICLE_TYPE_MISMATCH` when it does not match `order.serviceType` (canonical 6 categories + aliases).

## Local / DEV note

Client-only E2E writes (`localOrderBridge` without Firebase Auth) will be denied under these rules. Use a real Phone Auth session or Admin SDK for local order promotion.
