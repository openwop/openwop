# Runbook: Mint an API key for the OpenWOP conformance suite

> **Owner:** Host operators running `@openwop/openwop-conformance` against a deployed server.
> **Why this exists:** The 21 end-to-end conformance scenarios (the ones that POST `/v1/runs` and assert on `RunSnapshot` + the run event log) require `OPENWOP_API_KEY` set in the environment. Each host stack mints its keys differently — admin-SDK calls, IAM-issued tokens, JWT signing, internal keystores. Per the MyndHyve adoption-feedback record (`docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md` §B.2), this minting friction blocks the otherwise-passing conformance scenarios.
>
> **Why NOT an SDK helper:** The credential-acquisition path is fundamentally per-host. A `@openwop/conformance-sdk/mint-test-key` export would either (a) be a stub that delegates back to the operator's per-host minting (no value over a runbook) or (b) hard-code one vendor's minting flow (e.g., gcloud + Firebase Auth) and break the next adopter. This runbook documents the suite's API-key requirements + the per-host minting recipe for each reference host, so operators can fork the recipe for their own stack.

---

## What the conformance suite needs

The suite reads `OPENWOP_API_KEY` from `process.env` via `conformance/src/lib/driver.ts`. A valid key MUST:

1. **Authenticate** — the host's `checkAuth` middleware accepts the bearer.
2. **Be scoped to a test workspace / tenant** — the suite creates runs, fetches event logs, queries debug bundles. Conformance MUST NOT pollute a production tenant.
3. **Live long enough for the full suite** — `npx vitest run` typically takes 90–120 seconds against a live host; short-lived JWTs (5-minute TTL) work; sub-minute TTLs cause mid-suite expiration.
4. **Permit the seam routes** — when the host advertises `/v1/host/sample/test/*` seams (`mock-ai/program`, `evaluate-model-capability-gate`, `emit-envelope-reliability`, `surface`, `runs/:runId/events`, etc.), the conformance key MUST authorize against them. Operators that gate sample-seam routes behind a separate role (good practice) MUST grant the conformance key that role.

The suite does NOT need:

- Production-tenant access.
- Admin-level scopes (no workspace creation, no user provisioning).
- Long-lived persistence — re-minting between runs is fine.

---

## Per-host minting recipes

### Reference workflow-engine sample (TypeScript / in-memory)

The reference host runs with `OPENWOP_API_KEY` as the canonical static bearer:

```bash
export OPENWOP_API_KEY="conformance-static-key-for-local-dev"
# then in another terminal:
OPENWOP_API_KEY="conformance-static-key-for-local-dev" \
  OPENWOP_TEST_SEAM_ENABLED=true \
  node apps/workflow-engine/backend/typescript/lib/index.js
# in the conformance terminal:
OPENWOP_BASE_URL=http://localhost:3000 OPENWOP_API_KEY="conformance-static-key-for-local-dev" \
  npx vitest run --cwd conformance
```

Static API key + matching `OPENWOP_API_KEY` in the suite's environment. No minting required. Use this pattern for local development + the in-tree CI conformance run.

### Postgres reference host

Same shape as the in-memory reference — static bearer set via `OPENWOP_API_KEY` env var when the host boots, matching value in the conformance environment. The `examples/hosts/postgres/test/oauth2-oidc.test.ts` covers the JWT-validator path for non-static bearers; conformance against the host can use either.

### MyndHyve workflow-runtime (gcloud + Firebase Auth + admin-SDK)

MyndHyve's minting script (`scripts/mint-conformance-api-key.cjs`) requires:

1. `gcloud auth login` (Application Default Credentials).
2. Admin-SDK access to the project (typically a service-account JSON or workspace member with `firebase.admin` role).
3. A pre-provisioned conformance workspace (e.g., `ws-personal-<uid>`).

The script generates a custom Firebase Auth token bound to the workspace and exchanges it for a short-lived API key the host's `checkAuth` accepts.

```bash
# in MyndHyve repo root:
gcloud auth login   # OR `gcloud auth application-default login`
node scripts/mint-conformance-api-key.cjs --workspace ws-personal-${USER}

# script prints the API key; capture into env:
export OPENWOP_API_KEY="<output-from-script>"
export OPENWOP_BASE_URL="https://api.myndhyve.ai"
npx vitest run --cwd conformance
```

**Common failure mode (from the MyndHyve feedback record):** `invalid_rapt` reauth error during the gcloud step. Resolution: `gcloud auth login` (NOT `gcloud auth application-default login`) re-triggers the OAuth flow with the right scopes. After the OAuth flow completes, re-run the mint script.

### Other hosts (template)

For a host that doesn't fit the above patterns:

1. **Identify the host's auth mechanism.** Static bearer? JWT? OAuth2 client-credentials? mTLS cert? Read the host's `checkAuth` or equivalent.
2. **Provision a test workspace / tenant.** Out of band — typically a one-time setup the operator runs once per environment.
3. **Generate a short-lived credential bound to that workspace.** The mechanism varies: a JWT-signing script for OAuth2 hosts, a static key for simpler hosts, a cert + private-key pair for mTLS hosts.
4. **Export the credential as `OPENWOP_API_KEY`.** The conformance suite reads ONLY this env var; if the host uses a non-bearer scheme (e.g., mTLS), set additional env vars per `conformance/README.md` §"Optional environment flags" (e.g., `OPENWOP_TEST_MTLS_CERT_PATH`).
5. **Verify the key works:**

```bash
curl -H "Authorization: Bearer $OPENWOP_API_KEY" "$OPENWOP_BASE_URL/.well-known/openwop" | jq .protocolVersion
# expected: "1.0" (or "1.1" for hosts that advertise the v1.1 protocol-version bump)
```

If the discovery call returns 401, the key isn't valid; if it returns 403, the key authenticates but lacks the required scope; if it returns the protocolVersion field, you're set.

---

## Validation: confirm the auth-blocked scenarios now pass

After the API key mints, re-run the previously-blocked end-to-end suite:

```bash
OPENWOP_BASE_URL=$OPENWOP_BASE_URL OPENWOP_API_KEY=$OPENWOP_API_KEY \
  npx vitest run --cwd conformance \
    src/scenarios/envelope-reasoning-secret-redaction.test.ts \
    src/scenarios/envelope-refusal-shape.test.ts \
    src/scenarios/envelope-recovery-applied.test.ts \
    src/scenarios/envelope-retry-attempted.test.ts \
    src/scenarios/envelope-retry-exhausted.test.ts \
    src/scenarios/envelope-truncated.test.ts \
    src/scenarios/envelope-completion-distinguishes-truncation.test.ts \
    src/scenarios/envelope-truncation-cap-exhaustion.test.ts \
    src/scenarios/model-capability-substituted.test.ts \
    src/scenarios/model-capability-insufficient.test.ts \
    src/scenarios/node-module-required-capabilities-shape.test.ts \
    src/scenarios/envelope-reasoning-shape.test.ts \
    src/scenarios/envelope-tier-one-subset-static.test.ts \
    src/scenarios/envelope-variant-discriminator-static.test.ts
```

**Expected post-mint result (per the MyndHyve §E record):** 83 pass / 0 fail / 4 honest skip. The 4 skips are `node-module-required-capabilities-shape.test.ts` requiring the optional `/v1/host/sample/node-catalog` endpoint — hosts that don't expose it soft-skip cleanly. If your host DOES expose the catalog, all 87 should pass.

---

## If something goes wrong

- **401 Unauthorized on every scenario:** the `OPENWOP_API_KEY` value doesn't match what the host's `checkAuth` accepts. Double-check the key was captured correctly (`echo $OPENWOP_API_KEY | wc -c` should match the expected length).
- **403 Forbidden on seam routes (`/v1/host/sample/test/*`):** the key authenticates but lacks the conformance role. Update the minting script to attach the correct claim / role / scope.
- **401 after ~5 minutes of suite progress:** the key TTL is too short. Bump the minting script's expiration claim OR re-run the suite with the key freshly minted right before invocation.
- **Suite hangs on `mock-ai/program` POSTs:** the seam isn't enabled. Set `OPENWOP_TEST_SEAM_ENABLED=true` on the host process (NOT the conformance environment).
- **`invalid_rapt` during gcloud:** `gcloud auth login` (not `application-default login`); see MyndHyve recipe above.

---

## Related

- `conformance/README.md` — full env-var reference for the suite.
- `docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md` §B.2 — the MyndHyve friction report that motivated this runbook.
- `examples/hosts/postgres/test/oauth2-oidc.test.ts` — JWT-validator path for OAuth2-CC / OIDC hosts.
- `spec/v1/auth.md` — the canonical auth-profile predicates the keys are scoped against.
