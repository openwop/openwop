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
   - `spec/v2/core/overview.md` (axioms, closed-enum growth, retirement rule) and `spec/v2/core/conformance.md` §"Witness class"
2. Read every input file the user pointed at (failing conformance reports, implementer issues, threat-model refs).
3. Survey the existing corpus for adjacent surface:
   - `spec/v2/core/*.md` and `spec/v2/ext/` — which doc(s) state the rules in this area? Cite section headings. `spec/v1/` is frozen; cite it only for history or a migration row.
   - `spec/v2/declaration.json` — which family owns the surface, its `technical` maturity and witness class?
   - `RFCS/*.md` — any open or accepted RFC overlapping scope? Read it.
   - `schemas/v2/*.schema.json` — which schemas are nearest neighbors?
   - `conformance/src/scenarios/v2-*.test.ts` — what scenarios cover the surface today?
   - `evidence/v2-host-bundles/*.json` — which hosts already witness adjacent requirements? Reference hosts live in `openwop/openwop-examples`.
4. Reserve the RFC number: check `RFCS/` and open PRs for the highest number in use. Reserve the next one.
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
| Adjacent spec docs | List | spec/v2/core/<doc>.md §<section> |
| Standards docs present | List | Missing: … |
```

If intake is too thin to produce a useful RFC, **stop and report**. Do not fabricate.

---

## Phase 1 — Spec Architect Pass

Wear the **Spec Architect hat**. Answer:

1. **Surface alignment.** Which existing wire surface does this extend or modify? Cite `spec/v2/core/<doc>.md §<section>` (or `spec/v2/ext/<family>/`) verbatim. New surface area? State why it belongs in core rather than `ext/` (`spec/v2/core/overview.md` §"What is `ext/`"), and that it is in scope per `CONTRIBUTING.md` §"What's in scope" (internal data structures, storage backends, prompt construction and UI conventions are not).
2. **RFC 2119 keywords.** Sketch the normative prose. Each requirement uses MUST / SHOULD / MAY / MUST NOT / SHOULD NOT — capital, unambiguous. The RFC states the change; the rule itself lives in the v2 core or ext doc that owns it. Do not restate a rule another doc owns.
3. **Status target.** Each v2 doc carries a `> **Status: …**` line (`Stable`, `Draft`, `Note`, `Retired`). A new doc starts as `Draft`. A new family row in `spec/v2/declaration.json` starts below `technical: "stable"`.
4. **Cross-references.** Which other `spec/v2/` docs are implicated? Use relative paths in prose.
5. **Why this exists paragraph.** Draft the opening paragraph that explains motivation, distinguishing from related primitives (channels, interrupts, capabilities, profiles, events).
6. **Open spec gaps table.** What does this RFC explicitly NOT cover? Reviewers will use this to scope follow-up RFCs.

Output: spec section diff sketch + the normative prose with RFC 2119 keywords highlighted.

---

## Phase 2 — Schema Architect Pass

Wear the **Schema hat**. Answer:

1. **JSON Schema diff.** For each affected `schemas/v2/*.schema.json`:
   - Field added / removed / type-changed?
   - Required vs optional? Default value documented in prose?
   - `additionalProperties: false` preserved on every object? (v2 schemas are closed by default; `COMPATIBILITY.md` §2.4.)
   - `$schema: "https://json-schema.org/draft/2020-12/schema"` and `$id: "https://openwop.dev/spec/v2/<name>.schema.json"`?
   - Show the diff inline per `RFCS/0000-template.md` §Proposal.
2. **Capabilities.** A new family or facet is a row in `spec/v2/declaration.json` (facets in `spec/v2/facets/`). `schemas/v2/capabilities.schema.json` is generated from it by `scripts/generate-from-declaration.mjs`; never hand-edit it.
3. **OpenAPI diff.** `api/v2/` is derived: edit `api/openapi.yaml` (the source document) or the inline seams in `scripts/derive-v2-api.py`, then rerun `python3 scripts/derive-v2-api.py --write`. Specify `tag`, `operationId`, request/response schemas, and at least one error response. The gate lints `api/v2/openapi.yaml` with redocly.
4. **AsyncAPI diff.** New channel or event? Name the message and payload schema. The gate validates `api/v2/asyncapi.yaml`.
5. **Examples.** At least one positive and one negative example (what fails validation) per `RFCS/0000-template.md`.
6. **Version impact.** Per `spec/v2/core/versioning.md`: does this change the discovery representation, a header, or event versioning?

Output: schema diffs + OpenAPI/AsyncAPI diffs + examples table.

---

## Phase 3 — Security Architect Pass

Wear the **Security hat**. Run a focused threat pass against openwop's actual threat library — not generic STRIDE.

1. **Threat library.** Which of `SECURITY/threat-model-*.md` apply? `auth-profiles`, `compensation`, `interop`, `node-packs`, `prompt-injection`, `provider-policy`, `replay`, `secret-leakage`, `workload-identity`.
2. **Invariants.** Which `SECURITY/invariants.yaml` rows apply? Does this RFC add a new MUST-NOT? If so, draft the invariant row and name the conformance scenario that will enforce it (gate step 6 checks every protocol-tier MUST-NOT has a public test).
3. **Credential boundary.** Per `spec/v2/core/identity.md` and `spec/v2/core/security-defaults.md`: does this RFC touch credential resolution or an onward hop? State the redaction recipe for any new payload that could carry credentials.
4. **Redaction + cross-tenant.** SR-1 secret redaction and cross-tenant isolation preserved for every new recorded field?
5. **Replay-attack resistance.** Per `spec/v2/core/webhooks.md`: signature recipe unchanged?
6. **Audit trail.** What audit events emit, and where are they defined in `spec/v2/core/events.md`?
7. **External audit dependency.** Per `SECURITY/external-audit-engagement.md`: does this RFC change a surface the external audit will need to review again?
8. **Embargo path.** If this is a safety-fix RFC (CVE-class), per `COMPATIBILITY.md` §3 and `SECURITY.md`: 90-day public window OR embargoed coordinated disclosure?

Output: applicable-threat-models list + invariant additions + redaction recipes + audit-event list.

---

## Phase 4 — Conformance Architect Pass

Wear the **Conformance hat**. Per `CONTRIBUTING.md` §"Conformance suite (`conformance/`)" and `spec/v2/core/conformance.md`:

1. **Existing coverage.** Which `conformance/src/scenarios/v2-*.test.ts` files cover the adjacent surface today? List them.
2. **Falsifiability.** Fill the template's falsifiability table: for each MUST, the observable and who can cause the condition (`witnessable-unaided`, seam-gated, or unwitnessable). Match the family's witness class in `spec/v2/declaration.json`.
3. **New scenarios.** Draft the scenarios that will land with this RFC:
   - File `conformance/src/scenarios/v2-<name>.test.ts`; a `v2-` file targets major 2 when `conformance/scripts/generate-scenario-majors.mjs --write` regenerates `conformance/scenario-majors.json`. A file with no row never runs.
   - Top-of-file docstring naming the spec doc(s) verified.
   - Every assertion message is `req(id, section, requirement)`; one requirement id per `it` (`scripts/check-req-only.mjs`).
   - No bare `return` in an `it` body; say why with `return softSkip(kind, reason)`.
   - Server-free scenarios run in under a second.
4. **Fixtures.** New fixtures under `conformance/fixtures/` go in the `conformance/fixtures.md` catalog.
5. **Capability gating.** At major 2 a family is advertised by the presence of its record in discovery; there is no `.supported` field. An absent record is `inapplicable`, not a pass.
6. **Host coverage.** Which host (the v2 reference host in `openwop/openwop-examples`, openwop-app, MyndHyve) will witness the new requirement ids in a certified bundle? That bundle is what `Accepted` needs.
7. **INTEROP-MATRIX impact.** Does a host's advertisement change? Update the matrix in the same PR.

Output: scenario stubs + fixture stubs + falsifiability rows + witnessing host + INTEROP-MATRIX delta.

---

## Phase 5 — Compatibility Architect Pass

Wear the **Compatibility hat**. Per `COMPATIBILITY.md`:

1. **Classification.** Additive / safety-fix / breaking / v2 retirement? Justify against §2.1–§2.4 (§2.4 is the v2.x rule) and §3a for retirements:
   - Required → optional, required → removed, type changes — none?
   - Event-type shapes unchanged?
   - Endpoint contracts unchanged (additive optional aside)?
   - `MUST` requirements unrelaxed?
   - Error codes / HTTP statuses unchanged in meaning?
2. **Forward-compatibility clauses.** For additive: name the specific guarantees ("new field is optional with default `null`; existing clients ignore it; existing servers don't emit it").
3. **Migration plan (safety-fix / breaking only).** Per `COMPATIBILITY.md` §3:
   - 90-day public RFC window OR embargoed-disclosure window per `SECURITY.md`
   - Migration tooling (codemods, schema migrators, conformance scenarios that detect the old shape)
   - a `spec/v2/migrations.json` row for any surface that is replaced or retired
   - `CHANGELOG.md` `### Security` entry citing the advisory ID
4. **Suite vs spec.** Per §2.3: is the new conformance scenario stricter than spec text would imply? If so, mark it as a suite-version requirement, not a spec requirement.
5. **Cross-repo impact.** Which sibling repos must follow (`openwop-sdks`, `openwop-examples`, `openwop-app`, `openwop-registry`)? Name the follow-up for each.
6. **Lifecycle.** RFC `Draft` → `Active` (accepted, implementation pending) → `Accepted` (implemented, conformance reflects it). State which milestone this PR lands.

Output: classification verdict + migration plan (if not additive) + cross-cut decision + lifecycle milestone.

---

## Phase 6 — Synthesize the RFC

Write the RFC to `RFCS/NNNN-<slug>.md` using `RFCS/0000-template.md` verbatim section ordering:

```markdown
# RFC NNNN: <Title>

| Field | Value |
|---|---|
| **RFC** | NNNN |
| **Title** | <Short descriptive title> |
| **Status** | `Draft` |
| **Author(s)** | <name(s) + GitHub handle(s)> |
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

### Falsifiability — one row per normative requirement
| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |

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

Write `RFCS/registers/NNNN-<slug>.gaps.md` listing every open question, deferred decision, missing input, or "we'll learn from implementation" item beyond the in-template Unresolved questions:

```
| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | No host bundle witnesses the new requirement ids yet | Conformance Architect | `externally-gated:<tripwire>` A certified major-2 bundle closes this. | `Accepted` |
| G2 | §Security | Fresh threat-model review needed on the credential surface | Security Architect | `transferred:<target>` per `SECURITY/external-audit-engagement.md` | `Active` |
```

Each row's Resolution Path cell starts with a disposition token: `closed`, `transferred:<target>`, `carried:<gap-id>`, `externally-gated:<tripwire>`, or `open` (`scripts/registers-lib.mjs`). The corpus holds zero `open` gap rows and `scripts/check-registers.mjs` ratchets that count, so give every row a real disposition. A `carried:` row must name a gap id other than its own RFC's. A question with no resolution path becomes a risk.

---

## Phase 8 — Companion Risk Register

Write `RFCS/registers/NNNN-<slug>.risks.md`. Score each risk on **Likelihood × Impact** (H/M/L). Critical/High risks require a named mitigation owner and a target resolution date.

```
| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Hosts adopt the surface but stay on an older suite — INTEROP-MATRIX drift | M | M | Med | Gate the scenario on the family record; note it in §Conformance | Conformance Architect | `mitigated` — … |
| R2 | A new event payload carries a credential if a host implements it naively | L | H | Med | Redaction example in the spec; invariant + scenario per `SECURITY/invariants.yaml` | Security Architect | `accepted` — … |
```

The Status cell starts with `open`, `mitigated`, `accepted`, `closed`, or `transferred:<target>`.

---

## Phase 9 — GO / NO-GO Recommendation

Map output to the RFC lifecycle milestone:

| Milestone | What this skill produces | What's required to advance |
|---|---|---|
| `Draft` (open for comment) | RFC + Gap + Risk registers; many Unresolved questions acceptable | Identifies what implementers need to learn before Active |
| `Active` (merge candidate) | Comment window closed; no CRITICAL gaps; classification firm | All five architect passes complete, conformance scenarios sketched, threat-model clear |
| `Accepted` (implementation landed) | Spec text + schemas + derived API merged; scenarios in a published suite; a certified host bundle witnesses the requirement ids | Acceptance criteria ticked; register sweep done (no `open` gap rows) |

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
   - `RFCS/registers/NNNN-<slug>.gaps.md`
   - `RFCS/registers/NNNN-<slug>.risks.md`
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
| `spec/v2/core/overview.md`, `spec/v2/core/conformance.md` | Axioms, `ext/` boundary, witness class |
| `spec/v2/declaration.json` | Family rows, maturity, witness class |
| `INTEROP-MATRIX.md` | Host advertisement state |
| `ROADMAP.md`, `MAINTAINERS.md` | Vendor-neutral migration tripwire |

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
| Code | (write the diff) | Spec text → declaration / schemas → derived API → conformance; SDKs and hosts follow in their own repos |
| Quality review | `/code-review` | Banned-pattern + schema/contract review |
| NFR review | `/nfr` | Final checklist before merge |
| Docs review | `/ux-review` | RFC 2119 + cross-link integrity |
| Sync conformance | `/update-conformance` | Coverage matrix, fixtures, capability gating |
| Sync docs | `/update-docs` | README, CHANGELOG, INTEROP-MATRIX, RFC index |
| Ship | `/pr` | Create pull request with the right template |
