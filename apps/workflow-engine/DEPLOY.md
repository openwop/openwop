# workflow-engine — Public deployment bootstrap

Reproducible recipe for the live demo at `app.openwop.dev`. Captures every
gcloud / firebase / DNS step that brought up the Phase 1 + Phase 2 stack
so future maintainers can rebuild it from scratch in <30 min.

Read alongside `DEPLOY-SMOKE.md` (the live-deploy verification sequence).

## Prerequisites

- GCP project `openwop-dev` exists. Owner = `admin@myndhyve.ai`.
- Firebase project linked to `openwop-dev` (hosting target).
- Domain `openwop.dev` controlled at GoDaddy with editable DNS.
- gcloud CLI ≥ 510, firebase CLI ≥ 15, openssl, jq, node ≥ 22 locally.

```bash
gcloud config set account admin@myndhyve.ai
gcloud config set project openwop-dev
```

## 1. Attach a billing account

Cloud Run + Artifact Registry + Cloud Build all require billing.

```bash
gcloud beta billing accounts list                       # find an account
gcloud beta billing projects link openwop-dev \
  --billing-account=<ACCOUNT_ID>
```

## 2. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  firebasehosting.googleapis.com
```

## 3. Override the `allowedPolicyMemberDomains` org policy

The myndhyve.ai org policy denies `allUsers` IAM bindings, which blocks
public Cloud Run invocations. Override at the project level (does not
affect the org-wide policy).

```bash
cat > /tmp/allow-all-users.yaml <<'EOF'
constraint: constraints/iam.allowedPolicyMemberDomains
listPolicy:
  allValues: ALLOW
EOF
gcloud resource-manager org-policies set-policy /tmp/allow-all-users.yaml \
  --project=openwop-dev
# Propagation takes ~2 min. Test with: gcloud run services add-iam-policy-binding
```

## 4. Grant the Compute SA the Cloud Build roles

`gcloud run deploy --source` uses Cloud Build, which runs as the default
Compute SA (`<project-number>-compute@developer.gserviceaccount.com`).
It needs to read source, push images, write logs, AND access deploy-time
secrets.

```bash
PROJECT_NUMBER=$(gcloud projects describe openwop-dev --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for role in \
  roles/storage.objectViewer \
  roles/artifactregistry.writer \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding openwop-dev \
    --member="serviceAccount:$SA" \
    --role="$role" --condition=None
done
```

## 5. Generate + push session/admin secrets

```bash
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_TOKEN=$(openssl rand -hex 16)

echo -n "$SESSION_SECRET" | gcloud secrets create openwop-session-secret --data-file=-
echo -n "$ADMIN_TOKEN"    | gcloud secrets create openwop-admin-token   --data-file=-

# Save ADMIN_TOKEN — Cloud Scheduler step 9 needs it.
echo "ADMIN_TOKEN=$ADMIN_TOKEN"

# Grant the runtime SA secret-accessor on both secrets
for secret in openwop-session-secret openwop-admin-token; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 6. Deploy the Cloud Run backend

The Dockerfile lives at `apps/workflow-engine/Dockerfile` and expects the
build context at `apps/workflow-engine/` (so it can COPY both
`backend/typescript/...` and `providers.json`).

```bash
# Pull latest pack versions from the registry so we always deploy the
# most recently-patched packs (e.g., http@1.1.2 with the deterministic
# idempotency-key safety-fix, not http@1.1.1).
PACKS=$(for p in ai data http mcp triggers integration a2a agents crypto db files flow hitl messaging obs rag storage; do
  v=$(curl -s "https://packs.openwop.dev/v1/packs/core.openwop.$p/index.json" | jq -r '.latest')
  echo "core.openwop.$p@$v"
done | paste -sd,)

cat > /tmp/openwop-env.yaml <<EOF
NODE_ENV: production
OPENWOP_STORAGE_DSN: memory://
OPENWOP_BYOK_EPHEMERAL: "true"
OPENWOP_COOKIE_SECURE: "true"
OPENWOP_STRICT_REGISTRY: "true"
OPENWOP_API_KEYS: ""
OPENWOP_INSTALL_PACKS: "$PACKS"
EOF

gcloud run deploy openwop-app-backend \
  --source apps/workflow-engine \
  --region us-central1 \
  --allow-unauthenticated \
  --memory=512Mi --cpu=1 --concurrency=80 --max-instances=10 \
  --port=8080 --timeout=300 \
  --env-vars-file=/tmp/openwop-env.yaml \
  --set-secrets="OPENWOP_SESSION_SECRET=openwop-session-secret:latest,OPENWOP_ADMIN_TOKEN=openwop-admin-token:latest"

# Confirm public invocation works (org-policy override from step 3)
gcloud run services add-iam-policy-binding openwop-app-backend \
  --region=us-central1 --member="allUsers" --role="roles/run.invoker"
```

## 7. Firebase Hosting + custom domain

```bash
# Create the new hosting site + bind the `app` target
firebase hosting:sites:create app-openwop-dev --project openwop-dev
firebase target:apply hosting app app-openwop-dev --project openwop-dev

# Build the SPA. The production env vars (VITE_OPENWOP_BASE_URL=/api,
# VITE_OPENWOP_AUTH_MODE=cookie) live in `.env.production` at the
# frontend root and Vite auto-loads them. `vite.config.ts` asserts
# baseUrl is non-default in production mode, so a missing `.env.production`
# aborts the build instead of silently shipping the dev fallback.
( cd apps/workflow-engine/frontend/react && npm run build )

# Deploy
firebase deploy --only hosting:app --project openwop-dev

# Attach custom domain via REST API (gcloud doesn't have a Firebase
# Hosting custom-domains command in 510)
TOKEN=$(gcloud auth print-access-token)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: openwop-dev" \
  -H "content-type: application/json" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/openwop-dev/sites/app-openwop-dev/customDomains?customDomainId=app.openwop.dev" \
  -d '{}'

# The response contains DNS records you need to add at GoDaddy.
# Verify ownership TXT + the CNAME / _acme-challenge TXT propagate:
dig +short app.openwop.dev CNAME
dig +short TXT _acme-challenge.app.openwop.dev

# Re-poll status (`cert.state` → `CERT_ACTIVE` when Let's Encrypt finishes):
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: openwop-dev" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/openwop-dev/sites/app-openwop-dev/customDomains/app.openwop.dev" | jq '{hostState, ownershipState, "cert.state": .cert.state}'
```

## 8. Firebase Hosting → Cloud Run invoker grant

The Firebase Hosting service agent (auto-provisioned on first deploy)
needs `run.invoker` on the backend service. The agent doesn't always
exist at deploy time — grant the `firebase-adminsdk` SA as a fallback
that Firebase Hosting uses for `run:` rewrites:

```bash
gcloud run services add-iam-policy-binding openwop-app-backend \
  --region=us-central1 \
  --member="serviceAccount:firebase-adminsdk-fbsvc@openwop-dev.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## 9. Cloud Scheduler — daily cleanup cron

```bash
ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=openwop-admin-token)
gcloud scheduler jobs create http openwop-app-daily-cleanup \
  --location=us-central1 \
  --schedule="0 3 * * *" --time-zone="UTC" \
  --uri="https://app.openwop.dev/api/v1/host/sample/admin/cleanup" \
  --http-method=POST \
  --headers="Authorization=Bearer ${ADMIN_TOKEN}" \
  --description="Daily wipe of expired anon-session BYOK secrets + tenant trackers" \
  --attempt-deadline=60s --max-retry-attempts=3

# Test-fire (optional)
gcloud scheduler jobs run openwop-app-daily-cleanup --location=us-central1
```

## 10. Smoke

```bash
bash apps/workflow-engine/DEPLOY-SMOKE.md  # the seven-step sequence
# Or run the curl commands from that file inline.
```

## Phase 3 — Signed-in tier (Firebase Auth + Cloud SQL + KMS)

Phase 3 layers persistent storage on top of the anon cookie tier. Anonymous
visitors keep working exactly as before; signed-in users (Google or
GitHub via Firebase Auth) get persistent runs + workflows + BYOK secrets,
KMS-encrypted at rest.

### 11. Cloud SQL Postgres

```bash
# Create a small Postgres 15 instance (~$10/mo at the cheapest tier).
gcloud sql instances create openwop-app-pg \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=10 \
  --backup-start-time=04:00 \
  --availability-type=ZONAL

# Create the application database + user.
gcloud sql databases create openwop --instance=openwop-app-pg
gcloud sql users create openwop_app --instance=openwop-app-pg \
  --password="$(openssl rand -base64 32 | tr -d '+/=')"

# Connection string lives in Secret Manager.
DB_PASSWORD=$(gcloud sql users list --instance=openwop-app-pg \
  --filter='name:openwop_app' --format='value(name)')  # placeholder; copy from the create command output
INSTANCE_CONN=$(gcloud sql instances describe openwop-app-pg \
  --format='value(connectionName)')
DSN="postgresql://openwop_app:${DB_PASSWORD}@/openwop?host=/cloudsql/${INSTANCE_CONN}"
printf '%s' "$DSN" | gcloud secrets create openwop-storage-dsn --data-file=-
```

### 12. KMS key for BYOK envelope encryption

```bash
gcloud kms keyrings create openwop-byok --location=us-central1
gcloud kms keys create dek-wrap \
  --keyring=openwop-byok --location=us-central1 \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time="$(date -u -v+90d '+%Y-%m-%dT%H:%M:%SZ')"

# Grant the Cloud Run runtime SA encrypt/decrypt on the key.
RUNTIME_SA=$(gcloud run services describe openwop-app-backend \
  --region=us-central1 --format='value(spec.template.spec.serviceAccountName)')
gcloud kms keys add-iam-policy-binding dek-wrap \
  --keyring=openwop-byok --location=us-central1 \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
```

### 13. Firebase Auth — providers + audience

In the Firebase console (`https://console.firebase.google.com/project/openwop-dev/authentication`):
1. Authentication → Sign-in method → enable Google + GitHub providers.
2. Authentication → Settings → Authorized domains: add `app.openwop.dev`.

The OIDC issuer for Firebase ID tokens is:
- Issuer: `https://securetoken.google.com/openwop-dev`
- Audience: `openwop-dev` (the project id)
- JWKS: `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`

### 14. Re-deploy Cloud Run with Phase 3 env

```bash
# Connect Cloud SQL via the unix socket.
gcloud run services update openwop-app-backend \
  --region=us-central1 \
  --add-cloudsql-instances=openwop-dev:us-central1:openwop-app-pg \
  --update-secrets=OPENWOP_STORAGE_DSN=openwop-storage-dsn:latest \
  --update-env-vars=\
OPENWOP_OIDC_ISSUER=https://securetoken.google.com/openwop-dev,\
OPENWOP_OIDC_AUDIENCE=openwop-dev,\
OPENWOP_OIDC_JWKS_URL=https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com,\
OPENWOP_BYOK_KMS_KEY=projects/openwop-dev/locations/us-central1/keyRings/openwop-byok/cryptoKeys/dek-wrap
```

### 15. Frontend Firebase config

```bash
# Read the web-app config from the Firebase console:
firebase apps:sdkconfig WEB --project=openwop-dev > /tmp/fb-web.json
# Add VITE_FIREBASE_API_KEY / VITE_FIREBASE_AUTH_DOMAIN / VITE_FIREBASE_PROJECT_ID
# to apps/workflow-engine/frontend/react/.env.production and rebuild.
```

### 16. Smoke the Phase 3 surface

```bash
# Anon-tier still works (no auth).
curl -i -X POST https://app.openwop.dev/api/v1/runs \
  -H 'content-type: application/json' \
  -d '{"workflowId":"sample.demo.uppercase","tenantId":"","inputs":{"text":"hi"}}'

# Sign in via the SPA, copy the ID token from devtools, then:
curl -i https://app.openwop.dev/api/v1/runs \
  -H "authorization: Bearer <ID_TOKEN>"

# BYOK secret set as signed-in user
curl -i -X POST https://app.openwop.dev/api/v1/host/sample/byok/secrets \
  -H "authorization: Bearer <ID_TOKEN>" \
  -H 'content-type: application/json' \
  -d '{"credentialRef":"TEST_KEY","value":"sk-test"}'
```

## Roll-forward a new pack version

Step 6's `PACKS=$(...)` block always resolves `latest` from the registry,
so re-running steps 6–7 picks up freshly-published pack versions
automatically. Use this when a pack ships a safety fix (e.g.,
`core.openwop.http@1.1.2` after the deterministic idempotency-key fix
in commit `49dd801`).

## Roll-back

```bash
# Cloud Run keeps every revision. Roll back via traffic split:
gcloud run services update-traffic openwop-app-backend \
  --region=us-central1 --to-revisions=openwop-app-backend-00001-8hd=100
# Firebase Hosting keeps prior versions too:
firebase hosting:rollback --site=app-openwop-dev --project openwop-dev
```

## Decommissioning

```bash
gcloud scheduler jobs delete openwop-app-daily-cleanup --location=us-central1
gcloud run services delete openwop-app-backend --region=us-central1
firebase hosting:sites:delete app-openwop-dev --project openwop-dev
# Remove the custom-domain entry via the REST API DELETE on the same
# /customDomains/app.openwop.dev resource.
# Remove the GoDaddy DNS records (CNAME app, TXT _acme-challenge.app).
# Optionally restore the org policy if you decommission permanently:
gcloud resource-manager org-policies delete \
  constraints/iam.allowedPolicyMemberDomains --project=openwop-dev
# And destroy the secrets:
gcloud secrets delete openwop-session-secret
gcloud secrets delete openwop-admin-token
```
