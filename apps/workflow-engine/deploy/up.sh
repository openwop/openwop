#!/usr/bin/env bash
# White-label deploy helper for the workflow-engine reference app.
#
# Default mode is a dry run. Set OPENWOP_DEPLOY_CONFIRM=1 to execute commands
# that mutate GCP/Firebase state.
#
# Required env:
#   OPENWOP_GCP_PROJECT
#   OPENWOP_RUN_SERVICE
#   OPENWOP_RUN_REGION
#   OPENWOP_FIREBASE_TARGET
#   OPENWOP_PUBLIC_BASE_URL       e.g. https://flow.example.com
#
# Common optional env:
#   OPENWOP_SESSION_SECRET_NAME   default: openwop-session-secret
#   OPENWOP_ADMIN_TOKEN_NAME      default: openwop-admin-token
#   OPENWOP_SSE_BASE_URL          default: Cloud Run service URL
#   OPENWOP_RUNTIME_SA            default: project-number compute SA
#   OPENWOP_RUN_EXTRA_ARGS        appended to gcloud run deploy
#   OPENWOP_FRONTEND_DIR          default: apps/workflow-engine/frontend/react
#   OPENWOP_DEPLOY_POSTURE        default: cookie-per-visitor
#   OPENWOP_SKIP_BRAND_CHECK      1 = skip check-branding.sh (stock-brand deploys)
#
# This script intentionally uses merge-style `--update-secrets` /
# `--update-env-vars` for existing services. It does not use the dangerous
# full-replace `--set-*` flags that caused white-label deploy footguns.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE_DIR="$REPO_ROOT/apps/workflow-engine"
FRONTEND_DIR="${OPENWOP_FRONTEND_DIR:-$ENGINE_DIR/frontend/react}"

PROJECT="${OPENWOP_GCP_PROJECT:-}"
SERVICE="${OPENWOP_RUN_SERVICE:-}"
REGION="${OPENWOP_RUN_REGION:-}"
FIREBASE_TARGET="${OPENWOP_FIREBASE_TARGET:-}"
PUBLIC_BASE_URL="${OPENWOP_PUBLIC_BASE_URL:-}"
SESSION_SECRET_NAME="${OPENWOP_SESSION_SECRET_NAME:-openwop-session-secret}"
ADMIN_TOKEN_NAME="${OPENWOP_ADMIN_TOKEN_NAME:-openwop-admin-token}"
CONFIRM="${OPENWOP_DEPLOY_CONFIRM:-0}"
DEPLOY_POSTURE="${OPENWOP_DEPLOY_POSTURE:-cookie-per-visitor}"

usage() {
  cat >&2 <<'EOF'
usage:
  OPENWOP_GCP_PROJECT=<project> \
  OPENWOP_RUN_SERVICE=<cloud-run-service> \
  OPENWOP_RUN_REGION=<region> \
  OPENWOP_FIREBASE_TARGET=<firebase-hosting-target> \
  OPENWOP_PUBLIC_BASE_URL=https://<your-domain> \
  bash apps/workflow-engine/deploy/up.sh

Dry-run is the default. Add OPENWOP_DEPLOY_CONFIRM=1 to execute cloud changes.
EOF
}

require_env() {
  local missing=0
  for name in PROJECT SERVICE REGION FIREBASE_TARGET PUBLIC_BASE_URL; do
    if [ -z "${!name}" ]; then
      echo "error: missing required env for $name" >&2
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    usage
    exit 2
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: required command not found: $1" >&2
    exit 2
  }
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  if [ "$CONFIRM" = "1" ]; then
    "$@"
  fi
}

# capture <fn> <dry-run-fallback> — run <fn> live; print the fallback in
# dry-run. The fallback is NEVER passed to <fn> as an argument.
capture() {
  if [ "$CONFIRM" = "1" ]; then
    "$1"
  else
    printf '%s' "$2"
  fi
}

ensure_secret() {
  local name="$1"
  local generator="$2"
  if [ "$CONFIRM" != "1" ]; then
    echo "+ gcloud secrets describe $name --project=$PROJECT || create from generated value"
    return
  fi
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    echo "ok: secret exists: $name"
    return
  fi
  local value
  value="$($generator)"
  printf '%s' "$value" | gcloud secrets create "$name" --project="$PROJECT" --data-file=-
}

project_number() {
  gcloud projects describe "$PROJECT" --format='value(projectNumber)'
}

service_url() {
  gcloud run services describe "$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --format='value(status.url)'
}

readiness_url() {
  local base="$1"
  printf '%s/api/readiness' "${base%/}"
}

require_env
require_cmd gcloud
require_cmd firebase
require_cmd curl
require_cmd openssl
require_cmd npm

cd "$REPO_ROOT"

echo "== White-label deploy =="
echo "project:         $PROJECT"
echo "run service:     $SERVICE"
echo "run region:      $REGION"
echo "firebase target: $FIREBASE_TARGET"
echo "public base:     $PUBLIC_BASE_URL"
echo "deploy posture:  $DEPLOY_POSTURE"
if [ "$CONFIRM" != "1" ]; then
  echo "mode:            dry-run (set OPENWOP_DEPLOY_CONFIRM=1 to execute)"
else
  echo "mode:            live"
fi

PROJECT_NUMBER="${OPENWOP_PROJECT_NUMBER:-$(capture project_number 000000000000)}"
RUNTIME_SA="${OPENWOP_RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo
echo "== Enable required Google APIs =="
run gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  firebasehosting.googleapis.com \
  --project="$PROJECT"

echo
echo "== Ensure runtime secrets =="
ensure_secret "$SESSION_SECRET_NAME" "openssl rand -hex 32"
ensure_secret "$ADMIN_TOKEN_NAME" "openssl rand -hex 16"
for secret in "$SESSION_SECRET_NAME" "$ADMIN_TOKEN_NAME"; do
  run gcloud secrets add-iam-policy-binding "$secret" \
    --project="$PROJECT" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor"
done

echo
echo "== Deploy Cloud Run backend =="
run bash apps/workflow-engine/scripts/sync-schemas.sh
run bash apps/workflow-engine/scripts/sync-fixtures.sh
run bash apps/workflow-engine/scripts/sync-packs.sh
# Secrets + env ride on the deploy itself (merge-style --update-*), so even the
# FIRST revision of a brand-new service boots fully configured — no transient
# window where /readiness 503s on a missing session secret.
run gcloud run deploy "$SERVICE" \
  --source apps/workflow-engine \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --update-secrets "OPENWOP_SESSION_SECRET=$SESSION_SECRET_NAME:latest,OPENWOP_ADMIN_TOKEN=$ADMIN_TOKEN_NAME:latest" \
  --update-env-vars "NODE_ENV=production,OPENWOP_COOKIE_SECURE=true,OPENWOP_DEPLOY_POSTURE=$DEPLOY_POSTURE" \
  --quiet \
  ${OPENWOP_RUN_EXTRA_ARGS:-}

RUN_URL="${OPENWOP_SSE_BASE_URL:-$(capture service_url "https://$SERVICE-$PROJECT.$REGION.run.app")}"
echo "backend URL: $RUN_URL"

echo
echo "== Build branded frontend =="
(
  cd "$FRONTEND_DIR"
  run env \
    "VITE_OPENWOP_BASE_URL=${VITE_OPENWOP_BASE_URL:-/api}" \
    "VITE_OPENWOP_SSE_BASE_URL=${VITE_OPENWOP_SSE_BASE_URL:-$RUN_URL}" \
    npm run build
)
# check-branding.sh is a FORK guard — the steward's own OpenWOP-branded deploy
# legitimately carries the default strings and must skip it.
if [ "${OPENWOP_SKIP_BRAND_CHECK:-0}" = "1" ]; then
  echo "skipping check-branding.sh (OPENWOP_SKIP_BRAND_CHECK=1 — stock OpenWOP brand deploy)"
else
  run bash scripts/check-branding.sh "$FRONTEND_DIR/dist"
fi

echo
echo "== Deploy Firebase Hosting =="
run firebase deploy --only "hosting:$FIREBASE_TARGET" --project "$PROJECT"

echo
echo "== Verify readiness =="
if [ "$CONFIRM" = "1" ]; then
  HTTP_CODE="$(curl -s -o /tmp/openwop-readiness.json -w '%{http_code}' "$(readiness_url "$PUBLIC_BASE_URL")")"
  cat /tmp/openwop-readiness.json
  echo
  if [ "$HTTP_CODE" != "200" ]; then
    echo "error: readiness returned HTTP $HTTP_CODE" >&2
    exit 1
  fi
else
  echo "+ curl -s -o /tmp/openwop-readiness.json -w '%{http_code}' $(readiness_url "$PUBLIC_BASE_URL")"
fi

echo "ok: deploy recipe completed"
