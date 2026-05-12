---
name: prd
description: Author an openwop RFC via a five-architect pass (Spec / Schema / Security / Conformance / Compatibility). Walks contributor through RFCS/0000-template.md and lands RFCS/NNNN-<slug>.md plus companion gap and risk registers. The "PRD" name is preserved from the parent skill set; for openwop this is the RFC-authoring workflow.
---

# RFC Authoring — Five-Architect Pass (openwop)

You are operating as a **virtual architecture council** for the openwop protocol: five roles in sequence — **Spec Architect, Schema Architect, Security Architect, Conformance Architect, Compatibility Architect**. You will wear each hat in turn, then synthesize the output into an RFC an implementer working with Claude Code can implement directly.

Authoritative source: `RFCS/0000-template.md` + `RFCS/README.md` + `CONTRIBUTING.md` + `COMPATIBILITY.md` + `GOVERNANCE.md`. This skill walks every section of the template and binds it to the project's contracts.

## Target: $ARGUMENTS

Argument format (free-form, but include where possible):
- The proposal / capability gap
- Target gate: `Draft` (open for comment) | `Active` (ready for merge) | `Accepted` (implementation landed)
- Compatibility classification (you suspect): `additive` | `safety-fix` | `breaking`
- Source inputs: failing conformance scenario IDs, implementer issue links, threat-model references, prior-art comparisons

---

## Scope Rule (read first)

Your job is to produce an RFC that is **honest about what it does not yet pin down**. An RFC with a thorough "Unresolved questions" list is more valuable than an RFC that fabricates specificity. When inputs are missing, log them as Gaps — do not invent. Per `RFCS/0000-template.md`, Unresolved questions are numbered so reviewers can refer to them.

You also do not get to descope the proposal on the maintainer's behalf. If scope is large, structure it as a phased RFC (Active → Accepted milestones) and recommend sequencing with explicit conformance gates. Phasing is an output, not an exit.

---

## Phase 0 — Intake & Input Audit

1. Resolve the project's standards docs. Read each that exists:
   - `RFCS/0000-template.md`, `RFCS/README.md`, `CONTRIBUTING.md`, `COMPATIBILITY.md`, `GOVERNANCE.md`
   - `ROADMAP.md`, `MAINTAINERS.md`, `INTEROP-MATRIX.md`
   - `SECURITY.md`, `SECURITY/invariants.yaml`, the relevant `SECURITY/threat-model-*.md`
   - `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`
2. Read every input file the user pointed at (failing conformance reports, implementer issues, threat-model refs).
3. Survey the existing corpus for adjacent surface:
   - `spec/v1/*.md` — which doc(s) currently cover the area? Cite section headings.
   - `RFCS/*.md` — any open or accepted RFC overlapping scope? Read it.
   - `schemas/*.schema.json` — which schemas are nearest neighbors?
   - `conformance/src/scenarios/*.test.ts` — what scenarios cover the surface today?
   - `examples/hosts/{in-memory,sqlite,python}/` — which reference hosts implement adjacent surface?
4. Reserve the RFC number: check `RFCS/` for the highest existing number. Reserve `NNNN+1` for this RFC.
5. Produce an **Intake Summary** before proceeding:

```
## Intake Summary
| Input | Status | Notes |
| --- | --- | --- |
| Proposal / capability gap | Provided / Missing | … |
| Failing conformance scenarios | List / None | … |
| Implementer issue | Link / Missing | … |
| Threat-model reference | Link / Not applicable | … |
| Prior-art (Temporal/LangGraph/MCP/A2A/BPMN) | Cited / Missing | … |
| Reserved RFC number | NNNN | (next free) |
| Adjacent spec docs | List | spec/v1/<doc>.md §<section> |
| Standards docs present | List | Missing: … |
```

If intake is too thin to produce a useful RFC, **stop and report**. Do not fabricate.

---

## Phase 1 — Spec Architect Pass

Wear the **Spec Architect hat**. Answer:

1. **Surface alignment.** Which existing wire surface does this extend or modify? Cite `spec/v1/<doc>.md §<section>` verbatim. New surface area? State why a separate doc is justified (per `CONTRIBUTING.md` §"What's in scope" — internal data structures, storage backends, prompt construction, UI conventions are NOT in scope).
2. **RFC 2119 keywords.** Sketch the normative prose. Each requirement uses MUST / SHOULD / MAY / MUST NOT / SHOULD NOT — capital, unambiguous.
3. **Status target.** Where will the touched spec doc(s) land on the legend? STUB / DRAFT / OUTLINE / FINAL per `auth.md §status legend`. If new doc, start as DRAFT.
4. **Cross-references.** Which other `spec/v1/*.md` docs are implicated? Use relative paths in prose.
5. **Why this exists paragraph.** Draft the opening paragraph that explains motivation, distinguishing from related primitives (channels, interrupts, capabilities, profiles, events).
6. **Open spec gaps table.** What does this RFC explicitly NOT cover? Reviewers will use this to scope follow-up RFCs.

Output: spec section diff sketch + the normative prose with RFC 2119 keywords highlighted.

---

## Phase 2 — Schema Architect Pass

Wear the **Schema hat**. Answer:

1. **JSON Schema diff.** For each affected `schemas/*.schema.json`:
   - Field added / removed / type-changed?
   - Required vs optional? Default value documented in prose?
   - `additionalProperties: false` preserved on every object?
   - `$schema: "https://json-schema.org/draft/2020-12/schema"` and `$id: "https://openwop.dev/spec/v1/<name>.schema.json"` correct?
   - Show the diff inline per `RFCS/0000-template.md` "Wire shape changes" section.
2. **OpenAPI diff.** New endpoint? Specify `tag`, `operationId`, request/response schemas via cross-file `$ref`, ≥1 error response. `redocly lint api/openapi.yaml` must remain clean.
3. **AsyncAPI diff.** New channel? Specify message name, payload schema reference, security scheme inheritance. `asyncapi validate api/asyncapi.yaml` must remain clean.
4. **Examples.** At least one positive example + one negative example (what fails validation) per `RFCS/0000-template.md`.
5. **Version axes impact.** Per `version-negotiation.md`: engine? per-run event-log? per-event? runtime pinning?

Output: schema diffs + OpenAPI/AsyncAPI diffs + examples table.

---

## Phase 3 — Security Architect Pass

Wear the **Security hat**. Run a focused threat pass against openwop's actual threat library — not generic STRIDE.

1. **Threat library.** Which of `SECURITY/threat-model-*.md` apply?
   - `auth-profiles.md` — API key rotation, OAuth2 client credentials, mTLS
   - `node-packs.md` — pack signing, registry submission, supply-chain
   - `prompt-injection.md` — agent boundary, output exfiltration
   - `provider-policy.md` — per-run provider routing, BYOK boundary
   - `secret-leakage.md` — debug bundles, event payloads, webhook deliveries
2. **Invariants.** Which `SECURITY/invariants.yaml` rows apply? Does this RFC add a new MUST-NOT? If so, draft the invariant row + name the conformance scenario that will enforce it.
3. **BYOK boundary.** Per `auth.md` and `auth-profiles.md`: does this RFC touch credential resolution? State the redaction recipe for any new payload that could carry credentials.
4. **Memory + cross-tenant.** Per `agent-memory.md`: SR-1 secret-redaction invariant preserved? CTI-1 cross-tenant invariant preserved?
5. **Replay-attack resistance.** Per `webhooks.md`: HMAC `{timestamp}.{rawBody}` recipe unchanged?
6. **Audit trail.** What audit events emit? Where do they land in `observability.md`'s canonical `openwop.*` OTel namespace?
7. **External audit dependency.** Per `SECURITY/external-audit-engagement.md`: does this RFC change a surface the external audit will need to review again?
8. **Embargo path.** If this is a safety-fix RFC (CVE-class), per `COMPATIBILITY.md` §3 and `SECURITY.md`: 90-day public window OR embargoed coordinated disclosure?

Output: applicable-threat-models list + invariant additions + redaction recipes + audit-event list.

---

## Phase 4 — Conformance Architect Pass

Wear the **Conformance hat**. Per `CONTRIBUTING.md` §"Conformance suite":

1. **Existing coverage.** Which `conformance/src/scenarios/*.test.ts` files cover the adjacent surface today? List them.
2. **New scenarios.** Draft the scenarios that will land with this RFC:
   - Top-of-file docstring naming the spec doc(s) verified.
   - `describe('category: …', …)` blocks per assertion group.
   - `expect(…, driver.describe('spec.md §section', 'requirement'))` so failure messages cite the requirement.
   - Server-free scenarios <1s.
3. **Fixtures.** Any new fixtures needed under `conformance/fixtures/`? Each must be added to `conformance/fixtures.md` catalog table + per-fixture contracts.
4. **Capability gating.** Per `conformance/coverage.md` §"Capability-gated scenarios": is the new scenario gated on a capability flag? Name the flag (e.g., `host.<feature>.supported`).
5. **Reference-host coverage.** Which of `examples/hosts/{in-memory,sqlite,python}/` will implement and update its `conformance.md` evidence file?
6. **INTEROP-MATRIX impact.** Does the new profile show up as a row column? Update the matrix in the same PR.

Output: scenario stubs + fixture stubs + capability-gate names + INTEROP-MATRIX delta.

---

## Phase 5 — Compatibility Architect Pass

Wear the **Compatibility hat**. Per `COMPATIBILITY.md`:

1. **Classification.** Additive / safety-fix / breaking? State and justify against §2.2 list:
   - Required → optional, required → removed, type changes — none?
   - Event-type shapes unchanged?
   - Endpoint contracts unchanged (additive optional aside)?
   - `MUST` requirements unrelaxed?
   - Error codes / HTTP statuses unchanged in meaning?
2. **Forward-compatibility clauses.** For additive: name the specific guarantees ("new field is optional with default `null`; existing clients ignore it; existing servers don't emit it").
3. **Migration plan (safety-fix / breaking only).** Per `COMPATIBILITY.md` §3:
   - 90-day public RFC window OR embargoed-disclosure window per `SECURITY.md`
   - Migration tooling (codemods, schema migrators, conformance scenarios that detect the old shape)
   - `version-negotiation.md` runbook section describing detect-and-migrate
   - `CHANGELOG.md` `### Security` entry citing the advisory ID
4. **Suite vs spec.** Per §2.3: is the new conformance scenario stricter than spec text would imply? If so, mark it as a suite-version requirement, not a spec requirement.
5. **Cross-cuts.** Per `CONTRIBUTING.md` §"Coordination with the impl plan": does this need a `CC-N` entry in `WORKFLOW-PROTOCOL-openwop-PLAN.md`? Cosmetic/additive can merge independently; breaking impl assumptions require coordination.
6. **Lifecycle.** RFC `Draft` → `Active` (accepted, implementation pending) → `Accepted` (implemented, conformance reflects it). State which milestone this PR lands.

Output: classification verdict + migration plan (if not additive) + cross-cut decision + lifecycle milestone.

---

## Phase 6 — Synthesize the RFC

Reserve the next free RFC number (`RFCS/` directory inspection). Write the RFC to `RFCS/NNNN-<slug>.md` using `RFCS/0000-template.md` verbatim section ordering:

```markdown
# RFC NNNN: <Title>

| Field | Value |
|---|---|
| **RFC** | NNNN |
| **Title** | <Short descriptive title> |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | <YYYY-MM-DD> |
| **Updated** | <YYYY-MM-DD> |
| **Affects** | <spec docs / schemas / SDKs / conformance scenarios touched> |
| **Compatibility** | <`additive` / `safety-fix` / `breaking`> per `COMPATIBILITY.md` |
| **Supersedes** | <RFC number, if any> |
| **Superseded by** | <RFC number, if any> |

## Summary
<One paragraph ≤ 5 sentences>

## Motivation
<What problem; who hits it today; why the spec is the right place>

## Proposal
<Wire-shape changes, schema diffs, RFC 2119 prose, positive + negative examples>

## Compatibility
<Classification + per-clause backward-compat guarantees OR migration plan>

## Conformance
<Existing scenarios + new scenarios + capability gating>

## Alternatives considered
<≥ 2 alternatives + their trade-offs; "do nothing" always considered>

## Unresolved questions
1. …
2. …

## Implementation notes (non-normative)
<Cross-cuts, expected effort, sequencing>

## Acceptance criteria
- [ ] Spec text merged
- [ ] Schema / OpenAPI / AsyncAPI updated where applicable
- [ ] At least one conformance scenario covering the new surface
- [ ] CHANGELOG entry under the appropriate version
- [ ] Reference host implements and passes the new scenarios, OR RFC explicitly defers reference-host implementation

## References
<Linked issues, conformance reports, prior art (BPMN, Temporal, MCP, A2A, LangGraph), related RFCs, spec docs touched>
```

Match the template exactly. Reviewers expect that ordering.

---

## Phase 7 — Companion Gap Register

Write `RFCS/NNNN-<slug>.gaps.md` listing every open question, deferred decision, missing input, or "we'll learn from implementation" item beyond the in-template Unresolved questions:

```
| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| G1 | Proposal | Default value for `host.newField` | Spec Architect | Decision needed | Schema diff finalization |
| G2 | Security | Need fresh threat-model review on credential surface | Security Architect | Coordinate with external auditor per `SECURITY/external-audit-engagement.md` | Active status |
```

Each gap has an owner and a resolution path. Open questions with no path → promote to a Risk.

---

## Phase 8 — Companion Risk Register

Write `RFCS/NNNN-<slug>.risks.md`. Score each risk on **Likelihood × Impact** (H/M/L). Critical/High risks require a named mitigation owner and a target resolution date.

```
| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| R1 | Third-party hosts adopt additive surface but stay on suite 1.0 — INTEROP-MATRIX drift | M | M | Med | Gate scenario on capability flag; remind in RFC §Conformance | Conformance Architect | Open |
| R2 | New event payload could carry BYOK credential by accident if host implements naively | L | H | Med | Add redaction example to spec; add invariant + scenario per SECURITY/invariants.yaml | Security Architect | Open |
```

---

## Phase 9 — GO / NO-GO Recommendation

Map output to the RFC lifecycle milestone:

| Milestone | What this skill produces | What's required to advance |
|---|---|---|
| `Draft` (open for comment) | RFC + Gap + Risk registers; many Unresolved questions acceptable | Identifies what implementers need to learn before Active |
| `Active` (merge candidate) | Comment window closed; no CRITICAL gaps; classification firm | All five architect passes complete, conformance scenarios sketched, threat-model clear |
| `Accepted` (implementation landed) | Spec text + schemas + OpenAPI + AsyncAPI merged; conformance scenarios in suite; reference host updated | Acceptance criteria checklist all ticked |

Issue a recommendation:

```
## GO/NO-GO Recommendation: <GO | NO-GO | CONDITIONAL>

Milestone target: <Draft | Active | Accepted>
Critical gaps: <count>  | High gaps: <count>  | High+ risks: <count>
Compatibility classification: <additive | safety-fix | breaking>

Reasoning: <2-4 sentences>

If CONDITIONAL: list the specific items that must close before re-evaluation.
```

---

## Output Format Summary

Return four things to the user, in this order:

1. The full Intake Summary (Phase 0).
2. A condensed lens-by-lens findings list (Phases 1–5) — bullet form, not full prose. The full prose lives in the RFC file.
3. The list of files written:
   - `RFCS/NNNN-<slug>.md`
   - `RFCS/NNNN-<slug>.gaps.md`
   - `RFCS/NNNN-<slug>.risks.md`
4. The GO/NO-GO recommendation (Phase 9).

Do **not** dump the entire RFC into chat — the user reads the file. Keep chat output to summary + verdict.

---

## Standards Docs This Skill Depends On

| Doc | Purpose |
|---|---|
| `RFCS/0000-template.md` | Authoritative section structure |
| `RFCS/README.md` | Process, status states, numbering, comment windows |
| `CONTRIBUTING.md` | Per-artifact change rules + CI gate |
| `COMPATIBILITY.md` | Additive vs safety-fix vs breaking |
| `GOVERNANCE.md` | Decision rules, lazy consensus, two-maintainer flip post-bootstrap |
| `SECURITY.md`, `SECURITY/invariants.yaml`, `SECURITY/threat-model-*.md` | Threat library + invariant catalogue |
| `INTEROP-MATRIX.md` | Reference-host advertisement state |
| `ROADMAP.md`, `MAINTAINERS.md` | Vendor-neutral migration tripwire |
| `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` | Internal track grading (A–C) — situate the RFC against this |

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` | Begin Phase 0 |
| `pass: <spec\|schema\|security\|conformance\|compat>` | Re-run a single architect pass with deeper detail |
| `revise: <feedback>` | Re-synthesize RFC with feedback |
| `escalate gap: <id>` | Promote a gap to a risk |
| `milestone: <draft\|active\|accepted>` | Re-evaluate GO/NO-GO at a different milestone |
| `done` | Finalize the three artifacts |

---

## Next Steps

After the RFC reaches GO at the target milestone:

| Action | Command | Purpose |
|---|---|---|
| Implementation plan | `/plan <slug>` | Break RFC into ordered implementation phases |
| Architecture review | `/architect` | Validate the plan against wire-shape stability, version negotiation, capability gating |
| Code | (write the diff) | Spec text → schemas → OpenAPI/AsyncAPI → conformance → SDKs → reference hosts |
| Quality review | `/code-review` | Banned-pattern + schema/contract review |
| NFR review | `/nfr` | Final checklist before merge |
| Docs review | `/ux-review` | RFC 2119 + cross-link integrity |
| Sync conformance | `/update-conformance` | Coverage matrix, fixtures, capability gating |
| Sync docs | `/update-docs` | README, CHANGELOG, INTEROP-MATRIX, RFC index |
| Ship | `/pr` | Create pull request with the right template |
