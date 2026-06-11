# MyndHyve adoption — the 0045–0054 protocol-extension cohort

**Status: ✅ Accepted (2026-05-25).** This is the openwop-side consolidation record for MyndHyve's adoption of the 8-RFC protocol-extension cohort. It is an **index, not the source of truth** — the canonical, per-row conformance evidence lives in [`../../INTEROP-MATRIX.md`](../../INTEROP-MATRIX.md) §"Capability adoption — RFC 0045–0054 cohort (MyndHyve)". This file exists because `INTEROP-MATRIX.md`, `README.md`, `CHANGELOG.md`, `docs/myndhyve-rfc-adoption-handoff.md`, and RFCs 0045–0053 reference it by name; it consolidates the cohort story in one place.

## What graduated

On a single verified conformance run, **8 RFCs promoted `Active → Accepted`** per [`../../RFCS/0001-rfc-process.md`](../../RFCS/0001-rfc-process.md) §"Promotion to Accepted" — the first time the non-steward-host validation gate fired for a whole cohort.

| RFC                         | Capability advertised (live, curl-verified)                               | Conformance evidence                                                    | Status      |
| --------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------- |
| **0045** connector manifest | pack `connector` block (typed actions + auth)                             | `connector-manifest-validity.test.ts` PASS                              | Accepted ✅ |
| **0046** `host.credentials` | `capabilities.credentials.{supported,scopes,encryptionAtRest,sharing}`    | `credential-payload-redaction.test.ts` via the `credentials/echo` seam  | Accepted ✅ |
| **0047** `host.oauth`       | `capabilities.oauth.{supported,grants,providers}`                         | `oauth-connector-redaction.test.ts` via the `oauth/connector-echo` seam | Accepted ✅ |
| **0048** identity triple    | `RunSnapshot.owner` + `secrets.scopes` gains `workspace`                  | `cross-workspace-isolation.test.ts` via the `identity/*` seams          | Accepted ✅ |
| **0049** RBAC               | `capabilities.authorization.{supported,failClosed,roles}`                 | `authorization-fail-closed.test.ts` via the `authorization/decide` seam | Accepted ✅ |
| **0051** approval gate      | `core.openwop.governance.approvalGate` + `approval.*` events              | `approval-gate-flow.test.ts` via the `governance/approval-gate` seam    | Accepted ✅ |
| **0052** scheduling         | `capabilities.scheduling.{supported,cron,delayed,calendar}`               | `scheduling-cron-fires-once.test.ts` via the `scheduling/tick` seam     | Accepted ✅ |
| **0053** dead-letter        | `capabilities.deadLetter.{supported,retentionDays}` + `run.dead_lettered` | `deadletter-retry-exhaustion.test.ts` via the `deadletter/exhaust` seam | Accepted ✅ |

## Evidence (canonical copy in `INTEROP-MATRIX.md`)

- **Suite:** `@openwop/openwop-conformance@1.6.0`
- **Host:** MyndHyve `workflow-runtime`, Cloud Run revision `workflow-runtime-00211-69w`, commit `85275cdf87972e02c2e588cba481415f3e0edb15`
- **Discovery:** `https://api.myndhyve.ai/.well-known/openwop` (bare host — `/workflow-runtime` is **not** a path prefix; openwop-side curl-verified 2026-05-25, all 5 cohort capability blocks present + `supported: true`)
- **Result:** **28 cohort scenarios PASS / 0 FAIL** across RFCs 0045/0046/0047/0048/0049/0051/0052/0053 (12 cohort test files)

## Not in this cohort

- **RFC 0050 (SAML/SCIM)** + **RFC 0054 (run-diff)** remain `Draft` — MyndHyve documented opt-outs (no SSO infrastructure / time-travel-debug-UI demand). The RFC 0050 synthetic-IdP fixture is bundled in the conformance suite; both graduate when a non-steward host advertises them or MyndHyve's internal demand triggers implementation. See [`../myndhyve-rfc-adoption-handoff.md`](../myndhyve-rfc-adoption-handoff.md) for the retained per-RFC checklist.

## Related cross-repo adoption notes (MyndHyve's repo)

The earlier multi-agent signals reference adoption write-ups that live in **MyndHyve's own repository**, not here: `docs/openwop-adoption/0037-multi-agent-phase-1.md` (RFC 0037 Phase 1, MyndHyve commit `89cd564b`) and `docs/openwop-adoption/0044-vendor-kind-mapping.md` (RFC 0044 §C vendor-kind mapping, MyndHyve commit `c4342b5b`). Those paths are MyndHyve-local; the openwop-side evidence for both is in `INTEROP-MATRIX.md`.

## See also

- [`../../INTEROP-MATRIX.md`](../../INTEROP-MATRIX.md) — canonical per-capability adoption rows + reading guide.
- [`../myndhyve-rfc-adoption-handoff.md`](../myndhyve-rfc-adoption-handoff.md) — the original implementation handoff for this cohort.
- [`../myndhyve-agentic-runtime-handoff.md`](../myndhyve-agentic-runtime-handoff.md) — the follow-on handoff for the agentic-runtime + app-UX Active RFCs.
- [`../../RFCS/0001-rfc-process.md`](../../RFCS/0001-rfc-process.md) §"Promotion to Accepted" — the gate these 8 RFCs cleared.
