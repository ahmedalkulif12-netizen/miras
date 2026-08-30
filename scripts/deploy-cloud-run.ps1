# Deploy Miras API to Google Cloud Run
# Prerequisites: Google Cloud SDK (gcloud), logged in, billing enabled on hamula-cfc6c
#
# Usage:
#   .\scripts\deploy-cloud-run.ps1
#   .\scripts\deploy-cloud-run.ps1 -MoyasarSecretKey "sk_test_..." -MoyasarWebhookSecret "whsec_..."
#   .\scripts\deploy-cloud-run.ps1 -AppUrl "https://YOUR_CUSTOM_DOMAIN"
#
# Order for a clean firebase deploy:
#   1) This script (healthy hamula-api)
#   2) npm run build
#   3) npm run deploy:hosting:api   (or copy firebase.hosting.api.json -> firebase.json)

param(
  [string]$ProjectId = "hamula-cfc6c",
  [string]$ServiceName = "hamula-api",
  [string]$Region = "us-central1",
  [string]$AppUrl = "https://hamula-cfc6c.web.app",
  [string]$DeployEnv = "staging",
  [string]$MoyasarSecretKey = $env:MOYASAR_SECRET_KEY,
  [string]$MoyasarWebhookSecret = $env:MOYASAR_WEBHOOK_SECRET,
  [string]$AppCheckEnforce = "false"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error @"
gcloud CLI not found. Install Google Cloud SDK:
  winget install Google.CloudSDK
Then restart your terminal and run:
  gcloud auth login
  gcloud config set project $ProjectId
"@
}

if (-not $MoyasarSecretKey) {
  Write-Error @"
MOYASAR_SECRET_KEY is required for the API to start.
Set it in your environment or pass -MoyasarSecretKey.
See deploy/cloud-run.env.example
"@
}

if (-not $MoyasarWebhookSecret) {
  if ($DeployEnv -eq "staging") {
    $MoyasarWebhookSecret = "whsec_test_dummy"
    Write-Warning "MOYASAR_WEBHOOK_SECRET unset - using staging fallback whsec_test_dummy"
  } else {
    Write-Error @"
MOYASAR_WEBHOOK_SECRET is required for production.
Set it in your environment or pass -MoyasarWebhookSecret.
See deploy/cloud-run.env.example
"@
  }
}

if ($DeployEnv -eq "staging" -and $MoyasarSecretKey -notlike "sk_test_*") {
  Write-Error "Staging Cloud Run requires Moyasar TEST key (sk_test_*). Got a non-test key."
}

if ($DeployEnv -eq "production" -and $MoyasarSecretKey -notlike "sk_live_*") {
  Write-Error "Production Cloud Run requires Moyasar LIVE key (sk_live_*)."
}

if ($AppUrl -notlike "https://*") {
  Write-Error "APP_URL must be HTTPS for Moyasar callbacks (got: $AppUrl)"
}

Write-Host "Enabling required APIs on $ProjectId ..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=$ProjectId

Write-Host "Deploying $ServiceName to Cloud Run ($Region) ..."
gcloud run deploy $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --source=. `
  --platform=managed `
  --allow-unauthenticated `
  --port=8080 `
  --memory=512Mi `
  --cpu=1 `
  --min-instances=0 `
  --max-instances=10 `
  --set-env-vars="NODE_ENV=production,MIRAS_PROCESS_ROLE=api,MIRAS_DEPLOY_ENV=$DeployEnv,HAMOULA_DEPLOY_ENV=$DeployEnv,FIREBASE_PROJECT_ID=$ProjectId,MIRAS_EXPECTED_FIREBASE_PROJECT=$ProjectId,HAMOULA_EXPECTED_FIREBASE_PROJECT=$ProjectId,APP_URL=$AppUrl,APP_CHECK_ENFORCE=$AppCheckEnforce,MOYASAR_SECRET_KEY=$MoyasarSecretKey,MOYASAR_WEBHOOK_SECRET=$MoyasarWebhookSecret"

$url = gcloud run services describe $ServiceName --project=$ProjectId --region=$Region --format="value(status.url)"
Write-Host ""
Write-Host "Deployed: $url"
Write-Host "Health:   $url/health"
Write-Host ""
Write-Host "Smoke-test same-origin Hosting routes after firebase deploy:"
Write-Host "  $AppUrl/health"
Write-Host "  $AppUrl/api/calculate-price  (POST)"
Write-Host ""
Write-Host "Next: npm run deploy:hosting:api"
Write-Host "firebase.hosting.api.json rewrites /api/** and /health to $ServiceName ($Region)"
