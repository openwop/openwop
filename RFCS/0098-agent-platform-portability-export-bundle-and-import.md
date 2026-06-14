# RFC 0098: Agent Platform Portability — Export Bundle and Tenant Import

| Field             | Value                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0098                                                                                                                  |
| **Title**         | Agent Platform Portability — Export Bundle and Tenant Import                                                         |
| **Status**        | `Accepted`                                                                                                           |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                       |
| **Created**       | 2026-06-13                                                                                                          |
| **Updated**       | 2026-06-14 (`Active → Accepted`: live witnesses on both legs — the `portability.import:true` non-vacuous leg is carried by the openwop-app reference host (rev `00174-6m6`): import-of-literal-credential → 422 with the secret redacted in the error (SR-1), passing `export-bundle-portability` 6/6 vs `@openwop/openwop-conformance@1.24.0`, steward curl-verified; MyndHyve (rev `workflow-runtime-00269-ljm`) advertises `portability` with the declared honest `import:false` opt-out and serves export refs-only (→ 200). CLI `export`/`import` group live-smoke green. Both legs of the §D Accepted bar met.) · 2026-06-13 (`Draft → Active`: spec floor landed — top-level `portability` capability (with the `import ⇒ dryRun` if/then) + `export-bundle.schema.json` + `portability.md` + the `export-bundle-no-credential-material` invariant + content-free `import.applied` event + 3 capability-gated scenarios. 7-day comment window bypassed by maintainer.) |
| **Affects**       | `capabilities.schema.json`, `spec/v1/portability.md` (new), `schemas/export-bundle.schema.json` (new), `api/openapi.yaml`, conformance, `@openwop/cli` (`import`/`export` group) |
| **Compatibility** | `additive`                                                                                                          |
| **Supersedes**    | —                                                                                                                  |
| **Superseded by** | —                                                                                                                  |

## Summary

Define a portable **agent-platform export bundle** and a normative **import** endpoint so a tenant's reusable estate — agents (RFC 0070), packs (0003/0013), prompt templates (0027), connection definitions (0045/0095, *refs only*), scheduled jobs (0052), roster/org-chart (0086/0087) — can be exported from one openwop host and imported into another (or migrated from an external platform via an adapter), mapped onto the destination's RFC 0048 `{tenant, workspace?, principal}` identity, with a mandatory **dry-run plan** and **credential provenance** (RFC 0079). The bundle carries **no secret values** — only credential *refs* to be re-bound at the destination. Import is idempotent and gated by an RFC 0049 scope. Hosts that omit `portability` are unchanged. This generalizes the host-private "anonymous→user tenant migration" pattern (and the competitor "import my setup" journey, e.g. `hermes claw migrate`) into a portable, certifiable wire contract.

## Motivation

Two real journeys today have no protocol home:

1. **Cross-host / tenant migration.** Reference hosts implement a private "promote my anonymous sandbox into my signed-in tenant" step (cookie + OIDC coupled) — reassign runs/workflows/notifications `anon:* → user:*` and re-wrap credentials. That is a one-off, browser-coupled, host-private flow; an operator cannot script it, an A2A peer cannot reason about it, and there is no way to move an estate *between* openwop hosts at all.
2. **Competitor import.** The market's onboarding wedge is "bring your existing setup" — Hermes documents importing an OpenClaw install via `hermes claw migrate`. A new openwop host wants the same wedge, but there is no portable bundle for "an agent platform's reusable estate," so every host would invent its own importer.

openwop already standardizes every *piece* of the estate (agents 0070, packs 0003/0013, templates 0027, connections 0045/0095, schedules 0052, roster/org-chart 0086/0087) and the *identity* an import must land on (RFC 0048), plus the **secret invariants** an import must honor — credential material is host-side; only refs cross the wire (RFC 0046/0079). What is missing is the **bundle that composes those pieces** and the **import contract** that maps them onto a destination identity *safely*: a dry-run plan before any write, idempotent re-import, and a hard "no secret values in the bundle" invariant. Those are interop + data-integrity + security guarantees (an operator must be able to preview exactly what an import will create/overwrite, and be certain no plaintext secret was carried), so they belong on the wire. The *adapter* that reads a competitor's proprietary export and emits an openwop bundle stays a host/tooling concern; this RFC pins the bundle shape, the import endpoint, the dry-run, and the invariants.

## Proposal

### §A — `capabilities.schema.json`: additive optional top-level block

```diff
   "properties": {
     "agents": { "...": "..." },
+    "portability": {
+      "type": "object",
+      "description": "Export/import of a tenant's reusable estate (RFC 0098). Optional.",
+      "properties": {
+        "export": { "type": "boolean", "default": false },
+        "import": { "type": "boolean", "default": false },
+        "kinds": {
+          "type": "array",
+          "description": "Estate kinds this host can export/import.",
+          "items": { "enum": ["agent", "pack", "prompt-template", "connection-ref", "schedule", "roster", "org-chart"] }
+        },
+        "dryRun": { "type": "boolean", "default": true, "description": "Import supports a no-write plan preview. MUST be true if `import` is true." }
+      }
+    }
   }
```

### §B — `schemas/export-bundle.schema.json` (new)

```jsonc
{
  "$id": "https://openwop.dev/spec/v1/export-bundle.schema.json",
  "type": "object",
  "required": ["bundleVersion", "source", "items"],
  "properties": {
    "bundleVersion": { "const": "1" },
    "source": {
      "type": "object",
      "required": ["origin"],
      "properties": {
        "origin": { "type": "string", "description": "Origin host base URL or adapter id (e.g. 'adapter:openclaw')." },
        "exportedAt": { "type": "string", "format": "date-time" },
        "originPrincipal": { "type": ["string", "null"], "description": "Opaque source identity, informational only." }
      }
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "ref", "payload"],
        "properties": {
          "kind":    { "enum": ["agent", "pack", "prompt-template", "connection-ref", "schedule", "roster", "org-chart"] },
          "ref":     { "type": "string", "description": "Stable id within the bundle (for dependency edges)." },
          "dependsOn": { "type": "array", "items": { "type": "string" }, "default": [] },
          "payload": { "type": "object", "description": "The kind's existing schema (RFC 0070 manifest, 0003 pack, 0027 template, 0045 connection *ref*, 0052 job, 0086 roster, 0087 org-chart)." }
        }
      }
    }
  },
  "$comment": "A bundle MUST NOT contain credential VALUES. connection-ref items carry only refs/provider ids per RFC 0046/0079; the importer re-binds secrets at the destination."
}
```

### §C — Endpoints (host-extension `/v1/host/sample/*`, promotable to `/v1/*`)

| Method + path | Purpose |
| --- | --- |
| `GET /export[?kinds=]` | Emit an export bundle for the caller's tenant/workspace (RFC 0048). |
| `POST /import?dryRun=true` | **Plan**: validate the bundle, resolve dependency order, and return an `ImportPlan` (creates/updates/skips/conflicts + unbound credential refs) **without writing**. |
| `POST /import` | **Apply**: execute the plan idempotently. Returns an `ImportResult` per item: `created | updated | skipped | failed`, plus `secretsToRebind`. |

`ImportPlan`/`ImportResult` per item: `{ ref, kind, action, targetId?, reason? }`. Aggregate: `{ migrated: bool, counts: {...}, secretsToRebind: [provider/ref], conflicts: [...] }`. (This aggregate shape is a superset of, and supersedes, the host-private anon→user migration response.)

### §D — Events (additive, content-free, redaction-safe)

- `import.applied` — `{ bundleOrigin, counts, secretsToRebind }`. No payloads, no secret values.

### §E — `spec/v1/portability.md` normative prose (new doc)

1. An export bundle **MUST NOT** contain credential values. `connection-ref` items carry only refs/provider ids (RFC 0046/0079); the importer **MUST** report unbound refs in `secretsToRebind` and **MUST NOT** invent or transfer secret material.
2. Import **MUST** offer a dry-run when `portability.import` is advertised (`portability.dryRun` MUST be true): `POST /import?dryRun=true` **MUST NOT** write and **MUST** return the plan it would execute.
3. Import **MUST** be idempotent: re-applying the same bundle re-resolves to `skipped`/`updated`, never duplicate-creates. Items **MUST** be applied in `dependsOn` topological order; a cycle is a `422`.
4. All imported entities **MUST** be re-owned to the caller's RFC 0048 identity at the destination; source identity (`source.originPrincipal`) is informational only and **MUST NOT** grant any access.
5. Imported agents/packs that are *executable behavior* **SHOULD** route through RFC 0043 install policy (and MAY be staged as RFC 0096 proposals rather than activated directly).

### Examples

**Positive** — `GET /export?kinds=agent,prompt-template` yields a bundle; `POST /import?dryRun=true` at a second host returns a plan (`2 created, 1 conflict, secretsToRebind:[anthropic]`); operator resolves; `POST /import` creates them, re-owned to the caller, `import.applied` emitted; a re-run reports all `skipped`.

**Negative** — a bundle containing a literal API key in a `connection-ref` payload → `422` (secret-value rejection). A bundle with a `dependsOn` cycle → `422`. `POST /import` without the RFC 0049 import scope → `403`.

## Compatibility

**Additive.** New optional top-level capability block (`portability`), new bundle schema reusing existing item schemas, new host-extension endpoints, one ignorable event. Guarantees: absent the capability, nothing is served/emitted; item payloads reuse existing schemas unchanged; no run-execution wire change. The existing host-private anon→user migration remains valid — this RFC's `ImportResult` is a superset it can adopt without breaking. Lands in v1.x.

## Conformance

- **Existing coverage:** RFC 0079 credential-provenance scenarios assert no egress of secret material; RFC 0048 covers re-ownership/isolation.
- **New scenarios (capability-gated on `portability`):**
  1. *No secret values* — exporting a tenant with stored credentials yields a bundle with refs only; importing reports `secretsToRebind` and binds nothing.
  2. *Dry-run is read-only* — `?dryRun=true` returns a plan and makes zero writes (verified by a follow-up list).
  3. *Idempotent re-import* — applying the same bundle twice yields `created` then `skipped`; no duplicates.
  4. *Re-ownership* — imported entities are owned by the caller's identity, not the source principal.
  5. *Topological order / cycle* — dependencies apply in order; a cycle is rejected `422`.

## Alternatives considered

1. **Per-kind import endpoints (import agents, import packs, … separately).** Rejected: loses the dependency graph (a schedule that references an imported agent), forces clients to sequence + dedup themselves, and gives no single dry-run/plan. The bundle is the unit that makes a coherent estate move.
2. **Standardize the host-private anon→user migration as-is.** Rejected: it is cookie/SPA-coupled, single-source, and not a general portability contract; this RFC subsumes it as one degenerate case (a same-host import).
3. **Leave competitor import to bespoke host tooling.** Rejected for the *bundle* (every host would reinvent the estate format) but **kept** for the *adapter*: reading a competitor's proprietary export → an openwop bundle is explicitly out of scope here and remains host/tooling work. This RFC standardizes only the openwop-side bundle + import.
4. **Do nothing.** Rejected: no way to move an estate between openwop hosts at all, and the onboarding "bring your setup" wedge stays unbuildable.

## Unresolved questions

1. Should the bundle be signed (RFC 0076 safe-fetch / pack-signing style) when it crosses hosts, and is signature verification mandatory on import?
2. Should imported executable behavior default to **staged as RFC 0096 proposals** (review-before-activate) rather than activated — i.e., is "import = propose" the safe default?
3. How are run *history* and memory handled — explicitly out of scope (reusable estate only), or a future `kinds: ["run-archive","memory"]` extension with heavier provenance/redaction rules?

## Implementation notes (non-normative)

Reference host: `/v1/host/sample/export` + `/v1/host/sample/import` (the existing `migrate-tenant` flow becomes the same-host degenerate import). Adapters (e.g. `adapter:openclaw`) live in tooling, not the host. The `@openwop/cli` gains an `import`/`export` group: `export --kinds`, `import <bundle> --dry-run` (renders the plan), `import <bundle>` (applies), `--json` on reads, exit codes `0` applied / `2` plan-has-conflicts / `1` error; it never accepts or prints secret values. Sequencing: depends on RFC 0048 + RFC 0079 (Accepted); composes RFC 0096 (import-as-proposal) once that lands.

## Acceptance criteria

- [ ] Spec text merged (`spec/v1/portability.md`).
- [ ] `capabilities.schema.json` + `export-bundle.schema.json` updated; `api/openapi.yaml` paths added.
- [ ] ≥1 conformance scenario per §Conformance, capability-gated; the no-secret-values scenario is mandatory.
- [ ] CHANGELOG entry under the target v1.x.
- [ ] Reference host implements export/import and passes the new scenarios, or the RFC explicitly defers reference-host implementation.

## References

- RFC 0048 (tenant/workspace/principal identity) · RFC 0046 (host credentials) · RFC 0079 (credential provenance & egress policy) · RFC 0045 / 0095 (connection packs) · RFC 0003 (agent packs) · RFC 0013 (workflow-chain packs) · RFC 0027 (prompt templates) · RFC 0052 (scheduling) · RFC 0070 (agent manifest runtime) · RFC 0086 (roster) · RFC 0087 (org-chart) · RFC 0043 (registry & extension policy) · RFC 0076 (pack runtime & safe-fetch) · RFC 0096 (reviewable-learning proposals) · RFC 0040 (cross-host causation).
- Prior art: Hermes `hermes claw migrate` (competitor import journey); OpenClaw export; OCI image manifests + `dependsOn` topological apply; Terraform plan/apply dry-run model.
- Competitive feature analysis (`docs/`).
