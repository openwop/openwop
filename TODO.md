# TODO — MCP/A2A overlap remediation program

> Planning record, 2026-09-23 (HEAD `d593ad55`). Source: the MCP/A2A overlap analysis
> (MCP `2026-07-28` + `io.modelcontextprotocol/tasks` 2026-07-28; A2A v1.0.1 — both
> current, both equal to the pins in `spec/v2/interop-map.json:6-24`), five verify-first
> checks, and an `/architect` review of every phase. RFC numbers 0211–0214 are
> provisional — confirm the next free number at filing time (parallel sessions mint too).
>
> Tick a box only when the change is merged on `main`. Keep this file current as phases
> land; delete it when every phase is closed.

## Status: PROGRAM COMPLETE (2026-09-26)

All four program RFCs are **Accepted** (provisional, RFC 0156 §B review owed, as every overridden-window RFC is):

| RFC | Accepted | Evidence |
|---|---|---|
| 0211 A2A error details are ErrorInfo | #1548 | certified public v2-reference cut, published 2.38.0 (#1542) |
| 0212 canonical JSON is JCS | #1539 | openwop-app verifiers (#4099) + registry signer (registry#74); corpus-gate suite rows |
| 0213 three unstated outcomes | #1579 | certified public v2-reference cut, published 2.39.5 (#1575) incl. §B via the seams-profile claim hold (#1572, examples#88); openwop-app colocated companion (#1577) |
| 0214 A2A push credentials | #1579 | refusal leg: #1542 (push off); all eight §A–§E legs: #1575 (push on, suite-owned public receiver) — D2 reversed 2026-09-24, push built in examples#85 |

Phases: 1 (#1510) · 2+4 (Active flips #1514/#1517/#1519/#1518) · 3 (openwop-app#4097/#4099, examples#83/#85/#88, registry#74, sdks#49) · 5 (above) · 6 (upstream waves 1–3: ext-tasks#23/#24, A2A#1574/#1685/#1986/#1987/#1988/#2103). Suite releases along the way: 2.37.0 → 2.39.5.

**Follow-on flips (2026-09-26):** RFCs **0197, 0205, 0209** `Accepted` (provisional) in #1591 — the certified public v2-reference cut on published 2.40.1 carries the three declared-unwitnessable accounting rows added by #1582; 0197's MyndHyve leg is #1585 (certified 2.39.5, G1 closed) and #1595; 0209's render-side witness is openwop-app#4121's `render-needs-root` probe (sabotage-checked).

**Residuals owned elsewhere (not this program):**
- RFC 0199 needs a PRODUCTION witness for its box 374 (15/15 on v2-reference, #1575) — openwop-77, raised with David.
- RFC 0210 needs its tier-2 box (MyndHyve advertisement fix) — openwop-77.
- Promote `v2-sse-last-event-id-cursor` onto the core-standard floor after measuring all three bundle hosts.
- Audit-entry export shape → a future `auditLogIntegrity` RFC.
- ~~openwop-sdks#50~~ — fixed by openwop-sdks#51 (merged; issue closed).
- Watch A2A PR #2068 (SubscribeToTask POST→GET prose) → revisit the interop-map D1 exception if it merges.

## Binding constraints

- RFC 0147 §A.1 freeze is **SPENT** (`RFCS/0147-…:42`) — do not plan around it.
- RFC 0197 / `spec/v2/core/overview.md:38`: a 2.x minor never reshapes a v2 surface. A
  "replace" is add-beside + `spec/v2/migrations.json` row, or v3. REQUIRED properties,
  endpoints, error-code meanings and headers are never retirable in 2.x (R4).
- RFC 0147 §A.6 (`:48`): identity, authz, isolation, idempotency, replay, external
  effects or certification ⇒ full public window. Any shortening is a **recorded steward
  override** (MAINTAINERS.md row + RFC `Updated` field + §B retrospective owed), never a
  silent waiver. See decision D5.
- RFC 0147 §A.5: `Accepted` needs a non-vacuous behavioral witness from at least one host
  in strict mode. Overriding a window does not override the evidence bar.
- Shape-moving Class-3 corrections ⇒ `spec/v2/corrections.json` row + COMPATIBILITY.md §3
  entry with census. Prose-only Class-3 ⇒ §3 entry only. Class-2 editorial ⇒ §3 editorial
  entry, no row.
- Every file under `spec/`, `api/`, `schemas/` ships in `@openwop/spec-artifacts`; the
  first PR that touches one bumps spec-artifacts **and** the suite (exact-version peer,
  three-way pin: `conformance/package.json`, `scripts/openwop-check-publish-metadata.sh`,
  `scripts/check-npm-pack-contents.sh`, plus `dist/spec-artifacts.lock.json`).
- `check-rfc-status-coherence` rule 7: a shipped scenario may not cite a `Draft` RFC.
- npm publish (tag push) and production deploys need David's explicit go.

## Phase overview

| Phase | Items | Class | RFC | Versions |
|---|---|---|---|---|
| 1 | D1–D5, V4, V5, L1-alt, L2-sentence, D7 suite-peer fix | editorial / Class-2 / in-place amends | amend 0198, 0205, 0208 | rides open 2.37.0 cycle |
| 2 | file 0211–0214 Drafts together | Draft RFCs | 0211–0214 | — |
| 3 | sibling fixes H1–H5, registry signer, example comments | impl-only | — | — |
| 4 | Active flips, normative text, scenarios, invariants | additive + Class-3 | 0211–0214 | open cycle (2.37.0, or next minor if 2.37.0 publishes first) |
| 5 | witnesses → Accepted | status | 0211–0214 | — |
| 6 | upstream drafts (David sends) | out-of-repo | — | — |

---

## Phase 1 — corrections + drift gates (no RFC, no §A.6)

`/architect`: proceed with changes (all applied below). No CRITICAL.

- [x] **D3** `spec/v2/core/conformance.md:45` — carry RFC 0168's 2026-09-05 erratum: seams
      profile is `conformance.seamsProfile`, never root `profiles[]` (closed root,
      `capabilities.md:46,374`).
- [x] **D4** `spec/v2/core/replay.md:12` — facet modes `replay | branch` (facet schema,
      openapi `forkRun`, and the reference host already say so; `rerun` exists nowhere).
- [x] **D2** `scripts/derive-v2-api.py` — `HEADER_RENAME` (`:49`, applied `:62-63`) lets
      v1 `Capabilities-Etag` overwrite the real `ETag` description. Drop instead of rename;
      neutral `headers.md` row ("standard HTTP validator; obligation per operation"); put
      MUST (discovery) / SHOULD (runs) in per-operation descriptions. Do **not** add
      `required: true` (a reshape the monotone gate can't see). Regenerate.
- [x] **D5** `scripts/derive-v2-api.py` `v2_asyncapi()` — translate the 10 v1-spelled
      message names through the codemap v2 column, rewrite the `/v1/` path (`:98`), copy
      OpenAPI security schemes. Messages are unreferenced components ⇒ **Class 2**
      (COMPATIBILITY §3 editorial entry, no corrections row). **Keep `heartbeat.stateChanged`**
      — host event, not in the codemap, renaming = RFC 0197 reshape.
- [x] **D1** `spec/v2/interop-map.json:94-95` — keep `POST /tasks/{id}:subscribe` as a
      documented upstream-prose exception (A2A proto `a2a.proto:76-80` says GET; prose
      §5.3/§11.3.2 and both SDK clients say POST); rule text adds "servers SHOULD also
      accept GET". Amend RFC 0208 in place (no host routes HTTP+JSON). Fix
      `spec/v1/a2a-integration.md:389`.
- [x] **V4** `RFCS/0198-…:53` — reword "Upstream permits using task ids as bearer tokens"
      (ext-tasks `tasks.md:900-905`: MAY be bearer handles, but per-request authz MUST).
      Bolded normative sentence stays byte-identical.
- [x] **V5** `spec/v1/agent-ref-positioning.md:105-115` — name `io.modelcontextprotocol/skills`
      (SEP-2640, Final) as a naming collision with `role:"skill"`; `docs/integrations/mcp.md`
      — ext-apps (`io.modelcontextprotocol/ui`) has no A2UI bridge.
- [x] **L1-alt** `docs/integrations/mcp.md` — informative "Reading a ToolDescriptor as an MCP
      Tool" table; note the opaque-`inputSchema` gap and that the catalog is not callable
      on the mount.
- [x] **L2-sentence** `RFCS/0205-…` Unresolved questions — "in v3 `parts` becomes the
      required turn/artifact shape and `content` is removed."
- [x] **D7 suite-peer** `conformance/src/lib/a2a-fake-peer.ts:439,447` emits `error.data` as
      `Any[]` with ErrorInfo (A2A §9.5); fix self-tests `a2a-1-0-agent-card.test.ts:118,164,167`.
      Cite upstream §9.5 + `interop.md`, never 0211. Convicts no host (tests hit the suite's
      own peer).
- [x] **Gate** `scripts/check-interop-map.mjs` — check A2A rows' `http` verb+path against the
      vendored proto (`conformance/fixtures/upstream/a2a-v1.0.1/a2a.proto`); expand compound
      values; `{id=*}`↔`{id}`; documented-exception list. Sabotage: GetTask→POST; delete the
      Subscribe exception; `/task/{id}`. Prove the unmodified map compares all 12 rows.
- [x] **Gate** new `scripts/check-asyncapi-codemap.mjs` in `openwop-check.sh` stage 10
      (exempt `hostEvents`, cite `events.md:91` + RFC 0060). Sabotage: re-insert a v1 name;
      re-insert `/v1/`; add `run.stateChanged`; remove the exemption.
- [x] Versions: #1508 (2026-09-23) opened the **2.37.0** cycle (suite + spec-artifacts 2.37.0,
      unpublished). Phase 1 rides it — no separate patch; regenerate `CORPUS-STAMP.json`;
      CHANGELOG; COMPATIBILITY §3.
- [ ] Follow-up: `openwop-sdks` re-vendor PR (`check-vendored-sync` goes red on api/v2).
- Gates: full `npm run openwop:check`, `generate-spec-artifacts --check`,
  `derive-v2-api.py --check`, `protocol:status:check`, rule 7.

## Phase 2 — file four Drafts together

All four touch §A.6 classes. File together so windows run concurrently.

### RFC 0211 — A2A error details are ErrorInfo (D7)

`/architect`: go, split (Phase 1 peer fix → RFC → host fix). Two CRITICAL, resolved below.

- [ ] JSON-RPC `error.data` MUST be `Any[]` incl. `google.rpc.ErrorInfo`
      (`reason` = UPPER_SNAKE name minus `Error`, `domain: "a2a-protocol.org"`) — labelled an
      OpenWOP tightening of upstream §9.5 SHOULD (a2a-js 1.2.0 / a2a-python 1.1.5 already comply).
- [ ] HTTP+JSON MUST be `google.rpc.Status` (§11.6); §6.4 `problem+json` example named
      non-normative; clients SHOULD tolerate it.
- [ ] No OpenWOP `{error,message,details}` on any card-listed interface URL, incl.
      pre-dispatch 401/413/429; unlisted (disabled) interfaces exempt.
- [ ] Client: MUST accept `Any[]`, SHOULD accept legacy `{reason}` through 2.x.
- [ ] `TaskNotFoundError` metadata MUST NOT differ unknown vs unreadable except an echo of the
      requested id.
- [ ] **`supportedVersions`** placement — see decision D1. Erratum on RFC 0152 UQ4 and
      `spec/v1/a2a-integration.md:346,491`.
- [ ] `interop-map.schema.json` `errorRow.reason` (optional, additive §B.5) + values;
      `check-interop-map` enforces the UPPER_SNAKE rule.
- [ ] Invariant `a2a-error-no-existence-oracle` (protocol, high).
- [ ] Rewrite isolation comparator `v2-a2a-operation-map.test.ts:187` (currently
      `Object.keys(data)` ⇒ `["0"]` for any 1-element array — vacuous). Compare per-element
      `@type`/`reason`/`domain`/sorted metadata keys.
- Legs + sabotage (Phase 4): data shape (object / empty / wrong reason / wrong domain);
  normalised isolation (foreign-only metadata key); no envelope (route returns OpenWOP
  envelope); client `supportedVersions` projection (object-only parser — the only client leg
  that can fail); HTTP+JSON Status (gated, inapplicable everywhere today — not a witness).
- Census: 0 bundle rows affected.

### RFC 0212 — canonical JSON is JCS; certification preimages pinned (L3, D9, D11, D12)

`/architect`: proceed, widened. Census: 5 committed v3 bundles all re-derive under
code-unit order ⇒ Class-3, no bundle version bump.

- [ ] `ed25519-canonical-json` = RFC 8785 JCS in `packs.md:67`, `conformance.md:64,71`,
      8 pack-manifest schema descriptions, `certification-bundle.schema.json:5,168,373`,
      `run-event-payloads.schema.json:858,2642`, RFC 0063/0064 preimages, `spec/v1/replay.md:254,259`.
- [ ] Refusal set as explicit MUSTs: duplicate names, lone surrogates, non-finite numbers,
      integers outside ±(2^53−1), non-JSON values. Code change: suite `canonicalJSON`
      (`certification-bundle-v3.ts:82`, `cli.ts:339`) and registry signer
      (`build-pack-tarball.mjs:146`) currently coerce.
- [ ] Specify the whole `witnessSha256` preimage (row fields, `{rows, relaxations}` wrapper
      rule, UTF-16 code-unit row order). Today: `localeCompare` default locale
      (`certification-bundle-v3.ts:105`) — `cs`/`sk`/`lt`/`haw` locales already reorder the
      committed myndhyve + v2-reference bundles.
- [ ] **D11** RFC 0150 `tools[]` sort (`llm-cache-key-recipe.ts:79`) → code-unit order.
- [ ] Vectors `conformance/vectors/jcs-v1.json` (RFC 8785 App. B numbers, §3.2.3 sort,
      escapes, integer-like keys, NFC vs NFD, surrogate pairs, refusals, `ch`/`h`, `_`,
      uppercase) + diverging pairs in `semantic-request-digest-v2.json`.
- [ ] Coherence test: every committed bundle recomputes under the code-unit comparator.
- [ ] Invariant `signed-preimage-jcs-locale-independent`. Sabotage: `localeCompare(…,'cs')`;
      rebuild-object canonicalizer (integer-like keys); NaN coercion.
- [ ] **D8 re-scoped**: fix "approximation" comments in example hosts' `audit.ts`
      (sqlite/postgres). openwop-app `auditChainService.ts` is a host extension (does not
      advertise the audit profile) — see decision D6. Audit-entry export shape → future
      `auditLogIntegrity` RFC (deferred).
- Timing: vectors that encode current (JCS-equivalent) behavior may land during the window
  citing RFC 0148/0150; the refusal MUST and prose wait for Active.

### RFC 0213 — three unstated outcomes (D6a/b/c)

`/architect`: go with changes (applied). One RFC, three sections, independent acceptance boxes.

- [ ] **§A** `events.md:87` — `Last-Event-ID: N` is an exclusive cursor (stream `sequence > N`);
      N ≥ last ⇒ live run waits, terminal run closes with no frames; MUST NOT refuse a
      well-formed numeric id for lack of that sequence; malformed SHOULD `400 validation_error`.
      No new error codes (matches all 5 hosts and poll's past-end-200 rule).
      Invariant `event-cursor-after-authorization` (foreign/unknown run ⇒ 404 regardless of header).
- [ ] **§B** `idempotency.md:22` — loser MAY block (bounded by request timeout) and receive the
      winner's response only if **final** (cacheable; not 429/5xx per `:20`); otherwise MUST
      `409 idempotency_in_flight`, no retry timing in `details`, SHOULD `Retry-After`.
      Clarify in prose that `retriable: false` means "not retriable without waiting" (decision D7).
- [ ] **§C** Option X (decision D3) — cancelled/completed run resolve ⇒ `409
      interrupt_already_resolved` on both surfaces. `interrupt_cancelled` row keeps 410, no
      `deprecated` marker; correct only `statusSource`/`source` provenance (v1 said 422);
      `errors.md` line "core resolve surfaces MUST NOT emit `interrupt_cancelled`".
      Two COMPATIBILITY §3 Class-3 entries.
- New scenarios (off-floor): `v2-sse-last-event-id-cursor`, `v2-idempotency-in-flight` (v2
  variant; record `partial-witness` if no true overlap), `v2-interrupt-resolve-terminal`.
  Sabotage each (400 on future id; resume from 0; cursor before authz; two runs created;
  `details.retryAfter`; mismatch code; app's 410 `interrupt_gone`; foreign tenant not 404).

### RFC 0214 — A2A push credentials + delivery safety (D10, L5-correction)

`/architect`: CRITICAL D10; do correction now, defer implementation (decision D2).

- [ ] **D10** `security-defaults.md:65` forbids forwarding body-carried credentials, but A2A
      §4.3.3 requires push to send the client-supplied credential ⇒ push unsatisfiable.
      Carve-out: a push-config credential is a destination credential — sent only to the
      registered origin, only on push delivery, never after a redirect, dropped on
      config delete / terminal task. `spec/v2/corrections.json` row + COMPATIBILITY §3.
- [ ] Delivery-time egress re-resolve + no-redirect (`webhooks.md:79`) apply to push.
- [ ] Replay forks never push and never inherit push configs.
- [ ] Delivery: ≥1 attempt; retries follow `retryPolicy` semantics; dead-letters not visible
      to A2A clients (recover via `GetTask`); `token` carriage rule.
- [ ] Config isolation: foreign `configId` byte-identical to unknown; ids don't encode tenant;
      delete idempotent. No OpenWOP signature on A2A pushes.
- [ ] Editorial: RFC 0100:82,104 stale "HMAC per A2A §4.3.3".
- [ ] Invariants: new `a2a-push-credential-destination-bound`, `a2a-push-secrets-not-returned`;
      extend `a2a-push-egress-ssrf` to delivery time.
- `v2Operation` stays `null` (webhook ops are tenant-scoped; push is task-scoped).

## Phase 3 — sibling fixes (during windows; own worktrees; deploys need David)

- [ ] **H1** openwop-app `a2aServer10.ts:65-73` `Any[]`; `a2aCodec10.ts:167-184` accepts both
      shapes; no OpenWOP envelope on A2A routes (`agents.ts:864` + shared middleware).
- [ ] **H2** openwop-app `agents.ts:912-919` unsupported version ⇒ `-32009
      VersionNotSupportedError` (today `-32600`).
- [ ] **H3** openwop-app: v2 run-scoped resolve on cancelled run ⇒ 409 (today vendor
      `openwop-app.interrupt_gone` 410); `Retry-After` header on in-flight 409 (today stripped
      with `details.retryAfter`); malformed `Last-Event-ID` ⇒ `validation_error`.
- [ ] **H4** openwop-app `scripts/lib/bundle-v3-verify.mjs:39-41` + `certificationEvidence.ts:187`
      — code-unit order, honor `relaxations`.
- [ ] **H5** openwop-app issue: push sink drops credentials, follows redirects, 0.3 body,
      wrong content type — keep `pushNotifications` unadvertised until fixed.
- [ ] openwop-registry `scripts/build-pack-tarball.mjs:144` I-JSON refusal.
- [ ] openwop-examples sqlite/postgres `audit.ts` comment corrections.
- [ ] openwop-sdks Python/Go consume the JCS vectors.
- Witness: openwop-app in-memory boot (`createApp storageDsn:'memory://'`) + conformance with
  `OPENWOP_REQUIRE_BEHAVIOR=true`.

## Phase 4 — Active flips + suite 2.37.0

- [ ] Each RFC `Draft → Active` with normative text, schema, invariants, scenarios.
- [ ] Suite + spec-artifacts + `spec/v2/release.json` ride the open cycle (2.37.0 while
      unpublished; if 2.37.0 publishes first, open 2.38.0).
- [ ] Re-count tallies from the live tree; `node scripts/generate-protocol-status.mjs --write`.
- [ ] Run every sabotage against v2-reference and an openwop-app memory boot.
- Gates: full `openwop:check` (stage 10 incl. `generate-error-envelope --check` zero diff,
  `check-v2-surface-monotone`, `check-accepted-predicate`), `check-security-invariants.sh`,
  `protocol:status:check`, `spec-corpus-validity`, `tsc`, published-layout run.

## Phase 4b — the certification path (the gate Phase 5 actually waits on)

> Measured 2026-09-24: all fifteen Active cohort RFCs were flipped in a throwaway
> worktree and `check-accepted-predicate.mjs` run against the result. **All fifteen
> fail** — rule 1 (unticked acceptance boxes whose conditions are unmet) and rule 3
> (no `Evidence tier:` in `Updated`). 0203 was the sole pass and is now Accepted
> (#1521). The blocker is EVIDENCE, not the comment window: RFC 0197's box reads
> "**Evidence (never waived):** at least one committed v2 host bundle carries …".
> A steward override of §A.6 waives the wait; it does not waive this.

**The constraint that orders everything below.** RFC 0168 §E.1 makes ONE `blocked`
row bundle-wide fatal — every claimed profile goes `certified: false`. RFC 0174 §B.1
then refuses an uncertified bundle as acceptance evidence, and the predicate's reader
was deliberately hardened so "an acceptance may not rest on evidence the evidence
format itself refuses". So a re-cut landing `certified: false` moves ZERO RFCs however
few failures it shows, and a spent cut cannot be un-spent. Reach blocked = 0 BEFORE
cutting, not during.

`inapplicable` is free; `blocked` is fatal. Every blocked row is exactly one of three
kinds, and they have different fixes:

| Kind | What it means | Fix | Owner |
|---|---|---|---|
| **A — operator precondition missing** | the suite needs a credential or fixture the operator did not supply | supply it | host operator |
| **B — advertised but unanswerable** | the host claims a capability whose seam does not answer | build the seam, or stop advertising until you do | host |
| **C — wrongly blocked** | the host never claimed the thing, so §C.1 says `inapplicable` | fix the SCENARIO | suite |

Kind C is not hypothetical: RFC 0168 §C.1 records the corpus fixing exactly this once
— a scenario recording `blocked` on an absent advert "denied certification of every
profile to hosts that had merely not mounted the seams".

- [ ] **A — MyndHyve mints `OPENWOP_TEST_LOW_SCOPE_KEY` and `OPENWOP_TEST_TENANT_B_API_KEY`.**
      Clears ~6 of its 9 blocked rows (`0200.challenge-403-scope` + four tenant-B rows)
      with no product change. Highest value per unit of work in the whole program.
      *Owner: myndhyve-55.*
- [ ] **B — MyndHyve resolves `0199.*` ×5 + `credential-interrupt`.** Blocked because it
      advertises `oauth` while the two conformance seams do not exist. Either build them
      or stop advertising. **A seam that builds its own authorization URL is forbidden**
      (RFC 0199 R9): it would measure a stub and turn a blocked row into a meaningless
      pass. *Owner: myndhyve-55.*
- [ ] **C — audit each remaining blocked row against §C.1** before spending product work:
      a row blocked on something the host never advertised is a SUITE bug, and fixing it
      is free certification. *Owner: whoever cuts.*
- [ ] **v2-reference: `0207.a2a-traceparent-carried`.** #1520 (front-mux, in 2.37.0) is
      expected to clear it; the host was measured on loopback to send the carrier, so the
      earlier "real host gap" reading is withdrawn. *Owner: openwop-77.*
- [ ] **v2-reference: `v2-webhook-message-id-stable`.** Recorded "no test executed and no
      disposition recorded" on one cut having passed the previous one. Likely EADDRINUSE
      on the shared pinned receiver port — the same family as the #1513 identity
      collision. *Owner: openwop-77.*
- [ ] **Then, and only then, cut.** A bundle with `certified: true` on published 2.37.x,
      committed to `evidence/v2-host-bundles/`. Re-run the predicate dry-run against the
      committed bundle and flip whatever is then tickable, writing `Evidence tier:` into
      each `Updated`.

**Which host gates what.** MyndHyve is the only committed host advertising an `oidc`
lane, RFC 9728 PRM, `artifactTypes`, `conversationPrimitive` or the `content` family, so
**0205, 0210, 0200 and probably 0201/0209 can only be witnessed there** — no amount of
reference-host work substitutes. 0206 is externally gated regardless (decision D14: no
host serves an extended content locale; the row stays honestly unticked).

**Retracted 2026-09-24 — there is no such defect; do not spend time on it.** This file
briefly claimed that ten scenarios (`agent-loop` ×3, `distillation` ×4, `heartbeat` ×3,
`runtime-requires-install-gate`) record `blocked` for "seam absent" where §C.1 requires
`inapplicable`. **Checked, and they are correct.** Each gates on the ADVERT first and
returns `inapplicable` when the capability or profile is not advertised; the `blocked`
branch is reached only when the host DOES advertise and the seam then fails to answer —
kind B, legitimately fatal. `heartbeat-fires-once-per-tick.test.ts:19-21` is the pattern,
and the other three were spot-checked. The grep that produced the claim matched the
`blocked` string without reading the guard above it.

Kept as a worked example of the taxonomy rather than deleted: "records `blocked` when a
seam is absent" is kind B or kind C depending entirely on whether an advert gate runs
first, and only reading the scenario tells you which. A grep cannot.

## Phase 5 — Accepted

- [ ] **Depends on Phase 4b.** A host row only counts from a bundle whose profiles read
      `certified: true` (RFC 0174 §B.1); an uncertified one supplies nothing.
- [ ] 0211, 0212, 0213 (per-section boxes), 0214 (correction only) → `Accepted` when a
      tier-1/tier-2 host row exists from non-vacuous legs (§A.5). A2A/MCP tier-3 upstream
      peers remain externally gated — state it, don't claim it.

## Phase 6 — upstream outreach (drafts; David sends each)

- [ ] Bugs first: (1) MCP ext-tasks example `resultType:"task"` on `tasks/get`
      (`tasks.md:846,870` vs `:338`); (2) A2A SubscribeToTask proto GET vs prose POST;
      (3) A2A §6.4 `problem+json` vs §11.6 `google.rpc.Status`.
- [ ] Proposals: push payload signing + SSRF MUST; stream resumption / event ids (after 0213);
      idempotency key ("define a key", not a MUST); A2A trace carrier; push `token` carriage
      question; non-disclosure MUST + approver eligibility only with a concrete threat.
- Dropped: PKCE S256-unconditional (MCP quotes OAuth 2.1 verbatim).
- No RFC 0147 §A-banned claims ("industry standard", "independently validated", …).

## Deferred / dropped

- Deferred: A2A push implementation (`pushConfigs[]`, delivery scenario, public HTTPS
  receiver); promoting `v2-sse-last-event-id-cursor` onto the core-standard floor (after
  measuring all three bundle hosts); audit-entry export shape (`auditLogIntegrity` RFC).
- Dropped: L1 wire projection (no MCP media type; opaque-`inputSchema` tools; invites
  `tools/call` on catalog names); L4 MCP prompts from the library (contradicts
  `interop-map.json:445` "without template evaluation"; secret-variable exposure; RFC 0020
  source collision); `heartbeat.stateChanged` rename; new cursor error codes.

## Decisions — recommendations (adopted unless David overrides)

| # | Question | Recommendation | Why |
|---|---|---|---|
| D1 | Where `supportedVersions` goes under ErrorInfo | `metadata.supportedVersions` as a comma-joined string, emission SHOULD; clients MUST fall back to the card's `supportedInterfaces[].protocolVersion`; erratum on RFC 0152 UQ4 | ErrorInfo metadata is `map<string,string>`; no upstream SDK emits it; card is already authoritative |
| D2 | RFC 0214 scope | Correction only now; defer implementation until a real A2A client asks | D10 is a live contradiction for any host advertising push; implementation needs secret-store + delivery worker + public receiver, and no v2 host advertises push |
| D3 | D6c direction | Option X (prose wins, 409); keep §C inside 0213 with its own acceptance box; split only if the openwop-app fix lags the window | Option Y makes v2-reference non-conforming; RFC 0171 C4.6 "one code per state" |
| D4 | Drops | Confirm all four | Each has a CRITICAL/HIGH blocker recorded above |
| D5 | Comment windows | David's 2026-09-23 directive: shorten via a **recorded steward override of §A.6** per RFC (0194 precedent: RFC `Updated` field + MAINTAINERS.md override row + §B retrospective owed), not a silent waiver. Evidence bar (§A.5) is not overridable | Keeps the governance record honest and reviewable; matches 0197–0210 practice |
| D6 | openwop-app audit-chain `canonVersion` | Do it, last, as a host-extension hardening (era marker; absent ⇒ legacy recompute) | Cheap; stops a latent integer-key divergence; not a protocol obligation |
| D7 | `idempotency_in_flight` `retriable: false` | Leave the value; state in 0213 §B prose that `retriable` means "retriable without waiting" | Flipping it changes a code's meaning (R4); prose clarification is Class-3-safe |
| D8 | Publishing / deploys | Publish the open 2.37.0 cycle once after Phase 4 (or after Phase 1 if a host needs the corrected fake peer sooner); batch openwop-app deploy after Phase 3. Each still needs David's go | npm publish is irreversible; deploy ordering is backend-first |
| D9 | Upstream | Draft all; David sends bugs 1–3 first, proposals after 0213 lands | Outward-facing; bugs carry no claims |

---

# TODO — steward follow-ups from the 2026-09-19 gap-closure program

> **Separate program from the MCP/A2A phases above, and it outlives them.** That record says
> "delete it when every phase is closed" — this section is not part of it. Added 2026-09-24 by
> `openwop-1`, reviewing corpus `2.38.0` (HEAD `752d46d5`) against work shipped in 2.24.0–2.31.0.
>
> Everything shipped in that program survived and is doing its job: RFC 0158 is `Accepted`,
> witnessed by the five `durable-single-instance` rows on **two** hosts; the
> `inapplicable`-vs-`blocked` disposition rule is why `openwop-workflow-engine` certifies on all
> three profiles while recording four of those rows `inapplicable`; `v2-front-door-counts`
> caught the `spec/v2/core/` count when it grew 22 → 25. The items below are what did **not**
> close.

## S1 — `v2-projection` is a FALSE duplicate, not a duplicate · **highest value, not urgent**

`conformance/src/lib/v2-projection.ts` and `scripts/generate-from-declaration.mjs` both export a
`stripSupported`. **They do different jobs under the same name**, which is worse than two copies
of one function: a reader who finds one and assumes the other matches will be wrong in the
direction that silently relaxes a schema.

| | generator (`scripts/generate-from-declaration.mjs:177`) | lib (`conformance/src/lib/v2-projection.ts`) |
|---|---|---|
| input | a JSON **Schema** | a host's advertised capability **value** |
| strips | `supported`, **`tier`, `experimentalUntil`** | `supported` only |
| conditionals | **folds** `supported`-gated `if/then` into unconditional `required` (RFC 0192 §A) | leaves them |
| objects | sets `additionalProperties: false` | leaves open |
| prose | rewrites `description` via `rewriteSupportedProse` | — |

**Falsifiable instance, measured 2026-09-24:** run the lib's `stripSupported` over every root key
of `schemas/capabilities.schema.json` — **`multiAgent`** comes back still carrying `tier` and
`experimentalUntil` (on its `executionModel` facet, one level down). Corpus-wide the divergent surface is small (2 × `tier`, 1 ×
`experimentalUntil`, 3 × `supported`-gated `if/then`), which is why it has not bitten yet.

**Why this matters beyond tidiness:** the lib is the **host-facing** artifact — it ships in the
npm package (`files: ["src", …]`) and openwop-app asked for it after three sessions hand-derived
the same projection and each got it wrong in a different direction (their `selfHosted`
`string[]` → `boolean`; my `aiProviders.input` and `.policies` flattened to
`additionalProperties: true`). A host importing it today gets a **weaker** strip than the corpus
applies to itself.

**Do NOT merge them.** They should not agree. The fix is to make the distinction impossible to
miss:

- [x] Rename by contract, not by mechanism — the lib projects a *value*, the generator projects a
      *schema*. ~~Nothing imports the lib yet, so renaming is free now and not later.~~ **Wrong:**
      openwop-app imports it (see S2), so the old name stays as a `@deprecated` alias.
- [x] Cross-reference both, each naming the other and why they differ.
- [x] `carriesUnspliceablePayload` **is** a true duplicate and the two are behaviourally
      identical on every input (verified: `null`, arrays, boolean, enum, array, map, scalar,
      object-with-properties). Either dedupe it or add a parity test — it will land green.

**Done (S1):** the lib's export is `stripSupportedFlag` and the generator's is `projectV1FacetSchema`,
each with a comment naming the other. The generator's predicate moved to
`scripts/v2-unspliceable.mjs` (+ `.d.mts`, so the self-test imports it without `allowJs`), and
`v2-projection.test.ts` holds the two copies equal on every schema node of the v1 capabilities
schema, not just root keys. It is sabotage-proved. A second test pins the documented divergence on
`multiAgent.executionModel`. Seen along the way, not fixed: the generator keeps executionModel's
`tier`-gated if/then (it gates on `tier`, not `supported`) and strips its properties, so v2 carries a
no-op `if: {properties: {}}, then: {}`. It is harmless, but it is residue.

**Three options were measured before recommending the rename; record so nobody re-derives them:**

| option | verdict |
|---|---|
| generator imports the `.ts` directly | **Rejected.** Node 22.22/24 strip types fine and CI is on 24 — but `conformance/package.json` declares `engines: node >= 20`, where type stripping does not exist. Coupling the corpus gate to a Node-24-only feature is a real regression for a cosmetic win. |
| `.mjs` single source + `.ts` re-export | **Rejected.** TS *does* resolve a sibling `.mjs` (probed), but only under `nodenext` + `allowJs`; conformance is `moduleResolution: Bundler` with `allowJs` off. Turning `allowJs` on touches the whole package build. |
| rename + cross-reference + parity-gate the one true duplicate | **Recommended.** No runtime coupling, no engine risk, no shared-build change, and it closes the hazard that actually bit — undetected divergence. |

## S2 — ~~`v2-projection` is adopted by nothing~~ · **CLOSED 2026-09-24: premise false**

**Adopted by openwop-app since its `WHD-7`.** `backend/typescript/test/whd7-v2-projection-parity.test.ts`
imports `stripSupported`/`carriesUnspliceablePayload` from `…/src/lib/v2-projection.js` and pins its
hand-written discovery projection (`routes/discovery.ts`) to them. It found a fifth drift
(`workflowChainPacks.subChains`), and its `KNOWN_UNPROJECTED` list is openwop-app's `WHD-17`. It is a
parity pin, not a runtime import, because the suite is a devDependency that the `--omit=dev` image
lacks. The grep below looked only at this repo. That is the "failed grep treated as proof of absence"
shape openwop-app's `HANDOFF-4` warns about. Nothing is left to wire, and deleting the lib would break
that test.

*Original text, kept for the record:*

`grep -rl v2-projection conformance/src scripts` returns only the lib and its own test. The
generator has its own inline `carriesUnspliceablePayload`, so the helper written to stop sessions
re-deriving the projection is currently **a fourth copy of it**.

- [ ] After S1's rename, wire at least one real consumer, or delete the lib and say so. An
      unadopted helper shipped to hosts is a promise that nothing keeps.

## S3 — `webhooks.md` has tenant isolation and no DELIVERY isolation · **RFC, mine**

Surfaced by openwop-app's WHD-1 (now fixed on their side). Their delivery worker processed a
claimed batch strictly sequentially — `CLAIM_BATCH=5` × `DELIVERY_TIMEOUT_MS=10s` — so a handful
of dead subscribers delayed a **healthy** subscriber's first delivery to **5.5 minutes** against a
configured backoff of 2s. Their host was conformant *to the letter* the whole time.

`spec/v2/core/webhooks.md` carries exactly one isolation property:

> *"A subscription MUST receive only events from runs within its tenant scope … (invariant
> `webhook-cross-tenant-isolation`)."*

That is the **confidentiality** half. There is nothing — v1 or v2 — saying a subscription's
delivery MUST NOT be degraded by an unrelated subscription's failures.

- [x] File the RFC: **RFC 0215 `Draft`** (2026-09-24). It is stated as an isolation rule, not a
      latency bound (its Alternative 2 says why), with a floor of 8 unanswered attempts. It also
      picked up a second gap from openwop-app `WHD-16`: unregistering did not stop pending
      attempts, and ~1,600 signed POSTs went to a withdrawn URL.
- [x] Decide invariant vs §Durability clause: **both**. The text goes in §Durability, and two
      invariant rows (`webhook-delivery-isolation`, `webhook-unregister-stops-delivery`) are
      filed at `Active`. Reasons are in RFC 0215 §"Proposed invariants".
- [x] Prior-art survey (G6) and a threat-model home for the availability invariant (G3), both
      done 2026-09-25: RFC 0215 §Prior art; `threat-model-secret-leakage.md` §4.12.
- [x] RFC 0215 `Active` 2026-09-25, window waived by steward override of RFC 0147 §A.6
      (suite 2.40.0): the `webhooks.md` text, both invariant rows citing §4.12, and both
      scenarios, sabotage-proved on the v2 reference host.
- [x] RFC 0215 `Accepted` 2026-09-26 (provisional): 2.40.0 published (#1576); certified
      witnesses MyndHyve production (#1595, tier-2) and the v2 reference host (#1587, tier-1).
- [ ] RFC 0215's RFC 0156 §B retrospective review (register row `not-reviewed`). §A.3's per-tenant
      fair share is unmet on both deployed hosts (a SHOULD; openwop-app needs a tenant_id on
      delivery rows, ADR 0752).

## S4 — two defect patterns from my RFC 0158 rows, both found by hosts · **pattern check, no code owed**

Both are fixed on `main`; recorded because the *shapes* recur and a new scenario should be read
against them.

- **A transport failure is an unreadable observation, not a verdict** (`323400a2`, 2.34.2). My
  kill rows read status through `driver.get` calls that **threw** when the host died after its
  seam answered. I wrapped `waitBack()` in try/catch and left the watch reads bare — and
  `kill-during-execution` dies seconds later, squarely in that window. Measured at openwop-app's
  production image under a real supervisor: **four of five rows failed on `UND_ERR_SOCKET`,
  twice.**
- **Two scenarios can share one effect identity** (`2ae74ee6`, 2.37.0). My `duplicate-delivery`
  leg and `v2-terminal-event-once` both drove `POST /host/durability/kill` with the same
  registration URL. Layer-2 identity is *business* identity — tenant, workflow, node, request
  digest, deliberately **no `runId`** — so a conformant host resolved the second exercise to the
  first's recorded outcome and called out zero times. Whichever leg vitest ran second saw nothing.

- [ ] When adding a scenario that drives a seam at an operator-supplied URL, check whether another
      scenario drives the same seam: identical URL ⇒ identical effect identity ⇒ the second
      exercise is legitimately deduplicated to zero.

## Standing context (not tasks)

- **RFC 0111 / 0121 stay `Active` (Parked)** with named tripwires. 0121's is
  `externally-gated:provider-tos-clearance` — a legal question no spec text answers. **Do not
  withdraw it**; `Withdrawn` would lose the tripwire. 0111 has **zero** open gap rows.
- **Tier-3 host tripwire** is unownable and stated honestly — `INTEROP-MATRIX.md` says
  *"no independent-organization row exists"* and every graduation records its tier.
- **330 open risk rows**, ratcheted at `docs/witness-baseline.json` `openRisks: 330`. Zero is
  deliberately NOT the baseline (an open *risk* is a legitimate standing state; an open *gap* is
  work owed). The summary names the baseline it checks against.
- **`npm run openwop:check` cannot complete without network** — steps shelling to `npx -y`
  (redocly, asyncapi) fail `ETIMEDOUT` in a sandboxed run. Corpus-only checks
  (`check-spec-coherence`, `check-declaration`, `check-registers`) run offline and were green at
  `752d46d5`.
