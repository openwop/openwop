# RFC 0069: Host-extension safety contract for `exec`-class tools

| Field | Value |
|---|---|
| **RFC** | 0069 |
| **Title** | A normative carve-out: arbitrary-command (`exec`-class) execution MUST NOT be a protocol-tier capability — it lives only in named host-extension scopes (`x-host-<vendor>-exec`) whose safety controls the host owns end-to-end. Codifies an existing exclusion; no host wire shape changes. |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-26 |
| **Updated** | 2026-06-01 (`Active → Accepted`) — graduated as a **steward codification flip with no host dependency**, the RFC 0054 amendment precedent for deterministic corpus-level guarantees that cannot be adoption-gated. RFC 0069 advertises NO capability and changes no host's wire shape — it is a structural carve-out asserting the protocol corpus defines no `exec`-class primitive — so there is nothing a non-steward host could advertise to prove it; its guarantee is proven directly against the corpus by the always-on, server-free `exec-not-protocol-tier.test.ts` (the `exec-must-not-be-protocol-tier` protocol-tier SECURITY invariant), green on `main`. All six acceptance criteria are `[x]`. Accepting it on this basis (rather than leaving it `Active` indefinitely behind an unsatisfiable adoption gate) mirrors how RFC 0054 was amended. · 2026-05-29 — promoted `Draft → Active`. Every acceptance artifact already landed on `main` (this RFC codifies the existing exclusion: the `host-extensions.md` §"`exec`-class tools" MUST-NOT, the threat-model row + §4.7, the protocol-tier `exec-must-not-be-protocol-tier` invariant, and the always-on `exec-not-protocol-tier.test.ts` are all merged and CI-green). The 7-day comment window is opened and waived under the bootstrap-phase steward waiver (`GOVERNANCE.md` §bootstrap; single-maintainer phase, no non-steward maintainer yet). No host wire change. |
| **Affects** | `spec/v1/host-extensions.md` (new §"`exec`-class tools") · `SECURITY/threat-model-prompt-injection.md` (new §"`exec` tools" + an invariant row) · `SECURITY/invariants.yaml` (new protocol-tier invariant `exec-must-not-be-protocol-tier`) · `CHANGELOG.md` · new conformance scenario `exec-not-protocol-tier.test.ts` |
| **Compatibility** | `additive` (codifies an existing exclusion; safety-fix-shaped but no host's wire shape changes) |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop deliberately ships no `exec`-class tool — no protocol-tier primitive that runs an arbitrary host command on behalf of a workflow or an LLM. This RFC makes that exclusion **explicit and normative** rather than implicit. It adds a MUST-NOT to `spec/v1/host-extensions.md`: a host MUST NOT expose arbitrary-command execution under any protocol-owned namespace (`core.*`, `openwop.*`, or a `capabilities.*` flag); a host that needs `exec` exposes it only under a named host-extension scope (`x-host-<vendor>-exec`) and owns the safety story (sandboxing, allowlists, approval gates, audit) end-to-end. It adds a threat-model section and a protocol-tier SECURITY invariant (`exec-must-not-be-protocol-tier`) with a conformance scenario that asserts the protocol's own surface (the `core.*` node catalog, the capability schema, the canonical event/error vocabulary) defines no exec primitive. No host's wire shape changes — this codifies the status quo so an independent implementer can't read silence as permission.

## Motivation

The feature-gap analysis (`docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` row 7) classifies arbitrary-command execution as **HIGH risk** and recommends "file a new RFC defining a host-extension safety contract for `exec`-class tools (out-of-band, NOT in the protocol)." Its Out-of-scope section is blunt: "`exec`-class arbitrary command execution. Risky enough that the proposed RFC explicitly carves it OUT of the protocol rather than IN."

The risk is concrete. `exec` is the highest-severity attack surface a workflow runtime can expose:
- **Prompt-injection → RCE.** An LLM-emitted or untrusted-input-derived command string, if executed, turns a prompt-injection foothold into remote code execution on the host. openwop's prompt-injection threat model already establishes that LLM output and pack output are *untrusted* (`node-pack-output-untrusted`, the `<UNTRUSTED>` marker discipline); a protocol-tier `exec` would let that untrusted content reach a shell.
- **Sandbox escape.** RFC 0008 (WASM ABI) + RFC 0035 (sandbox invariants) already pin that sandboxed pack code MUST NOT spawn host processes, fork, or call exec-family syscalls (`node-pack-sandbox-no-process`). A protocol-tier `exec` capability would directly contradict that invariant set.
- **Multi-tenant blast radius.** openwop is multi-tenant (`tenantId` + `scopeId`); a shared exec surface is a cross-tenant catastrophe waiting on one path-traversal or one missed allowlist.

Today the protocol simply *doesn't define* an exec tool. But silence is not a contract. An independent implementer building a "core exec node" could read the absence as an unfilled gap rather than a deliberate exclusion, name it `core.exec`, and ship a protocol-tier RCE primitive that other hosts and clients would then treat as canonical. The spec is the right place to fix this because the exclusion is an **interop + security commitment**: every conforming host must agree that `exec` is host-extension-only, and the registry/extension-policy (RFC 0043) must refuse a `core.*` exec namespace. This RFC writes the rule down and gives it a test.

## Proposal

### §A — `host-extensions.md` new section "`exec`-class tools" (normative)

Add a section under §"What hosts MUST NOT do" (or adjacent to it):

> ### `exec`-class tools (arbitrary command execution)
>
> An **`exec`-class tool** is any capability that runs a caller- or model-supplied command, shell string, script, or binary on the host or in an environment the host controls (e.g., a "run this shell command", "execute this Python", or "spawn this process" tool).
>
> **`exec`-class execution MUST NOT be a protocol-tier capability.** Specifically, a conforming host MUST NOT:
> - define an `exec`-class tool under a protocol-owned namespace (`core.*` or `openwop.*`) — neither as a node typeId, an envelope type, nor a built-in tool;
> - advertise an `exec`-class capability under a protocol-owned `capabilities.*` flag;
> - redefine an existing protocol-tier capability (`host.fs`, `host.mcp`, a node pack, a connector) to perform arbitrary command execution.
>
> A host that needs `exec`-class execution MUST expose it **only** under a named host-extension scope using the canonical vendor prefix (`x-host-<vendor>-exec`, or a `vendor.<org>.*` / `private.<host>.*` node-pack namespace per §"Canonical prefixes"). The host owns the safety controls end-to-end and SHOULD document, at minimum:
> - **Sandboxing** — exec MUST run isolated from the host process and other tenants (RFC 0035 §A sandbox invariants are the recommended baseline; `node-pack-sandbox-no-process` already forbids protocol-tier sandboxed code from spawning processes, so any exec surface is by definition outside that sandbox and needs its own isolation).
> - **Command allowlisting / no shell interpolation** — the command set MUST be constrained; untrusted (LLM- or input-derived) content MUST NOT be interpolated into a shell string (this is the `prompt-injection-input-marker` / `node-pack-output-untrusted` discipline applied to the exec boundary).
> - **Human approval gating** — destructive or unbounded exec SHOULD require an RFC 0051 `approval` interrupt before execution.
> - **Audit** — every exec invocation SHOULD emit a host-internal audit record; the protocol does not normate its shape.
>
> Clients MUST treat any `x-host-<vendor>-exec` surface as opaque (per §"How extensions appear on the wire") and MUST NOT assume an exec extension is portable across hosts. A host MUST NOT depend on a client understanding its exec namespace.
>
> **Rationale.** `exec` is the highest-severity surface in a workflow runtime: a single prompt-injection or input-validation lapse becomes remote code execution, and a shared exec surface is a cross-tenant blast radius. The protocol stays exec-free so that no conforming host inherits that surface by default; hosts that accept the risk own it explicitly, in their own namespace, with their own controls. See `SECURITY/threat-model-prompt-injection.md §"exec tools"` and the `exec-must-not-be-protocol-tier` invariant.

Add a cross-reference from §"What stays in the protocol" / §"What hosts own" noting that arbitrary command execution is a host concern, never a protocol concern.

### §B — `threat-model-prompt-injection.md` new section "`exec` tools"

Add to §4 (threat table) and §5 (invariants):

- Threat-table row: *"LLM output or untrusted input is executed as a host command (RCE) | A protocol-tier `exec` tool would let prompt-injection reach a shell | The protocol defines no `exec`-class tool; exec is host-extension-only with host-owned sandboxing/allowlist/approval per `host-extensions.md §exec-class tools` | `exec-must-not-be-protocol-tier`"*
- §5 invariant row: *"`exec-must-not-be-protocol-tier` | Arbitrary-command (`exec`-class) execution MUST NOT be exposed under any protocol-owned namespace (`core.*`, `openwop.*`) or `capabilities.*` flag; it lives only in named host-extension scopes whose safety controls the host owns end-to-end."*

### §C — `SECURITY/invariants.yaml` new protocol-tier invariant

```yaml
  - id: exec-must-not-be-protocol-tier
    tier: protocol
    severity: critical
    threat_model: SECURITY/threat-model-prompt-injection.md
    tests:
      - conformance/src/scenarios/exec-not-protocol-tier.test.ts
    note: |
      RFC 0069. Arbitrary-command (`exec`-class) execution MUST NOT be a
      protocol-tier capability. The protocol defines NO exec-class tool
      under a protocol-owned namespace (`core.*` / `openwop.*`), NO
      exec capability flag in `capabilities.schema.json`, and NO
      exec-class entry in the canonical event/error vocabulary. A host
      that needs exec exposes it ONLY under a named host-extension scope
      (`x-host-<vendor>-exec`) with host-owned sandboxing + allowlist +
      approval-gating + audit, per `host-extensions.md §"exec-class tools"`.
      This invariant guards against an independent implementer reading
      the protocol's silence as permission to ship a `core.exec` RCE
      primitive other hosts would treat as canonical. The conformance
      scenario asserts the protocol's OWN surface (the published `core.*`
      node catalog, capability schema property names, and the canonical
      vocabularies) contains no exec-class primitive — a structural
      assertion against the spec corpus, not a host behavior.
```

### §D — conformance scenario `exec-not-protocol-tier.test.ts`

A server-free structural assertion over the spec corpus (mirrors the existing `spec-corpus-validity.test.ts` style — no host required):
- Assert no `core.*` / `openwop.*` node typeId, envelope type, or capability property name matches an exec-class pattern (`exec`, `shell`, `spawn`, `runCommand`, `runScript`, `subprocess` — case-insensitive, as a whole namespaced segment), EXCEPT where the token is part of an already-defined, non-exec name (the test uses an exact closed denylist of exec-class identifiers, asserting none appear as a protocol-owned typeId/capability — it does not flag substrings like `execution` in `multi-agent-execution`).
- Assert `capabilities.schema.json` defines no top-level or `agents.*`/`host.*` property whose name denotes arbitrary command execution.
- Assert the canonical error-code and event-name vocabularies contain no exec-class member.
- The scenario carries a positive control: a `vendor.acme.exec` / `x-host-acme-exec` identifier is *allowed* (host-extension namespace) — the assertion only fires on protocol-owned namespaces.

### Examples

**Positive (conformant host).** A host that needs to run shell commands ships a node pack `vendor.acme.exec` with `peerDependencies: { "x-host-acme-exec": "supported" }`, runs each command in an nsjail sandbox against an allowlist, and gates destructive commands behind an RFC 0051 approval. The protocol never sees it as anything but an opaque host extension. Conformant.

**Negative (non-conformant host).** A host defines a node typeId `core.exec` (or advertises `capabilities.exec.supported: true`, or `capabilities.host.shell`) that runs `RunOptions.configurable.command` in a subprocess. Non-conformant by §A — exec under a protocol-owned namespace. The `exec-not-protocol-tier` scenario fails if such a primitive were ever added to the spec corpus; a host that ships it locally is advertising a non-conformant protocol-tier capability.

## Compatibility

**Additive in practice; safety-fix-shaped in intent.** This RFC codifies an *existing* exclusion — the protocol corpus today defines no exec-class primitive, so no host's wire shape changes and no conforming host is invalidated. It is not a §2.2 breaking change: nothing required becomes optional, no type changes, no error-code meaning changes, no endpoint contract changes. It *adds* a MUST-NOT that was previously implicit, which is the safety-fix *shape* — but because the status quo already satisfies it, there is no migration burden and no 90-day embargo is needed (no CVE-class defect is being disclosed; the surface never existed). A host that had privately shipped a `core.exec` primitive (a pre-existing protocol violation, since `core.*` is registry-reserved per RFC 0043) would need to rename it to `x-host-<vendor>-exec` — that is the only migration, and it is a correction of an already-non-conformant state.

Forward-compatibility clauses:
- No new field, event, error code, capability flag, or endpoint is added — the change is prose + one threat-model section + one invariant + one structural conformance scenario.
- The invariant is a *structural* assertion over the spec corpus (the protocol's own surface), so it cannot regress a host that already advertises only host-extension exec.

## Conformance

- **Existing coverage.** `spec-corpus-validity.test.ts` (server-free corpus structural checks) is the nearest neighbor — the new scenario follows its pattern. `runtime-capabilities.test.ts` / `discovery.test.ts` cover capability-shape validation. The sandbox scenarios (`sandbox-no-host-process-escape.test.ts`, RFC 0035) cover the complementary "sandboxed pack code can't spawn a process" surface.
- **New scenario — `exec-not-protocol-tier.test.ts`** (always-on, server-free, <1s): the §D structural assertions over the spec corpus. Always-on (not capability-gated) because it asserts the protocol's *own* surface, not a host's advertisement — it must hold for every release of the corpus regardless of which host runs it.
- **Capability gating.** None — this is a corpus-structural invariant, always asserted.
- **Reference host.** No reference-host change needed — the invariant is satisfied by the protocol corpus itself; the scenario verifies that.
- **Fixtures.** None.

## Alternatives considered

1. **Define a sandboxed `core.exec` primitive with a strict capability contract** (bring exec *into* the protocol with mandatory sandboxing). Rejected — even a sandboxed protocol-tier exec normalizes the most dangerous surface in the runtime and creates an attractive nuisance: every host would feel pressure to implement it, and one sandbox-escape CVE becomes a protocol-wide incident. The gap analysis is explicit that exec must be carved OUT, not IN. Sandboxed pack execution (RFC 0008/0035) already covers *constrained* computation without arbitrary host commands.
2. **Leave the exclusion implicit** (do nothing; the protocol simply doesn't define exec). Rejected — silence is not a contract. An independent implementer can read an unfilled gap as an invitation, ship `core.exec`, and other hosts/clients would treat it as canonical. The whole point is to convert silence into a normative MUST-NOT with a test, so the exclusion survives contact with implementers who didn't read the threat model.
3. **A non-normative note in `positioning.md`** ("exec is out of scope") without an invariant or test. Rejected — a note has no enforcement. The gap analysis assigns this HIGH risk; a HIGH-risk exclusion deserves a protocol-tier invariant + a conformance scenario, not a prose aside.

## Unresolved questions

1. **Denylist completeness.** §D asserts no protocol-owned identifier matches an exec-class denylist (`exec`, `shell`, `spawn`, `runCommand`, `runScript`, `subprocess`, …). Is the closed denylist the right mechanism, or should the test assert against an allowlist of known-safe `core.*` typeIds instead (fail on any new `core.*` exec-shaped name)? Proposed: closed denylist for `Draft` (lower false-positive risk); revisit if the `core.*` catalog grows a legitimately exec-adjacent-but-safe name. Decide before `Active`.
2. **Relationship to a future "command connector".** Some hosts may want a *constrained* command surface (e.g., a connector that runs one specific, pre-registered binary with structured args, no shell). Is that an `exec`-class tool (host-extension-only) or a constrained connector (potentially protocol-tier under the RFC 0045 connector-manifest model)? Proposed: anything that runs a *caller/model-supplied* command is exec-class (host-extension-only); a connector that runs a *manifest-declared, host-resolved* action with structured args is not exec-class (it is the existing connector model). Confirm the boundary with an implementer before `Active`.
3. **Sandbox-baseline normativity.** §A lists sandboxing/allowlist/approval/audit as SHOULD for host-extension exec. Should any of these be MUST for a host that *advertises* an exec extension (even though the extension itself is non-portable)? Proposed: keep SHOULD at `Draft` — the protocol cannot enforce controls on a surface it deliberately doesn't define — but consider a MUST on "untrusted content MUST NOT be shell-interpolated" since that maps onto an existing protocol-tier prompt-injection invariant. Decide before `Active`.

## Implementation notes (non-normative)

- This RFC is prose + invariant + structural test; it lands no schema or wire change. The conformance scenario is the load-bearing artifact — it must pass against the corpus *as it stands today* (which it will, since no exec primitive exists) and would fail loudly if a future PR added one.
- The CLI/demo `exec`-adjacent work in the gap analysis (sandboxed dev exec) is implementation-only and lives in vendor host-extension territory — out of this RFC's scope, and a good first consumer of the `x-host-<vendor>-exec` convention this RFC names.
- Pairs with RFC 0043 (registry + extension policy): the registry MUST refuse to publish a pack claiming a `core.*` exec typeId, since `core.*` is registry-reserved. This RFC's invariant and RFC 0043's namespace reservation are mutually reinforcing.

## Acceptance criteria

- [x] `host-extensions.md §"exec-class tools"` with the normative MUST-NOT + the named-host-extension carve-out + the safety-control SHOULDs.
- [x] `threat-model-prompt-injection.md` §"exec tools" threat row + §5 invariant row.
- [x] `SECURITY/invariants.yaml` carries `exec-must-not-be-protocol-tier` (protocol-tier) with a resolving test glob.
- [x] `exec-not-protocol-tier.test.ts` asserts the protocol corpus defines no exec-class primitive (always-on, server-free).
- [x] CHANGELOG entry under `[1.1.6 — unreleased]`.
- [x] No reference-host change required (the invariant is satisfied by the corpus; the scenario verifies it) — explicitly noted.

## References

- [`spec/v1/host-extensions.md`](../spec/v1/host-extensions.md) — the protocol-vs-host-extension boundary this RFC sharpens; §"Canonical prefixes" + §"What hosts MUST NOT do".
- [`SECURITY/threat-model-prompt-injection.md`](../SECURITY/threat-model-prompt-injection.md) — LLM/pack-output-untrusted discipline the exec MUST-NOT extends.
- [`SECURITY/threat-model-node-packs.md`](../SECURITY/threat-model-node-packs.md) §sandbox — RFC 0035 sandbox invariants (`node-pack-sandbox-no-process`) the exec carve-out is consistent with.
- [`RFCS/0035-sandbox-execution-contract.md`](./0035-sandbox-execution-contract.md) — sandbox execution invariants (sandboxed code MUST NOT spawn processes).
- [`RFCS/0043-registry-and-extension-policy.md`](./0043-registry-and-extension-policy.md) — namespace reservation (`core.*` is protocol-owned; the registry refuses a `core.exec`).
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — the approval interrupt host-extension exec SHOULD gate behind.
- `docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` row 7 + Out-of-scope §"exec-class arbitrary command execution".
