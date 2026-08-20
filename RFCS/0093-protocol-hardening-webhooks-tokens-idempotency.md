# RFC 0093: Protocol hardening — webhook delivery egress, interrupt-token lifecycle, retryable-response caching, approval-gate timeout semantics

| Field | Value |
| --- | --- |
| **RFC** | 0093 |
| **Title** | Close four security/correctness gaps found in the 2026-06-11 corpus review: (1) webhook delivery-time egress re-validation + no-redirect policy + an explicit delivery tenant-isolation MUST, (2) interrupt signed-token lifecycle (expiry, single-use invalidation, constant-time verification, inspect intent), (3) idempotent-response caching of retryable-class outcomes (429/5xx) made supersedable, (4) the two approval-gate decisions RFC 0051 left "pin before Active" (timeout ⇒ auto-reject; quorum override opt-in) |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-11 |
| **Updated** | 2026-06-11 (`Active → Accepted` — tier-2 steward-affiliated sibling host **MyndHyve** `workflow-runtime` (Cloud Run revision `00476-xuv`, promoted to 100% after green; myndhyve#165, merge `92ecdb4ab`) passes `@openwop/openwop-conformance` 1.22.0 (run from openwop@`2648d7cc` main) under `OPENWOP_REQUIRE_BEHAVIOR=true`: **`webhook-tenant-isolation.test.ts` 4/4 non-vacuous** (the §A3 protocol-tier See [Amendment record](#amendment-record). |
| **Affects** | `spec/v1/webhooks.md` · `spec/v1/interrupt.md` · `spec/v1/rest-endpoints.md` (inspect-token intent) · `spec/v1/idempotency.md` · `spec/v1/interrupt-profiles.md` (approval-gate timeout/override) · `SECURITY/invariants.yaml` (new `webhook-cross-tenant-isolation` protocol-tier + `webhook-delivery-egress-revalidation` reference-impl invariants) · conformance scenarios · `CHANGELOG.md` |
| **Compatibility** | `additive` (new MUST/SHOULD clauses on previously silent or self-contradictory surfaces — see §Compatibility) |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

The 2026-06-11 corpus review found four hardening gaps. First, `webhooks.md` validates delivery URLs only at **registration** time, leaving DNS-rebinding and redirect-following TOCTOU paths to internal/metadata endpoints open, and never states that delivery is tenant-scoped. Second, interrupt signed tokens have no normative expiry, invalidation, or verification-timing requirements, and the deployed `GET /v1/interrupts/{token}` inspect endpoint is absent from `interrupt.md`. Third, `idempotency.md` rules 2 + 6 combine to make a cached transient `500` replay forever, contradicting the same section's "eventual successful response should replay" intent. Fourth, RFC 0051 (Accepted) left two decisions marked "pin before Active" that were never pinned. This RFC pins all four surfaces with additive normative text.

## Motivation

- **Webhooks (SSRF TOCTOU).** An attacker registers a webhook for a public hostname that passes registration-time checks, then flips its DNS A record to `169.254.169.254` (or has the public URL `302` to a metadata endpoint). The spec's registration-time-only MUST does not prevent either. RFC 0079 already establishes the safe-fetch posture for pack fetches; webhook delivery needs the same. Separately, nothing normatively requires that a subscription receives only its own tenant's run events — every other tenant-scoped surface (kv, table, blob, cache, queue, workspace, memory, annotations) has an explicit cross-tenant-isolation invariant; webhook **delivery** has none.
- **Interrupt tokens.** `interrupt.md` recommends (not requires) a 30-minute expiry, implies single-use only via the `409 interrupt_already_resolved` error, says nothing about timing-safe verification or HMAC-secret rotation, and never mentions `inspectInterruptByToken` even though `rest-endpoints.md` and `api/openapi.yaml` document it — so whether a `resolve`-intent token authorizes inspection is unspecified.
- **Idempotency caching.** Rule 6 (`idempotency.md`) says servers MUST cache `429`/`5xx` responses; rule 2 says duplicates MUST get the cached response. Together a retry with the same key replays the cached `500` forever; the parenthetical promising that "the server's eventual successful response should replay" is unreachable as written. Two conforming hosts can disagree on whether a same-key retry can ever succeed.
- **Approval gates.** RFC 0051's Unresolved Questions gate two decisions "before Active" (timeout default; whether a single override principal bypasses quorum); the RFC went to Accepted without pinning either, and `interrupt-profiles.md` contains no timeout semantics for the gate at all.

## Proposal

### A. Webhook delivery hardening (`spec/v1/webhooks.md`)

1. **Delivery-time egress re-validation.** Hosts MUST resolve the delivery URL's hostname at delivery time and validate every resolved address against the same denied ranges as registration (loopback, RFC 1918 private, link-local/cloud-metadata, and any host-configured denylist). The connection MUST be made to the validated address (pinned resolution); re-resolving between validation and connect defeats the check and MUST NOT be done.
2. **Redirects.** Webhook delivery MUST NOT follow redirects. A `3xx` response is a delivery failure and is retried per the existing retry policy.
3. **Tenant isolation.** A webhook subscription MUST receive only events from runs within the subscription's tenant scope (the tenant established at registration per the existing registration-time membership gate). Cross-tenant delivery is a protocol violation regardless of subscription filter breadth.

New SECURITY invariants: `webhook-cross-tenant-isolation` (protocol tier, enforced by the new `webhook-tenant-isolation.test.ts` scenario) and `webhook-delivery-egress-revalidation` (reference-impl tier; black-box conformance cannot observe a host's resolver behavior — enforcement pointer is the reference host's delivery client).

### B. Interrupt signed-token lifecycle (`spec/v1/interrupt.md`, `spec/v1/rest-endpoints.md`)

1. **Expiry.** Every signed interrupt token MUST carry an expiry (`expiresAt`). The default SHOULD be 30 minutes; hosts MAY allow per-interrupt configuration but MUST cap token lifetime at the interrupt's own deadline (`timeoutMs`) when one exists. An expired token MUST be refused with the canonical `410 interrupt_expired` envelope (the response both signed-token endpoints already document in `api/openapi.yaml` — this RFC makes the expiry itself normative; the refusal shape was already published).
2. **Invalidation.** A token MUST be invalidated once its interrupt is resolved, or the owning run is cancelled or completed. Subsequent use returns the existing `409 interrupt_already_resolved`.
3. **Verification.** Token MAC verification MUST use a constant-time comparison. Hosts SHOULD support overlapping verification secrets (key id / versioned secret) so secrets can rotate without orphaning outstanding tokens (HMAC-SHA256 is today's only spec'd scheme; token-format alternatives remain open gap I4 in `interrupt.md`).
4. **Inspect intent.** A token minted with `intent: "resolve"` authorizes both `GET /v1/interrupts/{token}` (inspect) and `POST /v1/interrupts/{token}/resolve`. Hosts MAY additionally mint `intent: "inspect"` tokens that authorize only the GET; a resolve attempt with an inspect-only token MUST be refused with `403 forbidden`. `interrupt.md` gains the inspect endpoint in its §"Signed resolution tokens" so the two docs describe the same surface.

### C. Retryable-response caching (`spec/v1/idempotency.md`)

Amend rules 2/6: servers MUST cache **final** outcomes (`2xx` and non-retryable `4xx`) for the dedup window. Retryable-class responses (`429`, `500`, `502`, `503`, `504`) MUST NOT be served from cache to a same-key retry: the retry MUST attempt re-execution (subject to the existing in-flight concurrency rule), and a later successful execution MUST replace any recorded retryable-class outcome so subsequent duplicates replay the success. Hosts MAY record retryable-class outcomes for observability.

### D. Approval-gate decisions (`spec/v1/interrupt-profiles.md`, pins RFC 0051 UQ 1–2)

1. **Timeout ⇒ auto-reject (fail closed).** When an approval gate reaches its timeout (`timeoutSec` from gate policy; host default if unset; no timeout if neither), the gate MUST resolve as **rejected** with resolution reason `timeout`, emitting the standard `interrupt.resolved` event with `outcome: "rejected"` and `reason: "timeout"`.
2. **Quorum override is opt-in.** A configured override principal MAY bypass quorum only when the gate's policy explicitly sets `overrideBypassesQuorum: true`. The default is `false`: absent the flag, an override principal's approval counts as one quorum vote. (Schema: additive optional boolean on the gate-policy object, default `false`.)

## Compatibility

`additive`, with one ambiguity resolution:

- §A and §B add MUST/SHOULD clauses on surfaces where the spec was previously **silent** (delivery-time validation, redirects, delivery tenant scope, token expiry/invalidation/timing, inspect intent). No existing conformance scenario asserts the contrary behavior; a host that already followed the registration-time rules and the recommended 30-minute expiry remains conformant.
- §C resolves an **internal contradiction** (rule 6 vs. the same section's replay-the-eventual-success parenthetical) in favor of the only reading under which the documented intent is reachable. No conformance scenario asserted 5xx-replay-forever. Hosts that cached and replayed 5xx must change behavior; this is a correctness fix to a self-contradictory requirement, not a reversal of a settled one.
- §D pins decisions RFC 0051 explicitly left open; `overrideBypassesQuorum` is a new optional field with default `false` (today's safest reading).

## Conformance

- New scenario `webhook-tenant-isolation.test.ts` (gated on the webhooks capability; mirrors the existing cross-tenant-isolation scenario pattern) backs the new protocol-tier invariant.
- Token-lifecycle assertions extend the existing interrupt-token scenarios where black-box observable (expiry shape on inspect; `409` after resolution).
- §C and §A delivery-time behavior are not black-box observable from a single-tenant conformance run; they are carried by the reference-impl-tier invariant and reference-host tests (see `SECURITY/invariants.yaml` pointers).

## Alternatives considered

- **Webhook allowlist instead of delivery-time re-validation.** Requiring hosts to maintain explicit egress allowlists pushes operational burden onto every operator and doesn't compose with user-supplied URLs; pinned-resolution re-validation matches RFC 0079's safe-fetch posture already in the corpus.
- **Excluding 429/5xx from caching entirely (no observability record).** Simpler, but loses the audit trail rule 6 was after; recording-without-replaying preserves both.
- **Making gate timeout ⇒ auto-approve.** Rejected: fails open. Every other gate-shaped surface in the corpus (authorization, deployment promotion) fails closed.
- **Do nothing.** Leaves an SSRF TOCTOU on a normative surface, a permanently-poisoned idempotency key failure mode, and two Accepted-RFC decisions formally unpinned.

## Unresolved questions

None — this RFC exists to pin previously open questions.

## Implementation notes (non-normative)

The reference host (openwop-app repo) should adopt pinned-resolution delivery (resolve once, connect by IP with SNI/Host set to the original hostname) and a `redirect: "error"` fetch policy. SDK changes: none required (no wire-shape change); the gate-policy `overrideBypassesQuorum` field lands in the gate-policy schema if/where one exists in `schemas/`.

## Acceptance criteria

- [x] Spec text merged (`webhooks.md`, `interrupt.md`, `rest-endpoints.md`, `idempotency.md`, `interrupt-profiles.md`).
- [x] SECURITY invariants added; `check-security-invariants.sh` green.
- [x] `webhook-tenant-isolation.test.ts` scenario landed in `@openwop/openwop-conformance` 1.22.0.
- [x] CHANGELOG entry under `[Unreleased]`.
- [x] Reference host implements delivery-time re-validation + token lifecycle and passes the new scenarios (tier-2 evidence per `GOVERNANCE.md` §Acceptance evidence tiers); `Active → Accepted` on that evidence.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- gate), webhook-signed-delivery/sig-algorithm/negative green (§A delivery hardening live via a pinned-resolution egress dispatcher + `redirect:'error'`), idempotency family 14 PASS (§C), interrupt-approval + interrupt-clarification PASS.
- Evidence tiers per `GOVERNANCE.md` §"Acceptance evidence tiers": webhook/idempotency/interrupt legs **tier-2** (this deployment); the signed-token lifecycle scenario (`interrupt-token-matrix`) is carried **tier-1** by the reference host (openwop-app#151, which seeds the fixture — MyndHyve's Cloud Run host honestly skips it: the token surface is a SHOULD per `interrupt.md` §"Resolution endpoints" and is not built there); §B hardening itself is implemented on MyndHyve's canvas-runtime token surface (`/v1/approvals/:token`: `interruptId`+`intent` payload, 30-min default capped at `timeoutMs`, canonical `410 interrupt_expired`/`409`, length-guarded `timingSafeEqual`, inspect intent) and §D fail-closed timeout + `overrideBypassesQuorum` via engine tests — both reported as named-deployable prose evidence (myndhyve `build/openwop-rfc0093-0094-conformance-evidence.txt`).
- 2026-06-11 (`Draft → Active` — comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus during the bootstrap phase (waiver recorded in the `MAINTAINERS.md` ledger), after a steward review of the corpus-review findings.
- All four items resolve internal contradictions or close gaps where the spec was silent; none reverses a behavior any conformance scenario asserted.)).

## References

- 2026-06-11 corpus review (this branch's PR).
- RFC 0051 (approval gate — UQ 1–2 pinned here), RFC 0079 (safe-fetch posture), RFC 0048/0074 (tenant model).
- `spec/v1/webhooks.md`, `spec/v1/interrupt.md`, `spec/v1/idempotency.md`, `spec/v1/interrupt-profiles.md`.
