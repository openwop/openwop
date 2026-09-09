# Threat Model: Replay and Fork

> **Scope:** `spec/v1/replay.md` — `POST /v1/runs/{runId}:fork` in both `mode: "replay"` and `mode: "branch"`, the recorded-fact re-emission contract (caveat 5), node-effect suppression (`capabilities.replay.sideEffectSuppression`), the LLM cache key a replay reuses, and **host-initiated fan-out** — webhook delivery, outbound streams, and analytics or audit sinks that project a run's event log outward.
> **Last updated:** 2026-08-19
> **Companion artifacts:** `spec/v1/replay.md` · `spec/v1/webhooks.md` · `spec/v1/idempotency.md` · `SECURITY/threat-model-secret-leakage.md` · `RFCS/0057-*` §D
> **Status of evidence:** `replay-fanout-suppression.test.ts` witnesses the fan-out MUST NOT on the wire and is falsifiable (§5). It is **capability-gated and outside every profile floor**, and on a host with an SSRF guard it records `blocked` — see §4, which is a property of the evidence, not a caveat about it.

## 1. Why this model, and why it is not secret leakage

The other threat models in this directory are mostly about **things escaping**: a credential in an event payload, a prompt reaching a tenant that should not see it, a cache serving one tenant's completion to another. Two of those live here too (§3.3, §3.4).

But the defining harm of this surface is different, and filing it under leakage would have hidden it: **nothing escapes.** A replay re-emits events that are true records of things that really happened, to a subscriber genuinely entitled to see them, over an authenticated and correctly signed channel. Every individual check passes. The harm is that the *act of delivering* asserts a claim the delivery does not carry in its body — **that this happened now, in this run** — and that claim is false.

Call it what it is: **a true-shaped false statement.** A subscriber cannot detect it by validating anything, because there is nothing invalid to find. It is an **integrity-of-externally-projected-facts** failure, and it is the reason this document exists rather than a section in `threat-model-secret-leakage.md`.

## 2. Trust boundaries

```text
[Operator]                                     ← :fork {mode, fromSeq}
        │ T1  replay vs branch — the whole distinction lives here
        ▼
[Host: fork creation → inherited log < fromSeq as FIXED HISTORY]
        │ T2  re-emitted events carry fresh envelope ids, pinned payload ids
        ▼
[Host: node re-execution]                      ← sideEffectSuppression
        │ T3  recorded outcome vs live call; cache key reuse
        ▼
[Host: event-log projection]                   ← THE GAP THIS MODEL OPENED WITH
        │ T4  webhook dispatcher / stream / analytics sink reading the append path
        ▼
[Subscriber · analytics · audit consumer]
             T5  receives a durable-sounding claim about a run
```

- **T1 Mode.** `replay` and `branch` differ in exactly one respect that matters downstream: a branch's events are **new facts**, a replay's are **records**. Every rule below reduces to reading that distinction from the run, never from the event.
- **T2 Re-emission.** Caveat 5 *requires* re-emission of recorded facts. That requirement is what creates the fan-out exposure — the more correct the host, the more it re-emits.
- **T3 Node effects.** Bounded by `sideEffectSuppression`; out of scope for T4, which is host-level.
- **T4 Projection.** The host's own outbound path. It is not in the node graph, which is why it was unspecified for the life of v1.
- **T5 Consumer.** Has no way to distinguish a re-emitted delivery from an original one — see §3.1.

## 3. Threats

### 3.1 `replay-fanout-no-refire` — re-emitted events delivered outward

**Threat.** A host fans out on every event append. A `mode: "replay"` fork re-emits the source run's events as fixed history; the dispatcher delivers them. A subscriber records that a run wrote a memory entry, completed, or charged a card **again**.

**Why subscriber-side defences do not help.** This is the part that makes it a security property rather than a tidiness one:

- Webhook dedup keys on `(subscriptionId, eventId)` per `webhooks.md`. A re-emitted event legitimately carries a **fresh** envelope `eventId` — envelope identity is volatile, and caveat 5 pins the *payload's* identifiers, not the envelope's. **So a correct re-emission defeats subscriber dedup by construction.**
- The signature verifies. The timestamp is fresh. The tenant is right. Nothing a receiver can check is wrong.
- The subscriber cannot tell that the run it is being told about is a fork, because the delivery is about the *event*, not the run's provenance.

The only place the distinction is knowable is the host, at the delivery boundary. That is why the rule is unconditional and lives there.

**Rule.** `replay.md` §"Host-initiated fan-out is an external effect": a host MUST NOT emit outbound deliveries for events a `mode: "replay"` fork re-emits as fixed history; replay-ness MUST be read **from the run**, never from the event type; suppression applies to **outbound** delivery only — the fork's own log MUST still carry the events; `branch` is out of scope; and it is **not** gated on `sideEffectSuppression`, which describes node effects.

**Not a scope carve-out.** `replay.md` contrasts lifecycle events (`run.started`, `run.completed`) as "ambiguous noise" against recorded-fact events like `memory.written` as "a false statement". That contrast **ranks the harm; it does not narrow the scope** — a host suppressing only recorded-fact deliveries would be selecting by event type, which the first requirement forbids.

**Prior art.** Martin Fowler, *Event Sourcing* §"External Updates": *"those external systems don't know the difference between real processing and replays"*, with a Gateway that checks replay mode before passing the call outward. A survey of the obvious alternative — deliver anyway, tag `isReplay`, let the receiver filter — found it **only** for internal observability sinks (Azure Durable Functions stamps `isReplay` on telemetry). No surveyed system tags an *external* delivery and sends it.

**Found in two independent trees**, in the second as a *written, reasoned exemption* recorded on the ground that "a replay is a distinct run whose events are genuinely new" — the reading this rule negates.

### 3.2 Node effect re-execution

Bounded by `capabilities.replay.sideEffectSuppression` (`none` / `recorded-outcome`). A host advertising `recorded-outcome` returns the Nth recorded outcome for the Nth attempt and fails closed with `replay_source_missing` when it cannot. Covered by `replay-side-effect-suppression.test.ts`. Distinct from §3.1: that is the host projecting outward, this is a node calling outward.

### 3.3 Cache-key portability across tenants

A replay reuses the source's LLM cache key. If the key is not tenant-scoped, a fork created in one tenant can read a completion produced in another — see `replay-llm-cache-key-portable` and `cache-cross-tenant-isolation`.

### 3.4 Fork authority

A fork inherits the source's history but not its authority. Fork creation is a decision in the *caller's* tenant; nothing about the source run confers permission to create it.

## 4. A property of the evidence, not a caveat about it

`replay-fanout-suppression.test.ts` observes the MUST NOT by **being the subscriber**: it boots a loopback HTTP receiver and registers it via `POST /v1/webhooks`.

A host with an SSRF guard on that endpoint **correctly refuses a loopback destination**, and one certifying host additionally requires `https:` — a spec MUST that no bypass should touch. Such a host records `blocked`. That row means **unobservable, not unmet**, and a reader of `INTEROP-MATRIX.md` should read it that way: a host can be fully conforming on this rule and produce a `blocked` row.

Consequently:

- **The scenario is outside every profile floor.** Putting a receiver-gated row in the `openwop-replay-fork` floor would make that profile un-certifiable for a host whose security control is correct, and would read as a regression that is not one. A floor must not punish a host for a security control.
- **Its witness on a reference host depends on an operator opt-in** (`OPENWOP_WEBHOOK_ALLOW_PRIVATE=true`). That dependency is disclosed here rather than in a footnote, because it is the difference between "this rule is witnessed" and "this rule is witnessed on hosts that opened a door for the test".
- **A proposed portable alternative** — `OPENWOP_WEBHOOK_RECEIVER_URL`, letting a guarded host point the suite at a public HTTPS sink with its guard fully intact — would remove that dependency. It carries its own disclosure: pointing the suite at an external origin **egresses run data to that origin**, which is an operator decision.

**What was rejected, and why it matters here.** A host offered a durable `webhook_deliveries/{id}` record with `status: "suppressed_replay"` as a positive, host-owned artifact to assert on instead. It was declined: asserting on such a record would **mandate host behaviour the spec never asked for, invented by the test rather than by the rule.** The MUST NOT is about outbound delivery, so the conforming observable is the absence of one, and a host that suppresses correctly without writing a record must not fail. Such a record remains valuable as optional host-side corroboration.

## 5. Why the negative is falsifiable

An assertion that nothing arrived is worthless unless something could have. The scenario therefore runs three legs in **one** test against **one** receiver and **one** subscription:

1. **Positive control** — the source run delivers. Absence is only asserted after presence is proven on that exact wiring.
2. **The MUST NOT** — after a `mode: "replay"` fork, a scaled quiet window with zero deliveries attributable to the fork.
3. **Boundary** — a `branch` fork **does** deliver, which is what separates "reads replay-ness from the run" from "silences anything that is a fork".

Falsification was demonstrated rather than assumed: with the host's suppression removed, leg 2 fails with the array it should not have received.

Two techniques from that run are worth reusing. **Wall-clock refutes disposition:** the scenario cannot honestly pass in under ~7.5s (grace plus quiet window), so a green at 41ms was arithmetically impossible for a run that happened — where a scenario has a known floor on its own runtime, duration is a free vacuity check needing no instrumentation. And **the requirement records its own disposition** at every exit path, because a file-level `executed-pass` earned by leg 1's control would otherwise certify a MUST NOT that never ran (`conformance-certification.md` gap G8).


## 6. Residual risks

Limits the controls in §3 leave standing (RFC 0173 §E.2).

- **Branch re-fires.** `mode: "branch"` is out of scope for suppression by design: a branch re-executes side-effecting nodes live for sequences `>= fromSeq`, so branching past an executed payment performs it again (`spec/v1/replay.md` §"branch mode"; RFC 0140 §D). The v2 effect-seam manifest states the asymmetry as data (`branchReFires: true`) and the suite witnesses it as a **permission**, not a requirement (RFC 0173 §C.1; RFC 0140 G6). A host SHOULD surface this in any operator-facing fork UI (`replay.md`).
- **Seams outside the manifest.** `GET /v1/host/effect-seams` lists every outbound effect path the node runtime can reach; RFC 0140 G7 ("not enumerable in the spec") is answered by making the host enumerate it (RFC 0173 §C.1). The suite cannot enumerate a host's seams itself, so completeness is **negative-existence**: a seam the host omitted re-fires and no black-box scenario sees it (RFC 0173 §Falsifiability). RFC 0140 G4's three unguarded reference-host paths (`deliverToSubscribers`, `s3Blob.put`, `openSearchSearch`) become manifest rows that fail until guarded.
- **The manifest is a self-declaration; RFC 0140 R5 is the control.** A host can omit a seam (RFC 0173 adversarial review 2). The check is the R5 audit class — guarding the convenience wrapper instead of the chokepoint: ADR 0533 found `guardedEgressFetch` guarded while `safeFetch` and MCP invocation dialled the underlying fetch directly from six modules. The mitigation is host-side and unenforceable by spec: guard the shared dispatcher and add a source-scan tripwire that greps the host for outbound clients against the manifest (RFC 0140 R5, `open`). A manifest is not a proof.
- **Layer-2 identity gaps.** v2 keys Layer 2 effect identity on **business identity** — one logical effect id per effect, stable across transport retries, injected as the provider's idempotency key (RFC 0173 §B `idempotency` row; RFC 0150 §B). For a provider with no natural business key the v1 activity recipe is the documented **fallback** (RFC 0173 §B, C6.7), where keying is under-specified (RFC 0173 R4, `open`); which providers have a key is recorded in `spec/v2/ext/provider-idempotency/registry.json` (RFC 0150 G3). The `effect-identity-business-key` witness runs against the fixture provider that rejects a changed key (RFC 0150 G4), never a fallback-keyed one. No deployed host persists a v1 recipe key (`docs/EFFECT-IDENTITY-V1-INVENTORY.md`): nothing is migrated, and nothing is witnessed. Layer 2 retention is ≥ 14 days (RFC 0170 §D.3); a replay reaching a seam after the ledger has aged out has no record to discharge against.

## 7. Verification

v2 scenarios (suite 2.0.0, RFC 0173 §Conformance), with the witness class from its falsifiability table:

- **`effect-seam-manifest`** — gated on `replay`: every manifest row is `guarded: true`; one seam of each `kind` (`http | queue | storage | provider-sdk | webhook-fanout`) is driven through the suite's receiver and no re-fire is observed. **Witnessable-gated.** Manifest completeness (§C.1) is **negative-existence** and has no scenario.
- **`effect-identity-business-key`** — gated on `idempotency`: the same provider key across two transport retries, via the fixture provider. **Witnessable-gated.**
- **`security-defaults-table`** — corpus: every `core/` obligation has a surface, an invariant, and a witness class ≠ `unwitnessable`. **Unaided (corpus).**
- **`relaxation-recorded`** — a bundle with `host.relaxations[]` cannot certify the relaxed profile (RFC 0173 §A.2). **Unaided.**
- **`threat-model-template`** — this file carries §1–§8. **Unaided (corpus).**
- **`fork-a-v1-run`** (RFC 0176 §A.5; named by RFC 0173 §E.2) — gated on history or the C.1 seams profile: an era-`2` run forked on the v2 host has a prefix byte-equivalent to the translated parent under RFC 0041 §C, and `run.started` carries the legacy Subject. **Witnessable-gated.**

Carried from v1: `replay-fanout-suppression.test.ts` (§4–§5 — outside every profile floor, `blocked` on an SSRF-guarded host) and `replay-side-effect-suppression.test.ts` (§3.2; in v2 it asserts the manifest, RFC 0173 §C.1). In v2 `sideEffectSuppression: none` is not a value: a host that cannot suppress does not advertise `replay` (RFC 0173 §B, C6.2).

## 8. References

- RFC 0041 §C; RFC 0057 §D; RFC 0140 §B, §D, G4, G6, G7, R5; RFC 0173 §A.2, §B, §C.1, §E.2, §Conformance, §Falsifiability, adversarial review 1–2, R1, R4; RFC 0176 §A.5; RFC 0150 §B, G3, G4; RFC 0170 §D.3.
- `spec/v2/core/replay.md`; `spec/v2/core/security-defaults.md` (the obligation table); `schemas/v2/effect-seam-manifest.json`; `GET /v1/host/effect-seams`; `spec/v1/replay.md` §"Side-effect suppression in replay", §"Host-initiated fan-out is an external effect"; `spec/v1/idempotency.md`; `spec/v1/webhooks.md`; `docs/EFFECT-IDENTITY-V1-INVENTORY.md`.
- `SECURITY/invariants.yaml` (`replay-fanout-no-refire`, `replay-llm-cache-key-portable`, `cache-cross-tenant-isolation`); `SECURITY/threat-model-secret-leakage.md`; `scripts/check-threat-model-template.mjs`.
