# Mobile deployment (Capacitor — Android & iOS)

Miras ships as a Capacitor WebView app (`com.hamoula.app`) with the Vite SPA in `dist/`.

## Prerequisites

- Node 20+
- Android Studio (Android SDK 36 / minSdk 24)
- Xcode 16+ on macOS (iOS 15+)
- Firebase Android + iOS apps registered for the same project as web

## One-time native Firebase files

These are generated from Firebase project **`hamula-cfc6c`** for package/bundle id `com.hamoula.app`:

| Platform | File | Location | App ID |
|----------|------|----------|--------|
| Android | `google-services.json` | `android/app/google-services.json` | `1:191963635866:android:205571afa09c0d4634bf23` |
| iOS | `GoogleService-Info.plist` | `ios/App/App/GoogleService-Info.plist` | `1:191963635866:ios:0e0eefb52ec786a234bf23` |

They are gitignored. To regenerate:

```bash
npx firebase-tools apps:sdkconfig ANDROID 1:191963635866:android:205571afa09c0d4634bf23 --project hamula-cfc6c -o android/app/google-services.json
npx firebase-tools apps:sdkconfig IOS 1:191963635866:ios:0e0eefb52ec786a234bf23 --project hamula-cfc6c -o ios/App/App/GoogleService-Info.plist
```

Register your Android **debug/release SHA-1 / SHA-256** in Firebase Console → Project settings → Miras Android (needed for Phone Auth / Play Integrity).

## Build & sync

```bash
# Install deps (includes @capacitor/app, status-bar, splash-screen, keyboard, geolocation, app-check)
npm install

# Production web bundle + copy into android/ + ios/
npm run cap:sync

# Or platform-specific:
npm run cap:sync:android
npm run cap:sync:ios
```

Open native IDEs:

```bash
npm run cap:open:android
npm run cap:open:ios
```

## WebView / UX settings (already configured)

- `capacitor.config.ts` — HTTPS Android scheme, allowlisted Firebase/Maps/Moyasar hosts, splash/status bar/keyboard plugins
- `src/lib/nativeShell.ts` — hides splash, styles status bar, Android back button, deep-link open
- `index.html` — `viewport-fit=cover`, apple-mobile-web-app meta, branded title
- `src/index.css` — safe-area insets, no iOS input zoom, native overscroll lock
- Android: `singleTask`, `adjustResize`, custom scheme `com.hamoula.app`, cleartext disabled, backup disabled
- iOS: URL scheme + location / camera / photo usage strings

## Environment

Use the same `VITE_*` client vars as web production builds (baked at `vite build` time):

- Firebase web config
- `VITE_APP_CHECK_RECAPTCHA_SITE_KEY` (web) — native App Check uses Play Integrity / App Attest via `@capacitor-firebase/app-check`
- `VITE_API_ORIGIN` if the API is not same-origin

**Never** set on store builds:

- `VITE_ENABLE_DEV_AUTH_BYPASS`
- `VITE_PHONE_AUTH_TESTING`
- `VITE_APP_CHECK_DEBUG_TOKEN`

## Admin access (mobile + web)

Admin login is **only** via `/admin/login` and is **strictly** ACL-gated:

1. Phone OTP succeeds (Firebase Auth identity)
2. Server `POST /api/admin/session` loads `admins/{uid}`
3. Doc must exist, `active !== false`, and **`phone` must match** the Auth phone (E.164)
4. `/admin/*` re-probes `GET /api/admin/me` on every entry; failure signs the user out

Unauthorized numbers can complete OTP but are **denied**, signed out, and never receive admin claims.

Seed (Admin SDK / Console only):

```json
{
  "uid": "<firebase-uid>",
  "name": "Operations Lead",
  "phone": "+9665XXXXXXXX",
  "active": true
}
```

See `docs/ADMIN_ACL.md`.

## Phone Auth on WebView

Invisible reCAPTCHA can be flaky inside Capacitor. Recommended for store QA:

1. Use Firebase Console **test phone numbers** during development builds only
2. Ensure authorized domains / App Check Play Integrity are configured for the release signing key
3. Prefer real devices over emulators for Integrity + SMS

## Store checklist

- [ ] Replace default Capacitor icons / splash with Miras brand assets
- [ ] Set `versionCode` / `versionName` (Android) and marketing version (iOS)
- [ ] Privacy labels (location, camera if used)
- [ ] Production `VITE_API_ORIGIN` + Moyasar live keys on the API host
- [ ] Deploy Firestore rules including admin `active != false` check
