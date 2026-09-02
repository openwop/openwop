# RFC 0124 — Gap Register

Companion to `0124-portable-per-run-parameter-deferral.md`. Open questions, deferred decisions, and missing inputs beyond the in-RFC Unresolved questions. Each gap has an owner and a resolution path; a gap with no path is promoted to a Risk.

Several gaps were **resolved in the 2026-07-04 openwop-app-1 Track-A host review** (grounded in real host code); they are struck through with the resolution.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| ~~G1~~ | Proposal | ~~Materialized variable naming vs author-facing `configurable` override keys.~~ **RESOLVED:** normative override key is the **bare param name**; prefix stays internal; deferred expansion MUST auto-generate the `configurableSchema` bare→prefixed mapping. Folded into §"Override key + variable naming". | Spec Architect | Done (review). | — |
| ~~G2~~ | Security | ~~No deterministic way to know a chain parameter carries secret-class material.~~ **RESOLVED (Active promotion, declarative hint):** OPTIONAL `parameters.properties.<p>.x-openwop-sensitive: true` → when set, `sensitive:true` MUST be materialized + redaction is a MUST; when absent, host MAY infer, redaction SHOULD. `x-openwop-sensitive` lands in `workflow-chain-pack-manifest.schema.json` on the path to `Accepted`. | Security Architect | Done (Active). | — |
| ~~G3~~ | Proposal §Rewrite targets | ~~Whether deferred mode MUST lift inline `config.systemPrompt` bodies into a PromptTemplate.~~ **RESOLVED (MUST):** deferred mode MUST lift an inline body into a host-resident PromptTemplate to defer it, else resolve at expansion time. Confirmed against a reference host whose `{{varName}}` runs only through `*PromptRef` composition. | Spec Architect | Done (review). | — |
| ~~G4~~ | Conformance | ~~`configurableSchema` auto-extend vs author-authored.~~ **RESOLVED with G1:** deferred expansion MUST auto-generate/extend `configurableSchema`; not the author's job. | Conformance Architect | Done (review). | — |
| G5 | Compatibility | `capabilities.prompts.variableSources` must include `variable` for the prompt-rewrite path. If a host advertises `deferredParameters.supported` but not `prompts` `variable` source, the fallback ("resolve at expansion time") is specified but untested. | Conformance Architect | `carried:openwop.gap.0124.5` Add a negative-capability conformance leg. | `Accepted` scenario completeness |
| G6 | Reference host | Second witness for `Accepted`. **Update (review):** MyndHyve `workflow-runtime` is **ruled out** — myndhyve-1 confirmed its tree has no chain-expansion path and no prompt-template-over-chain compose surface, so it cannot witness deferred chain expansion. The in-memory reference host also has no compose path. openwop-app is witness #1; a second witness needs either a new tier-2 host with a PromptTemplate compose path, or extending the in-memory host with one. | Compatibility Architect | `carried:openwop.gap.0124.6` Identify/build a second host with a PromptTemplate compose path. | `Accepted` dual-witness |

## Sweep at `Accepted` (2026-07-04)

Register-sweep gate per `RFCS/README.md` §Process. Single-witness graduation (openwop-app `#1245 → #1281`) under the bootstrap steward waiver; architect-reviewed (CONDITIONAL-GO → conditions C1–C3 cleared in this graduation).

| ID | Disposition | Evidence / carry-forward home |
|---|---|---|
| G1 | **RESOLVED** | `carried:openwop.gap.0124.1` Bare param name = normative override key; auto-generated `configurableSchema` (`workflow-chain-packs.md` §"Override key + variable naming"; scenario leg R6). |
| G2 | **RESOLVED** | `carried:openwop.gap.0124.2` `x-openwop-sensitive` in the manifest schema — **description reconciled** to the amended `source:"secret"` MUST in this graduation (was stale pre-amendment wording; architect blocker C2). |
| G3 | **RESOLVED** | `carried:openwop.gap.0124.3` Deferred mode MUST lift an inline prompt body; else resolve at expansion time (`expandChainDeferred` prompt-position handling; scenario). |
| G4 | **RESOLVED** | `carried:openwop.gap.0124.4` Deferred expansion auto-generates `configurableSchema` (scenario R6 leg). |
| G5 | **RESOLVED (folded into the scenario)** | `carried:openwop.gap.0124.5` Negative-capability: `deferredParameters` without a `prompts.variable` source → prompt token falls back to expansion-time. Landed as a server-free leg in `workflow-chain-deferred-parameters.test.ts`. |
| G6 | **CARRIED FORWARD (single-witness waiver)** | `carried:openwop.gap.0124.6` Second witness — MyndHyve + in-memory both lack a chain-expansion / PromptTemplate-compose path. A PromptTemplate-compose host is the deferred dual-witness path. Graduated single-witness under the steward waiver (0120/0121/0125/0126 precedent), witness #2 a tracked follow-up. The RFC's own dual-witness criterion is explicitly overridden by the waiver, recorded in the graduation note. Also carried: the ADR 0250 host route-test for the plaintext-rejection 400 (verified-by-construction today; reference-impl-tier follow-up). |
