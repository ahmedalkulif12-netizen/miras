# Deploy the Miras email/payout worker to Cloud Run (always-on, CPU never throttled).
# Prerequisites: gcloud logged in, billing on hamula-cfc6c, Gmail IMAP + App Password.
#
# Usage (from repo root, after filling SMTP_* in the environment):
#   .\scripts\deploy-cloud-run-agents.ps1
#
# Do NOT set MIRAS_AGENTS_ENABLED on hamula-api. This service is separate.

param(
  [string]$ProjectId = "hamula-cfc6c",
  [string]$ServiceName = "hamula-agents",
  [string]$Region = "us-central1",
  [string]$AppUrl = "https://hamula-cfc6c.web.app",
  [string]$AdminEmail = $(if ($env:MIRAS_ADMIN_EMAIL) { $env:MIRAS_ADMIN_EMAIL } else { "ahmed.alkhulif.12@gmail.com" }),
  [string]$SmtpUser = $env:SMTP_USER,
  [string]$SmtpPass = $env:SMTP_PASS,
  [string]$ImapUser = $(if ($env:IMAP_USER) { $env:IMAP_USER } else { $env:SMTP_USER }),
  [string]$ImapPass = $(if ($env:IMAP_PASS) { $env:IMAP_PASS } else { $env:SMTP_PASS })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error @"
gcloud CLI not found. Install Google Cloud SDK:
  winget install Google.CloudSDK
Then:
  gcloud auth login
  gcloud config set project $ProjectId
"@
}

if (-not $SmtpUser -or -not $SmtpPass) {
  Write-Error "Set SMTP_USER and SMTP_PASS (Gmail App Password) in the environment before deploying."
}

Write-Host "Enabling Cloud Run / Cloud Build / Artifact Registry APIs on $ProjectId ..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=$ProjectId

$Image = "$Region-docker.pkg.dev/$ProjectId/miras/${ServiceName}:latest"

$savedEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gcloud artifacts repositories describe miras --location=$Region --project=$ProjectId 2>$null | Out-Null
$repoMissing = $LASTEXITCODE -ne 0
$ErrorActionPreference = $savedEap
if ($repoMissing) {
  Write-Host "Creating Artifact Registry repo 'miras' in $Region ..."
  gcloud artifacts repositories create miras --repository-format=docker --location=$Region --project=$ProjectId
}

Write-Host "Building $Image via Cloud Build (Dockerfile.agents) ..."
gcloud builds submit --config=cloudbuild.agents.yaml --substitutions=_IMAGE=$Image --project=$ProjectId
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Commas break --set-env-vars. App Passwords are space-free; strip spaces anyway.
$SmtpPass = $SmtpPass -replace '\s', ''
$ImapPass = $ImapPass -replace '\s', ''

$EnvVars = @(
  "NODE_ENV=production",
  "MIRAS_PROCESS_ROLE=agents",
  "MIRAS_DEPLOY_ENV=staging",
  "FIREBASE_PROJECT_ID=$ProjectId",
  "APP_URL=$AppUrl",
  "MIRAS_SUPPORT_EMAIL=support@miras.com",
  "MIRAS_ADMIN_EMAIL=$AdminEmail",
  "SMTP_HOST=smtp.gmail.com",
  "SMTP_PORT=587",
  "SMTP_SECURE=false",
  "SMTP_USER=$SmtpUser",
  "SMTP_PASS=$SmtpPass",
  "SMTP_FROM=support@miras.com",
  "IMAP_HOST=imap.gmail.com",
  "IMAP_PORT=993",
  "IMAP_SECURE=true",
  "IMAP_USER=$ImapUser",
  "IMAP_PASS=$ImapPass",
  "IMAP_POLL_MS=15000",
  "MIRAS_AGENTS_SKIP_BOOT_EMAIL=true"
) -join ","

Write-Host "Deploying $ServiceName (min=1 max=1, CPU always allocated) ..."
gcloud run deploy $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --image=$Image `
  --platform=managed `
  --allow-unauthenticated `
  --port=8080 `
  --memory=512Mi `
  --cpu=1 `
  --min-instances=1 `
  --max-instances=1 `
  --no-cpu-throttling `
  --timeout=300 `
  --set-env-vars=$EnvVars

$ProjectNumber = gcloud projects describe $ProjectId --format="value(projectNumber)"
$RuntimeSa = "$ProjectNumber-compute@developer.gserviceaccount.com"
Write-Host "Granting Firestore access to $RuntimeSa (payout watcher) ..."
$ErrorActionPreference = "Continue"
gcloud projects add-iam-policy-binding $ProjectId `
  --member="serviceAccount:$RuntimeSa" `
  --role="roles/datastore.user" `
  --condition=None `
  --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Could not grant roles/datastore.user. Grant it in IAM if payout emails fail."
}
$ErrorActionPreference = "Stop"

$url = gcloud run services describe $ServiceName --project=$ProjectId --region=$Region --format="value(status.url)"
Write-Host ""
Write-Host "Deployed: $url"
Write-Host "Health:   $url/health"
Write-Host "Keep this URL private if you prefer: gcloud run services update $ServiceName --ingress=internal --region=$Region"
Write-Host ""
Write-Host "Confirm Gmail IMAP is enabled and support@miras.com forwards to $SmtpUser."
