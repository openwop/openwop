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
  `Accepted` RFC has no RFC 0156 §B review; §B is deferred by steward exemption (2026-10-17).
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
  and 0233 `Accepted`). **2.45.14 is published** (RFC 0234: v1 end-of-support 2026-10-04; hosts MAY drop 1.x from that date). **2.45.15 is published** (witness wave 1; openwop-app fixed both defects it found in #4372). **2.45.16 is published** (witness waves 2 and 3: all 73 core families v2-witnessed). **2.45.17 is published** (discovery ETag witness; both 304 witnesses revalidate under `2.0`, `2` and a wildcard Accept; prompt ETag advisory). openwop-app's public origin fails both 304 witnesses until its hosting front door forwards conditionals, so it holds its pin. Take a release lock
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

## 0 — MyndHyve now runs on openwop-app white-label (2026-10-29)

On 2026-10-29 the maintainer reported that MyndHyve runs on the openwop-app white-label (`myndhyve.ai`,
`myndhyve 0.8.0`, the openwop-app codebase) and retired its legacy `workflow-runtime` (`api.myndhyve.ai`).
Every MyndHyve bundle in `evidence/v2-host-bundles/` was cut against the legacy origin.

Done in this change:
- `evidence/host-tiers.json`:
  - the legacy row is `retired: 2026-10-29`, and its bundles stay tier-2 evidence;
  - `myndhyve.ai` and `api.openwop.dev` are tier 1 under openwop-app. 27 openwop-app bundles had read "tier unknown" because only `app.openwop.dev` was listed.
- `scripts/check-ext-status-coherence.mjs` refuses a bundle dated after its origin's retirement.
- `scripts/check-accepted-predicate.mjs` checks a claimed tier-2/3 against the cited bundle's origin. From RFC 0253 every cited build must resolve to a checked-in bundle.
- GOVERNANCE.md, KNOWN-LIMITS.md and INTEROP-MATRIX.md now say that no tier-2 host serves.
- Register triage of the 29 open rows that name MyndHyve or tier-2:
  - **closed as moot** (they measured the legacy runtime): 0176 G2, 0210 G5, 0221 G1, 0231 G6, 0234 G2.
  - **re-gated:** 0177 G3 (only the mirror ingest remains), 0220 G1 (`a2uiSurface` has no graduation path until a tier-2 or tier-3 host serves), and 0210 G4 (openwop-app is the only harness option left).
  - **unchanged:** the rest name MyndHyve only as an example or ask for "a second host" generically (0071 G9/G10/R8, 0112/0113/0114/0115 G4, 0120 G5, 0124 G6, 0129 G4/R5, 0165 G6/G7, 0192 G1, 0220 G2, 0236 G5, 0128 R5, 0147 R20, 0177 R2, 0224 R1, 0249 R1). Each still needs a tier-2 or tier-3 host, and none serves.

Still owed:
- [x] **The `Stable` tense (RFC 0220 erratum, 2026-10-29).** `spec/v2/ext/README.md` says a tier-2 host "serves" a `Stable` family, while the check reads historical bundles. All 12 `Stable` families rest on the retired legacy runtime. Rule it historical ("served it at a certified cut") and add a `Last witnessed:` line per family.
- [x] **RFC 0082 v2 deployment test (path b, decided 2026-10-29).** Done 2026-10-30: openwop-app's certified 2.46.35 cut `72e610b3d` passes 14 `0082.*` legs and both eval-gate legs; RFC 0254 `Accepted`. The two subset-only refusal legs wait on a host advertising a subset (RFC 0254 G5).
- [ ] **RFC 0249 G2 (installed-pack read-back):** drafted as [RFC 0253](./RFCS/0253-installed-pack-readback.md) (`Draft`, 2026-10-29); UQ 1–6 decided 2026-10-31 (/architect review, maintainer-approved). Its G3 owes a word-neutral `packs.md` pointer to the proposal install path when the core budget allows. G4 (automation) starts once RFC 0253 is `Active`.

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

## 2 — RFC 0156 §B retrospective reviews · **deferred by steward exemption (2026-10-17)**

- [ ] §B reviews are deferred while the protocol has no user outside the steward's organizations
      (`GOVERNANCE.md` §"Sole-steward operation"). An `Accepted` RFC no longer waits on or owes one.
      The exemption ends with the first outside user or non-steward maintainer; then every in-scope
      register row is owed again. No row is `ratified` on the exemption's account. Public call: #1609.
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
- [x] **A row whose id two files record has an unstable `assertions` and `scenario`.** Fixed in 2.46.11. Found 2026-10-14 by
      openwop-app (69c → 70c, −4 assertions): `prompts.resolution-precedes-composition` is recorded by
      `v2-prompt-end-to-end-events` and `v2-prompt-all-four-kinds-events`. `readLedgerFile` keeps the least
      certifiable result, so a fail is never masked, but on equal results the last line wins: the row names
      whichever worker wrote last. Fix: on equal results across files, sum the assertions and pick a stable scenario.

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
- [x] v2 registry operations: **RFC 0222 `Accepted`** 2026-10-18 (#1702, #1710; registry #77, #79 gate, #95/#96 probe yank).

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

- [x] **MyndHyve follow-ups done (2026-10-02, its session):** `openwop-smoke-byok-roundtrip` is
      withdrawn from production (build 68718d731, myndhyve#591; its next cut records
      `v2-secret-canary-absent` `inapplicable`), and the sealed-row delete is tested before the
      terminal on all three cap-breach paths. RFC 0228 G1 and G7 are closed (2026-10-16, 2026-10-17).
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

- [x] **Schema descriptions still say `.supported`.** Swept in 2.45.18: 38 descriptions in 15
      schemas now say "advertises `X`".
- [x] **MUSTs that live only in schema descriptions.** /architect ruling 2026-10-05: `channelPresence`'s
      advertise ⇒ emit and no-delivery-to-a-non-member rules are restated in `conversation.md`,
      witnessed by `v2-channel-presence-delivery` through the §13 seam (ported to `api/seams-v2.yaml`
      with an `observer` field), and invariant `channel-presence-member-only-delivery` is added.
- [x] **RFC owed: a v2 home for runless vendor host events.** → RFC 0236 (Active 2026-10-05). openwop-app (ADR 0812) delivers runless host
      events to major-2 webhook subscriptions with a `hostext:` pseudo-`runId`. That fails
      `webhook-delivery.schema.json`: v2 webhooks carry run events only (`webhooks.md` §Delivery), and
      `hostEvents` admits only the two heartbeat messages. Ruled 2026-10-05: no major-2 webhook delivery,
      no pseudo-ids. Likely one RFC with the ephemeral class below (events with no log position).
- [x] **RFC owed: an ephemeral delivery class in `events.md`.** → RFC 0236 (Active 2026-10-05). RFC 0110 says `channel.presence` MUST
      NOT be persisted and is replay-invisible. Yet `events.md` §1 makes a run its log, and the
      envelope requires `sequence`, a log position. Restating the rule would contradict core;
      dropping it lets a fork replay stale presence. Options: a non-`RunEvent` frame with no
      `sequence`, excluded from resumption, poll, snapshot, fork and fan-out (annotations and typing
      want the same class), or a channel-scoped stream. `conversation.md` names it open. Owner: the user.
- [x] **No leg witnesses identity.md §5 "MUST NOT mint a tenant-bound id containing `~`".** Leg `0184.mint-no-tilde` (2.45.19).
      openwop-app minted `user~3A<hash>/<id>` for personal/org tenants (app ADR 0814). Witness only
      ids the run itself mints (a created run's bound `runId`), never every body id, because ids
      already minted MUST still resolve. It bites only when the conformance credential sits in a
      non-clean tenant: `inapplicable` on a clean one. No RFC needed.
- [x] **Erratum: identity.md §5 table row `tenantId, workspaceId` is stale.** Fixed with `typeId`'s missing `@<semver>` pin; `check-id-kinds-bound` now compares the table. `ids.schema.json`
      widened `tenantId` to `^(anon:)?[A-Za-z0-9._~-]{1,128}$` (RFC 0184 §A.3); `workspaceId`
      has no `anon:` prefix. Split the row to match the schema (found by openwop-app, ADR 0814).
- [x] **RFC 0235** `Accepted` (provisional) 2026-10-05 on the v2 reference host's certified 2.45.18
      cut (497/0/0, build `e5f27708`). Owed: the RFC 0156 §B review. MyndHyve implements RFC 9110 and
      was invited to cut on 2.45.18; openwop-app's public origin still has the CDN-edge `304` issue.
- [x] **RFC 0236** `Accepted` (provisional) 2026-10-05 on the v2 reference host's certified 2.45.21 cut (505/0/0, build `9543718c`). Owed: the RFC 0156 §B review; openwop-app ADR 0812 is the tier-2 follow-on.
- [ ] **RFC 0081 major-2 residue (correction note 2026-10-24 in the RFC).** The sample-seam witness is now covered by
      `mode: "eval"` runs (scripted conformance agent) on MyndHyve `c8d511d84` and openwop-app `f17ee3753` (RFC 0244 legs). Still owed: (1) a certified host cut
      recording `0081.eval-envelope` and `0081.summary-served` (legs land in suite 2.46.20); (2) §E —
      ruled 2026-10-24: owned by RFC 0082 (see the RFC 0082 item).
- [x] **RFC 0244** `Accepted` (provisional) 2026-10-14 on MyndHyve's certified 2.46.9 cut (tier-2, build
      `65785814`, `myndhyve-2.46.9.json`). Owed: the RFC 0156 §B review and the suite residue below. openwop-app advertises it since 2026-10-15
      (2.46.9 cut `17090b1c8`: wire-shape, content-free, fixtures-valid pass; the seam-driven legs `inapplicable`).
- [x] **RFC 0082 eval-gated promotion: v2 leg shipped; witnessed 2026-10-30** (openwop-app 2.46.35 cut `72e610b3d`: `0082.eval-gate-unmet-refused` and `-unchanged` `executed-pass`) (ruling 2026-10-24, from RFC 0081 §E). Suite 2.46.29
      adds `v2-deployment-eval-gate`: run `conformance-eval-gate-failing` (summary `passed: false`), then `transitionAgentDeployment`
      promote with that `evalRunId`; expect `422 eval_gate_unmet` and the record unchanged (`0082.eval-gate-unmet-refused`,
      `-unchanged`). Gated on `agents.deployment`, `agents.evalSuite` and the fixture, whose listing declares that the promote of the
      scripted agent carries `requiredEval` and a promotable record exists. Owed: a host lists it and a certified cut records both legs.
      **Reevaluate (2026-10-29, §0):** the 2026-10-24 ruling assumed MyndHyve would run this, because it advertised
      `agents.deployment`. That is now true only of the legacy `api.myndhyve.ai`. Neither openwop-app nor the
      white-label `myndhyve.ai` advertises `agents.deployment`, and openwop-app has no deployment code. On the 002e1ed15
      cut, the scenario and both legs record `inapplicable`. RFC 0082 itself stays `Accepted` (on its v1 tier-2
      evidence); only this v2 leg is owed. **Decided 2026-10-29: path (b).** openwop-app builds `agents.deployment`, which the
      white-label inherits, and the suite ports `agent-deployment-lifecycle` / `-shape` (major-1 only today) to v2.
      The legacy runtime is retired, so a legacy cut is no longer possible.
- [x] **RFC 0252** `Accepted` 2026-10-27. Tier-1: openwop-app's certified 2.46.32 cut `2c8bc27d6` (ADR 0984)
      advertises `agents.evalSuite.recordedFixtures` and passes all six `0252.*` legs. (G3) openwop-sdks #63, released in SDK
      2.7.0. The live-lane record shipped 2026-10-27 (openwop-app #5304, ADR 0984 D7, build `dde96ce72`). The cut's two
      `0168.advertised-fixtures-exist` fails are a suite defect fixed in 2.46.33; a 2.46.33 re-cut follows the pin bump.
- [x] **RFC 0251** `Accepted` 2026-10-26. Tier-1: openwop-app's certified 2.46.28 cut 230c `24b6a05ff` (ADR 0983)
      advertises `agents.evalSuite.baselineSelection` and passes the five `0251.*` legs and both `0244.regression-*` legs.
      (G3) openwop-sdks #62 adds both properties to the three 2.x SDKs; unreleased, next SDK tag 2.7.0.
- [ ] **RFC 0244 suite residue.** (G2) CLOSED 2026-10-26: the counter tool and its two fixtures (2.46.25) pass on openwop-app's
      certified cut 226c (`fc9f666ed`, ADR 0977): `0244.live-miss-counted`, `first-unconsumed`, `miss-no-live-call`. (G3) CLOSED 2026-10-27: `0244.trial-memory-isolated`
      passes on openwop-app's certified cut `2c8bc27d6` (ADR 0989). (G5) a portable "fixtures = run X" reference: RFC 0252 `Accepted` 2026-10-27 (see the RFC 0252 item). §C `toolCallCount` has a leg from 2.46.25
      (`0244.efficiency-tool-calls`); 2.46.26 adds `0244.efficiency-model-usage` (§C model and token counts) and
      `0244.cost-every-trial` (§B); 2.46.27 adds `0244.efficiency-never-gated` (§C) and `0244.trial-memory-isolated`
      (§B, G3, through the reserved memory tool `conformance.eval:memory`). On openwop-app's cut 230c
      (`24b6a05ff`) the never-gated leg and the two §F legs (through RFC 0251's `baselineRunId`) pass; model-usage and
      cost read inapplicable (its scripted agent calls no model). On cut `2c8bc27d6` (2.46.32) `0244.trial-memory-isolated`
      passes too, so G3 has its host witness.
- [x] **RFC 0250** `Accepted` 2026-10-25. Tier-1: openwop-app's certified 2.46.23 cut 217c `f94471e98` advertises
      `hostEvents.replay {minRetentionSeconds: 86400}` and passes all six `0250.*` legs (app ADR 0973, EVENT-01). Still owed:
      openwop-sdks opt-in and a non-retrying resync (G5, openwop/openwop-sdks#60).
- [x] **RFC 0249** `Accepted` 2026-10-24, with **RFC 0096** `Accepted` on the same cut. Tier-1: openwop-app's certified 2.46.21
      cut 209c `34bfefddc` passes all nine `0249.*` legs (app ADR 0970/0972). Still owed: phase 2 read-backs for chain and agent
      packs (G2), the replay-fork rule (G3), and `automation` (G4). MyndHyve advertises `agents.proposals` without the
      operations (R1); its legs record `inapplicable`.
      **Audit 2026-10-29: G2 and G4 are spec gaps, and no host needs them yet.**
      - G2: v2 has no GET that serves an installed pack. `getAgent` returns an `AgentInventoryEntry` and `getWorkflow`
        returns one workflow; no pack read is in `path-manifest.json`.
      - G4 is deeper. The `automation` artifact is "an RFC 0052 job spec", but no job-spec schema exists at either major.
        `TriggerSubscription` (`source: schedule`) holds state only, has no read operation, and carries no
        cron or workflow binding. openwop-app does have a host-namespaced `/host/openwop-app/scheduler/jobs`.
      - No host proposes these kinds through the v2 operations: openwop-app proposes `prompt-template` only, and the
        white-label `myndhyve.ai` does not advertise proposals. Leave both as disclosed gaps until a host does
        (`readback` already discloses them). That host's need triggers the follow-up RFC.
- [x] **RFC 0248** `Accepted` 2026-10-23 (`ctx.callAI` attempt accounting + per-call retry policy, for the Book AI pack).
      Tier-1: openwop-app's certified 2.46.19 cut `f17ee3753` advertises `aiProviders.callAccounting` and passes all eight
      `0248.*` legs (fixture opt-in app ADR 0967). Host tensions stay with the host (ADR 0966): a `usage: false` attempt
      emits no `provider.usage`; a replay fork re-dispatches the mock instead of reusing recorded facts.
- [x] **RFC 0245** `Accepted` 2026-10-19 (eval fixtures replay a recorded tool error as an error; AEV-6 from openwop-app).
      Tier-1: openwop-app's certified 2.46.18 cut `3566445be` advertises `fixtureErrors` and passes
      `0245.fixture-error-replayed` (2.46.18 erratum: a success return needs no `outcome`). Register rows stay here:
      (G1) the agent-side half is seam-gated with RFC 0244 G2; (G2) whether to register a tool-failure error code;
      (G3) the non-MCP agent shape.
- [x] **RFC 0246** `Accepted` (provisional) 2026-10-16, **safety-fix**, 90-day window waived by STEWARD OVERRIDE. MyndHyve
      deployed the gate (`c8d511d84`) before advisory `GHSA-ffx7-pm5h-v6pq` was published; its certified 2.46.13 cut passes
      `0246.mean-gated` / `0246.suite-gated`. Owed: the RFC 0156 §B review; openwop-app's eval-fixture opt-in (second witness,
      pending its session's approval).
- [x] **RFC 0247** `Accepted` (provisional) 2026-10-16 (bounded stream lifetime). Host half: openwop-app 2.46.12 cut `aee0febbc`
      advertises `maxStreamAgeSec: 300`, 12/12 resume rows pass; SDK half: openwop-sdks `v2.6.0`. Owed: the RFC 0156 §B review.
      Register rows stay transferred here: (G1) no suite leg observes a bounded close (needs a long-hold live run); (G2) a
      hop-specific bound is not discoverable.
- [ ] **Next major: `dataResidency.regions` `minItems: 1`.** /architect ruling 2026-10-05: narrowing is a major
      (COMPATIBILITY.md §2.4), and not a safety fix. Within v2 an empty list is a claim: the host honours
      residency nowhere and MUST refuse every constraint. Since 2.45.22 the reject leg binds there (it
      used to skip). At the next major, also decide whether `capabilities.md` §2 bars advertising a family
      with no region.
- [x] **RFC 0237** `Accepted` (provisional) 2026-10-08 on the v2 reference host's certified 2.45.25 cut
      (517/0/0, build `a8e6db64`; sources `clock`, `random`, `id`). Owed: the RFC 0156 §B review; G3 (drop
      the `declared` boolean) at 3.0.
- [ ] **Three v2 discovery gaps (found by openwop-app #4676, ADR 0858, 2026-10-10).** Suite 2.46.3 witnesses
      (1) and (2) from discovery (`v2-multi-agent-advertisement`): level >= 3 needs `crossHostCausation` with a
      `hostId`, level >= 4 needs `replayDeterminism` with `refusalDivergenceEmission: true`, and the escalation kind
      is `clarification` or `approval`. The descriptions were corrected (corrections log, 2026-10-12). MyndHyve
      advertises `x-host-myndhyve-low-confidence` and records that row `executed-fail` until it changes. Still owed:
      (3) the fan-out seat: RFC 0243 `Accepted` (provisional) 2026-10-13. openwop-app advertises `agents.fanOut`
      and its certified 2.46.4 cut (`8d2adcbe8`) records `0243.unadmitted-fan-out-refused` `executed-pass`.
      Owed: the RFC 0156 §B review (G2 closed 2026-10-14, below).
- [x] **RFC 0243 G2: `maxFanOut` waves and the `perItemInput` gate.** Closed 2026-10-14: openwop-app's certified
      2.46.6 cut (`44960bca5`) records `0243.max-fan-out-waves`, `0243.per-item-input-gated` and
      `agents.dispatch-per-item-length-mismatch` `executed-pass` (suite 2.46.7 carries the packed `gaps.json`).
- [ ] **Next major: the multiAgent and auth conditionals into the schema.** `executionModel.version >= 3 ⇒
      crossHostCausation` (with `hostId` required), `>= 4 ⇒ replayDeterminism`, drop the `x-host-` member of
      `confidenceEscalationInterruptKind`, and `saml` + `scim` lanes ⇒ `subjectLinkKey`. Each is a conditional
      `required` or a narrowed pattern (COMPATIBILITY.md §2.4); the suite carries them in 2.x.
- [ ] **`auth.subjectLinkKey` with one lane (found by openwop-app, ADR 0812, 2026-10-10).** Suite 2.46.3 witnesses
      the existing half (`v2-auth-subject-link-key`: both lanes ⇒ the key; `identity.md` §3 now says MUST). The
      converse is RFC 0243 §B (`0243.subject-link-key-needs-both-lanes`), witnessed by the reference host's 2.46.4 cut.
      Twenty committed openwop-app bundles advertise `opaque-idp` without `saml`; they are reported, not re-judged.
      `negotiation.decided` is RFC 0242, below.
- [x] **RFC 0242** `Accepted` (provisional) 2026-10-11 on the v2 reference host's certified public cut on 2.46.0
      (build `d16cac40`, all seven `0242.*` ids pass). Owed: the RFC 0156 §B review; G2 (no host's `versions[]`
      spans floor to preferred) stays externally gated; openwop-app emits `requested` when it next touches negotiation.
      Done: the reference's certified 2.46.1 cut (533/0/0, build `f905c3b0`) is now its canonical bundle.
- [x] **RFC 0238** `Accepted` (provisional) 2026-10-07 on openwop-app's certified 2.45.23 cut at
      `api.openwop.dev` (379/0/0, build `e33f3a19c`). Owed: the RFC 0156 §B review; R2 (an embedding
      the suite cannot see) is reviewed with each host's certification; G2 stays external.
- [x] **Move the always-on schema legs of `frontend-plugin-packs.test.ts` to `src/coherence/`**
      (RFC 0238 G3; `conformance.md` §Two products). Done in 2.45.25: `src/coherence/frontend-plugin-schemas.test.ts`.
- [x] **RFC 0239** `Accepted` (provisional) 2026-10-07 on the v2 reference host's certified 2.45.23
      cut (512/0/0, build `1492562f`). Owed: the RFC 0156 §B review; G2 (a host whose
      `maxParticipants` is 64 or more cannot be shown an oversized roster) stays external.
- [x] **RFC 0241** `Accepted` (provisional) 2026-10-08 on the v2 reference host's certified
      seams-off public cut on 2.45.28 (420/0/0, build `bb7c5930`): all six RFC 0236 rows and
      `0241.trigger.bound-by-listing` caused through `POST /host/events/test`. Owed: the RFC 0156 §B review.
- [x] **openwop-app serves RFC 0241's trigger** (openwop-app #4623): its certified production cut
      `4683d9f89` (2.45.28, 423/0/0) passes all six `0236.*` rows and `0241.trigger.bound-by-listing`,
      RFC 0236's tier-2 witness.
- [x] **The seams profile is claimed by a host that mounts no seams** (openwop-app `4683d9f89`):
      fixed in 2.45.30. The two seam-free floor legs moved to their own files, and
      `coherence/seams-floor-legs-gated` keeps every floor leg seam-driven.
      Witnessed in production: openwop-app's 2.45.30 cut `7643ddb8e` no longer marks the profile certified.
- [ ] **RFCs owed before these legs can bind:** (the plugin-origin seat is RFC 0238; the roster
      seat is RFC 0239); a
      `nondeterminismPolicy.sources[]` seat (RFC 0237); a purpose-label carrier the suite can receive
      (DONE without an RFC in 2.45.29: the fixture `conformance-purpose-relay` takes a labelled inbound
      A2A message and relays it to the suite's peer, so `v2-purpose-propagation-onward` needs no seam;
      the number 0240 was never filed. Witnessed: the v2 reference host's certified 2.45.29 cut
      (524/0/0, build `bb1a42d6`) records both onward rows `executed-pass` through the relay, the
      family's first certified witness; openwop-examples #166, #169); and
      dropping the required `declared` / `advertised` booleans, which bring back `supported:false`
      under another name.
- [x] **Fixture-gated wave-3 legs not yet written.** (`multiPartyConversation`'s roster legs ship
      with RFC 0239.) The WASM fixture packs now exist (`conformance/fixtures/wasm-packs/`), and
      `v2-wasm-memory-cap` witnesses the memory ceiling. The ABI-rejection leg needed no RFC:
      `v2-wasm-abi-reject` reads the refusal from what it prevents — the pack in the existing
      `nodePackRuntimes.wasm.loadedPacks`, and the node of `conformance-wasm-pack-abi-mismatch`
      completing — so both observations are normative (discovery, run creation and the event poll).
- [x] **Schema-only legs in `*-static` scenarios belong in `src/coherence/`** (`conformance.md` §Two
      products: a check that reads only the corpus MUST NOT appear in a host bundle). Sweep the
      wave-1/2 `v2-*-static` scenarios: keep the legs that read host output, move the rest.
- [x] **Wrong cause in two 2.45.17 scenario comments.** `v2-discovery-etag` and
      `v2-run-snapshot-etag` say openwop-app's origin answered `304` to `2.0` and `200` to bare `2`.
      The cause was a CDN edge (hit-for-pass on a `no-store` response: the first conditional to reach
      a node that had not seen the object gets `200`), not the spelling. They are packed, so fix them
      when the 2.45.18 cycle opens. The legs themselves are right.
- [x] **`otel-emission-grpc` is attributed to `nodePackRuntimes`** in the coverage report. It is
      about OTel export.
- [x] **The seams profile derived from the whole `conformance` block** (found by openwop-app-67,
      2026-10-12). Fixed in 2.46.2: the predicate is `conformance.seamsProfile`, and
      `check-declaration` rule 13 resolves every predicate entry. Four signed openwop-app bundles
      (`openwop-workflow-engine-2.35.1`, `-2.43.0`, `-2.44.0`, `-2.45.28-4683d9f89`) certify seams-v2
      with only `certificationBundleUrl`; they stay as evidence, and `--verify` on 2.46.2 refuses only
      that certification. openwop-app's production host has never mounted the seams.

## 9 — RFC 0255 / 0256 implementation (2026-10-30)

Register rows transferred here. Each closes in the PR that does the work.

- **0256 G2–G5, R1–R4 (openwop-app, with spec follow-up).** Enumerate the remaining model paths and pack parsers; `replayPolicy` from tool descriptors; durable mid-loop events; primary provider docs; shadow counts before enforcing.

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
