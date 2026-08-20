# RFC 0079: Credential Provenance + Egress Policy

| Field | Value |
| --- | --- |
| **RFC** | 0079 |
| **Title** | A credential-provenance descriptor at the tool/egress boundary (host-issued credentials carry id / issuer / allowed audiences / scopes / expiry / redaction policy / audit-correlation id) + an `egress.decided` policy event (allowed / denied / downgraded / approval-required) + the load-bearing MUST that a host-issued credential is never attached to an egress destination outside its declared audiences — answering the credential-destination-binding question RFC 0076 §B parked |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-06-01 (`Active → Accepted` — graduated on a **non-steward host**. MyndHyve `workflow-runtime` (rev `workflow-runtime-00441-pid @ 100%`, live on `https://api.myndhyve.ai`) advertises `httpClient.egressPolicy {supported:true, decisions:["allowed","denied","downgraded","approval-required"]}` at the discovery doc root, layered over its Accepted `httpClient.safeFetch`. See [Amendment record](#amendment-record). |
| **Affects** | `schemas/credential-provenance.schema.json` (NEW) · `schemas/capabilities.schema.json` (additive optional `httpClient.egressPolicy` block) · `schemas/run-event-payloads.schema.json` (additive `egress.decided` payload + `_typeIndex`) · `schemas/run-event.schema.json` (RunEventType enum +1) · `spec/v1/host-capabilities.md` (§"Credential provenance + egress policy") · `SECURITY/invariants.yaml` (`egress-credential-audience-bound`) · `SECURITY/threat-model-secret-leakage.md` · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0076 §B added `ctx.http.safeFetch` — a host-mediated, SSRF-guarded egress primitive — but explicitly **parked the hardest question**: when a credential (a BYOK reference per RFC 0046, or an OAuth token per RFC 0047) is attached to that egress, _how does the host know the credential was host-issued and allowed for **that destination**?_ Without an answer, a prompt-injected agent or a misconfigured tool can attach a credential minted for service A to a request aimed at attacker-controlled service B — a confused-deputy / credential-exfiltration class that the SSRF guard (which checks the _URL_, not the _credential↔destination binding_) does not catch. This RFC defines a **credential-provenance descriptor** at the tool/egress boundary — host-issued credentials carry `{credentialId, issuer, audiences, scopes, expiresAt, redactionPolicy, auditCorrelationId}` (content-free of the secret value) — an **`egress.decided`** content-free policy event (`allowed` / `denied` / `downgraded` / `approval-required`), and the **load-bearing MUST**: a host MUST NOT attach a host-issued credential to an egress whose destination is not in the credential's `audiences`, failing closed when provenance can't be evaluated. It composes `ctx.http.safeFetch` (the egress mechanism), RFC 0046/0047 (credential sources), RFC 0049 (scopes), RFC 0064 (the tool boundary), and RFC 0078 (`ToolDescriptor.egress` — the static advertisement; this RFC is the runtime decision). It adds a new protocol-tier SECURITY invariant (`egress-credential-audience-bound`).

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0079" and RFC 0076 §B both name the gap: _RFC 0076 parks the hardest `safeFetch` question — how a host knows whether an `Authorization` header or credential passed to egress was host-issued and allowed for that destination._ Concretely:

1. **The SSRF guard checks the URL, not the credential↔destination binding.** `safeFetch` (RFC 0076 §B) resolves+pins the destination and blocks metadata endpoints — but if a tool attaches a host-stored credential, nothing checks that _this credential_ is _meant for this destination_. A confused-deputy attack (inject a tool call that targets `attacker.example` with a credential minted for `stripe.com`) sails through the SSRF guard.
2. **No provenance at the tool boundary.** RFC 0046 stores credentials and resolves them by `ref`; RFC 0047 acquires OAuth tokens. Neither carries, at the point of egress, _which destinations the credential is valid for_, _who issued it_, _when it expires_, or _how it audits_. A tool gets an opaque credential with no binding metadata.
3. **No observable egress decision.** When a host allows/denies/downgrades an egress, there is no content-free event an operator (or the RFC 0078 Keys page) can watch to see "credential X was used against destination Y, decision: allowed" — credential use is invisible until something breaks.

The spec is the right place because _credential↔destination binding_ is a **cross-host security invariant** (a confused-deputy class), and the _provenance shape_ + _decision event_ are interop concerns a Keys/audit console depends on. The per-host credential store + egress mechanics stay host-owned (RFC 0046/0047/0076); this RFC pins the provenance descriptor, the decision event, the audience-binding MUST, and the capability gate.

## Proposal

### §A — Credential provenance descriptor (NEW `schemas/credential-provenance.schema.json`)

When a host binds a credential (an RFC 0046 stored reference, or an RFC 0047 OAuth token) for an egress at the tool boundary, it attaches a **provenance descriptor** — metadata _about_ the credential, never the secret value:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["credentialId", "issuer", "audiences"],
  "properties": {
    "credentialId":   { "type": "string", "minLength": 1, "description": "Stable host-issued id for the credential (the RFC 0046 `ref`, or an OAuth-grant id). Correlates audit + the Keys-page view. NOT the secret value." },
    "issuer":         { "type": "string", "minLength": 1, "description": "Who minted/owns the credential — the host itself (`host`), an RFC 0047 OAuth provider id, or a BYOK principal (RFC 0046). Lets a consumer distinguish host-managed from caller-supplied credentials." },
    "audiences":      { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 }, "description": "REQUIRED. The destination hosts/domains (or destination-class ids) the credential is valid for. The §C binding MUST is evaluated against this list — a credential MUST NOT be attached to an egress outside its audiences." },
    "scopes":         { "type": "array", "items": { "type": "string" }, "description": "MAY — RFC 0049 scopes the credential grants (e.g. `egress:stripe:charge`)." },
    "expiresAt":      { "type": "string", "format": "date-time", "description": "MAY — credential expiry; an expired credential MUST NOT be attached (deny)." },
    "redactionPolicy":{ "type": "string", "enum": ["always", "hash", "host-policy"], "description": "MAY — how the credential surfaces in logs/events. `always`: never appears (default posture, SR-1); `hash`: an SR-1-redacted digest MAY appear; `host-policy`: host-defined. The secret value itself is NEVER on the wire regardless." },
    "auditCorrelationId": { "type": "string", "minLength": 1, "description": "MAY — id correlating this credential's egress decisions across the run's `egress.decided` events + the host audit log." }
  }
}
```

The descriptor is **content-free of the secret** — it travels with the egress _decision_, not the credential material (SR-1; reuses the RFC 0046 `credential-payload-redaction` posture).

### §B — `egress.decided` event (additive, content-free)

A host advertising the capability (§D) MUST emit `egress.decided` when it evaluates an egress that carries (or would carry) a host-issued credential:

```diff
+    "egressDecided": {
+      "type": "object",
+      "description": "RFC 0079. Emitted when a host evaluates a credentialed egress (via ctx.http.safeFetch / a tool) against credential provenance + the SSRF guard. Content-free: identifiers + decision only — no credential value, no request/response body. On replay re-read from the log, never regenerated (the decision is a recorded fact).",
+      "required": ["decision", "destination"],
+      "properties": {
+        "decision":     { "type": "string", "enum": ["allowed", "denied", "downgraded", "approval-required"], "description": "`allowed`: egress proceeds with the credential; `denied`: blocked (out-of-audience / expired / SSRF / unevaluable provenance — fail-closed); `downgraded`: proceeds WITHOUT the credential (anonymous egress, when the host policy permits); `approval-required`: suspended pending an RFC 0051 approval interrupt." },
+        "destination":  { "type": "string", "minLength": 1, "description": "The egress destination (host/domain) evaluated. Content-free identifier, not the full URL with query." },
+        "credentialId": { "type": "string", "minLength": 1, "description": "MAY — the provenance credentialId considered (absent for an anonymous/denied-pre-credential egress)." },
+        "reason":       { "type": "string", "description": "MAY — a short machine-stable reason code (`out-of-audience` / `expired` / `ssrf-blocked` / `provenance-unevaluable` / `scope-denied` / `ok`), for a crisp Keys-page / debugger explanation." },
+        "auditCorrelationId": { "type": "string", "minLength": 1, "description": "MAY — correlates to the provenance descriptor + host audit log." }
+      },
+      "additionalProperties": true
+    },
```

`_typeIndex`: `"egress.decided": { "$ref": "#/$defs/egressDecided" }`; `run-event.schema.json` `RunEventType` enum gains `egress.decided`.

### §C — Audience-binding MUST (normative — the parked-question answer)

When a host attaches a host-issued credential to an egress (via `ctx.http.safeFetch` per RFC 0076 §B, or a tool per RFC 0064):

1. The host **MUST NOT** attach the credential if the egress destination is not in the credential's provenance `audiences` (the confused-deputy guard). Such an egress is `denied` (`reason: "out-of-audience"`) or, where host policy permits anonymous egress, `downgraded` (proceeds without the credential).
2. The host **MUST fail closed**: if credential provenance cannot be evaluated (no descriptor, unparseable `audiences`), the egress is `denied` (`reason: "provenance-unevaluable"`) — never allowed-by-default.
3. An **expired** credential (`expiresAt` past) MUST NOT be attached (`denied` / `reason: "expired"`).
4. This composes the RFC 0076 §B SSRF guard (URL-level) — the audience binding is the **credential-level** check the SSRF guard doesn't perform; both MUST pass for `allowed`.

This is the new protocol-tier SECURITY invariant **`egress-credential-audience-bound`** (§F).

### §D — Capability (`capabilities.httpClient.egressPolicy`)

```diff
   "httpClient": {
     "properties": {
       "safeFetch": { "...": "unchanged — RFC 0076 §B" },
+      "egressPolicy": {
+        "type": "object", "additionalProperties": false,
+        "description": "RFC 0079. The host evaluates credential provenance + the audience-binding MUST (§C) on credentialed egress and emits egress.decided (§B). Requires httpClient.safeFetch (the egress mechanism). Absent ⇒ the host does not perform provenance binding (the RFC 0076 §B SSRF guard still applies); the conformance behavioral scenarios skip cleanly.",
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean", "description": "REQUIRED when present. true ⇒ §C binding enforced + egress.decided emitted." },
+          "decisions": { "type": "array", "uniqueItems": true, "items": { "type": "string", "enum": ["allowed", "denied", "downgraded", "approval-required"] }, "description": "MAY — which decision outcomes the host implements. Absent ⇒ at least allowed + denied." }
+        }
+      }
     }
   }
```

### §E — Composition

- **RFC 0076 §B `safeFetch`** — the egress mechanism; this RFC adds the credential↔destination binding §C performs _before_ `safeFetch` attaches a credential (closing 0076's parked question explicitly).
- **RFC 0046 host.credentials / RFC 0047 host.oauth** — the credential sources; the provenance descriptor's `credentialId`/`issuer` reference them; the secret stays host-side (`credential-payload-redaction`).
- **RFC 0049 scopes** — `provenance.scopes`; a scope-denied egress is `denied` (`reason: "scope-denied"`).
- **RFC 0064 tool hooks** — the tool boundary where credentialed egress originates; `egress.decided` sits alongside `agentToolCalled`/`agentToolReturned`.
- **RFC 0078 `ToolDescriptor.egress`** — the _static_ advertisement (`safe-fetch`/`host-mediated`); this RFC is the _runtime_ per-egress decision.
- **RFC 0051 approval** — `decision: "approval-required"` suspends via an `approval` interrupt; no new interrupt kind.

### §F — Safety + SECURITY invariant (normative)

New protocol-tier invariant **`egress-credential-audience-bound`**: a host-issued credential MUST NOT be attached to an egress destination outside its provenance `audiences`; provenance-unevaluable ⇒ fail-closed deny. Verified by a public conformance scenario (a credential minted for audience A, an egress aimed at B → `denied`/`downgraded`, never `allowed`-with-credential). The provenance descriptor + `egress.decided` are **content-free of the secret value** (SR-1; the `redactionPolicy` governs at-most a hash). `threat-model-secret-leakage.md` gains a §"Credential confused-deputy egress" row.

### Examples

**Positive.** A credential `{credentialId: "cred-stripe-1", issuer: "host", audiences: ["api.stripe.com"], expiresAt: "2026-12-01T00:00:00Z"}`; a tool egress to `api.stripe.com` → `egress.decided { decision: "allowed", destination: "api.stripe.com", credentialId: "cred-stripe-1", reason: "ok" }`. The same credential on an egress to `attacker.example` → `egress.decided { decision: "denied", destination: "attacker.example", credentialId: "cred-stripe-1", reason: "out-of-audience" }` (the confused-deputy block — `egress-credential-audience-bound`).

**Negative (non-conformant behavior).** A host that attaches `cred-stripe-1` to the `attacker.example` egress and emits `egress.decided { decision: "allowed" }` → non-conformant by §C-1/§F. **Negative (schema).** A provenance descriptor with `audiences: []` fails validation (`minItems: 1` — a credential with no audience can't be bound to anything); `egress.decided { decision: "ok" }` fails (`ok` not in the decision enum — the canonical allowed value is `allowed`).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). New `credential-provenance.schema.json`; an additive optional `httpClient.egressPolicy` block (a host that omits it keeps the RFC 0076 §B SSRF guard, unchanged); an additive content-free `egress.decided` RunEventType (folded best-effort). No existing field, event, error code, or endpoint changes. The new SECURITY invariant constrains _new_ behavior (credentialed egress under `egressPolicy`); it does not retroactively fail a host that doesn't advertise the capability. No conformance pass is invalidated. (Safety-fix-shaped in spirit — it closes a confused-deputy class — but additive in mechanism: it gates on a new capability + adds a new invariant rather than changing an existing contract.)

## Conformance

- **New scenarios:**
  - **`egress-provenance-shape.test.ts`** (always-on, server-free): `credential-provenance.schema.json` compiles; a conforming descriptor validates; `audiences: []` and the `egressDecided` decision-enum negatives are rejected; `egress.decided` is in the RunEventType enum; `httpClient.egressPolicy` is declared.
  - **`egress-audience-binding.test.ts`** (gated on `httpClient.egressPolicy.supported`): the keystone — a credential bound to audience A, an egress to B → `egress.decided { decision: "denied"|"downgraded", reason: "out-of-audience" }`, the credential is NOT attached; provenance-unevaluable → `denied` (`provenance-unevaluable`), fail-closed. Backs `egress-credential-audience-bound`. Soft-skips when unadvertised / no egress seam.
  - **`egress-decision-content-free.test.ts`** (gated): `egress.decided` + the provenance descriptor carry no secret value (SR-1 canary check). Soft-skips when unadvertised.
- **SECURITY invariant.** `egress-credential-audience-bound` row in `SECURITY/invariants.yaml` → `egress-audience-binding.test.ts` (per `scripts/check-security-invariants.sh`, a protocol-tier MUST-NOT needs a public test in the same PR that lands the invariant — so the invariant + its test land together at `Draft → Active`, not at this Draft filing).
- **Reference host.** Deferred (files at `Draft`). The shape ships; the binding + content-free scenarios soft-skip until a reference host wires `egressPolicy` over its `safeFetch`.

## Alternatives considered

1. **Rely on the RFC 0076 §B SSRF guard alone.** Rejected — the SSRF guard checks the _URL_ (resolve/pin/metadata-block), not the _credential↔destination binding_. A credential minted for A attached to a legitimate-looking but wrong destination B passes SSRF and leaks. The audience binding is an orthogonal, necessary check — exactly the question 0076 parked.
2. **Put audiences on the credential store (RFC 0046) only, no egress event.** Rejected — without the `egress.decided` event, credential use is unobservable (no Keys-page "credential used against X" view, no audit trail), and without the §C MUST at the _egress boundary_ the binding isn't enforced where it matters. The store is the source; the boundary is where it must be checked + observed.
3. **A new top-level `egress` capability instead of `httpClient.egressPolicy`.** Rejected — egress is the `httpClient`/`safeFetch` surface (RFC 0076); nesting under `httpClient` keeps the egress story in one block and makes the `safeFetch` dependency structural.
4. **Do nothing.** Rejected — RFC 0076 §B explicitly parks this as the hardest open question; leaving it open means every `safeFetch`-adopting host invents its own (or no) credential-binding, and the confused-deputy class stays unguarded. The gap analysis flags the Keys-page provenance view as a concrete demand.

## Unresolved questions

**All four resolved at `Draft → Active` (2026-05-30) as proposed below — recorded in `Updated:`.** Retained for the rationale trail:

1. **`audiences` matching semantics.** Exact host match, suffix/wildcard (`*.stripe.com`), or a destination-class id? Proposed: exact host + an explicit `*.domain` suffix form; no arbitrary regex (injection risk). Confirm before `Active`.
2. **`downgraded` default policy.** Is anonymous-egress-on-out-of-audience (`downgraded`) opt-in per credential, or host-global? Proposed: per-credential (a credential MAY permit downgrade; default is `denied`). Confirm.
3. **`egress.decided` emission scope.** Emit on every credentialed egress, or only on `denied`/`downgraded`/`approval-required` (suppress the high-volume `allowed`)? Proposed: emit on all non-`allowed` always; `allowed` gated behind a verbosity flag to avoid event-log flooding. Confirm.
4. **Relationship to RFC 0026 cost-attribution.** Should `egress.decided` carry a cost/destination tag that composes the RFC 0026 usage event? Proposed: out of scope; keep `egress.decided` security-only. Confirm.

## Implementation notes (non-normative)

- **Sequencing.** Composes RFC 0076 §B (`safeFetch`, the egress mechanism — this is its parked-question follow-on) + RFC 0046/0047 (credential sources) + RFC 0049 (scopes) + RFC 0064 (tool boundary) + RFC 0078 (`ToolDescriptor.egress` static advertisement) + RFC 0051 (approval-required). Adds one schema + one capability block + one content-free event + one SECURITY invariant.
- **Reference host.** A host that has wired `ctx.http.safeFetch` (RFC 0076 §B) adds `egressPolicy` by attaching provenance to its credential resolution + checking `audiences` before the fetch attaches the `Authorization` header + emitting `egress.decided`.
- **Demo impact** (out of scope): a Keys page showing which agents/workflows/tools may use each credential; tool calls displaying "credential used" without values; unsafe egress blocked with a crisp `reason`.
- **Expected effort:** M for the schema + capability + event + invariant + prose + shape conformance (lands at `Draft → Active`); M for a reference implementation over an existing `safeFetch`.

## Acceptance criteria

Checklist for `Active → Accepted` (files at `Draft`):

- [ ] `host-capabilities.md` §"Credential provenance + egress policy" documents §A descriptor + §B event + §C binding MUST + §D capability + §E composition.
- [ ] `credential-provenance.schema.json` (NEW) + `capabilities.schema.json` `httpClient.egressPolicy` + `run-event-payloads.schema.json` `egressDecided` + `_typeIndex` + `run-event.schema.json` enum +1.
- [ ] `SECURITY/invariants.yaml` `egress-credential-audience-bound` (protocol-tier) + its public test `egress-audience-binding.test.ts` (land together); `threat-model-secret-leakage.md` §"Credential confused-deputy egress".
- [ ] Conformance: `egress-provenance-shape.test.ts` (always-on) + the two gated behavioral scenarios.
- [ ] CHANGELOG entry + INTEROP-MATRIX row.
- [ ] All four Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host implements `egressPolicy` over `safeFetch` + passes the binding scenario, OR the RFC explicitly defers reference-host implementation.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- The two gated behavioral scenarios deferred at `Draft → Active` were authored + published in `@openwop/openwop-conformance@1.14.0` (`egress-audience-binding` keystone + `egress-decision-content-free`, PR #425) and MyndHyve passes both **non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`**: the §C confused-deputy MUST — `out-of-audience → denied{out-of-audience}` with `credentialAttached:false` (credential NOT attached), `provenance-unevaluable → denied{provenance-unevaluable}` (fail-closed), `in-audience → allowed` with `credentialAttached:true` — and the SR-1 canary (a planted `sk_live_…` stripped host-side by `destinationHost()`, `canaryLeaked:false`; the `egress.decided` wire carries a host-only destination + a closed-enum reason, no path/secret).
- **On this graduation the `egress-credential-audience-bound` SECURITY invariant advances `reference-impl → protocol` tier** (RFC 0035 precedent; its public test the gated `egress-audience-binding.test.ts`).
- No wire-shape change at graduation. — `Draft → Active` (2026-05-30) — steward acceptance, comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus after MyndHyve (non-steward) wire-shape review; wire shapes now locked.
- All 4 Unresolved questions resolved as proposed: UQ1 `audiences` matching = exact host OR explicit `*.domain` suffix (no arbitrary regex); UQ2 `downgraded` is per-credential opt-in, default `denied`; UQ3 emit `egress.decided` on all non-`allowed` always + `allowed` behind a verbosity flag; UQ4 `egress.decided` stays security-only (no RFC 0026 cost tag).
- NEW `schemas/credential-provenance.schema.json` + `host-capabilities.md` §"Credential provenance + egress policy" + `capabilities.httpClient.egressPolicy` + content-free `egress.decided` event + `egress-provenance-shape.test.ts` landed.
- **The §F invariant is split per the `check-security-invariants.sh` gate + RFC 0035 precedent:** `egress-decision-no-secret-leak` lands **protocol-tier** now (content-free guarantee; public test = the always-on shape scenario), and the behavioral `egress-credential-audience-bound` confused-deputy MUST-NOT lands **reference-impl tier**, graduating to protocol at `Active → Accepted` when a reference host wires `egressPolicy` over `safeFetch` + the gated `egress-audience-binding.test.ts` passes.
- Reference-host impl + behavioral scenarios deferred to Accepted.).

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0079" — the source recommendation.
- [`RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md`](./0076-pack-runtime-requirements-and-host-safe-fetch.md) §B — `ctx.http.safeFetch`, the egress mechanism + the explicitly-parked credential-destination question this RFC answers.
- [`RFCS/0046-host-credentials-capability.md`](./0046-host-credentials-capability.md) — the credential store + `credential-payload-redaction` posture the descriptor reuses.
- [`RFCS/0047-host-oauth-connector-flows.md`](./0047-host-oauth-connector-flows.md) — OAuth tokens as a provenance `issuer` source.
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — `provenance.scopes`.
- [`RFCS/0064-tool-invocation-hooks-and-authorization.md`](./0064-tool-invocation-hooks-and-authorization.md) — the tool boundary where credentialed egress originates.
- [`RFCS/0078-portable-tool-catalog-and-tool-session-contract.md`](./0078-portable-tool-catalog-and-tool-session-contract.md) — `ToolDescriptor.egress` (static advertisement; this RFC is the runtime decision).
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — `approval-required` decision.
- [`SECURITY/threat-model-secret-leakage.md`](../SECURITY/threat-model-secret-leakage.md) — the SR-1 posture + the new confused-deputy egress row.
