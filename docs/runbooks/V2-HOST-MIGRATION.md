# v2 Host Migration Runbook

> **Status: v1 (2026-09-04).** Step-by-step procedure for migrating a live OpenWOP host from major 1 to major 2 without downtime and without rewriting a single historical event row. Targets a host operator who already serves v1 in production. Pairs with `spec/v2/core/persistence.md`, `spec/v2/core/versioning.md`, and RFC 0167 §F.

This runbook is the product of two real migrations run in parallel — a tier-1 host (`openwop-app`, SQLite + Postgres) and a tier-2 host (MyndHyve, Firestore). **Twenty corpus defects were found during those two migrations, and every one of them was found by implementing the contract rather than by reading it.** That is the reason this document exists: the second migration was measurably cheaper than the first, and a third should be cheaper still.

Everything below that reads like an over-specific warning is an over-specific warning because it actually happened.

---

## When to use this runbook

You operate a host that serves major 1 in production, with persisted event logs you cannot afford to lose or rewrite, and you want to serve major 2.

**NOT covered:** building a host from scratch (start from `spec/v2/core/` and the `v2-reference` example instead — it was written from the spec rather than from v1 host code, which is what made it useful as a front-door witness); registry pack migration (`docs/runbooks/PACK-LIFECYCLE.md`); SDK upgrades.

---

## The one idea to take away

**Design against signals that look identical whether they are true or false.** Five distinct instances of this shape surfaced across the two migrations, and it is the only failure mode that recurred:

| what looked the same | what the two cases actually were |
|---|---|
| a `200` with a v1 body | the header was **honored** vs the header was **ignored** |
| an `inapplicable` ledger row | evidence **absent** vs evidence **excused** |
| a green negative control | the guard **fired** vs the guard tested the wrong file |
| a valid signature | attributable to a host vs signed by a keypair minted seconds ago |
| a schema-valid document | **specified** vs merely **not-yet-forbidden** by an open root |
| a `200` with the whole log | the cursor was **honored** vs **accepted and ignored** by a permissive parser |
| a requirement nobody violates | genuinely **upheld** vs **never asserted by anything** |

Every check you add should be able to fail. If you cannot describe the input that makes it fail, it is not a check.

---

## Phase 0 — Before you touch anything

**0.1 Pin the corpus and re-pin deliberately.** Record the exact suite tag your host validates against. Re-pinning mid-migration is normal — expect to do it three or four times — but each re-pin is a deliberate act with a gate run, never a drive-by bump.

**0.2 Know your version sites.** In this corpus a release-candidate bump touches **six** hand-kept sites plus several generated ones. In your host it will be fewer, but find them before you need them. The one that bites is any **exact-pinned peer dependency**: bumping a package's own version while leaving its peer pin behind produces an `ERESOLVE` that no local gate sees, because a repo checkout resolves the peer by path and only a packed-tarball install reproduces it.

**0.2b Pin both peers to the same explicit version — never to a dist-tag.** The suite and `@openwop/spec-artifacts` are declared exact peers published by two jobs in one workflow, so a moving tag like `next` advances **per package**. For the minutes between them, `@next` resolves a pair that was never published together, and the suite refuses to start. Confirm *both* resolve at your chosen version before installing.

> **On propagation windows generally:** a negative result measured inside one is not evidence at all. A host checking for a just-published package twice, twenty seconds apart, got "not found" both times and the correct answer on the third look; observed windows ran 2 to 9 minutes. Either wait it out, or check something not subject to the window — the publish job's own `+ package@version` line.

**0.3 Check your tenant's daily run ceiling.** A full certification lane creates runs. If your conformance tenant has a per-day run cap, one lane can exhaust it — measured: `429 session_runs_per_day`, retry ≈ 8.9 hours. The consequence is not merely inconvenient:

> A host that cannot be certified twice in a day is a host whose evidence **a second party cannot re-run**.

For a program whose thesis is independent witness, that is a defect in operator posture. **Provision a second API key scoped to a distinct tenant** (e.g. `conformance-verify`) rather than raising the shared tenant's ceiling — raising it relaxes a real protection permanently to solve a scheduling problem. The contrast is instructive: the tier-2 host ran two full lanes plus three filtered runs on one key and saw zero rate-limit hits, so this is configuration, not physics.

**0.4 Know your key syntax.** If your API keys are configured as CSV of `<key>` or `<key>:<tenant>`, the bearer token is **the part before the colon**. Sending the stored value whole returns `401`, which reads exactly like a missing credential and will cost you an hour.

---

## Your merge gate cannot be green mid-migration — and that is not a defect

The moment you pin to the v2 suite, a conformance lane wired into your merge gate starts measuring **the whole v2 contract**, including surfaces you have not built. If that lane is your merge gate, nothing merges until the migration is finished — which blocks the migration itself.

**Do not run the merge gate with `--require-behavior`.** That flag means *"I claim to implement all of v2; fail me if I do not advertise it."* Mid-migration you are not making that claim, so asserting it is not strictness — it is a false statement about your own host that you then fail. The flag's own contract says the default exists precisely so *"a v1.0-only host doesn't suddenly fail the suite when new optional profiles ship."*

| lane | flag | what it answers |
|---|---|---|
| merge gate | **no** `--require-behavior` | did I break something I had already built? |
| certification | `--require-behavior`, or `OPENWOP_OPTED_OUT_PROFILES` for deliberate non-implementation | is my advertised claim true? |

For reds that survive with the flag off — a surface you advertise but have not finished — keep a **named-scenario baseline that may only shrink**. This corpus ratchets the same way in two places already (`docs/witness-baseline.json`; the threat-model pointer count, reported as *"at baseline — a ratchet, not a pass"*).

**The baseline MUST name scenarios with reasons, never a count.** A count lets one red be swapped for another silently, and you stay green while learning nothing.

> **The real hazard is not a red gate — it is how someone eventually makes it green.** Quarantining scenarios is excused evidence wearing a gate's clothes, and it is indistinguishable from absent evidence at exactly the moment you need to tell them apart. Turning off a flag that asserts a claim you are not making is honest. Suppressing a scenario that measures a surface you *do* advertise is not.

**Keep a clean reference host as a control.** A tier-1 host mid-migration has legitimate failures, and a *wrong* check hides inside a set of correct ones almost perfectly — the same camouflage as a false red inside a load-induced one. Two suite defects in this program were caught only because the reference host has no legitimate failures for them to hide behind, and were invisible on the migrating host, where they had been filed under "unimplemented v2 legs". A host with a clean baseline is a better instrument than a host mid-migration.

---

## Phase 1 — The wire, first

**Land the dual-stack advertisement before anything else.** This ordering is not aesthetic. Every v2 conformance scenario reaches the host through v2 discovery, so until the v2 root exists, **nothing you build can be witnessed** — you would be writing migration code with no way to tell whether it works.

An adversarial review of the original plan caught this as an ordering inversion: the identity work had been scheduled before the wire, and all four of its "unaided" scenarios read the v2 root.

1. Advertise both majors in `protocolVersions[]`.
2. Keep `preferredVersion` on the **1.x** member. While `protocolVersions[]` carries any 1.x member, a header-less request MUST still get the v1 representation (`versioning.md` §1.1). This is what makes every step up to the flip invisible to existing clients, and therefore reversible.
3. Honor `OpenWOP-Version` — **or refuse it with `406`. Never ignore it.**

> **The trap.** A host that returns `200` with the v1 document to `OpenWOP-Version: 2` is invisible to every presence-gated scenario in the suite: a scenario that skips when a v2 shape is absent records `inapplicable` whether the host *refused* major 2 or *silently handed back v1*. Both are non-failures, so the bundle looks clean while witnessing nothing.
>
> This is not hypothetical. It is the shape that let an RFC sit `Accepted` on a host serving none of it. **Verify by fetching the resource twice, with and without the header, and comparing bytes.** A host advertising two majors that returns identical bytes for both has advertised a major it does not serve.

> **Advertising a major is a claim about the PATH SPACE, not about the discovery document.** Every probe that naturally comes to hand when you flip the advertisement — `protocolVersions`, `preferredVersion`, the response header, comparing the two representations — hits `/.well-known/openwop`, the one resource whose representation the header selects. **They all pass while almost nothing else is mounted.**
>
> Measured on a tier-1 host: advertising `["1.1","2.0"]` while serving **two of fifteen** top-level segments of the v2 path space. Its unversioned mount was a deliberate allowlist — chosen over a blanket `/v1`-strip because the host serves a large non-`/v1` surface a blanket rewrite would shadow, which is sound reasoning — and the list was simply incomplete. `POST /webhooks` under major 2 returned `404` while `POST /v1/webhooks` returned `201`.
>
> **Check it with a PAIR, never a single probe.** "This host does not implement webhooks" and "this host implements webhooks and did not mount them under major 2" are different facts that a lone `404` cannot separate. If `/v1<path>` answers and `<path>` under major 2 is `404`, the advertisement overstates. `v2-advertised-path-space-served` does exactly this against the parameterless GETs in `spec/v2/path-manifest.json`.

**Reversibility check:** through this whole phase a v1 client sees no change. If it does, stop — something is reading `protocolVersions[]` that should be reading `preferredVersion`.

---

## Phase 2 — The era key, and the rule everyone misses

The era key (`eventLogSchemaVersion`) is a trichotomy: **absent ⇒ 2**, `2` = v1 era, `3` = v2 era. Historical rows are never rewritten; translation happens at the **read** boundary.

**2.1 Stamp `3` on every creation path in ONE change.** A host with more than one creation path that leaves one unstamped produces runs indistinguishable from pre-cut runs, and every reader translates them as era `2` — a **silent wrong read, not an error**. One real host had exactly this shape in review: one path writing `2`, another writing nothing, and discovery advertising `1`, a value no path wrote.

**2.2 Collapsing to one constant is a precondition for advertising, not a consequence.** A host whose writers disagree has no single value to advertise, so whatever it publishes is false for some of its own runs.

**2.3 The writer rule — the one that is easy to miss.** An append to a run in era `2` MUST use **v1 vocabulary**: the name the codemap maps *from*, not the v2 name it maps to. The reader rule translates an era-`2` log at the storage boundary, which is only coherent if the log stays in one vocabulary for the run's lifetime. A host that starts writing v2 names into an era-`2` log breaks its own reader two ways — a renamed type is mapped twice, and a v2-only name is not on the codemap's v1 side at all, so the read fails.

**This matters most if you suspend runs.** If your host suspends on human approval, runs *will* straddle the deploy boundary, and draining them first is explicitly not the path.

**2.4 The v1 wire of an era-`3` log.** Through the overlap you serve both majors and `/v1/…` keys are unchanged, so a run created today is era `3`, stored in v2 vocabulary, and must still read on `/v1/…` exactly as before. Map back through the **same codemap row, inverted**. Verify the bijection at load. **Refuse rather than guess** if a future row folds.

**2.5 Never backfill.** Absent stays era `2` forever.

---

## Phase 3 — Identity

**Do not re-mint ids.** If v2 gives you a tenant-bound id grammar, implement it as a **reversible wire projection at the major-2 boundary**, not as a migration. A separator in an id is a path separator in every route, a primary key in your tables, and the value your create endpoint has returned since 1.0. A read projection satisfies the grammar exactly; minting breaks the v1 representation to satisfy it.

Two traps found in practice:

- **Project in every sender, not just the obvious one.** One host's projection lived in the JSON response wrapper — and its single most important endpoint content-negotiates and therefore sends through a different path. A wrapper that some call sites bypass is the failure `persistence.md` §"The seat" names.
- **Mount inbound validation *after* authentication**, and refuse a foreign tenant segment **before touching the store**, so existence is not disclosed.

**Prove the v1 wire unchanged by replaying a request transcript against both trees on the same port** — not by reading the diff. Expect only volatile values to differ (per-boot paths, trace ids, weak etags computed over them). Anything else is a finding, and you should state it rather than let it be discovered: one migration changed an opaque interrupt token's byte length, which was legitimate (the v1 parameter has no grammar) and was reported anyway.

---

## Phase 4 — Certify

**4.1 Publish your signing key before you certify.** `signingKeys[]` on your discovery root — available on **both** the v1 and v2 roots, because a certification bundle is v3 regardless of major. Each entry is `{keyId, alg: "ed25519", publicKey}`, where `publicKey` is the raw 32-byte key **base64url, unpadded — not PEM**.

Without it your signature attests **integrity only**: it proves the bundle was not altered after signing and proves nothing about who signed it, because a signer can mint a keypair and a key id at will.

- **Store the private half durably before publishing the public half**, and verify the stored secret round-trips to exactly the published value rather than assuming the write was faithful. A published key whose private half evaporated strands every bundle signed under that `keyId`, silently.
- **Verify the bytes import as a real Ed25519 key**, not merely that they are 43 base64url characters. A plausible string that is not a valid curve point passes every shape check and fails only at a verifier.

**4.1b Check whether your seams EXIST before planning when to mount them.** Several scenarios need a canonical seam under `/conformance/seams/…` to establish a precondition. A host whose test hooks live in its own extension namespace has *different* seams, not unmounted ones — and advertising the seams profile would claim routes that answer `404`. **"Not mounted" is a deployment choice; "not built" is a build task.** Recording the second as the first turns an unwritten feature into a schedule.

**4.2 Emit bundle v3.** An unsigned v3 bundle does not exist; `--certify` refuses to write anything without a build identity and a signing key. **Use an image digest or artifact hash as the build identity, not a commit** — a merge is a promise, only a deployment is a witness.

**4.2b A major-2 bundle is cut by the upstream CLI, against the deployed revision, with a key that is not in git.** Both production hosts measured this on the same evening. A host's own certify script is a v1 lane (`bundleVersion: '2'` hard-coded, no `--target-major`), so the evidence Phase 4 needs is producible only by `@openwop/openwop-conformance --certify --target-major 2` from the published suite. The signature binds `discovery.sha256` and `host.build`, so the bundle MUST be cut **after** deploy, against the revision that is serving — a bundle cut against a local boot attests a build nobody can reach. The private signing half lives outside the repository (a secret store the deployer reads at certify time), and the public half is what `signingKeys[]` publishes; verify the two round-trip before the first cut. The ritual is: deploy → verify the serving revision by `percent == 100` → run the upstream CLI at major 2 against it → read the dispositions.

**4.2c Count what witnesses, not what passes.** Fifty-three of fifty-five v2 files "passed" on one host; **thirty-four** executed an assertion. The other nineteen were seam-gated and soft-skipped `blocked` — a ✓ that is a statement about the gate, not the host. RFC 0167 §G.2's Coexistence gate names `fork-a-v1-run`, which is one of the nineteen, so the seams surface (§4.1b) is on the corpus's critical path, not only on yours. Report the executed count beside the pass count, always.

**4.3 Read the dispositions, not the exit code.** See "Verify the artifact" below.

**4.3b A clean lane is evidence about the requirements the lane RAN, and nothing else.** A bundle at `--target-major 1` reporting `executedFail: 0` is silent about every major-2 scenario — including ones that fail the host three ways. A host called such a run "the first fully clean lane of the day" and then corrected itself, because the scope of the zero is invisible in the zero.

> **The danger of a green bundle is not that it lies. It is that its scope is invisible in the number.** `executedFail: 0` and `inapplicable: 206` are the same sentence, and only one of them gets quoted.

Record the target major and the applicable set beside any total you intend anyone to read.

**4.4 Report `certified: none` honestly** if your floors are unmet. A bundle that says it certifies nothing, accurately, is worth more than one tuned until it says otherwise.

---

## Verify the artifact, not the wrapper

The single most expensive habit to unlearn:

```sh
some-long-command > lane.log 2>&1; echo "EXIT=$?"     # ← proves nothing
```

Observed failures of exactly this pattern, in one working day:

| what happened | what the wrapper reported |
|---|---|
| certification exited **2**, wrote no file | `0` |
| lane killed by the OOM/load killer, exited **137** | `0` |
| lane exited **1** and wrote a **valid bundle** | `1` — and the code was still the wrong thing to read |

The exit code is precisely the thing a kill destroys, so logging it fails silently in the case you most need it — and a non-zero code does not imply no artifact either, so the check is wrong in **both** directions.

**Ask instead:** did the file appear? Does it validate? Is the deployed revision serving what you think? Those are checkable.

**Verify in the environment the artifact will actually RUN in — "on a live boot" is not enough.**

Measured: a change resolved a package path at module scope. `tsc` passed. A live **local** boot passed. **The production image would not have started at all** — the package is a `devDependency` and the runtime stage installs with `--omit=dev`, so the resolve throws at import time, before the server listens. Not a degraded feature: no boot, every instance.

A dev tree has devDependencies installed. The image does not. **That verification was structurally incapable of seeing the failure, and looked exactly like verification that could.** Check inside the runtime stage, or against a deployed revision.

> And read the files next to the one you are editing. That repo had already measured this exact mechanism on a sibling package and written it down two files away. **The knowledge was adjacent and unread.**

The same rule applies to publishing: a green publish job is a wrapper claim. A registry `404` immediately after a successful publish is indistinguishable from a failed publish — propagation ran 2 to 9 minutes in practice. **Read the job log for the confirmation line before raising an alarm.**

---

## Deploy notes

- **Read the serving revision by traffic percentage, never by index or "latest ready".** On Cloud Run, `status.latestReadyRevisionName` returns the most recently *ready* revision — which a 0%-traffic tagged revision satisfies. The serving revision is the traffic entry at `percent === 100`. Two sessions independently reported the wrong revision from that field on the same day; one of them drew a correct conclusion from it **by luck**, because both candidate revisions happened to predate the thing being checked.
- **Writing a secret is a promise; a revision serving it is the witness.** A secret reference resolved as `latest` is resolved **once, at revision start**. Appending a new version does nothing until something redeploys — the credential returns `401`, which reads exactly like a missing credential.
- **Backend first, then frontend**, if you serve both.
- **Redeploy a content-identical half rather than leave build stamps disagreeing.** It feels wasteful. It is not: a verifier that reports "frontend MISMATCH ← someone else's deploy is live" *falsely and permanently* sends the next operator hunting a parallel deployer who does not exist. **A gate that cries wolf once gets ignored the time it is right.**
- **Re-read traffic after the build, before promoting.** The build is minutes long; that is the window in which something moves under you.
- **Confirm the change on the wire by measuring the delta**, not the value: fetch the outgoing revision and the incoming one and diff them. Observing that a field is `3` is weaker than observing it was absent and became `3`.

---

## Two ways a requirement goes unenforced, and they look the same from inside

Both were measured on real hosts in one afternoon, and neither produced an error anywhere.

**A requirement that lives only in a JSON Schema `description` has no witness and no `MUST`.** The event `sequence` field said *"first event is 0"* since v1. No prose stated it; no scenario asserted it across the entire v1 line. One host was 1-based for the life of the product and **could not have been told, because nothing was capable of telling it**. Of two independent hosts, the one that got it right did so by luck of implementation.

**A parameter that is accepted and ignored produces the same silence.** A host still serving the v1 cursor name, with a permissive request schema, accepted the v2 `afterSequence` and discarded it — returning `200` with a full replay of the log on every poll. A client resuming from a cursor loops forever and nothing errors.

> **A parameter accepted and ignored, and a requirement written and unasserted, are the same failure seen from two sides.** The host cannot distinguish either from working, and neither can its operator.

The defence is the same in both cases and it is not "write it down more carefully": **assert the effect, not the acceptance.** Check that the cursor *excluded* rows, not that the field was tolerated. Check that the first sequence *is* what the contract says, not that the field exists. A check on an effect cannot be satisfied by a permissive parser or by prose nobody reads.

**A third shape, found the same day by both hosts: a scoped signal quoted as if it were unscoped, with the scope nowhere in the output.** A preflight tool answered *"competing: none"* at load 146, because it enumerated one repo's worktrees and looked for one process shape — it was right about the set it could see and wrong about the machine. A harness reported exit `0` over a real exit `1` five times in a day. `executedFail: 0` was true at one target major and quoted as if true of the host. In every case the instrument measured something real and the reader took it for something larger, and nothing in the output said which. A fourth instance, from a deploy: a root `typecheck` that carried **no project reference to the service being deployed** passed, the suite passed (the new mount's discovery branch was never exercised), lint passed, and the image failed at `esbuild` fifteen minutes into a remote build on an import of a module-private symbol — the bundle step was the only gate that looked at the tree the image is built from. Run the exact bundle command locally before any deploy; a green typecheck is a statement about the projects it references. A fifth, from a red rather than a green: a `set -euo pipefail` gate script with the conformance lane ahead of the frontend lanes exited 1 on a known conformance artifact in every full run of a day — so **the frontend lanes never executed once**, and the exit code, already discounted as "the known red", was also hiding every lane after it. *"The lane never ran"* and *"the lane passed"* print identically in a summary that only lists what failed. A known red early in a sequential gate is not merely noise; it is a curtain. **When a signal is green, ask what it was scoped to before you ask what it proves — and when it is a red you have learned to ignore, ask what it is standing in front of.** A tool that answers a shared question from a private vantage is not merely incomplete; two sessions running it get the same false answer simultaneously and both act on it.

And one rule for the guards you write in response, in the tier-2 host's words after auditing its own inbound paths: **"not-exploitable-because-of-something-else is a coincidence, not a control."** A tenant-segment check that only *happens* to be safe because a downstream SQL layer binds parameters is not holding the property — the code that states the rule has to be the code that holds it. The host found this by applying the sabotage pair (break it each way; confirm both redden with disjoint sets) to a guard it had shipped an hour earlier, and finding it covered the sites where the bug had been found rather than every site that consumes an id. **A guard that covers the paths someone enumerated has the same shape as the projection that covered "both JSON senders."**

---

## Open items a third host should expect

- `keyId` is documented as registry-minted, but self-tier attribution only needs a host to vouch for its own key. Minting a local id is currently the honest thing to do at `self` tier; a registry mint is what `independent` tier will need.
- Certification refuses with one message for two different states — "a claimed profile has UNCLASSIFIED floor requirements" prints when **nothing ran**, which reads as forty failures.
- **Suite versions `2.0.0-rc.20` through `2.0.0-rc.28` are permanently uninstallable** — each pins a `spec-artifacts` peer that was never published, and npm versions cannot be repaired. `rc.29` is the floor. Do not reach for `--legacy-peer-deps` to get past the `ERESOLVE`: it **silently skips the peer**, after which the suite refuses to start on a corpus-stamp mismatch and you have traded a loud failure for a quiet one. Since #1231 a conformance tag publishes both packages together and verifies the result from an empty directory; the trailing `verify-installable` job is the one that speaks for consumers.
- Verify any install **from outside a checkout** — `cd "$(mktemp -d)" && npm init -y && npm install @openwop/openwop-conformance@<v>`. Inside a checkout the peer resolves from the monorepo whether or not it exists on npm, and every gate in the repo is blind to the difference.

---

## See also

- `spec/v2/core/persistence.md` — era key, reader and writer rules, the coexistence table
- `spec/v2/core/versioning.md` — the overlap rule and header grammar
- `spec/v2/core/conformance.md` — bundle v3, signature attribution
- RFC 0167 §F — the ten cut-gate predicates, rendered by `scripts/check-cut-gates.mjs`
- `examples/hosts/v2-reference` — a host written from the spec rather than from v1 host code
