# Handoff → MyndHyve session: adopting the protocol-extension RFCs (0045–0054)

**To:** the Claude Code session working on the MyndHyve app (`api.myndhyve.ai`).
**From:** the openwop spec session (2026-05-25).
**Status of the openwop side:** all 10 RFCs (0045–0054) are merged to `openwop@main`, gate-green, fully spec'd (capability schemas, events, SECURITY invariants, conformance scenarios, and `/v1/host/sample/*` test seams). Nothing more is needed on the spec side.

> **🎉 DONE (2026-05-25) — the cohort is `Accepted`.** MyndHyve's `workflow-runtime` advertises all five capability blocks live on `https://api.myndhyve.ai/.well-known/openwop` (independently curl-verified) and `@openwop/openwop-conformance@1.6.0` reported **28 PASS / 0 FAIL** against it (revision `workflow-runtime-00211-69w`, commit `85275cdf87972e02c2e588cba481415f3e0edb15`). On that verified run the 8 shipped RFCs (0045/0046/0047/0048/0049/0051/0052/0053) graduated `Active → Accepted` per `RFCS/0001` §"Promotion to Accepted" — see `INTEROP-MATRIX.md` + `docs/openwop-adoption/0045-0054-cohort-summary.md`. **Nothing further is required.** RFC 0050 (SAML/SCIM) + 0054 (run-diff) remain `Draft` per your documented opt-outs; the checklist below is retained for reference and for any host wanting to wire 0050's SAML ACS or 0054's run-diff UI.

## What you need to do

> **The remaining path for each RFC is `Draft → Active → Accepted`, gated on MyndHyve (or another non-steward host) implementing it and the conformance suite reflecting it.**

Concretely, per RFC, that means three things:

1. **Advertise** the capability/profile on `GET /.well-known/openwop` — *honestly* (advertise only what you actually honor; partial/Tier-1 advertisement is fine and is how the openwop side flips `Draft → Active`).
2. **Implement** the host-side behavior the RFC normates.
3. **Wire the conformance test seam** (the `POST/GET /v1/host/sample/*` endpoint listed below) so the capability-gated behavioral scenario stops soft-skipping and actually passes. These seams are conformance-only — return `404`/`403` in production unless an env-gate is set. They're catalogued in `spec/v1/host-sample-test-seams.md` §"Open seams (light up when fixtures ship)".

Then run `npx @openwop/openwop-conformance@latest` against `api.myndhyve.ai` and report the pass + the advertisement evidence (revision id + commit). Per `RFCS/0001-rfc-process.md` §"Promotion to Accepted", a non-steward host advertising + passing the scenario is what graduates each RFC `Active → Accepted` on the openwop side.

## Per-RFC checklist

### Tier 1 — connectors & credentials (highest leverage; converts your 38 `vendor.myndhyve.*` packs into portable artifacts)

| RFC | Advertise | Implement | Wire seam → scenario |
|---|---|---|---|
| **0046 `host.credentials`** | `capabilities.credentials { supported, scopes:['user','workspace','tenant'], encryptionAtRest, rotation:'two-key-overlap', sharing }` | Map your workspace BYOK vault + `users/{uid}/secrets` behind the resolver. Inject resolved material into the node sandbox **only** — never into inputs/variables/events/debug-bundle/replay (SECURITY invariant `credential-payload-redaction`). Two-key-overlap rotation. | `POST /v1/host/sample/credentials/echo` → `credential-payload-redaction.test.ts` (+ `credentials-capability-shape.test.ts` already passes on advertisement) |
| **0047 `host.oauth`** | `capabilities.oauth { supported, grants:['authorization_code','refresh_token'], providers:[…slack,google,…] }` | Run the authorization-code + refresh dance host-side; store tokens as `host.credentials` (0046) entries; resolve as in-sandbox bearer. Emit `connector.authorized` / `connector.auth_expired` (carry the credential **ref**, never the token). | `POST /v1/host/sample/oauth/connector-echo` → `oauth-connector-redaction.test.ts` |
| **0045 connector manifest** | (manifest-level, not a capability) | Re-emit a `vendor.myndhyve.*` integration pack with a `connector` block (`actions[].typeId` MUST resolve to real nodes; `auth` → 0046/0047). Install it on a **second** host to fire the GOVERNANCE.md federation tripwire. | `connector-manifest-validity.test.ts` is server-free and already passes; the win is publishing a real connector pack. |

### Tier 2 — multi-tenant identity & governance (your workspaces / RBAC / approvals)

| RFC | Advertise | Implement | Wire seam → scenario |
|---|---|---|---|
| **0048 identity triple** | Workspace-scoped discovery (reuses `capabilities.discovery.authScoped`) | Populate `RunSnapshot.owner { tenant, workspace?, principal? }` (opaque, non-PII `principal` — **MUST** per `auth.md`) + echo on `run.started`. Fail-closed cross-workspace isolation (`run_forbidden`). | `GET /v1/host/sample/identity/owned-run` + `POST /v1/host/sample/identity/cross-workspace-read` → `cross-workspace-isolation.test.ts` (`identity-owner-shape.test.ts` is server-free, already passes) |
| **0049 RBAC** | `capabilities.authorization { supported, failClosed:true, roles:[{role,scopes[]}] }` | Map your `RBACService` (owner/admin/editor/viewer, fail-closed) behind the contract; emit `authorization.decided { principal, action, resource, allowed, reason }`; feed your CMS audit log. Absent/unseeded role ⇒ **deny** (SECURITY invariant `authorization-fail-closed`). | `POST /v1/host/sample/authorization/decide` → `authorization-fail-closed.test.ts` (+ `authorization-roles-shape.test.ts` on advertisement) |
| **0050 SAML / SCIM** | `auth.profiles += ['openwop-auth-saml','openwop-auth-scim']` | SAML assertion validation (signature, `alg:none` reject, wrapping reject, validity windows) → `principal`; SCIM `/Users`+`/Groups` → principal/role upserts; deactivate ⇒ fail-closed deny. | `POST /v1/host/sample/auth/saml/validate` + `…/scim/provision`, gated on `OPENWOP_TEST_SAML_IDP_URL` / `OPENWOP_TEST_SCIM_URL` → `auth-saml-profile.test.ts` / `auth-scim-profile.test.ts` |
| **0051 approval gate** | (node registration; peerDep `authorization: 'supported'`) | Re-express your CMS approval gate + force-publish as `core.openwop.governance.approvalGate`. Request via `interrupt.requested {kind:'approval'}`; outcomes via `approval.granted/rejected/overridden` (`overridden` MUST carry `reason` + audit). `cms.page.force_published` → `approval.overridden`. | `POST /v1/host/sample/governance/approval-gate` → `approval-gate-flow.test.ts` (`approval-gate-events.test.ts` is server-free, already passes) |

### Tier 3 — runtime reliability & tooling

| RFC | Advertise | Implement | Wire seam → scenario |
|---|---|---|---|
| **0052 scheduling** | `capabilities.scheduling { supported, cron, delayed, calendar?, maxFutureHorizon }` | Map your routine scheduler onto the `schedule` trigger: durable scheduled runs, **exactly once per tick**, `maxFutureHorizon` (`schedule_horizon_exceeded`), a documented missed-tick policy (no backlog flood). | `POST /v1/host/sample/scheduling/tick` → `scheduling-cron-fires-once.test.ts` (+ `scheduling-capability-shape.test.ts`) |
| **0053 dead-letter** | `capabilities.deadLetter { supported, retentionDays }` | Add a DLQ sink keyed by workspace: on retry exhaustion emit `run.dead_lettered { runId, nodeId?, reason, attempts }`; keep the run **fork-eligible** (RFC 0011) for `retentionDays`; purge after. | `POST /v1/host/sample/deadletter/exhaust` → `deadletter-retry-exhaustion.test.ts` (+ `deadletter-capability-shape.test.ts`) |
| **0054 run diff** | (read endpoint) | `GET /v1/runs/{runId}:diff?against={otherRunId}` → deterministic `{ divergedAtSeq, eventDiffs[], stateDiff }`. *(Already implemented on the openwop reference side; mirror it in your workflow studio for run-vs-fork debugging.)* | `run-diff-*.test.ts` |

## Ground rules (all RFCs honor these)

- **Honest advertisement.** Advertise a capability only when you fully honor its contract. Tier-1/partial advertisement is fine and is exactly what graduates `Draft → Active` (your existing pattern, e.g. RFC 0034 `observability.testSeams.otelScrape`).
- **Additive.** Every one of these is a new optional capability/event/profile/endpoint — nothing breaks your existing v1 conformance pass.
- **Redaction-safe.** No credential/token/PII crosses the wire, enters events, debug bundles, or replay state. The `credential-payload-redaction` invariant (0046/0047) and the opaque-`principal` rule (0048) are hard MUSTs.
- **Fail-closed.** Credential/role/authorization absence denies, never opens (matches your RBAC default).
- **Seams are conformance-only.** The `/v1/host/sample/*` endpoints return `404`/`403` in production unless env-gated; never expose them to real tenants.

## Reference (on `openwop@main`)

- RFCs: `RFCS/0045-…` through `RFCS/0053-…` (+ `0054`); each has a per-RFC implementation note + acceptance checklist.
- Capability schema: `schemas/capabilities.schema.json` (`credentials`, `oauth`, `authorization`, `scheduling`, `deadLetter` blocks).
- Events: `schemas/run-event-payloads.schema.json` + `run-event.schema.json` (`connector.*`, `authorization.decided`, `approval.*`, `run.dead_lettered`).
- Spec prose: `spec/v1/host-capabilities.md` (§host.credentials/oauth/scheduling/deadLetter), `spec/v1/auth.md` (§Identity claims, §Role-based authorization), `spec/v1/auth-profiles.md` (SAML/SCIM/LDAP), `spec/v1/interrupt-profiles.md` (§approvalGate).
- Test seams: `spec/v1/host-sample-test-seams.md` §"Open seams".
- Promotion process: `RFCS/0001-rfc-process.md` §"Promotion to Accepted".
