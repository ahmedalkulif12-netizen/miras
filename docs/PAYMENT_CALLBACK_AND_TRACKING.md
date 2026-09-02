# Payment Callback & Live Tracking

## Payment callback lifecycle

```
Customer confirms payment
  → createPaymentIntent(orderId) with callback_url=/payment-callback
  → sessionStorage.pending_order_id = orderId
  → Redirect to Moyasar hosted checkout
  → Moyasar redirects to /payment-callback?id=...&status=...
  → PaymentCallbackPage calls GET /api/payments/return (auth + App Check)
  → Server validates order ownership + payment/order state
  → Navigate to /customer?track={orderId}
  → CustomerDashboard opens tracking step + Firestore order snapshot
  → (Parallel) Moyasar webhook → payment authorized → order status broadcasting
```

**Security:** Return URL query params are not trusted alone. Server checks `orders.userId`, optional `payments.transactionId`, and persisted statuses.

## Live tracking architecture

```
Driver (active trip)
  → @capacitor/geolocation / browser geolocation
  → orders/{orderId}/tracking/live  { driverId, lat, lng, updatedAt }
  → Firestore onSnapshot (customer)
  → LiveTrackingMap marker updates
```

| Component | Role |
|-----------|------|
| `src/lib/geolocation.ts` | Permission + watch API (Capacitor + web) |
| `src/lib/liveTracking.ts` | Publish/subscribe to `tracking/live` |
| `src/components/LiveTrackingMap.tsx` | Customer map markers |
| `firestore.rules` | Driver write / customer+driver read |

Throttled driver writes (~4s) reduce battery and Firestore cost.

## GPS permissions

| Platform | Configuration |
|----------|----------------|
| **Android** | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` in `AndroidManifest.xml` |
| **iOS** | `NSLocationWhenInUseUsageDescription` in `Info.plist` |
| **Web** | Browser prompt on first `watchPosition` |

After pulling changes:

```bash
npm install
npm run cap:sync
```

## Firebase Console / Google Maps setup

1. **Moyasar dashboard:** Set callback URL to `https://your-domain.com/payment-callback`
2. **Firebase Firestore rules:** Deploy existing rules (`tracking` subcollection already defined)
3. **Google Maps Platform:** Enable Maps JavaScript API + Routes; restrict `VITE_GOOGLE_MAPS_PLATFORM_KEY` by HTTP referrer
4. **App Check:** Keep debug token in dev; enforce in production after validation
5. **Capacitor iOS/Android:** Rebuild native apps after `cap sync` for geolocation plugin

## Order status machine (unchanged)

`awaiting_payment` → webhook → `broadcasting` → driver accept → `assigned` → … → `completed`

Tracking UI maps canonical statuses via `mapOrderStatusToTrackingUI()` — no changes to server transitions.
