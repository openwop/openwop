# RFC 0049: RBAC scopes & authorization decisions

| Field | Value |
|---|---|
| **RFC** | 0049 |
| **Title** | A portable role→scope binding (reusing the existing API-key scope grammar) plus a standardized, redaction-safe `authorization.decided` event, with a normative **fail-closed** default — so a host's RBAC becomes observable, auditable, and conformance-testable |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | `schemas/capabilities.schema.json` (additive `authorization.roles` advertisement) · `schemas/run-event-payloads.schema.json` (additive `authorization.decided` event) · `spec/v1/auth.md` (role→scope binding; the scope grammar this reuses) · RFC 0009/0010 (feeds the audit-log integrity profile) · `SECURITY/invariants.yaml` (new `authorization-fail-closed` invariant) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Bind the RFC 0048 principal's **role** to **scopes** (reusing openwop's existing API-key scope grammar in `spec/v1/auth.md`) and standardize an `authorization.decided { principal, action, resource, allowed, reason }` event so denials are observable, auditable, and conformance-testable — including a normative **fail-closed** default: an absent or unseeded role denies. This makes a host's RBAC (which is otherwise invisible above the protocol) a certifiable surface and feeds the existing audit-log integrity profile (RFC 0009/0010).

## Motivation

MyndHyve enforces workspace roles (`owner`/`admin`/`editor`/`viewer`) and CMS RBAC entirely host-side, **fail-closed** — a cache miss returns `{ allowed: false }`. openwop has a scope vocabulary for API keys (the scope table in `spec/v1/auth.md`: `manifest:read`, `runs:create`, `runs:read`, `runs:cancel`, …, matched by the host's authorization layer) but no contract tying **roles → scopes → a decision on a run or node**. So MyndHyve's RBAC is invisible to the protocol: a federated peer can't tell why a request was denied, and conformance can't assert that an unauthorized principal *is* denied — or that denial is fail-closed rather than fail-open.

The spec is the right place because authorization decisions are an interop and audit concern: cross-host workflows and the audit-log integrity profile (RFC 0009/0010) need a portable decision shape, and the fail-closed default is exactly the kind of safety invariant that should be hoisted and certified rather than re-implemented per host.

## Proposal

### §A — Role→scope binding (additive advertisement)

Advertise the host's role catalog in capabilities:

```diff
   "properties": {
+    "authorization": {
+      "type": "object",
+      "description": "RFC 0049. Maps RFC 0048 principal roles to scopes, reusing the API-key scope grammar (`spec/v1/auth.md`).",
+      "properties": {
+        "supported": { "type": "boolean" },
+        "failClosed": { "type": "boolean", "const": true, "description": "Absent/unseeded role denies. MUST be true — see SECURITY invariant `authorization-fail-closed`." },
+        "roles": {
+          "type": "array",
+          "items": {
+            "type": "object",
+            "required": ["role", "scopes"],
+            "properties": {
+              "role": { "type": "string", "minLength": 1 },
+              "scopes": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true }
+            },
+            "additionalProperties": false
+          }
+        }
+      },
+      "required": ["supported"],
+      "additionalProperties": false
+    }
   }
```

Scope matching reuses the existing API-key scope grammar (a request is authorized when **any** of the principal's role-derived scopes matches the required scope, including the established per-segment wildcard + verb-implication rules the host's authorization layer already applies to API keys). This RFC adds no new grammar — it reuses what API keys already match against, now sourced from a role instead of a key.

### §B — `authorization.decided` event (additive, redaction-safe)

Add to `run-event-payloads.schema.json`:

```json
"authorization.decided": {
  "type": "object",
  "required": ["principal", "action", "resource", "allowed"],
  "properties": {
    "principal": { "type": "string", "description": "Opaque RFC 0048 principal id — never PII." },
    "action": { "type": "string", "description": "The attempted action, e.g. `runs:cancel`." },
    "resource": { "type": "string", "description": "The target, e.g. a runId or workflowId." },
    "allowed": { "type": "boolean" },
    "reason": { "type": "string", "description": "Human-readable, redaction-safe — no credential material." }
  }
}
```

Every decision (allow **and** deny) MAY be emitted; every **deny** SHOULD be emitted and SHOULD feed the audit log per the RFC 0009/0010 audit-log integrity profile.

### §C — Fail-closed MUST (normative) + SECURITY invariant

An absent or unseeded role MUST deny (`allowed: false`), never default-allow. Add to `SECURITY/invariants.yaml`:

```yaml
- id: authorization-fail-closed
  tier: protocol
  severity: critical
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/authorization-fail-closed.test.ts
  note: |
    RFC 0049 §C: hosts advertising `capabilities.authorization.supported` MUST deny when
    a principal's role is absent, unseeded, or unresolvable (cache miss ⇒ deny). The
    decision MUST NOT default-allow under any error condition. `authorization.failClosed`
    is `const: true`.
```

## Compatibility

**Additive.** New optional capability block; new optional event; no required-field change. Hosts without `authorization.supported` are unaffected; consumers ignore an `authorization.decided` event they don't understand. The scope grammar is reused unchanged, so no existing API-key authorization behavior shifts.

**Depends on RFC 0048** (the `principal` the role binds to). Reuses the existing scope vocabulary (`spec/v1/auth.md`) and the audit profile (RFC 0009/0010).

## Conformance

- **`authorization-roles-shape.test.ts`** — the `authorization.roles` advertisement validates; scopes are well-formed. (Always runs.)
- **`authorization-scope-match.test.ts`** — a scope-match matrix: each role's derived scopes allow exactly the actions they should and deny the rest. (Gated on `authorization.supported`.)
- **`authorization-fail-closed.test.ts`** — an absent/unseeded role denies; a forced resolver error denies (never opens). (Gated; backs §C.)
- **`authorization-denial-audited.test.ts`** — a deny emits an `authorization.decided { allowed: false }` and a corresponding audit-log entry. (Gated on `authorization.supported` ∧ the audit-log profile.)

## Alternatives considered

1. **Invent a fresh permission DSL for roles.** Rejected — openwop already has a scope grammar that API keys match against; a second grammar would drift from the first and double the conformance surface. Roles should resolve *to* existing scopes.
2. **Put the full RBAC policy (role assignments, resource ACLs) on the wire.** Rejected — assignment is host-internal state; the protocol's job is the *decision shape* and the *fail-closed invariant*, not the policy store. (Same boundary RFC 0046 drew for credential storage.)
3. **Make denial events optional with no audit link.** Rejected — an unauditable denial defeats the enterprise/governance use case (MyndHyve's CMS audit trail). Tying deny to the existing audit profile is the point.

## Unresolved questions

1. **Role hierarchy / inheritance.** `admin` ⊇ `editor` ⊇ `viewer` is common. Should the advertisement express inheritance, or must each role enumerate its full scope set? Start with full enumeration (simpler to certify); add inheritance if an adopter pulls.
2. **Resource-scoped roles.** A principal might be `editor` in workspace A and `viewer` in workspace B. The role binding is per-(principal, workspace) — should the event carry the workspace context explicitly? Likely yes; align with RFC 0048's `owner.workspace`. Resolve before Active.
3. **Allow-event volume.** Emitting `authorization.decided` for every allow could be noisy. Should allows be sampled while denies are always emitted? Operator-tunable; defer the normative stance.

## Implementation notes (non-normative)

- Schema diffs (§A, §B) + the invariant (§C) land on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve's `RBACService` (local-mode, fail-closed) and `RoleSeedService` become the resolver behind the contract; CMS audit events (`cms.page.force_published`, etc.) map onto `authorization.decided` + the audit log they already feed.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `authorization.roles` advertisement in `capabilities.schema.json`.
- [ ] `authorization.decided` event in `run-event-payloads.schema.json`.
- [ ] `authorization-fail-closed` invariant in `SECURITY/invariants.yaml` with its test.
- [ ] Role→scope binding + scope-grammar reuse documented in `spec/v1/auth.md`.
- [ ] Four conformance scenarios (shape, scope-match, fail-closed, denial-audited).
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `authorization.roles` and passes the fail-closed + denial-audited scenarios.

## References

- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — the `principal`/`workspace` the role binds to (hard dependency).
- [`RFCS/0009-production-profile-conformance.md`](./0009-production-profile-conformance.md) · [`0010`](./0010-auth-profile-conformance.md) — the audit-log integrity profile denials feed.
- [`spec/v1/auth.md`](../spec/v1/auth.md) — the scope table + API-key scope grammar this RFC reuses.
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — binds approvals to the roles defined here.
