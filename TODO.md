# TODO — open steward work

> Rewritten 2026-09-26 by `openwop-77` when that session spun down (HEAD `7f97b724`). The
> MCP/A2A remediation program (RFCs 0197–0216) is **closed**: every RFC it filed is `Accepted`,
> and 0199 was the last (#1650). Its phase record was deleted as it asked. It is in git history
> at `7f97b724:TODO.md`, and the 2026-09-19 gap-closure follow-ups (S1–S4) are there too.
>
> Updated 2026-09-27: §3 and §4 worked (details below), `INTEROP-MATRIX.md` rewritten, and the
> quickstarts moved to v2. Updated 2026-09-28 after the 2.43.1 release. Updated 2026-10-01 after
> the 2.45.2 release (state, §6 and §7).
>
> Tick a box only when the change is merged on `main`. Delete an item once it is closed.

## State (2026-10-01)

- **RFCs:** 220 `Accepted`. `Active`: **0121** (paused), **0222** (last box needs a real yanked v2
  version), **0228** (v1 host-service error codes), **0229** (production-safe secrets witness) and
  **0230** (inbound webhook ingest contract). **0038** is `Draft` (Parked). **0225**, **0226** and
  **0227** went `Accepted` since the last update (#1791, #1821, #1831). Every waived-window
  `Accepted` RFC is **provisional** (RFC 0156 §B).
- **Suite:** **2.45.3 is published** (#1835, tag `v2.45.3` on `67ad3a54`). Releases since 2.44.2:
  2.44.3–2.44.9, then 2.45.0 (#1815, CORS preflight headers), 2.45.1 (#1819), 2.45.2 (#1822) and
  2.45.3 (RFC 0229 witnesses, the RFC 0230 trigger-bridge path, the v2 tenant-isolation
  witnesses, and a lost response recorded `blocked`). No host has cut on 2.45.3 yet.
  **The 2.45.4 cycle is open on `main`** (#1836, the v2 ports of `production-backpressure` and
  `budget-enforcement`) and is not cut.
  Take a release lock (`/tmp/claude-501/openwop-release-<ver>.lock`) before cutting.
- **Normative homes:** all 73 core families have v2 homes (#1802–#1804). The kernel budget is
  37,284 / 37,800 words, with the generated error table outside it (RFC 0227).
- **SDKs:** **2.5.0** (npm, PyPI, `go/v2.5.0`) sends `OpenWOP-Client-Version` on every request.
  Re-vendoring to a newer corpus tag is a separate change.
- **Hosts** (the canonical files in `evidence/v2-host-bundles/`, all certified, 0 fail, 0 blocked):
  the v2 reference host on 2.44.6 (437 pass), MyndHyve on 2.45.2 (273 pass) and openwop-app on
  2.44.5 (263 pass). `coordination` is `Stable` on MyndHyve's 2.45.2 cut (RFC 0220, #1828).
- **Cuts:** every certified public cut needs a fresh operator approval.

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

- [x] Ratchet debt: 172 → 1 (#1655, #1656, #1658–#1660). The old gate miscounted in both
      directions; #1657 blanks comments and strings before scanning. The one site left is
      `audit-log-integrity`, owned by the audit-budget work below. Checked on openwop-app at
      major 1 before release: #1659 reverted the one row that had wrongly gone `blocked`.
- [x] Audit checkpoint preimage contradiction and export shape: **RFC 0218 `Active`** (#1653).
  - [x] RFC 0218 §C, the anomaly shape, with `chainValid` tied to anomalies (#1703, examples #105).
  - [x] RFC 0218 `Accepted` on the certified 2.43.0 cut (#1733, #1727).
- [x] Postgres extra audit fields (examples #96) and the per-attempt budget witness for RFC 0033 §C
      (#1664, openwop-app #4167; new optional seam `…/test/mock-ai/dispatch-budgets`).
  - [x] openwop-app's vendored fixture carries `maxTokens: 256` (openwop-app #4161, pinning 2.42.9).
  - [x] RFC 0033 §B truncation legs compare real attempts and record the SHOULD (2.42.9, #1695).
  - [x] The anomaly shape (RFC 0218 §C, #1703).
  - [x] The mock-node race: a cross-process lock per node id (2.42.9, #1695).
- [x] Rotation overlap seam (#1720, examples #117).

## 4 — Smaller residuals

- [x] `v2-sse-last-event-id-cursor` is on the core-standard floor (#1652).
- [x] The generator no-op `if/then` is gone (#1652). Found along the way:
      `check-v2-surface-monotone` was blind to a tightened object carrying an `if`, which covered
      every capability family. Fixed and sabotage-proved, and the baseline gained 540 tuples.
- [ ] Watch A2A PR #2068 (SubscribeToTask POST→GET prose), still open on 2026-09-27. If it
      merges, revisit the interop-map D1 exception.

## 5 — Found while rewriting the quickstarts for v2 (#1654)

- [ ] MyndHyve's certified 2.42.8 cut fails `0172…unversioned-is-v2` and `0221.generated-secret-returned`
      (it echoes a supplied secret). Filed as myndhyve/myndhyve#528. Its next certified cut with both
      fixed is also RFC 0221's tier-2 witness.
- [ ] RFC 0224 gap G2 (`checkpointPublicKeys[]`): reopen when the first host dual-signs during a key
      rotation, or when anyone needs rotation without a verify gap.

Spec problems:
- [x] When is a request v2: Class 3 correction, the header-less default applies to
      `/.well-known/openwop` only; every other unversioned path is v2 (#1684, suite leg in 2.42.8).
- [x] A lost webhook secret: **RFC 0221 `Accepted`** (#1680, #1728; v2 reference host fixed in
      examples #98, witnessed on the certified 2.43.0 cut).
- [x] Dangling `auth.md` references (#1681).
- [x] Metadata key count: fixed by another session (#1671).
- [x] v2 registry operations: **RFC 0222 `Active`** (#1702, #1710; registry #77, #79 gate).
  - [ ] RFC 0222's last box: `v2-registry-lifecycle` leg 1 needs a non-partial pass, which needs a real
        yanked v2 version on packs.openwop.dev. Do not yank a pack just to produce evidence.

Defects outside the spec:
- [x] v2-reference's substituted `workspaceId` (examples #99), and the delivery-shape leg now checks
      "present exactly when" (#1682, which opened 2.42.9).
- [x] `new-pack` scaffolds a v2 pack from a registry clone (registry #76, examples #101, openwop
      #1688). The template now lives in `openwop-registry/templates/node-pack/`. It was proven end to
      end: scaffold → schema check (with a sabotage) → build → sign → `auto-register --tree v2` →
      `verify-signatures` → `npm run check`. The README's CI-only claim is corrected.
  - [x] `build-pack-tarball.mjs` bundles the file `runtime.entry` names, so WASM, Python and Go packs
        can publish (registry #78; all 156 existing tarballs rebuilt byte-identical).
  - [ ] Fixtures `rust-misbehaving-abi` / `rust-misbehaving-memory` keep v1-shaped manifests
        (never published). `packs/community.openwop-team.demo` carries stale v1 `keys/` files.
- [x] `tiny-workflow` and `streaming-client` speak v2, and CI runs them against the v2 reference
      host (examples #100).

## 6 — Follow-ups from 2026-09-28

- [ ] **RFC 0219 gap G7:** `0219.no-floor-no-refusal` needs a certified host that advertises no
      `minClientVersion`. It is externally gated.

## 7 — Follow-ups from 2026-10-01

- [ ] **RFC 0228's two open boxes.**
  - The v2 ports exist (`v2-fs-sandbox-escape-refused`, `v2-production-backpressure`,
    `v2-budget-enforcement`, suite 2.45.4), proven against a scratch host. Still owed: a certified
    `storage_limit_exceeded` or `egress_denied` row from a host.
  - No host witnesses the two new ports yet. Backpressure needs an advertised
    `production.backpressure.inflightCap`. Budget needs the `conformance-budget-tool-calls` fixture
    seeded.
  - Not ported: v1's `budget_model_denied` leg (needs a fixture that resolves a model unaided).
  - The rename rows G1–G3, G6 and G7 close on host cuts.
- [ ] **MyndHyve advertises `budget` at major 2 and enforces it only behind a v1 seam.** Reported
      by its session from source, not measured: `configurable.budget` is validated, stored and
      never read. The v2 port keys on the fixture, so MyndHyve records `inapplicable`. Its session
      is raising the advert with the maintainer.
- [ ] **RFC 0229** needs all four requirement ids `executed-pass` on a certified bundle from a
      production deployment. **RFC 0230** has its `Active` checklist open.
- [ ] **`mode: "eval"` refusal on the other two hosts.** `v2-eval-mode-unadvertised-refused`
      (2.45.3) measures it. The v2 reference host answered `capability_required` (fixed, examples
      #143). **Unverified:** openwop-app appears to accept `mode` and `evalSuiteRef` with no
      rejection. That was read from source, not run; its next cut on 2.45.3 will say.
- [ ] **CI passes while a suite self-check fails on every host.** 2.45.3's candidate failed
      `host-callback-declaration` and `runner-ledger` with no host at all (fixed in #1835), and
      #1825, #1826 and #1834 were all green. The server-free job runs a subset and the host job
      passes at ≥92%. Run every scenario that needs no host in the server-free job, at 100%.
- [ ] **The any-of floor row is emitted whatever profile is claimed** (RFC 0229 §E), as the prefix
      rows are. **Unverified:** on a major-1 host that does not claim `openwop-secrets` it should
      record `blocked` without denying any claimed profile. That was read from
      `certification-bundle-verify.ts`, not run.
- [ ] **Two maintainer decisions from the homing work.** `memoryScopeIsolation: "isolated"` is in
      v1 prose and no schema (recorded in `spec/v1/gaps.json`). `subWorkflow`'s child→parent link
      is observable only where `getRunAncestry` is served. Adding either to v2 needs an RFC.

## Pattern checks (no code owed; read new scenarios against these)

- **A transport failure is an unreadable observation, not a verdict.** A read that throws after
  the host dies must not become `executed-fail` (`323400a2`).
- **Two scenarios that drive a seam at the same operator URL share one effect identity.** A
  conformant host dedupes the second exercise to zero calls (`2ae74ee6`).
- **A blocked row on a conforming host is a release blocker**, unless the cut's posture
  explains it. 2.42.3–2.42.4 shipped an era-2 row blocked on every host; hotfix 2.42.5 (#1647).
- **Converting a partial pass to `blocked` is right only if a conforming host could have made
  the requirement observable.**
- **A scenario that imports a harness double declares `REQUIRES_HOST_CALLBACK`** or the opt-out.
  Run `host-callback-declaration` and `runner-ledger` with no host before opening the PR (#1835).

## Operating notes

- **Before a release that changes dispositions,** diff the changed files on openwop-app at major 1,
  base against head. Use its in-process harness: a fresh openwop-app worktree, `npm install` in
  `backend/typescript`, swap `node_modules/@openwop/openwop-conformance` for the working
  `conformance/`, then run `node node_modules/tsx/dist/cli.mjs conformance/run.ts --certify <dir>`
  with `OPENWOP_CONFORMANCE_ROOT` set. The v2 reference host alone missed a conversion to
  `blocked` that openwop-app caught (#1659).
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
