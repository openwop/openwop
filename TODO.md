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
- **Suite:** **2.45.9 is published** (tag `v2.45.9`; npm `latest` for both packages). Releases since 2.44.2: 2.44.3–2.44.9, 2.45.0 (#1815, CORS preflight headers), 2.45.1
  (#1819), 2.45.2 (#1822), 2.45.3 (#1835), 2.45.4 (#1840: the unclaimed any-of floor fix, the v2
  ports of `production-backpressure` and `budget-enforcement`, the host-free gate), 2.45.5 (the
  unclaimed prefix floor fix), 2.45.6 (RFC 0231: the `budget.onExhaustion` facet, its refusal rule
  and `v2-budget-exhaustion-facet`) and 2.45.7 (#1854: `v2-workspace-scope-from-identity` no longer
  fails a strict-mode host that does not advertise `workspace`) and 2.45.8 (RFC 0229 `Accepted`;
  `trigger-bridge-delivery` runs every witness path a host offers, #1861; `v2-table-schema-enforcement`, #1859) and 2.45.9 (#1863: `trigger-stream-cdc-sources` records
  `inapplicable`, not `blocked`, on a host without `stream`/`change`; **a major-1 host without them
  should cut on 2.45.9**, or the row denies its bundle). **A host that cut on 2.45.3–2.45.6
  in strict mode without `workspace` should re-cut on 2.45.7**, or opt out `family.workspace`. **A major-1 host that cut a v3 bundle on 2.45.3 without claiming
  `openwop-secrets`, or on any suite without claiming `openwop-interrupts`, should re-cut on
  2.45.5.** The v2 reference host has cut on 2.45.6 and MyndHyve on 2.45.5; openwop-app has not cut on
  2.45.3 or later. **2.45.10 is published** (RFC 0232 `Active`; the trigger dead-letter read).
  **2.45.11 is published** (the v2 trigger-bridge witnesses; the retired-twin `308` errata).
  **2.45.12 is published** (RFC 0233 `Active`: the connection-provider reads; RFC 0230's stale and
  secret-once legs; the retired-`/v1` path-space fix). **2.45.13 is published** (RFC 0230, 0232
  and 0233 `Accepted`). **2.45.14 is published** (RFC 0234: v1 end-of-support 2026-10-04; hosts MAY drop 1.x from that date). **2.45.15 is published** (witness wave 1; openwop-app fixed both defects it found in #4372). **2.45.16 is published** (witness waves 2 and 3: all 73 core families v2-witnessed; MyndHyve is fixing three host defects wave 2 found). Take a release lock
  (`/tmp/claude-501/openwop-release-<ver>.lock`) before cutting.
  - A PR that leaves the version alone must not re-stamp `CORPUS-STAMP.json` or the ledger.
- **Normative homes:** all 73 core families have v2 homes (#1802–#1804). The kernel budget is
  37,458 / 37,800 words, with the generated error table outside it (RFC 0227).
- **SDKs:** **2.5.0** (npm, PyPI, `go/v2.5.0`) sends `OpenWOP-Client-Version` on every request.
  Re-vendoring to a newer corpus tag is a separate change.
- **Hosts** (the canonical files in `evidence/v2-host-bundles/`, all certified, 0 fail, 0 blocked):
  the v2 reference host on 2.45.6 (460 pass), MyndHyve on 2.45.5 (294 pass) and openwop-app on
  2.44.5 (263 pass). `coordination` went `Stable` on MyndHyve's 2.45.2 cut (RFC 0220, #1828).
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
  - [ ] `packs/community.openwop-team.demo` in openwop-registry (checked 2026-10-03). Its
        `keys/pack.json.sig` is dead: `build-pack-tarball.mjs` strips it and writes the real
        signature. Its `keys/community.openwop-team.pub.pem` is not the key that signs 0.1.2
        (`registry/keys/openwop-team-1.pub`), and the README's verify recipe (canonical JSON
        over the manifest, that pem) fails on both the source and the published tarball. The pem
        and README ship inside the tarball, so fixing them changes its bytes: do it only with a
        0.1.3 publish. The `rust-misbehaving-abi` / `-memory` fixtures are not a defect: only
        the major-1 `wasm-pack-*` scenarios use them, and they declare `<2.0.0`.
- [x] `tiny-workflow` and `streaming-client` speak v2, and CI runs them against the v2 reference
      host (examples #100).

## 6 — Follow-ups from 2026-09-28

- [ ] **RFC 0219 gap G7:** `0219.no-floor-no-refusal` needs a certified host that advertises no
      `minClientVersion`. It is externally gated.

## 7 — Follow-ups from 2026-10-01

- [ ] **RFC 0228's last open box: the rename rows** (state 2026-10-02).
  - **Certified `egress_denied` row: done.** The v2 reference host's certified 2.45.6 cut records
    all five `httpClient.ssrf-*` requirements `executed-pass`, and the acceptance box is ticked.
    MyndHyve's certified 2.45.5 cut adds a tier-2 witness: all five rows `executed-pass`.
  - **v2 ports (gap G4):** all five exist; `v2-table-schema-enforcement` (2.45.8, fixture
    `conformance-table-schema-probe`) is the last. It has no host witness: no host advertises
    `tableStorage` at major 2. Not ported: v1's `budget_model_denied` leg.
  - **Rename rows.** G2 is closed (reference host, certified 2.45.5). Still open, as the host
    sessions report from source:
    - G1 (MyndHyve): the `safeFetch` codes are renamed and certified (2.45.5 cut). The `503`
      half is fixed in build cf84c7f64 (unit-witnessed; no `inflightCap` advertised). The
      maintainer ruled (2026-10-03) it closes as unit-witnessed once a certified cut containing
      it is in `evidence/`: MyndHyve's 2.45.10 cut (build e2fe80f33, myndhyve#594) qualifies when
      checked in.
    - G3 (openwop-app): fix up as openwop-app #4331, not merged. Maintainer decision
      2026-10-02: it closes on a certified cut that contains the fix, recorded as unit-witnessed
      with `v2-fs-sandbox-escape-refused` `inapplicable` (the host advertises neither `fs` nor
      `tableStorage` at major 2).
    - G6 (openwop-app): fixed and deployed (#4238); needs a certified cut.
    - G7 (MyndHyve): partly fixed (cf84c7f64); the maintainer accepted the partial fix and the
      run-creation `validation_error` leg is externally gated on a MyndHyve change.
- [x] **MyndHyve follow-ups done (2026-10-02, its session):** `openwop-smoke-byok-roundtrip` is
      withdrawn from production (build 68718d731, myndhyve#591; its next cut records
      `v2-secret-canary-absent` `inapplicable`), and the sealed-row delete is tested before the
      terminal on all three cap-breach paths. Still open there: RFC 0228 G1's `503` half and G7.
- [x] **MyndHyve withdrew `triggerBridge.ingestion`** at both majors (build cf84c7f64, myndhyve#592,
      2026-10-03); `POST /trigger-subscriptions` answers `404`. RFC 0099's `Accepted` already discloses
      that its MyndHyve legs ran through the seam (#1868).
- [x] **RFC 0230, 0232 and 0233 `Accepted`** (2026-10-04, provisional; the RFC 0156 §B reviews are
      owed). Evidence: openwop-app's certified, seam-free, strict major-2 production cut on 2.45.12
      (build `983976bbc`, `evidence/v2-host-bundles/openwop-workflow-engine.json`). Still open by
      design: RFC 0230 G3 and RFC 0232 G2, both waiting on a trigger-subscription pause surface (no RFC
      yet); RFC 0233 G4 (a dry-run validate endpoint, deferred).
- [ ] **Witness waves (v1 end-of-support makes them urgent).** Wave 1 (2.45.15) ports six families. Next:
      wave 2 (MyndHyve-only families: artifactTypes, selfHostedRunner, portability, subWorkflow,
      providerUsage, scheduling, aiEnvelope, credentials, authorization, deadLetter); wave 3 (no host
      serves them at v2: a per-family decision). Found in wave 1, owed:
      - ~25 seam-only MUST legs have no v2 observation path (prompt compose/resolve, voice/speech,
        `ai/call*`, `envelope/accept`, envelope runtime, model-capability gate, node-catalog).
        `conformance.md` §Witness class requires a path (RFC, like 0233) or a demotion per family.
      - v2 `PromptTemplate.templateId` (`ids.schema.json`, allows A–Z, `~`, `:`) disagrees with the
        `/prompts/{templateId}` path pattern and string `PromptRef` (lowercase only).
      - `capabilities.schema.json` `prompts.endpointsSupported` description allows "the family
        omitted and endpointsSupported: true", impossible at v2.
      - v2 `aiProviders.authModes` is a bare `string[]`; v1 had an enum. Restoring it needs an RFC.
        openwop-app advertises `api-key` (clients ignore it); told to use `apiKey`.
      - `run-secrets-witness` still addresses v2 runs with `%2F`; switch to the `~` projection once
        a host cut can re-prove RFC 0229's rows.
      - Wave 2 (2.45.16) found: capabilities.md §2 "omit a facet you don't offer" vs `false`-valued
        boolean facets (MyndHyve `scheduling.calendar: false`); a generic leg is a candidate, after
        sizing which hosts and families it touches. `deadLetter` retry exhaustion needs a fixture and a
        ruling on what "exhausts" means. `{HostBase}` is undefined in v2 prose.
- [ ] **Host evidence owed, as the host sessions report it (2026-10-02):**
  - RFC 0230 (openwop-app, session 4d): the seam-free run on 2.45.9 is done (legs 1–3 pass,
    leg 4 fails, `blocked` 0). The pin to 2.45.9 is committed. The production flag and the
    certified cut are held for RFC 0232 (above). Production is `6de66ea16` on a dedicated-core
    database (`db-custom-1-3840`). The host reports the earlier cut's major-1 timeout reds had two
    causes, both addressed: a full ownership-table scan (openwop-app #4333) and `db-f1-micro`
    throttling with two live instances.
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

## 8 — Wave 3 follow-ups (architect review, 2026-10-04)

- [ ] **Schema descriptions still say `.supported`.** That is not a v2 field (`capabilities.md` §2:
      presence is the claim). It appears in about 20 descriptions across `run-event-payloads`,
      `conversation-turn`, `conversation-event` and `channel-presence-payload`. Needs one mechanical
      sweep. Some MUSTs also live only in descriptions (`channel-presence-payload`: not persisted,
      delivered to members only); move them into `conversation.md` or drop them.
- [ ] **`dataResidency.regions` has no `minItems`.** `regions: []` validates, so the "accept an
      advertised region" rule can never apply. Adding `minItems: 1` narrows the schema and needs an
      RFC.
- [ ] **RFCs owed before these legs can bind:** a plugin-origin seat so the four `uiPlugins`
      invariants keep a witness after v1 (they are seam-gated and v2 mounts no plugin seam); a
      roster input seat and refusal codes for `multiPartyConversation`; a
      `nondeterminismPolicy.sources[]` seat; a purpose-label carrier the suite can receive; and
      dropping the required `declared` / `advertised` booleans, which bring back `supported:false`
      under another name.
- [ ] **Fixture-gated wave-3 legs not yet written.** `multiPartyConversation` roster legs need a
      `conformance-multi-party-council` fixture, and that needs the roster input seat above first.
      `nodePackRuntimes` ABI-rejection and memory-cap-breach legs need an operator-installed WASM
      fixture pack (`conformance-wasm-pack-memory-cap-breach`). Until then both families are
      witnessed by their advertisement legs only.
- [ ] **Schema-only legs in `*-static` scenarios belong in `src/coherence/`** (`conformance.md` §Two
      products: a check that reads only the corpus MUST NOT appear in a host bundle). Sweep the
      wave-1/2 `v2-*-static` scenarios: keep the legs that read host output, move the rest.
- [ ] **`otel-emission-grpc` is attributed to `nodePackRuntimes`** in the coverage report. It is
      about OTel export.

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
