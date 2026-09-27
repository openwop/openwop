# TODO — open steward work

> Rewritten 2026-09-26 by `openwop-77` when that session spun down (HEAD `7f97b724`). The
> MCP/A2A remediation program (RFCs 0197–0216) is **closed**: every RFC it filed is `Accepted`,
> and 0199 was the last (#1650). Its phase record was deleted as it asked. It is in git history
> at `7f97b724:TODO.md`, and the 2026-09-19 gap-closure follow-ups (S1–S4) are there too.
>
> Tick a box only when the change is merged on `main`. Delete an item once it is closed.

## State at spin-down

- **RFCs:** every RFC is `Accepted` except **0121** (`Active`) and **0038** (`Draft`, Parked).
  Every Accepted RFC whose window was waived is **provisional**: its RFC 0156 §B review is owed,
  and `docs/SECTION-B-REVIEW-PACKET.md` lists them.
- **Suite:** `@openwop/openwop-conformance` and `@openwop/spec-artifacts` **2.42.6** are published,
  with GitHub release `v2.42.6`. No cycle is open.
- **Hosts:** openwop-app certified RFC 0199 on published 2.42.2
  (`evidence/v2-host-bundles/openwop-workflow-engine-side-rev-rfc0199-2.42.2.json`). It was asked
  to pin 2.42.6, which adds the `appendEra2Event` seam.

## 1 — RFC 0121 subscription-rail witness · **owner openwop-77 (paused)**

David cleared **GitHub Copilot only** (#1604). Anthropic, Google and OpenAI are **not** cleared,
so never advertise `subscription` for them. The work is blocked on a GitHub account whose Copilot
works through the CLI. Buying a plan is not covered by any autonomy grant, so ask David.

- [ ] Run a device flow to get a token with no scopes. Verify it with `@github/copilot-sdk`.
- [ ] openwop-app adds the loopback sidecar `clients/copilot-provider`
      (`OPENWOP_COPILOT_ENDPOINT=http://127.0.0.1:8791/v1`).
- [ ] Witness one real model turn through it, then do a certified cut.
- [ ] Flip to `Accepted`. **Never flip on the advert-shape or §B.8 rows alone.** §B.8 proves
      scope rejection on the wire and nothing about storage or resolution (#856).

## 2 — RFC 0156 §B retrospective reviews · **externally gated**

- [ ] Each provisional `Accepted` RFC needs a §B review. The review must be cross-organization,
      so it cannot run until the non-steward tripwire fires. A steward self-review recorded as
      `ratified` is the substitution §B forbids. Public call: #1609.
- [ ] RFC 0215 §A.3 per-tenant fair share (a SHOULD) is unmet on both deployed hosts. openwop-app
      needs a `tenant_id` on its delivery rows (their ADR 0752).

## 3 — Audit follow-ups (unfailable-leg audit, waves 1–2)

- [ ] **Ratchet debt:** `conformance/softskip-after-assert.baseline.json` holds **172** sites that
      assert and then `softSkip()`, so each records `executed-pass` with a `partial-witness:`
      detail. `scripts/check-softskip-after-assert.mjs` stops the count growing. Work it down:
      each site becomes `blocked` **only if a conforming host could have made the requirement
      observable**. Otherwise it becomes inapplicable before the first assertion, or an annotated
      `// partial-witness-ok:`. The wave-2 over-corrections (dead-letter, backpressure) show what
      the wrong call looks like. Lower the baseline with `--write` as sites close.
- [ ] **Per-attempt budget seam:** an effect-budget leg cannot tell per-attempt spend from per-run
      spend without a seam. The envelope fixture's `maxTokens` also needs a value the leg can
      assert against.
- [ ] **Audit checkpoint signature preimage contradiction:** `spec/v1/auth-profiles.md` §3 signs a
      `merkleRoot`, but the checkpoint schema signs canonical JSON of the checkpoint. Pick one,
      treating it as a corpus erratum or an RFC, and fix the scenario to match.
- [ ] **Postgres reference host** emits audit fields beyond the closed schema. The audit-log leg
      relaxes the schema in-test to tolerate them, and says so. Either the host drops them or
      the schema names them.
- [ ] Audit-entry export shape → a future `auditLogIntegrity` RFC.

## 4 — Smaller residuals

- [ ] Promote `v2-sse-last-event-id-cursor` onto the core-standard floor after measuring all
      three bundle hosts.
- [ ] Watch A2A PR #2068 (SubscribeToTask POST→GET prose). If it merges, revisit the interop-map
      D1 exception.
- [ ] Generator residue (S1): `projectV1FacetSchema` keeps `multiAgent.executionModel`'s
      `tier`-gated `if/then` while stripping its properties. v2 therefore carries a no-op
      `if: {properties: {}}, then: {}`. It is harmless, but tidy it.

## Pattern checks (no code owed; read new scenarios against these)

- **A transport failure is an unreadable observation, not a verdict.** A read that throws after
  the host dies must not become `executed-fail` (`323400a2`).
- **Two scenarios that drive a seam at the same operator URL share one effect identity.** A
  conformant host dedupes the second exercise to zero calls (`2ae74ee6`).
- **A blocked row on a conforming host is a release blocker**, unless the cut's posture
  explains it. 2.42.3–2.42.4 shipped an era-2 row blocked on every host; hotfix 2.42.5 (#1647).
- **Converting a partial pass to `blocked` is right only if a conforming host could have made
  the requirement observable.**

## Operating notes

- **v2-reference cuts:** the template is `/tmp/claude-501/cut2401.sh`, signed with key
  `v2-reference-4`. Boot from a fresh openwop-examples worktree after `npm install`, because the
  shared checkout has no deps. Pinned fake ports need `--max-workers 1`. Run
  `npm run build:cli` before `npm pack`.
- **Release locks:** take `/tmp/claude-501/openwop-release-<ver>.lock` before cutting. Two
  sessions double-cut 2.41.0.
- **RFC 0111** is `Accepted` (#1629). **0121**'s tripwire is
  `externally-gated:provider-tos-clearance`. Do not withdraw it, because `Withdrawn` would lose
  the tripwire.
- **330 open risk rows**, ratcheted at `docs/witness-baseline.json`. An open *risk* is a
  legitimate standing state; an open *gap* is work owed.
- **`npm run openwop:check` needs network** (`npx -y` redocly/asyncapi).
