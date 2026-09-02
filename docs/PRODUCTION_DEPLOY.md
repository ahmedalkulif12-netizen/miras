# Production Deployment

> **Full launch guide:** [PRODUCTION_LAUNCH.md](./PRODUCTION_LAUNCH.md) — Firebase, Moyasar live, App Check, Maps, Play Store.
> **Hosting `/api` routing:** [HOSTING_API.md](./HOSTING_API.md) — Firebase Hosting + Cloud Run JSON rewrites.

Miras on Firebase: **Hosting** serves the Vite SPA; **Cloud Run** (`hamula-api`) serves `/api/*` + `/health` as JSON.

## Pre-deploy checklist

| Step | Status |
|------|--------|
| Healthy Cloud Run `hamula-api` with Moyasar secrets | Required before Hosting rewrites |
| `firebase.json` rewrites `/api/**` + `/health` → Cloud Run | Required |
| Copy `.env.staging.example` / `.env.production.example` → host secrets | Required |
| `MIRAS_DEPLOY_ENV=staging` + `sk_test_*` for current live Hosting | Current |
| `MIRAS_DEPLOY_ENV=production` + `sk_live_*` for real charges | Later |
| `APP_URL=https://your-domain` (custom domain or `*.web.app`) | Required |
| Firestore rules + indexes | Required |
| Moyasar webhook → `{APP_URL}/api/webhooks/moyasar` | Required |
| Run `npm run verify:staging` or `npm run verify:production` | Required |

## Build & run (single-process / VPS)

```bash
npm ci
npm run verify:production
npm run build:production
NODE_ENV=production MIRAS_DEPLOY_ENV=production node dist/server.cjs
```

## Firebase Hosting + Cloud Run (recommended)

```powershell
.\scripts\deploy-cloud-run.ps1 -AppUrl "https://hamula-cfc6c.web.app"
npm run deploy:live
```

Health probe (same origin after Hosting deploy):

```http
GET /health
→ { "ok": true, "service": "miras-api", "deployEnv": "staging", ... }
```

## HTTPS / nginx

See `deploy/nginx/miras.conf.example` for TLS termination + reverse proxy to `:3000`.

## Staging

Use `.env.staging.example` with `MIRAS_DEPLOY_ENV=staging` and `npm run verify:staging`.
Run E2E smoke only against staging: `docs/E2E_STAGING.md`.

## Post-deploy smoke test

1. `GET /health` → 200 JSON (not HTML)
2. `POST /api/calculate-price` → JSON
3. Manual test payment (Moyasar `sk_test_*`) + driver completion
4. Admin overview + driver moderation

**Readiness:** see [PRODUCTION_LAUNCH.md](./PRODUCTION_LAUNCH.md) and [HOSTING_API.md](./HOSTING_API.md).
