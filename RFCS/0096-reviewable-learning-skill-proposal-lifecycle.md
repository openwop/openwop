# RFC 0096: Reviewable Learning — Skill/Automation Proposal Lifecycle

| Field             | Value                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0096                                                                                                                  |
| **Title**         | Reviewable Learning — Skill/Automation Proposal Lifecycle                                                            |
| **Status**        | `Accepted`                                                                                                           |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                       |
| **Created**       | 2026-06-13                                                                                                          |
| **Updated**       | 2026-06-14 (`Active → Accepted`: non-steward live witness — MyndHyve advertises `agents.proposals` at the locked shape on live rev `workflow-runtime-00269-ljm` and serves the host-sample seams non-vacuously (apply-without-scope → 403), steward curl-verified; openwop-app reference host (rev `00174-6m6`) serves the full surface + passed `proposal-reviewable-learning` 7/7 non-vacuous vs `@openwop/openwop-conformance@1.24.0`. CLI `proposals` group live-smoke green. Both legs of the §D Accepted bar met.) · 2026-06-13 (`Draft → Active`: spec floor landed — `agents.proposals` capability + `proposal.schema.json` + `agent-memory.md` §"Reviewable learning" + the `proposal-inert-until-applied` / `proposal-no-resynthesis` invariants + content-free `proposal.created`/`proposal.activated` events + 3 capability-gated scenarios. `rule` artifact kind dropped (no defining RFC). 7-day comment window bypassed by maintainer.) |
| **Affects**       | `capabilities.schema.json`, `spec/v1/agent-memory.md` (new §), `schemas/proposal.schema.json` (new), `api/openapi.yaml`, conformance, `@openwop/cli` (`proposals` group) |
| **Compatibility** | `additive`                                                                                                          |
| **Supersedes**    | —                                                                                                                  |
| **Superseded by** | —                                                                                                                  |

## Summary

Add an optional, capability-gated **proposal lifecycle** so a host can let an agent synthesize a *reusable artifact* — a skill (agent pack, RFC 0003), a workflow-chain pack (RFC 0013), a prompt template (RFC 0027), or a scheduled automation (RFC 0052) — from its own run/tool traces, and have that artifact remain **inert until a human reviews and activates it**. A `Proposal` is a durable, draft-state object with a typed `artifact` payload, a provenance pointer to the traces that produced it, a duplication signal against existing artifacts, and a small state machine (`draft → revise → applied | rejected | archived`). Activation is **not a new authorization path** — it is delegated to the RFC 0051 approval-gate semantics (role/scope/quorum, audited override). Hosts that omit the `agents.proposals` capability are unchanged; nothing about the run-execution wire changes.

## Motivation

The competitive landscape for self-hosted agents (OpenClaw "Skill Workshop," Hermes self-improvement + "Curator") converges on one product-ready idea: an agent that **improves from experience without silently mutating its own long-term behavior**. The pattern that works is *proposal-first* — the agent drafts a reusable behavior, but the draft is inert until a human revises/approves it. This is materially safer than letting an agent rewrite its production behavior in place, and it is the single most-cited differentiator in the `docs/` competitive feature analysis that drove the v1.x agent-platform RFC wave (0070, 0081, 0082, 0085, 0086).

openwop already has every *downstream* primitive but no *upstream* contract:

- **Artifacts** a proposal can produce exist: agent packs (0003), workflow-chain packs (0013), prompt templates (0027), scheduled automations (0052).
- **Activation governance** exists: RFC 0051 `approvalGate` binds role/scope/quorum + audited override; RFC 0049 RBAC; RFC 0043 registry-and-extension policy gates what may be installed.
- **Quality signal** exists: RFC 0081 scorecards, RFC 0056 run feedback/annotation.

What is missing is the **inert-draft object and its review state machine**: where a synthesized-but-unapproved behavior lives, how it is revised, how it is shown to differ from what already exists (duplication detection — the "Curator" problem), and the hard invariant that it **cannot affect any future run until explicitly activated**. Today that is host-private: an A2A peer or the conformance suite cannot assert "this synthesized skill was inert until an authorized principal applied it." That invariant — *no generated reusable behavior influences a run before review* — is a safety + interop guarantee an operator depends on, so it belongs on the wire. The *synthesis algorithm* (what traces become what artifact) stays entirely a host choice; this RFC pins only the object shape, the lifecycle, the gate, and the inertness invariant.

## Proposal

### §A — `capabilities.schema.json`: additive optional sub-block under `agents`

```diff
   "agents": {
     "type": "object",
     "properties": {
+      "proposals": {
+        "type": "object",
+        "description": "Host synthesizes reusable artifacts from run/tool traces as inert, reviewable drafts (RFC 0096). Optional.",
+        "properties": {
+          "artifactKinds": {
+            "type": "array",
+            "description": "Which artifact kinds the host can propose.",
+            "items": { "enum": ["agent-pack", "workflow-chain-pack", "prompt-template", "automation"] }
+          },
+          "duplicationDetection": { "type": "boolean", "default": false },
+          "activation": {
+            "enum": ["approval-gate", "direct-rbac"],
+            "description": "`approval-gate` routes activation through an RFC 0051 gate; `direct-rbac` requires an RFC 0049 scope only."
+          }
+        },
+        "required": ["artifactKinds", "activation"]
+      }
     }
   }
```

A host advertises `agents.proposals` only if it serves the §C endpoints. The CLI (and any client) MUST capability-gate on this block and fail closed when it is absent.

### §B — `schemas/proposal.schema.json` (new)

```jsonc
{
  "$id": "https://openwop.dev/spec/v1/proposal.schema.json",
  "type": "object",
  "required": ["id", "kind", "state", "artifact", "provenance", "createdAt", "owner"],
  "properties": {
    "id":    { "type": "string", "description": "Host-assigned, stable across revisions." },
    "kind":  { "enum": ["agent-pack", "workflow-chain-pack", "prompt-template", "automation"] },
    "state": { "enum": ["draft", "revised", "applied", "rejected", "archived"] },
    "title": { "type": "string" },
    "rationale": { "type": "string", "description": "Plain-language why, SR-1 redaction-safe (no secrets/PII)." },
    "artifact":  { "type": "object", "description": "The proposed artifact, shaped by `kind` (an RFC 0003 pack manifest, an RFC 0027 template, an RFC 0052 job spec, …). Inert until applied." },
    "provenance": {
      "type": "object",
      "required": ["sourceRunIds"],
      "properties": {
        "sourceRunIds": { "type": "array", "items": { "type": "string" }, "description": "Runs whose traces produced this proposal (RFC 0040 causation-compatible)." },
        "synthesizerModel": { "type": "string" }
      }
    },
    "duplicateOf": { "type": ["string", "null"], "default": null, "description": "Existing artifact ref this proposal restates/overlaps, if duplication detection is on." },
    "owner": { "type": "object", "additionalProperties": false, "required": ["tenant"], "properties": { "tenant": { "type": "string", "minLength": 1 }, "workspace": { "type": "string", "minLength": 1 }, "principal": { "type": "string", "minLength": 1 } }, "description": "RFC 0048 identity triple {tenant, workspace?, principal} — inlined (no standalone identity.schema.json in the corpus; matches run-snapshot.schema.json.owner)." },
    "activation": { "type": ["object", "null"], "description": "When applied: the RFC 0051 approval reference + the resulting installed artifact ref.", "default": null },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" }
  }
}
```

### §C — Endpoints (host-extension `/v1/host/sample/proposals`, promotable to `/v1/proposals`)

| Method + path | Purpose |
| --- | --- |
| `GET /proposals[?state=&kind=]` | List proposals (tenant/workspace-scoped per RFC 0048). |
| `GET /proposals/{id}` | One proposal, including the inert `artifact`. |
| `PATCH /proposals/{id}` | Author edits the draft (`revise`): mutates `artifact`/`title`/`rationale`, sets `state: revised`. MUST NOT activate. |
| `POST /proposals/{id}/apply` | Activate. MUST route through the advertised `activation` mode (§A); on success installs the artifact via the relevant pack/registry path (RFC 0043) and sets `state: applied` with `activation` populated. |
| `POST /proposals/{id}/reject` | `state: rejected` with an optional reason. |
| `DELETE /proposals/{id}` | `state: archived` (soft). |

### §D — Events (additive, content-free, redaction-safe)

Two new optional events, gated on `agents.proposals`:

- `proposal.created` — `{ proposalId, kind, sourceRunIds, duplicateOf }`. Emitted when the host synthesizes a draft. No artifact body, no rationale text (those live behind the authed read).
- `proposal.activated` — `{ proposalId, kind, approvalId?, installedArtifactRef }`. Emitted on successful `apply`.

### §E — `spec/v1/agent-memory.md` normative prose (new section "Reviewable learning")

1. A `Proposal` in any state other than `applied` **MUST NOT** influence the resolution, planning, or execution of any run. (The inertness invariant.)
2. `apply` **MUST** be authorized: if `activation = approval-gate`, the host **MUST** drive an RFC 0051 gate and **MUST NOT** install the artifact unless the gate is `granted` (or `overridden`, which **MUST** be audited per RFC 0009/0010); if `activation = direct-rbac`, the caller **MUST** hold the RFC 0049 scope the host advertises for activation.
3. On `apply`, the installed artifact **MUST** be the exact `artifact` payload last persisted on the proposal (no silent re-synthesis at activation).
4. `provenance.sourceRunIds` and `rationale` **MUST** be SR-1 redaction-safe.

### Examples

**Positive** — a `draft` agent-pack proposal is read, revised via `PATCH`, then `apply` drives an `approval-gate`; gate `granted` → `installedArtifactRef` returned, `proposal.activated` emitted.

**Negative (fails validation / authorization)** — `POST /proposals/{id}/apply` by a principal lacking the activation scope → `403`, `state` stays `revised`, no artifact installed, no `proposal.activated`. A proposal whose `artifact` is malformed for its `kind` → `422`.

## Compatibility

**Additive.** New optional capability sub-block (`agents.proposals`), new schema, new host-extension endpoints, two new ignorable events. Guarantees: hosts that don't advertise `agents.proposals` neither serve the endpoints nor emit the events; existing clients never see proposals; the run-execution wire (RFC 0033 completion contract, RFC 0040 causation) is untouched. Lands in v1.x.

## Conformance

- **Existing coverage:** RFC 0051 approval-gate scenarios cover the activation path; RFC 0043 covers install policy.
- **New scenarios (ship with `@openwop/openwop-conformance`):**
  1. *Inertness* — a `draft` proposal whose `artifact` is a workflow-chain pack does not alter a run that would match it; only after `apply` does the behavior appear.
  2. *Gated activation* — `apply` without the required role/scope is denied; with it (or a quorum-met gate) succeeds and emits `proposal.activated`.
  3. *No re-synthesis* — the installed artifact byte-matches the last-persisted `artifact`.
- New scenarios run only when `agents.proposals` is advertised.

## Alternatives considered

1. **Let agents write skills/packs directly (no proposal object).** Rejected: this is exactly the "agent silently mutates its production behavior" failure the market avoids; it makes the inertness invariant unexpressible and uncertifiable.
2. **Reuse RFC 0082 agent-deployment-lifecycle.** Rejected: 0082 promotes an *already-authored* agent through environments; a proposal is a *synthesized, not-yet-real* artifact pending first review. Different object, different state machine; 0082 is a good downstream once an applied proposal becomes a deployable agent.
3. **Fold into RFC 0068 memory consolidation.** Rejected: 0068 reconciles the *memory corpus*; a proposal produces an *executable reusable artifact*. Conflating them overloads one capability with two semantics.
4. **Do nothing.** Rejected: leaves the single strongest market differentiator host-private and unverifiable.

## Unresolved questions

1. Should `duplicateOf` be a single ref or a ranked list (Curator-style near-duplicate cluster)?
2. Should `revise` fork a new `id` (versioned proposals) or mutate in place (current draft: mutate, with `updatedAt`)?
3. Does an `applied` proposal that is later found harmful get a first-class `rollback`, or is that just the artifact's own uninstall path (RFC 0043)?

## Implementation notes (non-normative)

Reference host: surface under `/v1/host/sample/proposals`; the synthesizer is a host concern (an LLM pass over `sourceRunIds` traces). The `@openwop/cli` `proposals` group drives the lifecycle (`list`/`get`/`revise`/`apply`/`reject`/`archive`, `--json` on reads, exit codes `0` applied / `3` pending-review / `1` rejected|error). Sequencing: depends on RFC 0051 (Accepted) for activation; pairs naturally with the CLI `approvals` group already shipped.

## Acceptance criteria

- [ ] Spec text merged (`agent-memory.md` §"Reviewable learning").
- [ ] `capabilities.schema.json` + `proposal.schema.json` updated; `api/openapi.yaml` paths added.
- [ ] ≥1 conformance scenario per §Conformance, capability-gated.
- [ ] CHANGELOG entry under the target v1.x.
- [ ] Reference host implements `/v1/host/sample/proposals` and passes the new scenarios, or the RFC explicitly defers reference-host implementation.

## References

- RFC 0051 (approval/deployment gate) · RFC 0049 (RBAC) · RFC 0043 (registry & extension policy) · RFC 0003 (agent packs) · RFC 0013 (workflow-chain packs) · RFC 0027 (prompt templates) · RFC 0052 (scheduling) · RFC 0081 (scorecards) · RFC 0056 (run feedback/annotation) · RFC 0048 (identity triple) · RFC 0040 (cross-host causation).
- Prior art: OpenClaw Skill Workshop (proposal-first skills); Hermes self-improvement + Curator (near-duplicate curation); Rust RFC "experimental → stabilized" gating.
- Competitive feature analysis (`docs/`), the driver for the v1.x agent-platform RFC wave.
