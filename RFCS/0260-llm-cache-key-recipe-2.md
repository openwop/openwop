# RFC 0260: LLM cache key recipe 2 — every output-shaping parameter is in the key

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0260                                                            |
| **Title**         | LLM cache key recipe 2 (`openwop-llm-key-2`): the replay cache key for an LLM-calling node covers every sampling and output-shaping parameter, and is recorded on the effect ledger |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-13                                                      |
| **Updated**       | 2026-11-13 — filed at **`Active`, comment window waived by the maintainer** (2026-11-13, in the steward session: "1. opt-in, 2. waived"). Replay is a class RFC 0147 §A.6 forbids a bootstrap waiver for, so this is a STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. The maintainer chose the opt-in classification (a new advertised recipe) over a safety-fix that would change every replaying host's key. Closes finding P-004 of the 2026-08-11 assessment for hosts that opt in. |
| **Affects**       | `spec/v2/facets/replay.schema.json` (new optional facet `llmCacheKeyRecipe`; its description is the normative home of §A–§B) · `spec/v2/declaration.json` (`replay` facets list; `schemas/v2/capabilities.schema.json` regenerated) · `schemas/v2/effect-ledger-projection.schema.json` (new optional `cacheKey` on an effect record; its description is the normative home of §C) · `spec/v2/core/replay.md` (at most one pointer clause beside the RFC 0041 reference) · conformance: new scenario `v2-replay-llm-cache-key.test.ts`, judge `lib/llm-cache-key-2.ts` with self-tests, new fixture `conformance-llm-cache-key` · CHANGELOG. v1 is frozen and not touched. RFC 0041's recipe is not changed. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4: an optional facet on an existing family, an optional property on a closed v2 object. A host that does not advertise the facet keeps the RFC 0041 recipe. |
| **Supersedes**    | — (RFC 0041's recipe stays the default; this RFC adds an alternative a host opts into) |
| **Superseded by** | —                                                               |

## Summary

`spec/v2/core/replay.md` makes RFC 0041's content-addressed key the cache key for an LLM-calling node. That recipe hashes model, provider, messages, tools, temperature and responseSchema, and nothing else. Two calls that differ only in `maxTokens`, `stop` or `seed` therefore share a key, and a replay can serve a result recorded for a different request. This RFC defines recipe 2, `openwop-llm-key-2`, which hashes every sampling and output-shaping parameter the host sends and fixes the canonical message form RFC 0041 left open. A host opts in by advertising `replay.llmCacheKeyRecipe: "openwop-llm-key-2"`, and then records each LLM call's key on the effect ledger, where the suite can recompute and check it without a seam.

## Motivation

The 2026-08-11 assessment raised this as finding P-004 ("Replay cache keys omit outcome-changing inputs"), and the 13 November re-check found it still open:

- **The key collides on parameters that change the answer.** A call with `maxTokens: 16` and one with `maxTokens: 4096` produce different text. Under RFC 0041 they have the same key, so a replay of the second can be served the first's truncated reply. The same holds for `stop`, `seed`, `topP`, `topK`, the penalties and any provider-specific parameter.
- **The canonical message form is undefined.** RFC 0041 hashes "the canonical message array" without saying what canonical is. Two hosts that represent a string content and a one-part content array differently compute different keys for the same call, so the key is not portable.
- **The key is unobservable.** The only v1 witness (`replay-llm-cache-key-portable`) read the key through a test seam. At v2 a MUST whose only witness is a seam must become a SHOULD or gain a normative observation path (`spec/v2/core/conformance.md` §Witness class).

The maintainer chose an opt-in fix. A host that changed its key recipe in place would stop matching every result it recorded before the change, so a correction that forced every replaying host to switch at once would turn a silent wrong answer into a burst of `replay_source_missing` failures. With an advertised recipe id, each host switches when it is ready, and a consumer can see which recipe a host uses.

## Proposal

### §A — the facet

`replay` gains one optional facet:

```diff
   "properties": {
     "modes": { … },
     "retention": { … },
-    "effectSeamsManifest": { "const": "/host/effect-seams" }
+    "effectSeamsManifest": { "const": "/host/effect-seams" },
+    "llmCacheKeyRecipe": {
+      "type": "string",
+      "enum": ["openwop-llm-key-2"],
+      "description": "RFC 0260 — the cache-key recipe this host uses for every LLM-calling node. Absent ⇒ the RFC 0041 recipe (replay.md). Present ⇒ the host MUST compute the key for every LLM-calling node by the named recipe … (full text: §B–§C)"
+    }
   },
```

- **A.1.** A host that advertises `replay.llmCacheKeyRecipe` MUST compute the cache key for every LLM-calling node by the named recipe, and MUST NOT use RFC 0041's recipe for a call made while the facet is advertised.
- **A.2.** A host that does not advertise the facet keeps RFC 0041's recipe, unchanged. Nothing in this RFC binds it.
- **A.3.** A host that advertises the facet MUST also advertise `idempotency`, because §C records the key on the effect ledger that family serves.
- **A.4.** The vocabulary is closed and grows under `spec/v2/core/overview.md` §0. A consumer MUST NOT act on a value it does not recognize.

### §B — recipe 2

The key is the lowercase hex SHA-256 of the RFC 8785 (JCS) serialization of:

```text
{
  "recipe":         "openwop-llm-key-2",
  "model":          <the model id the host sends>,
  "provider":       <the provider id>,
  "messages":       <the canonical message array, B.2>,
  "tools":          <the tool definitions as sent, or []>,
  "toolChoice":     <as sent, or null>,
  "responseSchema": <the structured-output schema as sent, or null>,
  "params":         <B.1>
}
```

- **B.1. Parameters.** `params` MUST carry the named members `temperature`, `maxTokens`, `stop`, `seed`, `topP`, `topK`, `frequencyPenalty` and `presencePenalty`.
  - A named parameter the host does not send MUST be `null`, never omitted, so an unsent parameter and a sent zero hash differently.
  - `stop` MUST be sorted by UTF-16 code unit (the order RFC 8785 sorts keys) and de-duplicated.
  - Every other sampling or output-shaping parameter the host sends to the provider MUST appear under `params.extra`, keyed by the provider's own parameter name. `extra` is omitted when there is none.
- **B.2. Messages.** The canonical array is the messages exactly as the host sends them, after template expansion.
  - Each message is `{role, content}`, with `content` an array of parts. A string content MUST become the one-part array `[{"type": "text", "text": <string>}]`.
  - There is no Unicode normalisation: the text is the code points the host sends.
- **B.3. Exclusions.** Request ids, trace context, tenant ids, run and node ids, timestamps and credential material MUST NOT enter the key. A key that varies with any of them is not stable (§Conformance leg 4).

Positive example. The fixture's call (§Conformance) with `{maxTokens: 16, temperature: 0}` hashes:

```json
{"messages":[{"content":[{"text":"Say ok.","type":"text"}],"role":"user"}],"model":"conformance-mock-1","params":{"frequencyPenalty":null,"maxTokens":16,"presencePenalty":null,"seed":null,"stop":null,"temperature":0,"topK":null,"topP":null},"provider":"conformance-mock","recipe":"openwop-llm-key-2","responseSchema":null,"toolChoice":null,"tools":[]}
```

to `f1714d7aa2abf5994dd375f66aac14514b1c2439f203a6171dc6053c59f54402`. With `maxTokens: 32` the key is `07e50afae3ca35d1bc0f52cab7c4bb55b46f8b82333d0a870d2b8dec3b85380b`.

Negative example. Under RFC 0041 those two calls have the same key, because neither `maxTokens` nor the other parameters is hashed.

### §C — the key on the effect ledger

A provider call is an effect: a retried provider call inside a run MUST resolve to the same effect record (`spec/v2/core/idempotency.md` §Composition). Each effect record gains one optional property:

```diff
         "properties": {
           …
+          "cacheKey": {
+            "type": "object",
+            "additionalProperties": false,
+            "required": ["recipe", "digest"],
+            "properties": {
+              "recipe": { "type": "string", "enum": ["openwop-llm-key-2"] },
+              "digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
+            },
+            "description": "RFC 0260 §C — the cache key of an LLM provider call …"
+          }
         }
```

- **C.1.** A host that advertises `replay.llmCacheKeyRecipe` MUST carry `cacheKey` on the effect record of every LLM provider call made while the facet is advertised. `recipe` names the recipe, and `digest` is the key it computed.
- **C.2.** `cacheKey` carries no preimage. The digest is a hash of the request, and the record stays content-free of provider payloads (idempotency.md §Witness).
- **C.3. Replay and fork.** On replay, a recorded result MUST be served only to an invocation whose key, computed by the recipe the source record names, equals the recorded digest.
  - A source record with no `cacheKey` was recorded under RFC 0041's recipe, so the host MUST match it by that recipe.
  - A fork MUST copy each `cacheKey` verbatim with the record, and MUST NOT recompute it.

### §D — normative homes

§A–§B live in the `llmCacheKeyRecipe` facet description, and §C in the `cacheKey` property description: schema-description homes, as RFCs 0258 and 0259 used. `spec/v2/core/replay.md` gains at most one pointer clause beside its RFC 0041 reference. The core word budget is nearly full, so the rules are not restated there.

## Compatibility

`additive` per `COMPATIBILITY.md` §2.4:

- `llmCacheKeyRecipe` is an optional facet on an existing family. A host that does not advertise it is unaffected, and so is a client that ignores it.
- `cacheKey` is an optional property on the closed effect record. Consumers pin the schema version they validate against, and the CHANGELOG names the property (risk R3).
- No existing MUST is relaxed. RFC 0041's recipe stays the rule for a host that does not opt in.
- No event-log shape changes. A fork against a historical checkpoint replays under the recipe its records name (§C.3).

## Conformance

New scenario `v2-replay-llm-cache-key.test.ts`, gated on the facet, on `idempotency`, and on the `conformance-llm-cache-key` fixture. The fixture's node makes one `ctx.callAI` call through the host's conformance mock (provider `conformance-mock`, model `conformance-mock-1`) with the run's prompt and parameters unchanged. This is the pattern of `conformance-callai-attempt-accounting` (RFC 0248). The suite reads the call's record on `GET /runs/{runId}/effects`, a normative observation path, so no seam is needed.

The judges and the recipe are in `lib/llm-cache-key-2.ts`. Their self-tests pin the known-answer vector above and fail each judge on a sabotaged host:

- no `cacheKey`;
- the RFC 0041 recipe id;
- the RFC 0041 recipe's collision on `maxTokens`;
- a per-run nonce in the key;
- a key over a different model id.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A, §C shape `openwop.requirement.0260.shape` | `cacheKey` validates closed, with a registered recipe and a 64-hex digest | the suite, server-free | witnessable — unaided |
| §A.1, §C.1 key recorded `openwop.requirement.0260.key-recorded` | the fixture call's effect record carries `cacheKey.recipe: "openwop-llm-key-2"` | the suite, on a host advertising the facet | witnessable — gated (facet + fixture) |
| §B.1 parameters in the key `openwop.requirement.0260.params-in-key` | two runs differing only in `maxTokens` have different digests | the suite (it chooses the parameters) | witnessable — gated (facet + fixture) |
| §B.3 key stable `openwop.requirement.0260.key-stable` | two identical runs have the same digest | the suite | witnessable — gated (facet + fixture) |
| §B, §B.2 key portable `openwop.requirement.0260.key-portable` | the digest equals recipe 2 recomputed by the suite over the inputs the fixture pins | the suite (it knows every input) | witnessable — gated (facet + fixture) |
| §B.1 `params.extra` for unnamed parameters | — | needs a provider parameter the fixture does not send; the suite cannot see which parameters a host sends beyond the ones it chose | claims-check — a host states its parameter mapping |
| §C.3 replay matches by the source record's recipe | a replay fork of a recorded call is served the recorded result only when the digest matches | needs a recorded result under one recipe and a replay under another, which needs the host to switch recipes mid-test | unwitnessable — the suite cannot change a host's advertised recipe; Unresolved question 2 |
| §A.3 the facet implies `idempotency` — `openwop.requirement.0260.implies-idempotency` | discovery carries `idempotency` whenever it carries `replay.llmCacheKeyRecipe` | the suite, unaided | witnessable — unaided (a host advertising the facet without `idempotency` fails this leg; the ledger legs then record `inapplicable`) |

## Alternatives considered

1. **A safety-fix that changes RFC 0041's recipe for every host.** It closes the gap everywhere at once. Rejected by the maintainer (2026-11-13): every replaying host's recorded results would stop matching at the cut, and the failure would land on hosts that have no LLM nodes affected by the collision.
2. **Hash the provider request body verbatim.** Simple, and it covers every parameter by construction. Rejected: the body carries request ids, trace headers mapped into fields, and provider-specific envelopes, so the key would vary run to run (§B.3) and differ between two hosts calling the same provider. That fails the portability RFC 0041 set out to provide.
3. **Witness through a seam that returns the key.** That was the v1 approach. Rejected: the key would be seam-gated, and `conformance.md` §Witness class would demote §A.1 to a SHOULD. The effect ledger already exists and already carries provider-call records.
4. **Do nothing.** A replay keeps serving a truncated or differently seeded result as if it were the answer to the request being replayed, and no outside party can see that it happened.

## Unresolved questions

1. Should recipe 2 become the default at v3, with RFC 0041's recipe deleted? This RFC does not decide it. The next major's charter does, from how many hosts opted in.
2. §C.3 is unwitnessable because the suite cannot change a host's advertised recipe during a run. A seam that records a result under RFC 0041 and replays it under recipe 2 would witness it, but seam-only witnesses are what this RFC set out to avoid. Left open until a host asks for the transition to be tested.
3. Does a provider's `reasoning` or `effort` parameter belong in the named set, rather than in `extra`? It is in `extra` today. A future recipe id can promote it without changing this one.

## Implementation notes (non-normative)

- The recipe is about twenty lines given a JCS implementation. `conformance/src/lib/llm-cache-key-2.ts` is a reference in TypeScript.
- A host that already records provider calls on the effect ledger adds one property to the record it writes. A host that does not (a provider call it treats as not an effect) has a Layer-2 gap independent of this RFC (idempotency.md §Composition).
- openwop-app and the v2 reference host each need a `conformance.callai.cache-key` node mapping and the fixture listed only while the facet is advertised.

## Acceptance criteria

- [x] Normative text merged in its schema-description homes (§D). *(2026-11-13.)*
- [x] Facet in `spec/v2/facets/replay.schema.json` and `declaration.json`; `cacheKey` in `effect-ledger-projection.schema.json`; capabilities schema regenerated. *(2026-11-13.)*
- [x] `v2-replay-llm-cache-key.test.ts`, `lib/llm-cache-key-2.ts` with self-tests, and the `conformance-llm-cache-key` fixture in the suite. *(2026-11-13.)*
- [x] CHANGELOG entry. *(2026-11-13.)*
- [ ] A certified host bundle records `0260.key-recorded`, `0260.params-in-key`, `0260.key-stable` and `0260.key-portable` `executed-pass`.

## References

- RFC 0041 (multi-agent replay under nondeterminism), whose §A recipe this RFC leaves as the default.
- RFC 0248 (`ctx.callAI` attempt accounting), whose fixture pattern this RFC reuses.
- RFC 0150 (effect identity), RFC 0173 §C.2 (the effect ledger projection).
- `spec/v2/core/replay.md` §Suppression; `spec/v2/core/idempotency.md` §Layer 2, §Witness, §Composition; `spec/v2/core/conformance.md` §Witness class.
- RFC 8785 (JSON Canonicalization Scheme).
- The 2026-08-11 OpenWOP protocol and reference-app assessment, finding P-004.
