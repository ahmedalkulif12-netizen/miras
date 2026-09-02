# Miras Production Launch Guide

Complete deployment flow for **production** while keeping **staging** isolated. Miras ships as one Node process (Express + Vite `dist/` SPA).

## Deployment architecture

```
                    Internet (HTTPS)
                           │
                           ▼
              ┌────────────────────────┐
              │  TLS terminator        │
              │  nginx / Cloud LB      │
              │  deploy/nginx/*.conf   │
              └───────────┬────────────┘
                          │ HTTP :3000
                          ▼
              ┌────────────────────────┐
              │  node dist/server.cjs  │
              │  trust proxy + HSTS    │
              │  /health /api/* / SPA  │
              └───────────┬────────────┘
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   Firebase Auth    Firestore        Moyasar API
   App Check        Rules/Indexes    Webhooks → /api/webhooks/moyasar
```

| Layer | Production | Staging |
|-------|------------|---------|
| Deploy flag | `HAMOULA_DEPLOY_ENV=production` | `HAMOULA_DEPLOY_ENV=staging` |
| Build | `NODE_ENV=production npm run build` | Same |
| Moyasar | `sk_live_*` **required** | `sk_test_*` only (`sk_live_*` **blocked**) |
| APP_URL | **HTTPS** required | HTTPS recommended |
| App Check server | `APP_CHECK_ENFORCE=true` **required** | Usually `false` until device QA |
| Debug tokens | **Forbidden** | Allowed for QA |
| E2E smoke | **Do not run** | `npm run test:e2e:staging` |

Code guards: `server/config/deployEnv.ts`, `server/config/env.ts`, `scripts/verify-production-env.ts`.

---

## Staging vs production separation

**Recommended:** two Firebase projects (`hamula-staging`, `hamula-prod`) and two hosts.

| Resource | Staging | Production |
|----------|---------|------------|
| Firebase project | `hamula-staging` | `hamula-prod` |
| Host | `https://staging.YOUR_DOMAIN.com` | `https://app.YOUR_DOMAIN.com` |
| Moyasar | Test dashboard + `sk_test_*` | Live dashboard + `sk_live_*` |
| Maps API key | Separate key, staging referrers | Separate key, prod referrers only |
| Service account | Staging SA JSON on staging host | Prod SA JSON on prod host |
| Pin | `HAMOULA_EXPECTED_FIREBASE_PROJECT` | Same |

Server **refuses to start** if:

- Production uses `sk_test_*` or staging uses `sk_live_*`
- Production `APP_URL` is not HTTPS
- Production runs without `APP_CHECK_ENFORCE=true`
- Production env includes `VITE_APP_CHECK_DEBUG_TOKEN`
- `FIREBASE_PROJECT_ID` ≠ `HAMOULA_EXPECTED_FIREBASE_PROJECT` (when pin is set)

---

## Full production deployment flow

### Phase 1 — Firebase production project

1. Create Firebase project **`hamula-prod`** (separate from dev/staging).
2. Enable **Phone Authentication** (Saudi +966).
3. Deploy rules from repo:
   ```bash
   firebase use hamula-prod
   firebase deploy --only firestore:rules,firestore:indexes
   ```
4. **Authorized domains:** Firebase Console → Authentication → Settings → add `app.YOUR_DOMAIN.com`.
5. Create web app + Android app (`com.hamoula.app`) → download `google-services.json` to `android/app/` (never commit).
6. Seed `pricing/*` documents (same shape as dev).
7. Create `admins/{uid}` for each operator; use `/admin/login` to grant claims.

### Phase 2 — Firebase App Check (enforce before launch)

See `docs/FIREBASE_APP_CHECK.md`. Production checklist:

| Step | Console action |
|------|----------------|
| Web provider | App Check → Web app → **reCAPTCHA v3** → copy site key → `VITE_APP_CHECK_RECAPTCHA_SITE_KEY` |
| Android | App Check → Android → **Play Integrity** + SHA-256 (Play App Signing + upload key) |
| Monitor | 3–7 days metrics on Auth, Firestore, unenforced |
| Enforce Firestore | App Check → Firestore → **Enforce** |
| Enforce Auth | App Check → Authentication → **Enforce** |
| Enforce server | Host env: `APP_CHECK_ENFORCE=true` |

**Remove** all `VITE_APP_CHECK_DEBUG_TOKEN` from production build env.

### Phase 3 — Google Maps API restrictions

Use a **dedicated browser key** for production (`VITE_GOOGLE_MAPS_PLATFORM_KEY`).

Google Cloud Console → APIs & Services → Credentials → Maps key:

| Restriction | Value |
|-------------|--------|
| Application | HTTP referrers |
| Referrers | `https://app.YOUR_DOMAIN.com/*` |
| | `https://*.YOUR_DOMAIN.com/*` (if subdomains) |
| APIs enabled | Maps JavaScript API, Places API (if used), Geocoding (if used) |

**Do not** add `localhost` to production key — use a separate dev/staging key.

Firebase Web API key (separate from Maps):

- API restrictions: Firebase-related APIs only
- Application restrictions: HTTP referrers matching your domain
- App Check enforced in Firebase Console

### Phase 4 — Moyasar live integration

Moyasar Dashboard (live mode):

| Setting | Value |
|---------|--------|
| Secret API key | `sk_live_*` → host env `MOYASAR_SECRET_KEY` |
| Webhook URL | `https://app.YOUR_DOMAIN.com/api/webhooks/moyasar` |
| Webhook secret | → `MOYASAR_WEBHOOK_SECRET` |
| Callback (client) | `https://app.YOUR_DOMAIN.com/payment-callback` (via `APP_URL`) |

Flow unchanged: customer pays → Moyasar webhook → `broadcasting` → driver accept → capture.

Test on **staging** with `sk_test_*` first; switch host env to live only on production deploy.

### Phase 5 — Host + HTTPS

**Option A — VPS + nginx**

1. Copy `deploy/nginx/hamoula.conf.example` → `/etc/nginx/sites-available/hamoula`
2. Replace `YOUR_DOMAIN`, enable site, run certbot.
3. Set all vars from `.env.production.example` on the host (secret manager).

**Option B — Railway / Render / Fly.io**

1. Build: `npm run build`
2. Start: `node dist/server.cjs`
3. Health check: `GET /health`
4. Custom domain + automatic TLS
5. Inject env vars from dashboard (never repo)

### Phase 6 — Build & verify

On CI or deploy machine with production env injected:

```bash
npm ci
npm run verify:production
npm run build:production
node dist/server.cjs
```

`verify:production` runs `scripts/verify-production-env.ts` — checks HTTPS, live Moyasar, App Check, no debug tokens.

### Phase 7 — Post-deploy validation

1. `GET https://app.YOUR_DOMAIN.com/health` → `{ deployEnv: "production", appCheckEnforce: true }`
2. Customer: OTP login → create order → **live** Moyasar (small amount) → `/payment-callback` → tracking
3. Driver: accept → arrived → transit → complete
4. Admin: overview + driver approve
5. **Do not** run `test:e2e:staging` against production

---

## Deployment checklists

### Firebase checklist

- [ ] Separate prod Firebase project created
- [ ] Firestore rules + indexes deployed
- [ ] Phone Auth enabled + authorized domains
- [ ] App Check registered (web reCAPTCHA + Android Play Integrity)
- [ ] App Check **enforced** on Auth + Firestore
- [ ] `admins/{uid}` documents created
- [ ] Pricing collection seeded
- [ ] Service account key on host (not in git)

### Domain & HTTPS checklist

- [ ] DNS A/AAAA → host
- [ ] TLS certificate valid
- [ ] `APP_URL=https://app.YOUR_DOMAIN.com`
- [ ] nginx/proxy forwards `X-Forwarded-Proto`
- [ ] HSTS active (automatic via `securityHeaders` middleware)

### Moyasar checklist

- [ ] Live secret on production host only
- [ ] Webhook URL reachable + HMAC verified
- [ ] Callback URL matches `APP_URL/payment-callback`
- [ ] Test payment completed end-to-end on staging first

### Google Maps checklist

- [ ] Production browser key with domain referrers only
- [ ] Billing enabled on GCP project
- [ ] Staging uses separate key (optional localhost referrers)

### Play Store checklist (manual)

- [ ] Play Console app created (`com.miras.app`)
- [ ] Play Integrity linked to Firebase prod project
- [ ] Internal testing track APK/AAB uploaded
- [ ] Privacy policy URL live (`https://app.YOUR_DOMAIN.com/privacy`)
- [ ] Terms URL live (`https://app.YOUR_DOMAIN.com/terms`)
- [ ] Data safety form completed
- [x] Store listing AR screenshots + feature graphic (see `store/` and `fastlane/`)
- [ ] Target countries: Saudi Arabia
- [ ] Content rating questionnaire
- [ ] Closed testing group invited

### App Store checklist (manual — macOS + App Store Connect)

- [ ] Apple Developer Team ID applied: `node scripts/set-ios-team-id.mjs YOURTEAMID` then `npm run deploy:hosting` so AASA is live
- [ ] App ID `com.ahmed.miras` has Associated Domains (`applinks:hamula-cfc6c.web.app` and `applinks:hamula-cfc6c.firebaseapp.com`)
- [ ] App Store Connect app created; bundle ID `com.ahmed.miras`; iPhone only
- [ ] Privacy policy URL: https://ahmedalkulif12-netizen.github.io/miras-privacy/
- [ ] Support URL + email `support@miras.com`; listing copy in `fastlane/metadata/ios/`
- [ ] 6.7" screenshots uploaded from `store/ios/iphone-6.7/`
- [ ] App Privacy nutrition labels + content rating
- [ ] Firebase Phone Auth **test number** for App Review (production has no demo login)
- [ ] Xcode Archive (Release) uploaded to TestFlight, then Submit for Review

---

## Environment templates

| File | Use |
|------|-----|
| `.env.example` | Local development |
| `.env.staging.example` | Staging host template |
| `.env.production.example` | Production host template |

---

## npm scripts

```bash
npm run verify:staging      # validate staging env before deploy
npm run verify:production   # validate production env before deploy
npm run build:production    # NODE_ENV=production build
npm run test:e2e:staging    # staging only — never production
```

---

## Final launch blockers (typical)

1. App Check Play Integrity on Play-distributed build (not sideload)
2. Moyasar live webhook verified on production domain
3. Production Firebase project + rules deployed separately from dev
4. Maps + Firebase keys restricted to production domain
5. Play Store listing + policy URLs + closed test track
6. Key rotation if secrets were ever committed locally

**Estimated production readiness: ~94–95%** (code + docs + guards complete; launch requires manual Console/host/store steps above).

---

## Exact manual steps before Play Store

1. Create **hamula-prod** Firebase project; deploy rules; add authorized domain.
2. Register App Check (reCAPTCHA web + Play Integrity); enforce Auth + Firestore.
3. Create Moyasar **live** account settings + webhook on production URL.
4. Provision VPS/PaaS; set `.env.production.example` values in secret manager.
5. Run `npm run verify:production` + deploy build.
6. Complete one real live payment + driver completion on production.
7. Build signed AAB (`npm run cap:sync` + Android Studio release build).
8. Upload to Play Console **Internal testing**; verify Play Integrity + OTP + payments.
9. Fill store listing, privacy policy, data safety, content rating.
10. Promote internal → closed testing after QA sign-off.

See also: `docs/PRODUCTION_DEPLOY.md`, `docs/ENVIRONMENT.md`, `docs/E2E_STAGING.md`.
