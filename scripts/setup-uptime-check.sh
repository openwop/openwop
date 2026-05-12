#!/usr/bin/env bash
# setup-uptime-check — one-shot creation of the Cloud Monitoring uptime
# check + alert policy for packs.openwop.dev.
#
# Stage 4 PR 4 (2026-05-12): operational maturity per the enterprise-
# architecture review. The registry's CDN-front (Fastly + Firebase
# Hosting) is mostly self-healing, but a quiet content-rewrite,
# DNS-flip, or cert-expiry will silently break consumers until someone
# notices. This script wires Cloud Monitoring to page when the
# discovery endpoint stops returning the expected payload.
#
# Probes: `GET https://packs.openwop.dev/v1/index.json`. Asserts:
#   - HTTPS handshake succeeds
#   - HTTP 200 response
#   - Response body contains the literal string `"packs":` (JSON key
#     present means the registry-side build-index step ran successfully
#     AND Firebase Hosting deployed it).
#
# Cadence: every 1 minute from 4 global regions (USA, EU, SA, AP).
# Alert: if 2 consecutive checks fail.
#
# Requires:
#   - `gcloud` CLI authenticated as a user with at least
#     `roles/monitoring.uptimeCheckConfigEditor` AND
#     `roles/monitoring.alertPolicyEditor` on the `openwop-dev` project
#   - Project `openwop-dev` (the project that hosts packs.openwop.dev)
#
# Usage:
#   ./scripts/setup-uptime-check.sh                    # create
#   ./scripts/setup-uptime-check.sh --notification-channel <id>
#                                                      # create + page
#                                                      # via existing channel
#   ./scripts/setup-uptime-check.sh --dry-run          # print plan, don't apply
#
# Idempotent: re-running with the same display-name returns the
# existing uptime-check + alert-policy IDs without recreating.
#
# @see docs/runbooks/INCIDENT-RESPONSE.md §Incident class 4

set -euo pipefail

PROJECT="openwop-dev"
UPTIME_DISPLAY="packs-openwop-dev-discovery"
ALERT_DISPLAY="packs-openwop-dev-uptime-failure"
HOST="packs.openwop.dev"
PATH_TO_CHECK="/v1/index.json"
BODY_MATCH='"packs":'
PERIOD_SECONDS=60
TIMEOUT_SECONDS=10
NOTIFICATION_CHANNEL=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notification-channel)
      NOTIFICATION_CHANNEL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      sed -n '1,/^set -euo/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

# ─── preflight ─────────────────────────────────────────────────────

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not on PATH" >&2
  exit 2
fi

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q '@'; then
  echo "ERROR: no active gcloud account — run \`gcloud auth login\`" >&2
  exit 2
fi

if ! gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "ERROR: cannot describe project $PROJECT (auth or permission issue)" >&2
  exit 2
fi

# ─── plan ──────────────────────────────────────────────────────────

echo "Project:               $PROJECT"
echo "Uptime check name:     $UPTIME_DISPLAY"
echo "Alert policy name:     $ALERT_DISPLAY"
echo "Target URL:            https://${HOST}${PATH_TO_CHECK}"
echo "Cadence:               every ${PERIOD_SECONDS}s, ${TIMEOUT_SECONDS}s timeout"
echo "Body-match assertion:  $BODY_MATCH"
if [[ -n "$NOTIFICATION_CHANNEL" ]]; then
  echo "Notify channel:        $NOTIFICATION_CHANNEL"
else
  echo "Notify channel:        (none — alert policy created without notification)"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo ""
  echo "DRY-RUN — no changes applied"
  exit 0
fi

# ─── uptime check ──────────────────────────────────────────────────

# Look up existing first (idempotent). gcloud monitoring uptime list
# returns the displayName + name fields.
EXISTING_UPTIME=$(gcloud monitoring uptime list-configs \
  --project="$PROJECT" \
  --format='value(name)' \
  --filter="displayName=$UPTIME_DISPLAY" 2>/dev/null || true)

if [[ -n "$EXISTING_UPTIME" ]]; then
  echo ""
  echo "✓ Uptime check already exists: $EXISTING_UPTIME"
  UPTIME_NAME="$EXISTING_UPTIME"
else
  echo ""
  echo "Creating uptime check..."
  # gcloud monitoring uptime create takes a YAML config file via
  # --resource-config-file. We use a heredoc to avoid temp-file
  # cleanup. Region list: usa, europe, south_america,
  # asia_pacific per Cloud Monitoring docs.
  gcloud monitoring uptime create "$UPTIME_DISPLAY" \
    --project="$PROJECT" \
    --resource-type=uptime-url \
    --resource-labels=host=$HOST,project_id=$PROJECT \
    --path="$PATH_TO_CHECK" \
    --port=443 \
    --protocol=https \
    --period="${PERIOD_SECONDS}s" \
    --timeout="${TIMEOUT_SECONDS}s" \
    --selected-regions=usa,europe,south_america,asia_pacific \
    --status-codes=200 \
    --matcher-content="$BODY_MATCH" \
    --matcher-type=contains-string
  UPTIME_NAME=$(gcloud monitoring uptime list-configs \
    --project="$PROJECT" \
    --format='value(name)' \
    --filter="displayName=$UPTIME_DISPLAY")
  echo "✓ Created uptime check: $UPTIME_NAME"
fi

# ─── alert policy ──────────────────────────────────────────────────

EXISTING_ALERT=$(gcloud alpha monitoring policies list \
  --project="$PROJECT" \
  --format='value(name)' \
  --filter="displayName=$ALERT_DISPLAY" 2>/dev/null || true)

if [[ -n "$EXISTING_ALERT" ]]; then
  echo "✓ Alert policy already exists: $EXISTING_ALERT"
  exit 0
fi

echo ""
echo "Creating alert policy..."

# The condition: uptime_check/check_passed=false sustained for 2 minutes
# (== 2 consecutive 1-minute checks failing). Trigger count=1 (any
# single failing region trips, so 2 consecutive regional-flap windows
# don't false-positive — they would need to both be from the same
# region, which Cloud Monitoring aggregates).
POLICY_JSON=$(cat <<EOF
{
  "displayName": "$ALERT_DISPLAY",
  "documentation": {
    "content": "packs.openwop.dev discovery endpoint (/v1/index.json) failed >=2 consecutive uptime checks across 4 regions. Triage steps: docs/runbooks/INCIDENT-RESPONSE.md §Incident class 4.",
    "mimeType": "text/markdown"
  },
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Uptime check failed >= 2 minutes",
      "conditionThreshold": {
        "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.\"check_id\"=monitoring.regex.full_match(\".*${UPTIME_DISPLAY//-/_}.*\")",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_NEXT_OLDER",
            "crossSeriesReducer": "REDUCE_COUNT_FALSE",
            "groupByFields": ["resource.label.host"]
          }
        ],
        "comparison": "COMPARISON_GT",
        "duration": "120s",
        "trigger": { "count": 1 },
        "thresholdValue": 1
      }
    }
  ]$([[ -n "$NOTIFICATION_CHANNEL" ]] && printf ', "notificationChannels": ["%s"]' "$NOTIFICATION_CHANNEL" || true)
}
EOF
)

# Write to a tmp file because --policy-from-file expects a path.
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT
echo "$POLICY_JSON" > "$tmpfile"

gcloud alpha monitoring policies create \
  --project="$PROJECT" \
  --policy-from-file="$tmpfile"

NEW_ALERT=$(gcloud alpha monitoring policies list \
  --project="$PROJECT" \
  --format='value(name)' \
  --filter="displayName=$ALERT_DISPLAY")
echo "✓ Created alert policy: $NEW_ALERT"

echo ""
echo "Done. Verify in Cloud Console:"
echo "  https://console.cloud.google.com/monitoring/uptime?project=$PROJECT"
echo "  https://console.cloud.google.com/monitoring/alerting?project=$PROJECT"
