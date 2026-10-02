# TODO — open steward work

> Rewritten 2026-09-26 by `openwop-77` when that session spun down (HEAD `7f97b724`). The
> MCP/A2A remediation program (RFCs 0197–0216) is **closed**: every RFC it filed is `Accepted`,
> and 0199 was the last (#1650). Its phase record was deleted as it asked. It is in git history
> at `7f97b724:TODO.md`, and the 2026-09-19 gap-closure follow-ups (S1–S4) are there too.
>
> Updated 2026-09-27: §3 and §4 worked (details below), `INTEROP-MATRIX.md` rewritten, and the
> quickstarts moved to v2. Updated 2026-09-28 after the 2.43.1 release. Updated 2026-10-01 after
> the 2.45.2 release (state, §6 and §7), and again after 2.45.4 and 2.45.5.
>
> Tick a box only when the change is merged on `main`. Delete an item once it is closed.

## State (2026-10-01)

- **RFCs:** 221 `Accepted`. `Active`: **0121** (paused), **0222** (last box needs a real yanked v2
  version), **0228** (v1 host-service error codes), **0229** (production-safe secrets witness) and
  **0230** (inbound webhook ingest contract). **0231** (budget exhaustion facet) went `Accepted`
  on 2026-10-02 (tier-1, the v2 reference host). **0038** is `Draft` (Parked). **0225**, **0226** and
  **0227** went `Accepted` since the last update (#1791, #1821, #1831). Every waived-window
  `Accepted` RFC is **provisional** (RFC 0156 §B).
- **Suite:** **2.45.7 is published** (#1855, tag `v2.45.7` on `573fb413`; npm `latest` for both
  packages). Releases since 2.44.2: 2.44.3–2.44.9, 2.45.0 (#1815, CORS preflight headers), 2.45.1
  (#1819), 2.45.2 (#1822), 2.45.3 (#1835), 2.45.4 (#1840: the unclaimed any-of floor fix, the v2
  ports of `production-backpressure` and `budget-enforcement`, the host-free gate), 2.45.5 (the
  unclaimed prefix floor fix), 2.45.6 (RFC 0231: the `budget.onExhaustion` facet, its refusal rule
  and `v2-budget-exhaustion-facet`) and 2.45.7 (#1854: `v2-workspace-scope-from-identity` no longer
  fails a strict-mode host that does not advertise `workspace`). **A host that cut on 2.45.3–2.45.6
  in strict mode without `workspace` should re-cut on 2.45.7**, or opt out `family.workspace`. **A major-1 host that cut a v3 bundle on 2.45.3 without claiming
  `openwop-secrets`, or on any suite without claiming `openwop-interrupts`, should re-cut on
  2.45.5.** The v2 reference host has cut on 2.45.6; MyndHyve and openwop-app have not cut on
  2.45.3 or later. **The 2.45.8 cycle is open on `main`** (`v2-table-schema-enforcement`) and is not cut.
  Take a release lock (`/tmp/claude-501/openwop-release-<ver>.lock`) before cutting.
- **Normative homes:** all 73 core families have v2 homes (#1802–#1804). The kernel budget is
  37,324 / 37,800 words, with the generated error table outside it (RFC 0227).
- **SDKs:** **2.5.0** (npm, PyPI, `go/v2.5.0`) sends `OpenWOP-Client-Version` on every request.
  Re-vendoring to a newer corpus tag is a separate change.
- **Hosts** (the canonical files in `evidence/v2-host-bundles/`, all certified, 0 fail, 0 blocked):
  the v2 reference host on 2.45.6 (460 pass), MyndHyve on 2.45.2 (273 pass) and openwop-app on
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

- [ ] **RFC 0228's last open box: the rename rows** (state 2026-10-02).
  - **Certified `egress_denied` row: done.** The v2 reference host's certified 2.45.6 cut records
    all five `httpClient.ssrf-*` requirements `executed-pass`, and the acceptance box is ticked.
    MyndHyve's next cut would add a tier-2 witness (it advertises `safeFetch` since its #581).
  - **v2 ports (gap G4):** all five exist; `v2-table-schema-enforcement` (2.45.8, fixture
    `conformance-table-schema-probe`) is the last. It has no host witness: no host advertises
    `tableStorage` at major 2. Not ported: v1's `budget_model_denied` leg.
  - **Rename rows.** G2 is closed (reference host, certified 2.45.5). Still open, as the host
    sessions report from source:
    - G1 (MyndHyve): fixed for pack-facing callers and deployed (myndhyve#581); needs a
      certified cut. The major-2 boundary strips `details.retryAfter*`; not checked for the `503`.
    - G3 (openwop-app): fix up as openwop-app #4331, not merged. Maintainer decision
      2026-10-02: it closes on a certified cut that contains the fix, recorded as unit-witnessed
      with `v2-fs-sandbox-escape-refused` `inapplicable` (the host advertises neither `fs` nor
      `tableStorage` at major 2).
    - G6 (openwop-app): fixed and deployed (#4238); needs a certified cut.
    - G7 (MyndHyve): not fixed. `no_active_deployment` goes out as
      `myndhyve.no_active_deployment` at major 2; the denial envelope is untraced.
- [ ] **MyndHyve's next certified cut carries four changes the maintainer approved** (2026-10-02;
      reported by its session, in PRs, not deployed, no cut run):
  - the suite pin at 2.45.5 (merged);
  - `budget` and `agents.evalSuite` removed from discovery at both majors, with `mode: "eval"`
    answering `422 capability_not_provided`, so `v2-eval-mode-unadvertised-refused` executes there;
  - `secrets.runSecrets` with the `openwop-secrets-run-witness` fixture (RFC 0229's production
    witness). The sealed value is deleted before the terminal event and status are written;
    untested on the three cap-breach paths, and a terminal written outside the executor relies
    on a TTL;
  - then the cut, which would also witness `egress_denied` and RFC 0228 G1.
- [ ] **RFC 0229** needs all four requirement ids `executed-pass` on a certified bundle from a
      production deployment. **RFC 0230** needs openwop-app to advertise `inboundSigning` and pass the path in strict mode on a production cut; its other boxes are ticked.
- [ ] **Host evidence owed, as the host sessions report it (2026-10-02):**
  - RFC 0230 (openwop-app): blocked on an operator decision plus a pin bump. Measured on
    production by the flag's owner: `OPENWOP_TRIGGER_INBOUND_SIGNING` is unset, so the facet is
    not advertised; the suite pin is `^2.45.2`; and its last cut had ten timeout failures at
    major 1 that are still being traced.
  - RFC 0229: neither host can witness it yet. openwop-app does not advertise
    `secrets.runSecrets`; MyndHyve consumes `runSecrets` but advertises no facet and seeds no
    fixture. It needs a production deployment, so the reference host cannot stand in.
- **Decided 2026-10-01 (architect review, at the maintainer's request); no work owed:**
  - `memoryScopeIsolation: "isolated"` is not carried in v2. It never had a schema, and
    `openwop.gap.0189.17` is closed.
  - A `core.subWorkflow` child's parent stays observable through `getRunAncestry` only. v2 removed
    the snapshot fields on purpose (migration C4.18), and the only host advertising `subWorkflow`
    also serves ancestry. If a host ever advertises `subWorkflow` without ancestry, the fix is an
    RFC requiring the child's `run.started.causationId` to name the parent's event, as trigger
    deliveries already do. It is not a new field.
- [ ] **openwop-app's tool catalog is not sorted by `toolId`** (openwop-app #4339, filed 2026-10-02).
      The advisory row `tool-catalog-projection…sorted-by-toolid` flipped between two runs of one
      build in the 2.45.5 pre-release diff, then passed on four later runs. Read from its source:
      nothing sorts the list, so the order is registration order plus whatever workspace workflows
      expose a tool at the time of the read. That the flip comes from workspace state is inferred;
      no failing list was captured. It is a SHOULD (RFC 0204 §D.13), recorded and never failed.
      Closes when the host sorts and a cut records the row `executed-pass`.

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
