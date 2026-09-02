# Firebase App Check (P0-13)

App Check verifies that Firebase and Express API traffic comes from the genuine Miras app, not scripts or cloned clients.

## Architecture

```
┌─────────────────┐     App Check JWT      ┌──────────────────┐
│ Miras Client  │ ─────────────────────► │ Firebase Auth    │
│ (Web / Android) │                        │ Firestore        │
└────────┬────────┘                        └──────────────────┘
         │ X-Firebase-AppCheck
         ▼
┌─────────────────┐   verifyToken()   ┌──────────────────┐
│ Express APIs    │ ◄──────────────── │ Firebase Admin   │
│ /api/orders …   │                   │ appCheck()       │
└─────────────────┘                   └──────────────────┘
```

### Client providers

| Platform | Provider | Implementation |
|----------|----------|----------------|
| **Web** (browser) | reCAPTCHA v3 | `@capacitor-firebase/app-check` web provider |
| **Web dev** | Debug token | `VITE_APP_CHECK_DEBUG_TOKEN` |
| **Android** (Capacitor) | **Play Integrity** | Native plugin + JS `CustomProvider` bridge |
| **iOS** (future) | App Attest / DeviceCheck | Same plugin — enable in Console when shipping iOS |

Init runs in `main.tsx` via `ensureAppCheck()` before React mounts.

### Server enforcement

- Middleware: `server/middleware/verifyAppCheck.ts`
- Applied to all authenticated APIs (`/api/orders`, payments, account delete, …)
- **`APP_CHECK_ENFORCE=false`** (default): logs invalid/missing tokens but allows requests — safe rollout
- **`APP_CHECK_ENFORCE=true`**: rejects requests without valid App Check token

Webhooks (`/api/webhooks/moyasar`) and public quote (`/api/calculate-price`) are **not** App Check gated.

## Firebase Console setup (required)

### 1. Register apps

Firebase Console → **Build → App Check → Apps**:

| App | Provider |
|-----|----------|
| Web (`hamula-cfc6c` web app) | reCAPTCHA v3 — copy **site key** → `VITE_APP_CHECK_RECAPTCHA_SITE_KEY` |
| Android (`com.hamoula.app`) | **Play Integrity** — add SHA-256 of signing key |

**reCAPTCHA Domains (required for Hosting OTP):** the App Check site key must allow at least:

- `hamula-cfc6c.web.app`
- `hamula-cfc6c.firebaseapp.com`
- `127.0.0.1` / `localhost` (local)

Update via Google Cloud Console → reCAPTCHA → key → Domains, or:

```bash
gcloud recaptcha keys update YOUR_SITE_KEY --project=hamula-cfc6c --web \
  --domains=hamula-cfc6c.web.app,hamula-cfc6c.firebaseapp.com,localhost,127.0.0.1
```

Missing domains here commonly surface as Phone Auth `auth/captcha-check-failed` / **Hostname match not found**.

### 2. Play Integrity (Android)

1. Play Console → your app → **Release → App integrity** → link Firebase project
2. Enable **Play Integrity API** in Google Cloud Console
3. Register **debug** SHA-256 for local builds; register **Play App Signing** SHA-256 for production
4. Upload to **Internal testing** track — Play Integrity attestation requires Play-distributed builds for production tokens

**Local Android debug:** set debug token env (see below) or use `firebase-appcheck-debug` provider via plugin `debugToken`.

### 3. Debug tokens (development)

1. Console → App Check → **Manage debug tokens** → Add token
2. `.env`: `VITE_APP_CHECK_DEBUG_TOKEN=<uuid-from-console>`
3. Android native debug: add to `android/gradle.properties` or run config:
   ```
   FIREBASE_APPCHECK_DEBUG_TOKEN=<same-uuid>
   ```
   (Capawesome reads this env var on Android/iOS builds.)

### 4. Gradual enforcement

1. **Monitor** — Console → App Check → each product → Metrics (1–2 weeks)
2. **Enforce Firestore** — Console → Firestore → App Check → Enforce
3. **Enforce Auth** — Console → Authentication → App Check → Enforce (after Phone Auth tested with App Check)
4. **Enforce server** — production `.env`: `APP_CHECK_ENFORCE=true`

Do **not** enforce until debug tokens work in dev and Play Integrity works on a test track build.

## Capacitor sync

After pulling these changes:

```bash
npm install
npm run cap:sync
```

Rebuild Android in Android Studio. Ensure `google-services.json` is present under `android/app/`.

## Files

| File | Role |
|------|------|
| `src/lib/appCheck.ts` | Client init + token getter |
| `src/lib/authApi.ts` | Sends `X-Firebase-AppCheck` on API calls |
| `server/middleware/verifyAppCheck.ts` | Server verification |
| `firestore.rules` | `hasAppCheck()` helper (optional in rules later) |

## iOS (later)

When shipping iOS:

1. Register iOS app in App Check with **App Attest** (iOS 14+) or DeviceCheck (iOS 13)
2. Run `npx cap sync ios`
3. No client code changes — same `initAppCheck()` path handles native platforms
