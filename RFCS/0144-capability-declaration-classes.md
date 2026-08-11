# RFC 0144: Which host capability families the core schema declares

| Field             | Value                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**           | 0144                                                                                                                         |
| **Title**         | Which host capability families the core schema declares                                                                        |
| **Status**        | `Accepted`                                                                                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts), with the openwop-app reference host                                                          |
| **Created**       | 2026-08-09                                                                                                                   |
| **Updated**       | 2026-08-10                                                                                                                   |
| **Affects**       | `schemas/capabilities.schema.json`, `spec/v1/host-extensions.md` §"Canonical prefixes", `spec/v1/host-capabilities.md`, `spec/v1/artifact-type-packs.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — five optional properties declared on an already-open object; five prose examples corrected to the spelling hosts already emit |
| **Supersedes**    | —                                                                                                                            |
| **Superseded by** | —                                                                                                                            |

> **Status note.** `Accepted` (2026-08-10). The corpus change (five declarations, the §A rule, the prose corrections) landed with the `Active` cut; the wire shape was locked then. `Accepted` waited on one thing — a host witness that a declared family, advertised at the plain root, **validates against the declared shape** — and that witness now exists. See §"Acceptance witness". (Note the witness is the discovery-doc *validation*, distinct from RFC 0142's leg-B *emission* witness they share a subject with; see the witness section for the attribution.)

## Summary

`host-capabilities.md` defines 36 distinct `§host.<name>` capability families. `capabilities.schema.json` declares 83 top-level properties. **Sixteen families are declared in neither spelling** — including five that carry normative MUSTs binding wire shape, so a host advertising them is validated by nothing and a consumer reading them has no schema to check against. This RFC declares those five (`artifactTypes`, `aiEnvelope`, `agentRuntime`, `forms`, `promptLibrary`) at the **plain** document root per RFC 0137 G16, states the rule that decides which of the remaining eleven ever earn a declaration, and corrects the five prose snippets that still show a **dotted** discovery key — the last of which is what actually blocks hosts from dropping their dotted mirrors.

## Motivation

### The defect is a missing enforcement surface, not a missing feature

This is the sixth instance of one corpus defect: **a normative claim whose enforcement surface was never declared.** RFCs 0138, 0139, 0140, 0141 and 0142 each closed one instance. This is the capability-discovery instance.

`§host.artifactTypes` says *"A host advertising `store: true` MUST persist registered artifacts and emit `artifact.created`."* That MUST binds a key that `capabilities.schema.json` has never heard of. Under `additionalProperties: true` the object validates whether the host spells it `artifactTypes`, `host.artifactTypes`, `artifactType`, or `artifactTypez`. The MUST is real; nothing anywhere states what shape carries it.

### The measurement

Extracting `## §host.*` headings from `host-capabilities.md` yields **40 headings, 36 unique** — `§host.knowledge` and `§host.secrets` each appear three times (`:1252`/`:2182`/`:2324` and `:1329`/`:2259`/`:2401`). Duplicate sections in a normative document are their own defect; they are recorded here because "the file's headings are the family list" needs the dedupe stated rather than assumed.

Reading each section's own advertised key — **not its heading** — partitions the 36:

| | |
|---|---|
| **Declared** (20) | `aiProviders`, `blobStorage`, `cache`, `credentials`, `deadLetter`, `fs`, `heartbeat`, `httpClient`, `kvStorage`, `mcp`, `nosql`, `oauth`, `queueBus`, `scheduling`, `searchIndex`, `secrets`, `sql`, `tableStorage`, `toolHooks`, `vectorStore` |
| **Undeclared** (16) | `agentRuntime`, `aiEnvelope`, `artifactTypes`, `brand`, `canvas`, `chat`, `coordination`, `dataIntegration`, `entities`, `forms`, `kanban`, `knowledge`, `launchStudio`, `messaging`, `promptLibrary`, `webResearch` |

> **A worked false positive, recorded because the method matters.** An earlier pass of this analysis counted `http` as undeclared, reading the section *title* `§host.http`. That section advertises a family named **`httpClient`**, which *is* declared. Deriving the key from the heading is the same error class the surrounding RFCs were written to close — reasoning from the wrong surface — so the population here is derived from each section's capability-flag line and JSON example, never its title.

### Not all sixteen should be declared, and that is the point

`kanban`, `canvas`, `brand`, `launchStudio`, `entities` are product concepts. They are documented in `host-capabilities.md` because packs bind to them, but the protocol has no normative claim about their wire shape and should not acquire one. Declaring all sixteen would pull vendor surface into the core schema; declaring none leaves five MUSTs unenforceable. The corpus needs a **rule**, not a curated list — a list is the artifact that drifts, which is how sixteen families accumulated undeclared in the first place.

## Proposal

### A. The rule (normative)

Added to `host-extensions.md` §"Canonical prefixes":

> A `§host.<name>` section in `host-capabilities.md` **MUST** be declared as a property of `capabilities.schema.json` when the section states a normative requirement (MUST / MUST NOT) that binds the **shape or content of a wire artifact** — a discovery-document field, an event payload, a request or response body. A section that only describes a host-side `ctx.*` method surface, or a product concept a pack may bind to, is an **extension namespace**: hosts MAY advertise it, clients MUST tolerate its absence, and it **MUST NOT** be declared in the core schema.

The rule is checkable against the tree, so a future sweep re-derives the same partition instead of re-litigating it, and it can become a CI gate later — deliberately — once the fleet has migrated.

### B. The five declarations

Declared at the **plain** document root. Per RFC 0137 **G16** (resolved 2026-08-05), `host.<name>` is the capability **identifier** notation — the spelling used in pack `peerDependencies`, in `error.capability`, and in prose `§` headings — while the **discovery-document key is the plain family name at the document root**. Five host capabilities were already declared plainly (`fs`, `kvStorage`, `tableStorage`, `queueBus`, `scheduling`), and the reference host emits `artifactTypes` un-prefixed today.

| Family | Declared shape | The MUST it carries |
|---|---|---|
| `artifactTypes` | `{ supported, store, render, export[], types{} }` | `store: true` ⇒ MUST persist and emit `artifact.created` (`artifact-type-packs.md` §"Host capability") |
| `forms` | `{ contentPacks }` | `contentPacks` ⇒ MUST instantiate through the host's own create path; pack strings are untrusted (`form-content-packs.md` §"Trust boundary") |
| `aiEnvelope` | `{ supported, await }` | `generate` is required when advertised; `await` only when `await` is advertised |
| `promptLibrary` | `{ supported }` | pinned-version lookup for replay determinism |
| `agentRuntime` | `{ supported }` | advertising it **implies** `agents.manifestRuntime` (RFC 0070 §B) |

Root `additionalProperties` **stays `true`**. This is a permissive first declaration: no host's current discovery document becomes invalid, including one still emitting a dotted `'host.forms'` key. Each declared object sets `additionalProperties: false` on its own body, matching every sibling declaration in the file.

### C. The prose corrections — the gating step, not tidy-up

Snippets in `spec/v1/` show a **dotted** key in a discovery-document position:

| Location | Snippet |
|---|---|
| `artifact-type-packs.md:129`, `:149` | `"host.artifactTypes": { … }` — the `store` example, and the per-type `types` map |
| `host-capabilities.md:461`, `:479` | the same two shapes, mirrored |
| `host-capabilities.md:505` | `"host.forms": { "contentPacks": true }` |
| `host-capabilities.md:21` | §"The contract pattern" step 1 — *"the host advertises `host.<name>: { supported: true, … }`"* |
| `artifact-type-packs.md:172` | the store-without-render negotiation example, prose form |

> **A second scoping error, recorded because it is the RFC's own subject.** The first sweep matched a *quoted* `"host.<name>` key and returned exactly five. That predicate missed the last two rows, which write the same dotted key in backticks — and one of them, `host-capabilities.md:21`, is the document's **general statement of the discovery pattern**, which all 36 sections inherit. Correcting five leaf examples while the rule that generates them still reads dotted would have left the defect intact and looking closed. This is the same failure the RFC is about: a sweep whose predicate matched a narrower surface than the one that mattered. `:21` and `host-extensions.md`'s equivalent now state the identifier-vs-key distinction outright rather than demonstrating one spelling and meaning the other.
>
> Left dotted deliberately: `host-capabilities.md:24` (`error.capability = "host.<name>"` — an identifier), the 36 `**Capability flag:**` lines (identifiers), and every `peerDependencies` entry.

**These corrections are load-bearing.** A host reading `:505` and emitting `'host.forms'` is *following the spec*; its dotted key is not legacy debt but compliance with a snippet that still stands. Declaring the plain key while leaving the snippet in place lands a canonical spelling **no host can safely emit exclusively** — every host carries both keys indefinitely, and the fork looks closed in the schema while staying open on the wire. Hence an explicit ordering:

1. Declare plain (§B) — nothing newly invalid.
2. Correct the five snippets — the dotted spelling stops being spec-sanctioned.
3. **Only then** are dotted mirrors droppable, and dropping one is a host's decision, not a deprecation this RFC imposes.

Note that `:129`/`:149` carry the `store` MUST that RFC 0142's leg B witnesses — the correction lands on the exact line that RFC's acceptance criterion points at.

**Scoped, not swept.** Fifteen quoted `"host.<name>` keys exist in `spec/v1/`; five are discovery-document keys and are corrected. The other ten are correct as written and **MUST NOT** be changed: eight are `peerDependencies: { "host.X": "supported" }` (the identifier notation, dotted-correct per G16), one is `allowedHostCalls: ["host.fs", "host.kvStorage"]`, one is a frontend-plugin `hostApi` array. Three namespaces share a prefix; a regex-driven "fix the dotted keys" pass would convert all fifteen and break pack manifests — the same wrong-surface error, committed by the tool meant to correct it. Verifiable: `grep -c '"host\.' spec/v1/` drops by exactly five, and no `peerDependencies` line changes.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. Five optional properties on an object whose `additionalProperties` was and remains `true`; no field becomes required, changes type, or is removed. No MUST is added, relaxed, or reinterpreted — the five requirements have been normative since RFCs 0070, 0071, 0075 and 0137. A host emitting nothing new stays valid; a host emitting a dotted mirror stays valid; a host emitting a plain key is, for the first time, validated against a declared shape.

The prose corrections change no requirement — they correct the *spelling of an example* to the one the schema now declares and the reference host already emits.

## Conformance

No new scenario. The declarations are exercised by `spec-corpus-validity` (every schema round-trips) and by the existing capability-gated legs that read these families.

**Deliberately not added here:** a leg asserting that a host emits the *canonical* arm. The RFC 0137 helper `readFormContentCap` resolves four arms (plain-root → dotted-root → plain-wrapper → dotted-wrapper) so the suite can measure a mixed fleet during exactly this migration. Tightening that shared resolver now would red every host at once and convert a migration aid into a gate this RFC has not earned. The correct instrument is a **separate** leg that asserts the canonical spelling, or reports which arm answered, so *conformant* and *migrated* stop being the same green — filed as a gap below rather than smuggled in as a helper change.

## Acceptance criteria

- [x] Five families declared plainly; `spec-corpus-validity` and the full `openwop:check` green — `artifactTypes`, `aiEnvelope`, `agentRuntime`, `forms`, `promptLibrary` each declared at the plain root in `schemas/capabilities.schema.json`.
- [x] Five quoted-key snippets corrected and the two prose/pattern statements restated; the ten identifier occurrences unchanged.
- [x] The §A rule present in `host-extensions.md` §"`host.*` capability surfaces" and consistent with the declared/undeclared partition above.
- [x] A host advertising at least one newly declared family validates against the schema — witnessed on the openwop-app reference host (see §"Acceptance witness").

## Acceptance witness

**Witnessed 2026-08-10 on the openwop-app reference host.** The host advertises `artifactTypes` (and `forms`) at the **plain document root** (`discovery.ts:1406`, RFC 0137 G16) and its emitted `artifactTypes` block **validates against `capabilities.schema.json`'s declared shape by Ajv 2020** (`additionalProperties: false` on the family body) — its `test/artifact-types-advert-conformance.test.ts` runs **3/3 green**, and that file caught a *real* prior advert defect before this witness (an extra `schemaEndpoint` key + a non-object `types` map, since fixed), which is what makes the green non-vacuous rather than tautological. The `@openwop/openwop-conformance@1.70.2` suite runs **2527 passed / 0 failed** against the host under `OPENWOP_REQUIRE_BEHAVIOR=true`, including every `artifact-type-*` shape scenario.

**Attribution (kept honest).** The `store: true` / `artifact.created` substrate this family's subject sits on — RFC 0142's leg-B *emission* witness — was landed by a **separate** openwop-app session (host PRs #3111 advertising per-type `store`, #3115 emitting `artifact.created` off-contract). This RFC's witness is the **discovery-document validation** property, which is independent of that posture: a host need not take the `store: true` posture to witness that its *declared* `artifactTypes` block validates against the schema. RFC 0142 (the emission witness) reached `Accepted` separately (#920); this RFC rides on the shared subject but is credited for the validation half only.

## Alternatives considered

1. **Declare all seventeen.** Pulls `kanban`, `canvas`, `brand`, `launchStudio`, `entities` into the core schema. These are product concepts with no protocol claim about their shape; the corpus would be asserting ownership it does not want.
2. **Declare none; rely on `additionalProperties: true`.** The status quo. Leaves five MUSTs binding keys nothing declares, which is the defect.
3. **Declare dotted, matching the prose.** Rejected on measurement: the reference host emits `artifactTypes` **plain** at `discovery.ts:1338` while the prose shows it dotted, so following the prose would declare a node no host emits. G16 already settled the direction; the prose is the residue.
4. **Set root `additionalProperties: false`.** Would instantly invalidate every host carrying a dotted mirror — including one carrying it *because the spec told it to*. Correct only after step 3 of §C has played out across the fleet, and then only under its own RFC.
5. **Ship a curated list instead of a rule.** A list is the artifact that drifts. Seventeen undeclared families accumulated precisely because no rule said which ones should not.

## Unresolved questions

1. Whether the eleven extension-namespace families should be *marked* as such in `host-capabilities.md` (a per-section badge) or left to the §A rule to classify on demand. A badge is more legible and is one more surface to drift.
2. Whether `aiEnvelope.await` belongs as a nested boolean (declared here) or as its own family. The prose spells the sub-flag `host.aiEnvelope.await: supported`; nesting matches `forms.contentPacks` and is the lower-variance reading, but no host advertises it today so the shape is unwitnessed.
3. When root `additionalProperties: false` becomes appropriate — gated on the dotted mirrors actually being dropped, which §C step 3 enables but does not schedule.

## Open spec gaps

| ID | Gap |
|---|---|
| G1 | The permissive multi-arm resolver cannot witness *which* spelling a host emits, so a schema declaration alone migrates no one — a host may sit on a fallback arm indefinitely with a green suite. A canonical-arm leg (or an arm-reporting one) is the remedy; deliberately deferred per §Conformance. |
| G2 | `host-capabilities.md` carries duplicate `§host.knowledge` and `§host.secrets` sections (three each). Not count-affecting — both families are declared — but a normative document with three same-named sections makes "edit the section" ambiguous. |
| G3 | The §A rule is stated as prose and checked by review. It is *shaped* to be machine-checkable (heading set × RFC 2119 keywords × schema properties) but no gate enforces it, so a future family can again land undeclared. |

## References

- RFC 0137 gap **G16** (resolved 2026-08-05) — the plain-vs-dotted ruling this RFC applies
- `spec/v1/host-capabilities.md` — the 36 `§host.<name>` contracts
- `schemas/capabilities.schema.json` — 83 declared properties, root `additionalProperties: true`
- RFC 0070 §B (`agentRuntime` ⇒ `agents.manifestRuntime`), RFC 0071 / RFC 0075 (`artifactTypes` facets), RFC 0137 (`forms.contentPacks`)
- RFC 0142 — the `store`-gated emission witness; its leg B is the intended first witness of a declared `artifactTypes`
- openwop-app ADR 0537 (2026-08-09) — reference host migrated `forms` to the plain root, dotted key retained as a deprecated mirror
