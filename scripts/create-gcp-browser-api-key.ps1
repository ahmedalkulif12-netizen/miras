# Creates an unrestricted Browser API key for hamula-cfc6c via gcloud (if installed + authenticated).
# After creation, rotates local env files automatically.
#
# Prerequisites:
#   gcloud auth login
#   gcloud config set project hamula-cfc6c
#
# Usage:
#   .\scripts\create-gcp-browser-api-key.ps1

$ErrorActionPreference = 'Stop'
$ProjectId = 'hamula-cfc6c'
$DisplayName = "Miras Web Unrestricted $(Get-Date -Format 'yyyy-MM-dd')"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error @"
gcloud CLI is not installed. Create the key manually:
  1. https://console.cloud.google.com/apis/credentials?project=$ProjectId
  2. Create credentials → API key
  3. Application restrictions: None
  4. API restrictions: Don't restrict key
  5. Run: npm run rotate:firebase-api-key -- --key=YOUR_NEW_KEY
"@
}

gcloud config set project $ProjectId | Out-Null

$keyResource = gcloud alpha services api-keys create `
  --display-name="$DisplayName" `
  --project=$ProjectId `
  --format="value(name)"

if (-not $keyResource) {
  Write-Error 'Failed to create API key resource.'
}

$keyString = gcloud alpha services api-keys get-key-string $keyResource --format="value(keyString)"
if (-not $keyString) {
  Write-Error 'Failed to read key string from gcloud.'
}

Write-Host "Created API key: $($keyString.Substring(0,6))...$($keyString.Substring($keyString.Length-4))"

npm run rotate:firebase-api-key -- --key=$keyString
