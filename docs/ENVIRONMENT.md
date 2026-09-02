# Environment & Secrets (P0-15)

Miras separates **server secrets** from **client public config** to prevent accidental leakage in git or frontend bundles.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  .env (gitignored)                                          │
├──────────────────────────┬──────────────────────────────────┤
│  Server-only             │  VITE_* (public in browser build) │
│  MOYASAR_SECRET_KEY      │  VITE_FIREBASE_*                  │
│  MOYASAR_WEBHOOK_SECRET  │  VITE_GOOGLE_MAPS_PLATFORM_KEY    │
│  GOOGLE_APPLICATION_…    │  VITE_APP_CHECK_*                 │
│  FIREBASE_PROJECT_ID     │                                   │
│  APP_CHECK_ENFORCE       │                                   │
└──────────────────────────┴──────────────────────────────────┘
         │                              │
         ▼                              ▼
  server/config/env.ts           src/lib/publicEnv.ts
  Express + Firebase Admin       Firebase JS + Maps + App Check
```

**Rule:** If a value must never appear in the browser, do **not** prefix it with `VITE_`.

## Quick start (development)

```bash
cp .env.example .env
# Fill in values (migrate from firebase-applet-config.json if needed)
npm run dev
```

## Required variables

### Server (`process.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Dev: optional | `development` or `production` |
| `MIRAS_DEPLOY_ENV` | **Prod/staging: yes** | `development` \| `staging` \| `production` — controls Moyasar + App Check rules |
| `MIRAS_EXPECTED_FIREBASE_PROJECT` | Recommended | Pin Firebase project id on host (prevents cross-env deploy) |
| `PORT` | Optional | Default `3000` |
| `APP_URL` | **Prod/staging: yes** | Public HTTPS app URL for Moyasar callbacks (custom domain or `*.web.app`) |
| `FIREBASE_PROJECT_ID` | **Prod: yes** | Firebase project for Admin SDK |
| `MOYASAR_SECRET_KEY` | **Prod: yes** | Moyasar API secret (`sk_test_*` local/staging, `sk_live_*` production) |
| `MOYASAR_WEBHOOK_SECRET` | **Prod: yes** | HMAC secret for webhook verification |
| `GOOGLE_APPLICATION_…` | Prod recommended | Path to Firebase service account JSON (omit on Cloud Run ADC) |
| `APP_CHECK_ENFORCE` | Optional | `true` to reject APIs without App Check token |

See also [HOSTING_API.md](./HOSTING_API.md) for Firebase Hosting → Cloud Run `/api` rewrites.

### Client (`VITE_*` — public)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_FIREBASE_API_KEY` | **Yes** | Firebase Web API key (restrict in Console) |
| `VITE_FIREBASE_AUTH_DOMAIN` | **Yes** | e.g. `hamula-cfc6c.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | **Yes** | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | **Yes** | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | **Yes** | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | **Yes** | Firebase web app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | Optional | Google Analytics |
| `VITE_GOOGLE_MAPS_PLATFORM_KEY` | Maps features | Browser Maps key (referrer-restricted) |
| `VITE_APP_CHECK_DEBUG_TOKEN` | Dev only | App Check debug token |
| `VITE_APP_CHECK_RECAPTCHA_SITE_KEY` | Web prod | reCAPTCHA v3 site key |
| `VITE_MIRAS_DEPLOY_ENV` | Prod/staging build | Must match server `MIRAS_DEPLOY_ENV` |

## Dev vs staging vs production

| Aspect | Development | Staging | Production |
|--------|-------------|---------|------------|
| `MIRAS_DEPLOY_ENV` | `development` | `staging` | `production` |
| Moyasar key | `sk_test_*` | `sk_test_*` only | `sk_live_*` required |
| `APP_URL` | `http://localhost` | HTTPS staging host | **HTTPS required** |
| App Check enforce | Usually `false` | Optional | **`true` required** |
| Debug App Check token | Allowed | Allowed | **Forbidden** |
| E2E smoke | Optional locally | `npm run test:e2e:staging` | **Never run** |
| Verify script | — | `npm run verify:staging` | `npm run verify:production` |

Templates: `.env.staging.example`, `.env.production.example` — see `docs/PRODUCTION_LAUNCH.md`.

## Files gitignored (never commit)

- `.env`, `.env.local`, `.env.production`
- `firebase-applet-config.json` (deprecated — use `.env`)
- `**/google-services.json`
- `**/*serviceAccount*.json`

Use `firebase-applet-config.example.json` as a migration reference only.

## Key restriction (Google Cloud / Firebase Console)

Even public client keys must be restricted:

- **Firebase API key:** App Check + authorized domains
- **Maps key:** HTTP referrer restrictions (localhost + production domain). Enable billing and: Maps JavaScript API, Places API, Geocoding API, Directions API, Routes API
- **Moyasar:** Secret key server-only; never in frontend

## Production deploy

```bash
# Validate host env (set MIRAS_DEPLOY_ENV + secrets on host first)
npm run verify:production

# Build with production VITE_* vars injected at build time
npm run build:production
NODE_ENV=production MIRAS_DEPLOY_ENV=production node dist/server.cjs
```

Set all server secrets on the host (Railway, Cloud Run, VPS, etc.) — not in the repo.
Full checklist: `docs/PRODUCTION_LAUNCH.md`.
