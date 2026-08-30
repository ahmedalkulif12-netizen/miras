#!/usr/bin/env bash
# Deploy Miras API to Google Cloud Run (hamula-cfc6c / hamula-api / us-central1)
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-hamula-cfc6c}"
SERVICE_NAME="${SERVICE_NAME:-hamula-api}"
REGION="${REGION:-us-central1}"
APP_URL="${APP_URL:-https://hamula-cfc6c.web.app}"
DEPLOY_ENV="${MIRAS_DEPLOY_ENV:-${HAMOULA_DEPLOY_ENV:-staging}}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

if [[ -z "${MOYASAR_SECRET_KEY:-}" ]]; then
  echo "Set MOYASAR_SECRET_KEY before deploying."
  echo "See deploy/cloud-run.env.example"
  exit 1
fi

if [[ -z "${MOYASAR_WEBHOOK_SECRET:-}" ]]; then
  if [[ "$DEPLOY_ENV" == "staging" ]]; then
    MOYASAR_WEBHOOK_SECRET="whsec_test_dummy"
    echo "MOYASAR_WEBHOOK_SECRET unset — using staging fallback whsec_test_dummy"
  else
    echo "Set MOYASAR_WEBHOOK_SECRET before production deploy."
    echo "See deploy/cloud-run.env.example"
    exit 1
  fi
fi

if [[ "$DEPLOY_ENV" == "staging" && "$MOYASAR_SECRET_KEY" != sk_test_* ]]; then
  echo "Staging Cloud Run requires Moyasar TEST key (sk_test_*)."
  exit 1
fi

if [[ "$DEPLOY_ENV" == "production" && "$MOYASAR_SECRET_KEY" != sk_live_* ]]; then
  echo "Production Cloud Run requires Moyasar LIVE key (sk_live_*)."
  exit 1
fi

if [[ "$APP_URL" != https://* ]]; then
  echo "APP_URL must be HTTPS for Moyasar callbacks (got: $APP_URL)"
  exit 1
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

gcloud run deploy "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source=. \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --set-env-vars="NODE_ENV=production,MIRAS_DEPLOY_ENV=${DEPLOY_ENV},HAMOULA_DEPLOY_ENV=${DEPLOY_ENV},FIREBASE_PROJECT_ID=${PROJECT_ID},MIRAS_EXPECTED_FIREBASE_PROJECT=${PROJECT_ID},HAMOULA_EXPECTED_FIREBASE_PROJECT=${PROJECT_ID},APP_URL=${APP_URL},APP_CHECK_ENFORCE=${APP_CHECK_ENFORCE:-false},MOYASAR_SECRET_KEY=${MOYASAR_SECRET_KEY},MOYASAR_WEBHOOK_SECRET=${MOYASAR_WEBHOOK_SECRET}"

URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo ""
echo "Deployed: $URL"
echo "Health:   $URL/health"
echo ""
echo "After firebase deploy, smoke-test same-origin:"
echo "  ${APP_URL}/health"
echo "  ${APP_URL}/api/**"
echo ""
echo "Next: npm run build && firebase deploy --only hosting,firestore"
echo "firebase.json must rewrite /api/** and /health → ${SERVICE_NAME} (${REGION})"
