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

> **⚠️ The command below is the FIRST-TIME / from-scratch bring-up only.**
> It sets the Phase-1 config (`OPENWOP_STORAGE_DSN: memory://`, just the
> session + admin secrets). **Do NOT re-run it to ship a code update to an
> already-live service** — `--env-vars-file` and `--set-secrets` *replace*
> (not merge), so re-running it wipes everything §14 and later steps added.
> The live `openwop-app-backend` currently binds **7 secrets** (session,
> admin, the real `openwop-storage-dsn`, both VAPID keys, `minimax-api-key`,
> `openwop-messaging-bridge-token`) plus OIDC + KMS env — running the
> from-scratch command against it would drop the real DB, the managed
> "Try it free" key, Web Push, and messaging in one shot. To ship new code,
> use **[Redeploying new code to the live service](#redeploying-new-code-to-the-live-service)** below. `gcloud run services describe openwop-app-backend --region us-central1 --format='value(spec.template.spec.containers[0].env)'` is the source of truth for what's bound.

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

### Redeploying new code to the live service

Once the service exists (post-§14, with its full secret + env set), the
**only safe way to ship a code change** is to rebuild the image while
leaving the running config untouched. `gcloud run deploy` preserves the
current revision's env vars and secret bindings for any flag you omit —
so pass **no** `--env-vars-file`, `--set-env-vars`, or `--set-secrets`:

```bash
# From a CLEAN checkout of origin/main — never the shared working tree,
# which may carry another session's uncommitted work into the build
# context. (e.g. `git worktree add --detach /tmp/owp-deploy origin/main`)
gcloud run deploy openwop-app-backend \
  --source apps/workflow-engine \
  --region us-central1 \
  --project openwop-dev \
  --quiet
```

This builds via Cloud Build and rolls a new revision with the new image
+ the *existing* 7 secrets, OIDC/KMS env, Cloud SQL attachment, resource
limits, and `--allow-unauthenticated` IAM all carried forward unchanged.

To **add or rotate** a single binding without disturbing the rest, use the
*merge* flags — `--update-secrets="VAR=secret:latest"` or
`--update-env-vars=...` — never the `--set-*` (full-replace) forms. This is
how `MINIMAX_API_KEY` and `OPENWOP_MESSAGING_BRIDGE_TOKEN` were added after
§14 without a full re-spec. (The §14 `--set-secrets` list is itself now a
partial snapshot — it predates those two bindings, so re-running §14
verbatim would also drop them.)

After any deploy, confirm the binding set survived and the managed tier is
healthy:

```bash
gcloud run services describe openwop-app-backend --region=us-central1 \
  --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -i secret
curl -s https://app.openwop.dev/api/readiness   # {"status":"ready",...} — 503 if a managed key is unconfigured
```

### Feature toggle: warm-instance posture

By default the deploy above uses `min-instances=0` (Cloud Run evicts
the container after ~15 min of no traffic). That's the cheapest
posture (~$0/mo idle) but introduces the cold-start UX the AI chat
surface mitigates with its "Spinning up your demo server…" card.

To eliminate cold starts entirely — at a cost of ~$30-40/month for
a single always-warm `cpu=1, memory=512Mi` instance — flip the
posture **without redeploying** by running this one-liner against
the existing service:

```bash
gcloud run services update openwop-app-backend \
  --region=us-central1 \
  --min-instances=1 \
  --no-cpu-throttling
```

`--no-cpu-throttling` is what makes `min-instances=1` actually
keep the container warm; without it, the idle instance gets CPU
throttled to ~5% and the *first* request still pays a partial
warmup cost.

To revert to the cost-saving posture later:

```bash
gcloud run services update openwop-app-backend \
  --region=us-central1 \
  --min-instances=0 \
  --cpu-throttling
```

The FE's cold-start UX gracefully handles both postures — it
adapts based on `lastSuccessAt` in localStorage rather than
hard-coding cold-start assumptions. So you can flip the toggle
either way without coordinating a FE redeploy.

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

### 13. Firebase Auth — providers + OAuth client redirect URIs

In the Firebase console (`https://console.firebase.google.com/project/openwop-dev/authentication`):
1. Authentication → Sign-in method → enable Google + GitHub providers.
2. Authentication → Settings → Authorized domains: confirm `app.openwop.dev`
   is listed AND `localhost` is listed (the latter auto-added; needed if you
   want to test sign-in via `npm run dev`).
3. Firebase web app must exist BEFORE you can fetch its config in step 15.
   Create it once:
   ```bash
   firebase apps:create WEB "app.openwop.dev" --project=openwop-dev
   ```

The OIDC issuer for Firebase ID tokens is:
- Issuer: `https://securetoken.google.com/openwop-dev`
- Audience: `openwop-dev` (the project id)
- JWKS: `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`

**OAuth client redirect URIs (mandatory manual step):** Firebase Auth's
**Authorized domains** list controls which *origins* can initiate sign-in. The
**redirect URIs** for the underlying OAuth clients are a separate concept that
Firebase only auto-syncs for the default `*.firebaseapp.com` domain. For a
custom domain you must add it manually:

- **Google** — `https://console.cloud.google.com/apis/credentials?project=openwop-dev`.
  Open the "Web client (auto created by Google Service)" entry. Add to
  **Authorized JavaScript origins**: `https://app.openwop.dev`. Add to
  **Authorized redirect URIs**: `https://app.openwop.dev/__/auth/handler`.
  Without this Google rejects sign-in with `Error 400: redirect_uri_mismatch`.
- **GitHub** — `https://github.com/settings/developers` → your "openwop-dev"
  OAuth app. Add `https://app.openwop.dev/__/auth/handler` to the
  **Authorization callback URL** list. (GitHub allows only ONE callback URL
  per app; if you want both the default and custom domains to work, either
  pick one OR create a second GitHub OAuth app.)

Changes propagate near-instantly; Google docs claim up to a few hours.

### 14. Re-deploy Cloud Run with Phase 3 env

The default `--update-env-vars` separator is `,`, but the JWKS URL contains
literal `@` and commas in some hosts, so we use the `^|^` custom-separator
form. If a previous deploy set `OPENWOP_STORAGE_DSN` as a plain env var, it
must be removed first — Cloud Run refuses to swap "plain env" → "secret env"
under the same name.

```bash
# One-time cleanup if step 6 left OPENWOP_STORAGE_DSN as a plain env var.
gcloud run services update openwop-app-backend \
  --region=us-central1 --remove-env-vars=OPENWOP_STORAGE_DSN

# Re-build the image from source so the bundle has the P3 code (Postgres
# adapter, OIDC verifier, KMS bootstrap). `--source` triggers Cloud Build.
gcloud run deploy openwop-app-backend \
  --source ./apps/workflow-engine \
  --region us-central1 --allow-unauthenticated \
  --memory=512Mi --cpu=1 --concurrency=80 --max-instances=10 \
  --port=8080 --timeout=300 \
  --env-vars-file=/tmp/openwop-p3-env.yaml \
  --set-secrets='OPENWOP_SESSION_SECRET=openwop-session-secret:latest,OPENWOP_ADMIN_TOKEN=openwop-admin-token:latest,OPENWOP_STORAGE_DSN=openwop-storage-dsn:latest,OPENWOP_VAPID_PUBLIC_KEY=openwop-vapid-public-key:latest,OPENWOP_VAPID_PRIVATE_KEY=openwop-vapid-private-key:latest' \
  --add-cloudsql-instances=openwop-dev:us-central1:openwop-app-pg
```

**Web Push (PR #174)** binds two additional secrets:
`OPENWOP_VAPID_PUBLIC_KEY` + `OPENWOP_VAPID_PRIVATE_KEY`. Generate the
keypair once at bootstrap with `npx web-push generate-vapid-keys
--json`, then load each value into Secret Manager as in §5. Absent
env vars → push fanout no-ops gracefully (the FE just hides the
"Enable background push" affordance via the `/config` endpoint).

Where `/tmp/openwop-p3-env.yaml` contains:

```yaml
NODE_ENV: production
OPENWOP_BYOK_EPHEMERAL: "true"
OPENWOP_COOKIE_SECURE: "true"
OPENWOP_STRICT_REGISTRY: "true"
OPENWOP_API_KEYS: ""
OPENWOP_INSTALL_PACKS: "core.openwop.ai@1.1.1,…"
OPENWOP_OIDC_ISSUER: "https://securetoken.google.com/openwop-dev"
OPENWOP_OIDC_AUDIENCE: "openwop-dev"
OPENWOP_OIDC_JWKS_URL: "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
OPENWOP_BYOK_KMS_KEY: "projects/openwop-dev/locations/us-central1/keyRings/openwop-byok/cryptoKeys/dek-wrap"
```

**Gotcha**: the bundled image's `package.json` must declare every runtime
dependency the bundled code imports. Esbuild bundles with `--packages=external`
+ the runtime stage does `npm install --omit=dev`, so transitive-only deps
disappear at runtime. After P3 landed, the missing one was `ajv` (used by
`src/host/mcpServerRouter.ts` but only present transitively via
`@openwop/openwop-conformance` dev-dep). Add `ajv` to `dependencies` in
`apps/workflow-engine/backend/typescript/package.json` if you see
`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ajv'` in revision logs.

### 15. Frontend Firebase config + Hosting headers

Fetch the web-app config (step 13 must have created the WEB app first):

```bash
# Find the appId
APP_ID=$(firebase apps:list --project=openwop-dev | awk '/WEB/ {print $4}')
firebase apps:sdkconfig WEB "$APP_ID" --project=openwop-dev
```

Copy `apiKey`, `authDomain`, `projectId` into
`apps/workflow-engine/frontend/react/.env.production`.

**Critical**: `VITE_FIREBASE_AUTH_DOMAIN` must be the SAME custom domain that
serves the SPA (`app.openwop.dev`), NOT the default `*.firebaseapp.com`.
Reason: redirect-based sign-in persists in-flight auth state into the
auth-domain origin's storage. If `authDomain ≠ SPA origin`, the embedded
auth iframe on the SPA is third-party and modern browsers (Safari ITP / Brave
Shields / Firefox TCP) partition its storage → `getRedirectResult` returns
null and sign-in is silently dropped. Firebase Hosting auto-proxies
`/__/auth/*` on custom domains, so this just works once you point authDomain
at the custom domain. See commit `e785890` for the full root-cause analysis.

`firebase.json` Hosting headers (`/index.html` MUST have `Cache-Control:
no-cache, no-store, must-revalidate` AND `Cross-Origin-Opener-Policy:
same-origin-allow-popups` on the SAME source rule — Firebase Hosting only
applies headers from the LAST-matching source per request, so two separate
rules covering the same path will lose one):

```json
{
  "source": "**/!(*.@(js|css|svg|png|jpg|jpeg|webp|avif|ico|woff|woff2|map))",
  "headers": [
    { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
    { "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" }
  ]
}
```

Without the no-cache directive, Firebase Hosting caches `index.html` for ~1
hour, so newly-deployed bundles aren't picked up until the cache expires.

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

## Phase 3 production-rollout gotchas (post-mortem)

Every item below was a real bug we hit during the initial app.openwop.dev
deploy. Documented here so the next bootstrap doesn't have to repeat the
debug cycle.

- **Session cookie name must be `__session`.** Firebase Hosting strips every
  cookie *except* `__session` from requests it forwards to Cloud Run, so
  any other name is silently dropped on every API call. The backend reads
  the cookie name from `OPENWOP_SESSION_COOKIE_NAME` (default `__session`).
  Behind a reverse proxy that doesn't strip cookies, you can override.

- **Redirect-based sign-in beats popup-based** for any auth flow that runs
  in a browser with strict COOP defaults. `signInWithPopup`'s polling of
  `window.closed` triggers `Cross-Origin-Opener-Policy would block` warnings
  on every poll, persistent through the auth flow. The redirect flow has no
  popup and no warnings. The trade-off is two full page reloads for the
  link-account flow (Google rejected + Google signed in to complete the
  link).

- **`Cross-Origin-Opener-Policy: same-origin-allow-popups`** belongs on
  every Hosting response, but `same-origin` (the browser default for
  documents without an explicit header) blocks popup auth. The redirect
  flow doesn't strictly need this; we set it anyway as defense in depth
  for adopters who fork the SPA and revert to popups.

- **`authDomain` MUST be the SPA's custom domain.** See step 15 above.
  Without this, `getRedirectResult` returns null after a successful OAuth
  round-trip because the auth state was persisted into the default-domain
  origin's partitioned third-party storage.

- **Modal portal**: any modal whose JSX lives inside a `position: sticky`
  + `backdrop-filter` ancestor must portal out to `document.body` via
  `createPortal`. Both properties create stacking contexts that cap the
  modal's z-index. The `<SignInButton>` modal originally rendered behind
  `<main>` because the `<header>` had both. Fix: portal both the sign-in
  and delete-account modals out.

- **Rules of Hooks**: any `useEffect` after a conditional return is a
  ticking time bomb that detonates on the first render where the
  conditional flips. `DemoHostBanner` had `if (user) return null;` BEFORE
  a `useEffect` and crashed the whole SPA the moment a user signed in.
  Eslint-plugin-react-hooks catches this if enabled; we don't ship a
  lint config in this repo yet so use it locally
  (`npx eslint --plugin react-hooks ...`) before sharing screenshots.

- **Local dev points at prod by default.** `apps/workflow-engine/frontend/
  react/vite.config.ts` proxies `/api/**` to `https://app.openwop.dev` so
  `npm run dev` in the frontend dir works end-to-end against the deployed
  backend without spinning up a local Postgres / KMS / Firebase Auth. The
  proxy rewrites the `__session` cookie's Domain to `localhost` so cookies
  travel. Override with `OPENWOP_DEV_PROXY_TARGET=http://localhost:8080`
  to point at a locally-running backend.

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
