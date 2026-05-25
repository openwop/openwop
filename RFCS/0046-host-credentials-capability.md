# RFC 0046: host.credentials capability — credential vault, encryption, sharing & rotation

| Field | Value |
|---|---|
| **RFC** | 0046 |
| **Title** | `host.credentials` capability — a portable credential resolution + lifecycle contract (store-at-rest, workspace sharing, two-key-overlap rotation, redaction-everywhere) |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | `schemas/capabilities.schema.json` (additive `host.credentials` block; additive `workspace` value in `secrets.scopes` enum) · `schemas/credential-reference.schema.json` (new — the wire shape of a *reference*, never the secret) · `schemas/node-pack-manifest.schema.json` (additive `requiredCredentials[]` node block, sibling to existing `requiresSecrets[]`) · `spec/v1/host-capabilities.md` (new §host.credentials) · `spec/v1/run-options.md` (the `ai.credentialRef` reserved-key annex is generalized) · `SECURITY/invariants.yaml` (new `credential-payload-redaction` invariant) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add an optional `host.credentials` capability — a sibling to `host.fs` / `host.kvStorage` / `host.blobStorage` (RFCs 0014–0019) — that defines a portable **credential resolution + lifecycle contract**: how a credential is stored at rest, shared across the workflows of a workspace, rotated with a grace window, and resolved into a node sandbox **without ever putting plaintext on the wire**. A pack references a credential by `{ ref, scope }`; the host injects the resolved material into the node sandbox only, never into `inputs`, persisted variables, events, debug bundles, or replay state. A new SECURITY invariant (`credential-payload-redaction`) gates the redaction guarantee, mirroring `mcp-toolcall-payload-redaction`.

## Motivation

openwop today has exactly one credential surface: the `ai.credentialRef` reserved run-option key (`spec/v1/run-options.md` §"Reserved keys") plus the `capabilities.secrets` advertisement (`{ supported, scopes: ['tenant'|'user'|'run'], resolution: 'host-managed' }`). That is enough to *pass an opaque reference into a run* and have the host's `SecretResolver` dereference it internally — but it is not a first-class surface for:

- storing/encrypting a credential at rest,
- sharing one credential across many workflows in a workspace,
- rotating a credential with a grace window,
- redacting it consistently across events, debug bundles, and replay state.

MyndHyve hits this directly. It stores per-user secrets at `users/{uid}/secrets` and runs a workspace-shared BYOK vault. All of that lifecycle logic lives *above* the protocol as host-private code, so it is uncertifiable, and no `vendor.myndhyve.*` pack can portably declare "I need credential X." Every host that wants a credential vault reinvents the redaction surface — which is exactly the kind of repeated bug surface (a token leaking into an event payload or a debug bundle) that warrants a single hoisted invariant, the same argument RFC 0014 made for `host.fs` path-traversal.

This is the foundation of Tier 1 in `plans/myndhyve-protocol-extension-rfcs.md`: RFC 0047 (OAuth) stores its acquired tokens here, and RFC 0045 (connector manifest) points its `requiredCredentials` declarations at this contract.

## Proposal

### §A — `capabilities.schema.json`: `host.credentials` block (additive)

Add a `credentials` block under `host`, mirroring the shape of the existing `queueBus` / `blobStorage` blocks:

```diff
   "host": {
     "properties": {
+      "credentials": {
+        "type": "object",
+        "description": "RFC 0046. Portable credential resolution + lifecycle contract. A pack references a credential by `{ ref, scope }` (see `credential-reference.schema.json`); the host resolves it into the node sandbox ONLY — never into inputs, persisted variables, events, debug bundles, or replay state (SECURITY invariant `credential-payload-redaction`).",
+        "properties": {
+          "supported": { "type": "boolean" },
+          "scopes": {
+            "type": "array",
+            "items": { "type": "string", "enum": ["user", "workspace", "tenant"] },
+            "uniqueItems": true,
+            "description": "Subset of resolution scopes the host implements. `workspace` is the RFC 0048 sub-tenant; `tenant` and `user` align with the existing `secrets.scopes` vocabulary."
+          },
+          "encryptionAtRest": { "type": "boolean", "description": "Host encrypts stored credential material at rest." },
+          "rotation": {
+            "type": "string",
+            "enum": ["none", "two-key-overlap"],
+            "description": "`two-key-overlap`: old + new credential both resolve as valid during a grace window (mirrors `openwop-auth-api-key-rotation`)."
+          },
+          "sharing": { "type": "boolean", "description": "A single stored credential can be referenced by many workflows within a scope (e.g. a workspace-shared key)." }
+        },
+        "required": ["supported"],
+        "additionalProperties": false
+      }
     }
   }
```

Additionally, extend the existing `capabilities.secrets.scopes` enum with `workspace` (additive — no host that omits it changes behavior):

```diff
   "scopes": {
     "type": "array",
-    "items": { "type": "string", "enum": ["tenant", "user", "run"] },
+    "items": { "type": "string", "enum": ["tenant", "user", "run", "workspace"] },
     "uniqueItems": true
   }
```

### §B — `credential-reference.schema.json` (new — the reference, **not** the secret)

The only credential artifact that ever crosses the wire is the reference:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/schemas/credential-reference.schema.json",
  "title": "CredentialReference",
  "description": "RFC 0046. An opaque, host-issued handle to a stored credential. NEVER carries key material. The host's resolver dereferences it into the node sandbox at execution time.",
  "type": "object",
  "required": ["ref"],
  "properties": {
    "ref": { "type": "string", "minLength": 1, "description": "Opaque host-issued identifier, e.g. `cred_a3b9c2`. Hosts MUST NOT encode secret material in the ref." },
    "scope": { "type": "string", "enum": ["user", "workspace", "tenant"], "description": "Resolution scope. Absent ⇒ host default scope." }
  },
  "additionalProperties": false
}
```

### §C — Resolution contract (added to `host-capabilities.md`, normative)

A host advertising `host.credentials.supported: true` MUST:

1. Resolve a `{ ref, scope }` reference at **node-execution time** and inject the resolved material into the node sandbox **only**. The resolved value MUST NOT appear in `inputs`, persisted `variables`, `channels`, any `run.*` event payload, the debug bundle, or replay state. (This mirrors the framework-reserved-name stripping MyndHyve already performs and is gated by §E.)
2. Return a typed error envelope on resolution failure: `credential_not_found` (unknown ref), `credential_forbidden` (ref resolvable but out of the caller's scope — fail-closed), `credential_scope_unsupported` (scope not in the advertised `scopes`).
3. When `sharing: true`, resolve the **same** stored credential for every workflow that references it within the scope, without copying material between references.

### §D — Two-key-overlap rotation (normative, when `rotation: "two-key-overlap"`)

Rotation reuses the contract already verified for API keys in `openwop-auth-api-key-rotation` (and its `auth-api-key-rotation.test.ts`): during a grace window the **old and new** credential both resolve as valid; after the window the old MUST fail with `credential_not_found`. Canary-redaction MUST hold throughout: neither the old nor the new material may surface in any redaction-gated surface from §C.1.

### §E — SECURITY invariant `credential-payload-redaction`

Add to `SECURITY/invariants.yaml`, sibling to `mcp-toolcall-payload-redaction`:

```yaml
- id: credential-payload-redaction
  tier: protocol
  severity: critical
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/credential-payload-redaction.test.ts
  note: |
    RFC 0046 §C.1: hosts advertising `host.credentials.supported` MUST resolve a
    credential reference into the node sandbox ONLY. Resolved material MUST NOT appear
    in run inputs, persisted variables, channels, any run.* event payload, the debug
    bundle, or replay state. The reference (`{ ref, scope }`) is the only credential
    artifact permitted on the wire.
```

### §F — Pack manifest declaration (additive)

Extend `node-pack-manifest.schema.json` with a node-level `requiredCredentials[]` block, a sibling to the existing `requiresSecrets[]` `SecretRequirement` array, so a pack declares its credential needs portably:

```diff
   "PackNode": {
     "properties": {
       "requiresSecrets": { "type": "array", "items": { "$ref": "#/$defs/SecretRequirement" } },
+      "requiredCredentials": {
+        "type": "array",
+        "items": { "$ref": "#/$defs/CredentialRequirement" },
+        "description": "RFC 0046. Credentials the node needs. Resolved by the host's host.credentials resolver at dispatch time; refuses to register on a host lacking host.credentials.supported."
+      }
     }
   }
```

where `CredentialRequirement` is `{ key: string, scope?: 'user'|'workspace'|'tenant', displayName?: string }`.

## Compatibility

**Additive.** New optional capability block; new optional schema; new optional node-manifest array; one new enum value (`workspace`) appended to `secrets.scopes` (appending to an `enum` is non-breaking — no existing advertisement is invalidated). Hosts without `host.credentials.supported` ignore the block, and a pack declaring `requiredCredentials` refuses to register on them (peerDependency `credentials: 'supported'`, the same pattern `core.openwop.files` uses against `host.fs`).

This **supersedes the informal** `ai.credentialRef` reserved-key annex with a first-class surface; that annex's existing behavior (opaque ref, host-side `SecretResolver` dereference, `credential_forbidden` on provider mismatch) stays valid and is now a special case of the general contract. The `secrets.scopes` advertisement remains valid.

## Conformance

- **`credentials-capability-shape.test.ts`** — `host.credentials` block validates; `scopes` is a subset of the enum. (Always runs.)
- **`credential-resolve-roundtrip.test.ts`** — a `conformance.credential.echo` fixture node references a seeded credential and the host resolves it in-sandbox; the echo proves resolution without leaking. (Gated on `host.credentials.supported`.)
- **`credential-payload-redaction.test.ts`** — adversarial: assert the resolved material is absent from inputs, variables, every event payload, the debug bundle, and replay state. (Gated; backs §E.)
- **`credential-rotation-overlap.test.ts`** — old + new valid during the grace window; old fails after; canary-redaction holds. (Gated on `rotation: 'two-key-overlap'`.)

New fixtures: a seeded credential entry + the `conformance.credential.echo` node, catalogued in `conformance/fixtures.md`.

## Alternatives considered

1. **Leave credentials as the `ai.credentialRef` annex + `secrets` advertisement.** Rejected — that surface can pass a reference but cannot express storage, workspace sharing, rotation, or a redaction invariant. MyndHyve's vault stays host-private and uncertifiable, and connector packs (RFC 0045) have nothing portable to point at.
2. **Define a credential *store* API (`PUT/GET /v1/credentials`).** Rejected for v1 — putting credential *write* operations on the wire enlarges the attack surface and forces every host to expose a CRUD endpoint. The contract here is resolution + lifecycle *advertisement*; how credentials are created (UI, OAuth dance per RFC 0047, admin import) stays host-internal.
3. **Fold credentials into `host.kvStorage`.** Rejected — KV has no redaction invariant, no rotation semantics, and no scope model; conflating them would weaken both.

## Unresolved questions

1. **Per-field rotation granularity.** Should rotation be advertised per-scope (e.g. `workspace` rotates but `user` does not)? Deferred until an adopter needs split rotation.
2. **Credential *metadata* on the wire.** Operators may want non-secret metadata (provider, expiry, last-rotated) visible in a UI. A future RFC could add a redaction-safe `GET /v1/credentials/{ref}/meta`. Deferred — App-layer concern until pulled.

## Implementation notes (non-normative)

- Schema diffs (§A, §B, §F) and the SECURITY invariant (§E) land on `Active` promotion alongside the matching conformance scenarios; `scripts/check-security-invariants.sh` fails if the invariant row lands without its test.
- Reference-adopter target: MyndHyve maps its workspace vault to `scope: 'workspace'`, advertises `host.credentials.{ rotation: 'two-key-overlap', sharing: true, encryptionAtRest: true }`, and re-expresses `users/{uid}/secrets` + the workspace vault as the resolver behind the contract.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `host.credentials` block + `workspace` enum value in `capabilities.schema.json`.
- [ ] `credential-reference.schema.json` added.
- [ ] `requiredCredentials[]` + `CredentialRequirement` in `node-pack-manifest.schema.json`.
- [ ] `spec/v1/host-capabilities.md` §host.credentials section.
- [ ] `credential-payload-redaction` invariant in `SECURITY/invariants.yaml` with its test.
- [ ] Four conformance scenarios (shape, resolve-roundtrip, redaction, rotation) in `@openwop/openwop-conformance`.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `host.credentials` and passes the redaction + rotation scenarios (drives the GOVERNANCE.md second-host tripwire).

## References

- [`RFCS/0014-host-fs-capability.md`](./0014-host-fs-capability.md) — the host-capability + SECURITY-invariant template this RFC follows.
- [`RFCS/0010-auth-profile-conformance.md`](./0010-auth-profile-conformance.md) — `openwop-auth-api-key-rotation`, the two-key-overlap rotation contract reused in §D.
- [`spec/v1/run-options.md`](../spec/v1/run-options.md) §"Reserved keys" — the `ai.credentialRef` annex this RFC generalizes.
- `SECURITY/invariants.yaml` — `mcp-toolcall-payload-redaction` (the sibling redaction invariant).
- [`plans/myndhyve-protocol-extension-rfcs.md`](../plans/myndhyve-protocol-extension-rfcs.md) — Tier 1 context; RFC 0047 + RFC 0045 depend on this.
