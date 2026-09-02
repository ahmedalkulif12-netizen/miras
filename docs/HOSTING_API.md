# Hosting + Cloud Run API routing (Miras)

Firebase Hosting serves the SPA from `dist/`. Express on Cloud Run (`hamula-api`)
serves **only** JSON for `/api/**` and `/health`.

## Why `/api` returned HTML

If Hosting is deployed **without** Cloud Run rewrites (or while `hamula-api` is
unhealthy), the catch-all SPA rewrite sends `/api/**` → `index.html`. The browser
then fails with “API returned HTML instead of JSON”.

## Correct site binding

`.firebaserc` must use project `hamula-cfc6c` **without** stale hosting targets.
`firebase.json` must pin the site explicitly:

```json
"hosting": {
  "site": "hamula-cfc6c",
  ...
}
```

## Cloud Run rewrite 404 during finalize

If `hamula-api` is **not Ready**, Hosting finalize fails with:

`Requested entity was not found`

while linking `/api/**` rewrites. Until Cloud Run is healthy:

1. Deploy SPA-only: `firebase deploy --only hosting --project hamula-cfc6c` (default `firebase.json`)
2. Deploy API: `.\scripts\deploy-cloud-run.ps1` until `/health` returns JSON
3. Re-enable API rewrites: `npm run deploy:hosting:api` (uses `firebase.hosting.api.json`)

## Deploy order (clean `firebase deploy`)

```powershell
# 1) Healthy API with Moyasar TEST keys (staging)
$env:MOYASAR_SECRET_KEY = "sk_test_..."
$env:MOYASAR_WEBHOOK_SECRET = "whsec_..."
.\scripts\deploy-cloud-run.ps1 -AppUrl "https://hamula-cfc6c.web.app"

# 2) Confirm Cloud Run is up
# curl https://YOUR-CLOUD-RUN-URL/health

# 3) SPA Hosting (always works with site hamula-cfc6c)
npm run verify:staging
npm run deploy:live

# 4) After Cloud Run is Ready, wire /api/** + /health rewrites:
npm run deploy:hosting:api
```

## Same-origin smoke tests

After Hosting deploy (custom domain or `*.web.app`):

```http
GET  https://YOUR_DOMAIN/health
→ application/json  { "ok": true, "service": "miras-api", ... }

POST https://YOUR_DOMAIN/api/calculate-price
Content-Type: application/json
→ application/json (never text/html)
```

## Payments (test keys on live Hosting)

| Env | `HAMOULA_DEPLOY_ENV` | Moyasar key | Notes |
|-----|----------------------|-------------|--------|
| Local `npm run dev` | `development` | `sk_test_*` | Checkout may use local draft flow |
| Live Hosting (current) | `staging` | `sk_test_*` | Set on Cloud Run; `APP_URL` = public HTTPS origin |
| Real charges | `production` | `sk_live_*` | Requires App Check enforce + live Moyasar |

Set Moyasar Dashboard:

- Webhook: `{APP_URL}/api/webhooks/moyasar`
- Callback: `{APP_URL}/payment-callback`

When attaching a **custom domain**, update Cloud Run `APP_URL`, rebuild is not
required for server env, then update Moyasar URLs to the new origin.

## Client config

Leave `VITE_API_ORIGIN` **unset** so the SPA calls same-origin `/api/*` and
Hosting rewrites to Cloud Run. Set `VITE_API_ORIGIN` only for split-host debugging.
