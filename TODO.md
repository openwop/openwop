# TODO — open steward work

> Rewritten 2026-09-26 by `openwop-77` when that session spun down (HEAD `7f97b724`). The
> MCP/A2A remediation program (RFCs 0197–0216) is **closed**: every RFC it filed is `Accepted`,
> and 0199 was the last (#1650). Its phase record was deleted as it asked. It is in git history
> at `7f97b724:TODO.md`, and the 2026-09-19 gap-closure follow-ups (S1–S4) are there too.
>
> Updated 2026-09-27: §3 and §4 worked (details below), `INTEROP-MATRIX.md` rewritten, and the
> quickstarts moved to v2.
>
> Tick a box only when the change is merged on `main`. Delete an item once it is closed.

## State (2026-09-27)

- **RFCs:** every RFC is `Accepted` except **0121** and **0218** (`Active`) and **0038** (`Draft`,
  Parked). Every Accepted RFC whose window was waived is **provisional**: its RFC 0156 §B review
  is owed, and `docs/SECTION-B-REVIEW-PACKET.md` lists them.
- **Suite:** 2.42.6 is published. The **2.42.7 cycle is open and unreleased** (#1652). It holds:
  - the SSE cursor floor promotion;
  - the surface-monotone gate fix;
  - RFC 0218's vectors and signature leg;
  - the softskip ratchet: #1655–#1660, baseline 172 → 1, the gate parser fixed in #1657;
  - whatever audit-budget lands.

  Cut it with the release recipe once audit-budget's PRs are in.
- **Site:** openwop.dev is pinned at `bad18fceb915` (openwop-site #125) and deployed.

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
  - [ ] RFC 0218 `Accepted` needs a committed host bundle carrying
        `openwop.requirement.0218.checkpoint-signature-over-root`. It was witnessed live on the
        SQLite reference host, and a host that signs the object instead of the root fails it.
- [ ] **Postgres extra audit fields** (openwop-examples #96) and **per-attempt budget seam**:
      in progress with the `audit-budget` agent on branch `fix/audit-extra-fields-budget-seam`.
- [ ] **Rotation overlap seam.** `v2-webhook-secret-rotation`'s post-overlap leg cannot observe
      the old secret stopping when the advertised `overlapSeconds` exceeds the suite's wait cap.
      It is annotated, not `blocked`, by ruling. A seam that shortens the overlap under test would
      make it witnessable.

## 4 — Smaller residuals

- [x] `v2-sse-last-event-id-cursor` is on the core-standard floor (#1652).
- [x] The generator no-op `if/then` is gone (#1652). Found along the way:
      `check-v2-surface-monotone` was blind to a tightened object carrying an `if`, which covered
      every capability family. Fixed and sabotage-proved, and the baseline gained 540 tuples.
- [ ] Watch A2A PR #2068 (SubscribeToTask POST→GET prose), still open on 2026-09-27. If it
      merges, revisit the interop-map D1 exception.

## 5 — Found while rewriting the quickstarts for v2 (#1654)

Spec problems:
- [ ] **When is a request v2?** `versioning.md` §1.2 says an unversioned path is the v2 surface.
      §1.3 says a header-less request gets `preferredVersion`'s major, which is 1.x through the
      overlap. The v2 reference host follows §1.2 for `/runs` and §1.3 only for `/.well-known`.
- [ ] **A webhook secret can be lost.** `registerWebhook` makes `secret` optional, and v2 never
      echoes one (`webhooks.md` §Surfaces, `api/v2/openapi.yaml`). A client that omits it can
      never verify a delivery; v1 returned a host-generated secret once.
- [ ] `runs.md` §Surface and the OpenAPI `ApiKeyAuth` description cite an `auth.md` that does
      not exist in v2. The scope vocabulary exists only in the OpenAPI security schemes.
- [ ] `capabilities.md` §3.1 says "Metadata keys (17)" and omits `signingKeys`. The declaration
      has 18.
- [ ] v2 has no counterpart to `spec/v1/registry-operations.md` (yank, rotation, submission).

Defects outside the spec:
- [ ] v2-reference sends `workspaceId: "default"` in webhook deliveries when the run has no
      workspace, which `webhooks.md` §Delivery forbids.
- [ ] openwop-registry: `scripts/new-pack.mjs` fails ("template dir missing"), the README says
      only CI can build the v2 tree, and `npm run check` covers only the v1 tree.
- [ ] openwop-examples: the `vendor-template` and `rust-hello` packs are v1-shaped, and
      `tiny-workflow` and `streaming-client` are v1-only.

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
