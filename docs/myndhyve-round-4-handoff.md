# Handoff → MyndHyve session: round-4 (post-v1.1.4 release; 2026-05-26)

**To:** the Claude Code session working on the MyndHyve app (`api.myndhyve.ai`).
**From:** the openwop spec session (2026-05-26).
**Companion to:** `docs/myndhyve-rfc-adoption-handoff.md` (round-1, ✅ DONE), `docs/myndhyve-round-2-handoff.md` (round-2, ✅ items 1+2 DONE, item 3 deferred), `docs/openwop-adoption/round-3-closure-2026-05-26.md` (round-3, ✅ 4 of 10 shipped, 3 deferred, 3 opt-out).
**Status of the openwop side:** **v1.1.4 cut + tag pushed 2026-05-26** (`v1.1.4` + `sdk/go/v1.1.4`). RFC 0028 / 0029 / 0040 / 0041 / 0055 / 0057 are now `Accepted` on the strength of MyndHyve's three rounds of advertisement; the v1.1.4 CHANGELOG narrates the cycle.

> **Why this exists.** Round-3 closed 4 of 10 ask items, with 3 deferred (0056 / 0061 / 0062) and 3 opt-out (0025 / 0035 / 0036). v1.1.4 cut against that posture. Round-4 has two narrow asks tied to the release + one optional re-evaluation pass.

## Per-feature checklist

### 1. Re-pin `vendor.myndhyve.brand@1.1.0` (post-PR #232 merge; openwop-side)

Status: **PR #232 merged 2026-05-26** — `vendor.myndhyve.brand@1.0.0 → 1.1.0` ships with `x-openwop-form` annotations on `brand.persona.discover.config.json` (`provider-picker` + `model-picker { dependsOn: ["provider"] }`).

| Advertise | Implement | Wire seam |
|---|---|---|
| (no capability flag — `x-openwop-form` is per-property annotation on the pack-manifest `configSchema`) | Re-pin the new pack-version hash in `docs/pack-pins/vendor-myndhyve-pins.json`. Re-deploy `workflow-runtime` (forces resolver cache invalidation). Curl-verify the pack resolves to the new `manifestHash`. | The 7-hash pin block is pasted in the PR #232 body (post-merge canonical values may differ; re-run `node scripts/emit-pin-json.cjs vendor.myndhyve.brand 1.1.0 --quote-key` against `main` HEAD if so). |

**Asks from your side**: paste the post-merge JSON block on PR #232 as a reply when you've re-pinned. Once the pin lands + your `myndhyveNodePackResolver` round-trips to the new hash, **RFC 0066 graduates `Draft → Active → Accepted` in one step** once the 7-day comment window closes (~2026-06-01).

### 2. Run `npx @openwop/openwop-conformance@1.7.0` against `api.myndhyve.ai`

**v1.1.4 ships `@openwop/openwop-conformance` 1.6.1 → 1.7.0** with the autonomous-agent-runtime cohort scenarios. A formal run against your live capabilities advertisement (revision `00217-q7c`) would provide the harder evidence supporting the round-3 graduations (RFC 0029 / 0055 / 0057) — the curl-verified capability blocks were sufficient for openwop-side promotion, but a green pass-count chart is the conventional public-record evidence.

**Asks from your side**: one conformance run + the JSON output. We'll fold it into `INTEROP-MATRIX.md` "Conformance trajectory" and `examples/hosts/*/conformance.md` banner-sync per the v1.1.4 Phase 7 re-measurement pass.

### 3. Optional — re-evaluate round-3 deferrals against your roadmap

Round-3 closure-doc deferrals (no openwop-side action required; this is a check-in if your product roadmap has shifted):

| RFC | What you deferred | What would change your mind |
|---|---|---|
| **0056** (run feedback & annotations) | "No current product driver; HITL inbox is browser-side without annotation side-store." | A quality-analytics or HITL-review feature would demand it. v1.1.4 ships the in-memory + Postgres + SQLite reference implementations end-to-end (the wire surface is solid). |
| **0061** (stateful agent-loop, `executionModel.version: 5`) | "Engine-level work: per-run monotonic iteration counter + emission on `runOrchestrator.decided` + stateful resume continuity. Estimated 4-8 hours dedicated. Partial advertisement (version: 5 without honoring iteration MUST) would violate honesty policy." | Same — this is gated on the engine-side work + the partial-advertisement honesty rule. RFC 0061 is `Active` on the openwop side; awaiting a host wiring the v5 loop end-to-end for `Accepted`. |
| **0062** (memory distillation — "dreams") | "Largest item in the cohort; estimated 2-3 days. Composes on 0061's stateful primitive — defer until after 0061." | Same dependency on 0061. RFC 0062 is `Accepted` end-to-end on the in-memory reference host (M2 enforcement landed this cycle); MyndHyve adoption would be a second-host confirmation, not a graduation gate. |

### 4. Honest-correction recognition — RFC 0058 wall-clock arm landing

Acknowledging the two-round arc on RFC 0058: round-3 closure-doc reported `maxRunDurationMs` honestly NOT advertised; round-3 follow-up landed the real arm (`limits.maxRunDurationMs: 600000`) after MyndHyve retracted the earlier `maxNodeExecutions` conflation. **The openwop-side documented this verbatim in v1.1.4 release notes bullet #12 + `docs/openwop-adoption/rfc-0058-round-3-retraction.md`** — the retraction + corrected landing is exactly the honesty-policy posture we want non-steward hosts to model. RFC 0058 stays `Active` pending a second-host advertisement.

## Out of scope for this round

- **RFC 0050 (SAML/SCIM)** — round-1 opt-out; the synthetic IdP fixture ships in `@openwop/openwop-conformance@1.6.0`+ for any host wanting to wire its SAML ACS. v1.1.4 changes nothing here.
- **RFC 0054 (run diff)** — round-1 opt-out; the reference app's client-side compare (`RunComparePage.tsx`, plan Item #24) operates without it.
- **A2A peer endpoint** (round-2 item #3) — confirmed deferred until MyndHyve has a product driver. The reference app's `A2APeerPanel.tsx` (PR #224) remains a forward-compat placeholder.

## Reference (on `openwop@main`, post-v1.1.4)

- **`CHANGELOG.md` `[1.1.4]`** — full release narrative (14 bullets).
- **`https://github.com/openwop/openwop/releases/tag/v1.1.4`** — published GitHub Release.
- **`@openwop/openwop@1.1.4`** (npm) — TypeScript SDK with `parseMemoryWrittenEvent` typed helper.
- **`@openwop/openwop-conformance@1.7.0`** (npm) — conformance suite with autonomous-agent-runtime cohort scenarios.
- **`openwop-client==1.1.4`** (PyPI) — Python SDK in lockstep.
- **`github.com/openwop/openwop/sdk/go@v1.1.4`** (Go modules) — Go SDK in lockstep.
- **Round-3 closure doc** — `docs/openwop-adoption/round-3-closure-2026-05-26.md`.
- **RFC 0058 retraction doc** — `docs/openwop-adoption/rfc-0058-round-3-retraction.md`.
- **Pack pin emitter** — `scripts/emit-pin-json.cjs <pack-name> <version> [--quote-key]`.

## How to report back

Same shape as round-1 + round-2 + round-3:

1. Post-merge canonical 7-hash JSON for `vendor.myndhyve.brand@1.1.0` on PR #232 (round-4 item 1).
2. `npx @openwop/openwop-conformance@1.7.0` against `api.myndhyve.ai` — paste the JSON output (round-4 item 2).
3. Optional check-in on the 3 round-3 deferrals (round-4 item 3).
4. No action needed on round-4 item 4 (honest-correction recognition only).

Round-4 items 1 + 2 close cleanly per item once your re-pin + conformance evidence lands; item 3 is informational only.
