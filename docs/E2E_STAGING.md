# E2E Staging Validation (Miras)

Automated smoke tests validate the **real staging stack** without browser UI automation. They exercise the same server routes, Moyasar webhook HMAC verification, Firestore security rules, and client listeners used in production.

## Testing architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  scripts/e2e-staging-smoke.ts                                           │
│    └─ e2e/runner.ts                                                     │
│         ├─ stagingGuard.ts      ← blocks prod keys / wrong project      │
│         ├─ HTTP → Express API   ← Bearer ID tokens (custom token exchange)│
│         ├─ signed webhook       ← real /api/webhooks/moyasar handler    │
│         └─ Firebase client SDK  ← Firestore rules + onSnapshot listener │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
   Running Miras server          Firebase (staging project)
   E2E_BASE_URL                    Auth + Firestore only
```

### Layers

| Layer | Purpose | Touches production? |
|-------|---------|---------------------|
| **Staging guard** | Requires `E2E_STAGING=true`, allowlisted project, test UIDs, blocks `sk_live_*` | No |
| **API smoke** | Order create, accept, status, capture, payment return | Only staging project data |
| **Webhook sim** | HMAC-signed Moyasar payload → broadcasting | Same as above |
| **Firestore client** | Customer `onSnapshot` + driver GPS write under rules | Same as above |
| **Cleanup** | Deletes orders/payments/webhook events created in run | Scoped to artifact IDs |

### What is NOT automated (manual QA below)

- Moyasar hosted payment UI (card entry)
- Phone OTP login UI
- Capacitor native GPS / Play Integrity App Check on device
- Admin complaints charts (still mock UI)

Payment authorization in E2E uses a **seeded payment doc + signed webhook** — the same server code path after Moyasar authorization, without calling Moyasar card UI.

## Prerequisites

1. **Staging Firebase project** (can be `hamula-cfc6c` dev or a dedicated staging project)
2. **Server running**: `npm run dev` or deployed staging host
3. **Firebase Admin credentials**: `GOOGLE_APPLICATION_CREDENTIALS` or ADC
4. **Dedicated test UIDs** — create once in Firebase Auth or let the runner create them

## Environment variables

Add to `.env` (see `.env.example`):

```bash
E2E_STAGING=true
E2E_ALLOWED_FIREBASE_PROJECT=hamula-cfc6c
E2E_BASE_URL=http://localhost:3000
E2E_CUSTOMER_UID=e2e_customer_001
E2E_DRIVER_A_UID=e2e_driver_a_001
E2E_DRIVER_B_UID=e2e_driver_b_001
E2E_UID_PREFIX=e2e_          # optional extra safety — all UIDs must start with this
# E2E_APP_CHECK_TOKEN=         # required retest when APP_CHECK_ENFORCE=true
```

## Run commands

```bash
# 1. Start server (separate terminal)
npm run dev

# 2. Validate guards only (no Firestore writes)
npm run test:e2e:staging:dry

# 3. Full smoke suite
npm run test:e2e:staging

# Debug: keep artifacts for inspection
npm run test:e2e:staging -- --skip-cleanup
```

## Automated scenarios

| Scenario | Validates |
|----------|-----------|
| `health` | `GET /health` uptime probe |
| `appCheckCompat` | Bearer-only when enforce off; 401 when enforce on without token |
| `firstDriverWins` | Concurrent accept → one `200`, one `409` |
| `fullLifecycle` | Order → webhook → return → accept → arrived → transit → tracking listener → capture → `completed` |

## Manual QA checklist (staging)

Run after automated smoke passes on your staging host.

### Customer booking

- [ ] Phone OTP login succeeds with App Check debug token (web)
- [ ] Create order from customer dashboard — price matches server quote
- [ ] Moyasar test card completes payment (`4111…` test PAN)
- [ ] Redirect lands on `/payment-callback?orderId=…` and resumes tracking
- [ ] Order appears in Firestore with `broadcasting` after webhook

### Driver flow

- [ ] Approved driver sees broadcasting offer when online
- [ ] Accept opens Google Maps directions
- [ ] Buttons progress: **Arrived at pickup → Start transit → Complete**
- [ ] Live map updates on customer dashboard (foreground GPS)

### First-driver-wins (manual confirmation)

- [ ] Two drivers on two devices — only first accept succeeds; second shows error toast

### App Check (before production enforce)

- [ ] Firebase Console → App Check metrics show valid requests
- [ ] Debug token works in dev; Play Integrity works on internal track APK
- [ ] Set `APP_CHECK_ENFORCE=true` on staging → APIs reject missing header
- [ ] Re-run `npm run test:e2e:staging` with `E2E_APP_CHECK_TOKEN` set

### Admin

- [ ] `/admin/login` → overview shows real Firestore stats
- [ ] Approve/suspend driver updates `drivers/{uid}.accountStatus`

### Regression

- [ ] Customer cannot accept own order as driver
- [ ] Deleted account cannot create orders
- [ ] Payment capture idempotent (double complete does not double-credit wallet)

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `E2E blocked` | Missing `E2E_STAGING` or project mismatch |
| `401 Unauthorized` | Server not running or invalid test UIDs |
| Webhook `401` | `MOYASAR_WEBHOOK_SECRET` mismatch with server `.env` |
| Tracking listener timeout | Firestore rules not deployed; driver not assigned |
| `create order failed: 503` | Pricing docs missing in Firestore |

## Safety rules

- Never set `E2E_STAGING=true` against production Moyasar live keys
- Use `E2E_UID_PREFIX=e2e_` so test users are obvious in Firebase Console
- Automated cleanup runs by default; use `--skip-cleanup` only for debugging
