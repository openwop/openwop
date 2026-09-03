# RFC 0143: Tool-result trust is untrusted-by-default and monotone through composition

| Field             | Value                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0143                                                                                                                                                                                    |
| **Title**         | Tool-result trust is untrusted-by-default and monotone through composition                                                                                                             |
| **Status**        | `Accepted`                                                                                                                                                                               |
| **Author(s)**     | David Tufts (@davidscotttufts), with the openwop-app reference host                                                                                                                    |
| **Created**       | 2026-08-09                                                                                                                                                                             |
| **Updated**       | 2026-08-09                                                                                                                                                                             |
| **Affects**       | `SECURITY/threat-model-prompt-injection.md`, `spec/v1/ai-envelope.md` §"Trust boundary", `SECURITY/invariants.yaml`, `conformance/src/coherence/tool-result-trust-monotone.test.ts`     |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — states the general rule the corpus's ~ten point-invariants already instance; relaxes no MUST                                                    |
| **Supersedes**    | —                                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                                      |

## Summary

The corpus fences roughly ten specific untrusted-content ingresses into the prompt — user input, RAG, prior artifacts, MCP results, card inputs, form-content strings, runner output, node-pack output, voice transcripts — each with its own MUST and its own invariant. It never states the **general rule** they instance: **a tool result is untrusted content entering model context, and trust does not increase through composition.** Absent that rule there is no principle forbidding the laundering path (untrusted content → tool → "result" → prompt, trust dropped on the way because no clause said results inherit the trust of their inputs), and no completeness check catching the *next* ingress added without a fence. This RFC states the rule as a **meet-semilattice**: the `contentTrust` of any composed prompt segment MUST be the meet (⊓) of its inputs' trust, so one untrusted input yields an untrusted segment and no transformation — summarize, format, extract, store-and-recall — may raise trust. It blesses the two host strategies that ship today (coarse-grained propagation; conservative static reader classification), declines to require per-value taint (which no host witnesses), and carves out structurally-isolated readers so the rule does not punish correct sandboxing.

## Motivation

### The point-invariants have no stated principle

`threat-model-prompt-injection.md` §5 lists `prompt-injection-input-marker`, `-kb-marker`, `-artifact-marker`, `-mcp-marker`; `chat-card-input-trust-boundary` (RFC 0071); `form-content-pack-string-trust-boundary` (RFC 0137); `runner-output-untrusted-transport` (RFC 0122); `node-pack-output-untrusted`; `voice-transcript-untrusted` (RFC 0106); and `prompt-composed-trust-marker` (RFC 0027/0020), which pins the compose-boundary meet. Each fences one ingress. `ai-envelope.md` §"Trust boundary" states the propagation MUST for **one pair of sources** — MCP tool result, A2A inbound message. Every one is a special case of the same sentence, and that sentence is written nowhere.

Two costs follow from the gap:

1. **The laundering path (`FRMD-F1-1`) is unforbidden in general.** Untrusted content enters a tool; the tool returns a "result"; the result is interpolated into a later prompt without the untrusted tag — legally, because no clause says a tool result inherits the trust of what produced it. The reference host's own memory-lane docblock names it exactly ("no second-order launder via output"), but the corpus rule it implements does not exist.
2. **No completeness check.** When RFC 0142's `runproduce` or a future ingress adds a new content path to the prompt, nothing fails if it ships without a trust fence. Each ingress is guarded only if someone remembered to write its bespoke invariant.

### Why "tool result" is the right frame, and why it generalizes the existing rules

An MCP result, a runner output, a RAG chunk, a card input, a recalled memory summary, and a pack-node output are the same thing to the model: **bytes of unknown provenance entering its context.** RFC 0071/0122/0137/0106 each rediscovered "signature proves authorship, not content safety" for its own surface. The general statement is: *content entering model context is untrusted unless the host has a specific, named basis for trusting it, and "a tool ran and returned" is not such a basis.*

### The measurement that makes the MUST necessary

Supplied by the reference host and the number that motivates the rule: **before its `BuiltinTool.contentTrust`-required ratchet (#2982), 166 of 168 built-in tool results defaulted to `trusted`** — silently, because trust was opt-out. After: 159 untrusted / 13 trusted / 0 unclassified across 172 registration sites, every `trusted` a named per-tool decision. A default of trusted is a default of launderable; the ratchet is only meaningful because a rule requires it.

## Proposal

### The invariant (normative — new §"Trust is monotone through composition" in `threat-model-prompt-injection.md`)

Trust over content forms a two-element meet-semilattice `untrusted ⊏ trusted` with meet `⊓` (`untrusted ⊓ anything = untrusted`).

1. **Untrusted by default.** Content entering model context carries `contentTrust: "untrusted"` unless the host has a **specific, named basis** for `"trusted"`. A tool having executed and returned is **not** a basis. For a built-in/registered tool the basis is a per-tool `contentTrust` decision recorded at registration; registry silence is `untrusted` (fail-closed).
2. **Monotone composition (the meet rule).** The `contentTrust` of any prompt segment composed from one or more inputs MUST be the **meet** of its inputs' `contentTrust`. Equivalently: if **any** contributing input is `untrusted`, the segment is `untrusted`. No transformation — summarization, formatting, extraction, translation, or a store-then-recall round trip — may raise a segment's trust above the meet of its inputs. `ai-envelope.md` §"Trust boundary" (MCP/A2A) and `prompt-composed-trust-marker` (compose boundary) are **named instances** of this rule.
3. **No laundering through storage.** Persisting untrusted content and later recalling it does not launder it: a value written to durable state while `untrusted` MUST be `untrusted` on recall, unless the reader is structurally isolated per clause 5. This closes `FRMD-F1-1`.

### Two conforming strategies, neither privileged (normative)

A host MAY satisfy clauses 2–3 by either, and the RFC recognizes both as conformant:

- **(a) Dynamic coarse-grained propagation.** Carry a trust bit at a coarser granularity than the value (per-turn, per-summary, per-segment) and take the meet at each composition/storage boundary. This **over-tags** — a turn that consumed any untrusted input taints the whole turn summary — and over-tagging is conformant because the invariant is a lower bound on caution: coarser is safer, never laundering.
- **(b) Conservative static reader classification.** Classify a *reader* of durable state as untrusted whenever the store is writable outside the operator's trust boundary. Hand-classified, lossy toward caution. A store reachable by an untrusted writer yields untrusted reads.

**Value-granular taint through arbitrary durable state is NOT required.** No host implements it and demanding it would make the rule unsatisfiable-in-practice — the exact failure this RFC's design avoids. A host that chooses value-granular precision is conformant, but the floor is coarse-grained meet.

### Structurally-isolated readers (normative carve-out)

4. A host MAY omit the persisted trust tag for content whose **only** reader is **structurally isolated** — sandboxed with no network egress and no path to model context or to a side-effecting tool (e.g. a workbench renderer behind the RFC 0035 sandbox contract). In that case trust is enforced by **reader posture**, not by a tag, and a tag adds nothing. The carve-out is narrow: it applies only when isolation is structural (enforced by the runtime), never when isolation is merely conventional. A reader that can reach model context or egress is **not** isolated and clause 3 applies. *(Without this, every sandboxed renderer that legitimately drops the tag — e.g. the reference host's `runArtifactStore` workbench reader — would be non-conformant, which would make the rule punish correct isolation.)*

### The fail-open default is the violation

5. A composition site that treats **missing** `contentTrust` as `"trusted"` (a `bindingTrust: undefined ⇒ trusted` default) violates clause 1: absence of a trust decision is `untrusted`, never `trusted`. This is the shape the invariant most needs to catch, because it is silent.

## Compatibility

**Additive** per §2.1. Against §2.2: no schema/endpoint/event change; **no MUST relaxed** — every clause states what an existing point-invariant already requires for its surface, generalized. A host conformant to all existing trust invariants is conformant to this rule by construction (they are its instances); a host that is *not* was already non-conformant on the specific surface. The rule adds a **completeness obligation** (no unfenced ingress) that is stricter than the sum of the point-invariants only in that it names the gap where a new ingress ships without one — which is a suite-detectable omission, not a wire change.

## Conformance

`tool-result-trust-monotone.test.ts` — always-on, server-free, three parts:

1. **Completeness (the load-bearing leg).** Enumerate every content-ingress surface the threat model's §4 STRIDE table names (`→ prompt` rows: user input, RAG/artifact, refine, MCP, node-pack output, runner, card input, form-content, voice) and assert **each has a fencing invariant** in `SECURITY/invariants.yaml`. A new ingress added to §4 without a trust invariant reds this leg — the general-rule analog of RFC 0138's "every manifest admits the hatch," and the thing the point-invariants alone cannot provide.
2. **The meet is stated normatively.** The new threat-model section states monotone composition (the meet), untrusted-by-default with "a tool ran" explicitly *not* a basis, no-laundering-through-storage, the two blessed strategies, and the isolation carve-out. Prose-pinned because the schema cannot express "MUST be the meet."
3. **The general rule names its instances.** `ai-envelope.md` §"Trust boundary" and the `prompt-composed-trust-marker` note cross-reference the general rule, so the special cases are anchored to it and cannot drift into contradicting it.

**Host behavior is witnessed separately.** The dynamic-propagation strategy (a) through the durable-store hop — the part `ai-envelope.md:694` never covered — is witnessed by the reference host: plant untrusted knowledge → dispatch → assert the recalled turn summary returns fenced, with a per-leg report of what the leg does **not** discriminate. Two known non-discriminations, disclosed by the host: the fail-closed asymmetry the scenario rests on does not observe the happy path (a host that fails closed correctly and still re-fires on a recorded node passes), and classification + guard can mask each other so the suite does not independently witness strategy (a) vs the reader-classification fallback. These bound the witness; they are stated, not closed.

No capability gate: the invariant is unconditional wire discipline (`conformance/coverage.md` §"shape vs behavior" — this is shape + a host-witnessed behavioral leg).

## Alternatives considered

1. **Do nothing.** The laundering path stays unforbidden in general and the next ingress ships unfenced with nothing to catch it. The reference host already found `bindingTrust: undefined ⇒ trusted` on one route and 166/168 tools defaulting trusted — the gap has a demonstrated exploit surface, not a hypothetical one.
2. **Require value-granular taint.** Precise, and unsatisfiable in practice: no host tracks per-value provenance through generic durable state, `DurableCollection` rows carry no trust metadata, and demanding it forces `Active`-host-pending for a guarantee nobody witnesses. Rejected; the meet-at-boundary floor is what ships.
3. **Fold into `ai-envelope.md`'s Trust boundary section** (extend the MCP/A2A clause to "any tool"). Closer, but leaves the completeness obligation and the meet-semilattice framing unstated, and buries a corpus-wide rule inside one envelope doc. The general rule belongs in the threat model, with the envelope clause citing it.
4. **Mandate one strategy** (e.g. dynamic propagation only). Would make the reference host's static reader classification — legitimate and shipping — non-conformant, and would forbid a value-granular host from being *more* precise. The invariant is the contract; the strategy is the host's.
5. **A new `contentTrust` wire field or trust-lattice with more than two elements.** Over-engineering: the corpus's two-element `trusted`/`untrusted` is sufficient and already deployed; a richer lattice invents surface no host needs.

## Unresolved questions

1. **Enumerating "every §4 ingress" is only as complete as §4.** The completeness leg checks that each ingress §4 *names* has a fence; an ingress that exists in a host but was never added to §4 is invisible to it. The leg reduces the gap from "any missing fence" to "any ingress missing from the threat model," which is a smaller, reviewable surface — but not zero. Tightening it would need a wire-level enumeration of ingress points, which does not exist.
2. **The isolation carve-out's boundary.** "Structurally isolated" is defined by reference to the RFC 0035 sandbox contract; a host with a *different* isolation mechanism must argue equivalence. Whether the corpus should enumerate acceptable isolation mechanisms or leave it to host argument is open — left to argument for now, as sandbox is the only shipped one.

## Implementation notes (non-normative)

For a host, conformance is: (1) a per-tool `contentTrust` decision with fail-closed default (the reference host's #2982 ratchet), (2) the meet taken at every composition and storage boundary via either blessed strategy, (3) no `undefined ⇒ trusted` default at any composition site. The reference host implements (a) via a `consumedUntrusted` bit riding the durable turn summary and the vector index, and (b) via static reader classification for stores; its `routes/prompts.ts:301` `bindingTrust: undefined` is the clause-5 fail-open to fix — the first thing its own G13 witness should red.

The completeness leg composes with, does not duplicate, the point-invariants: they assert *how* each surface is fenced; the leg asserts *that every surface is*.

## Acceptance criteria

- [x] Monotone-composition invariant stated normatively (`threat-model-prompt-injection.md` §"Trust is monotone through composition")
- [x] `ai-envelope.md` §"Trust boundary" cites the general rule as its instance
- [x] `tool-result-trust-monotone` invariant row + the completeness/meet/instance conformance legs, non-vacuity sabotage-verified
- [x] CHANGELOG entry; suite minor bump with the three-way pin
- [x] Reference host witnesses strategy (a) through the durable-store hop with a per-leg non-discrimination report — see §"Acceptance witness"

## Acceptance witness (2026-08-09)

`Accepted` on the openwop-app tier-1 reference host, both halves witnessed:

**Behavioral — strategy (a) through the durable-store hop.** openwop-app#3074 (`e035ecae3`), `test/g13-trust-monotone-witness.test.ts`, 4 legs against the **real** `createSubjectMemoryPort` (durable rows + vector index, not a mock). Source-verified by the steward:
- untrusted ingress → dispatch → the persisted turn summary carries `derived-from-untrusted` **asserted on the durable row** (`listMemoryEntries` by `MEMORY_UNTRUSTED_TAG`), and a later no-untrusted-ingress turn recalls it inside `BEGIN/END UNTRUSTED CONTENT` while a trusted control stays outside — the `ai-envelope.md:694` gap (§2a "no laundering through storage") closed against real storage;
- **clause 5 (`missing ⇒ trusted` is the violation) fixed at the compose layer** — the `routes/prompts.ts:301` `bindingTrust: undefined` fail-open now derives from the binding's declared `source` (`variable`/`context` fail **closed** to untrusted; explicit entry wins), so every caller inherits it (leg C witnesses the derivation; a control leg proves no over-fence);
- **the meet is monotone** — the recall path carries `consumedUntrusted` with no transformation raising it; three sabotages each isolate exactly one assertion, restore → 4/4.

**Corpus — the completeness + prose legs run non-vacuously on the host.** At suite `1.68.0` (openwop-app#3086), `tool-result-trust-monotone.test.ts` runs **8/8 green** against this host with the sabotage matrix holding (renaming a floor invariant reds the completeness leg; softening `MUST be the meet` reds the prose leg).

**Disclosed non-discriminations (RFC gaps G2/G3), in the witness docblock verbatim.** (i) The fail-closed asymmetry does not observe the happy path — under-derivation of `consumedUntrusted` stays green here, carried by strategy-(b) classification, not this leg. (ii) A tag-and-fence-everything host would also pass — bounded by the row-tag + trusted-control, not eliminated. (iii) G3 — "structurally isolated" is exercised only via the RFC 0035 sandbox shape. **A new vacuity class surfaced in the making and worth the record:** an assertion window delimited by a token the asserted content can itself contain is vacuously satisfiable (the host's first `indexOf('Task:')` window matched the summary's own prefix; a sabotage caught it). This is the same family as RFC 0142's `driver.describe`-loads-env vacuity — a check that passes for a reason unrelated to what it claims to test.

Evidence tier: tier-1 reference host, source-verified commit + a suite run from the published `1.68.0`. Bootstrap steward waiver per the standing governance note.

## References

- `SECURITY/threat-model-prompt-injection.md` §4 (STRIDE per surface), §5 (the point-invariants this generalizes)
- `spec/v1/ai-envelope.md` §"Trust boundary" — the MCP/A2A instance
- `SECURITY/invariants.yaml` — `prompt-composed-trust-marker`, `chat-card-input-trust-boundary`, `form-content-pack-string-trust-boundary`, `runner-output-untrusted-transport`, `node-pack-output-untrusted`, `voice-transcript-untrusted`, and the four `prompt-injection-*-marker` rows
- RFC 0071 / 0122 / 0137 / 0106 — the per-surface trust-boundary rules unified here
- `COMPATIBILITY.md` §2.1
- openwop-app `BuiltinTool.contentTrust` ratchet (#2982) — the 166/168 measurement; the `consumedUntrusted` memory-lane propagation; the `bindingTrust: undefined` fail-open
