# Deploy Miras API to Google Cloud Run
# Prerequisites: Google Cloud SDK (gcloud), logged in, billing enabled on hamula-cfc6c
#
# Usage:
#   .\scripts\deploy-cloud-run.ps1
#   .\scripts\deploy-cloud-run.ps1 -TapSecretKey "sk_test_..." -TapPublicKey "pk_test_..."
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
  [string]$TapSecretKey = $env:TAP_SECRET_KEY,
  [string]$TapPublicKey = $env:TAP_PUBLIC_KEY,
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

if (-not $TapSecretKey -or -not $TapPublicKey) {
  Write-Error @"
TAP_SECRET_KEY and TAP_PUBLIC_KEY are required for the API to start.
Set them in your environment or pass -TapSecretKey and -TapPublicKey.
See deploy/cloud-run.env.example
"@
}

if ($DeployEnv -eq "staging" -and $TapSecretKey -notlike "sk_test_*") {
  Write-Error "Staging Cloud Run requires a Tap TEST secret (sk_test_*)."
}
if ($DeployEnv -eq "staging" -and $TapPublicKey -notlike "pk_test_*") {
  Write-Error "Staging Cloud Run requires a Tap TEST public key (pk_test_*)."
}

if ($DeployEnv -eq "production" -and $TapSecretKey -notlike "sk_live_*") {
  Write-Error "Production Cloud Run requires a Tap LIVE secret (sk_live_*)."
}
if ($DeployEnv -eq "production" -and $TapPublicKey -notlike "pk_live_*") {
  Write-Error "Production Cloud Run requires a Tap LIVE public key (pk_live_*)."
}

if ($AppUrl -notlike "https://*") {
  Write-Error "APP_URL must be HTTPS for Tap redirects (got: $AppUrl)"
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
  --set-env-vars="NODE_ENV=production,MIRAS_PROCESS_ROLE=api,MIRAS_DEPLOY_ENV=$DeployEnv,HAMOULA_DEPLOY_ENV=$DeployEnv,FIREBASE_PROJECT_ID=$ProjectId,MIRAS_EXPECTED_FIREBASE_PROJECT=$ProjectId,HAMOULA_EXPECTED_FIREBASE_PROJECT=$ProjectId,APP_URL=$AppUrl,APP_CHECK_ENFORCE=$AppCheckEnforce,APP_STORE_APPLE_ID=6807503584,TAP_SECRET_KEY=$TapSecretKey,TAP_PUBLIC_KEY=$TapPublicKey"

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
