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

## Phase 1 — The wire, first

**Land the dual-stack advertisement before anything else.** This ordering is not aesthetic. Every v2 conformance scenario reaches the host through v2 discovery, so until the v2 root exists, **nothing you build can be witnessed** — you would be writing migration code with no way to tell whether it works.

An adversarial review of the original plan caught this as an ordering inversion: the identity work had been scheduled before the wire, and all four of its "unaided" scenarios read the v2 root.

1. Advertise both majors in `protocolVersions[]`.
2. Keep `preferredVersion` on the **1.x** member. While `protocolVersions[]` carries any 1.x member, a header-less request MUST still get the v1 representation (`versioning.md` §1.1). This is what makes every step up to the flip invisible to existing clients, and therefore reversible.
3. Honor `OpenWOP-Version` — **or refuse it with `406`. Never ignore it.**

> **The trap.** A host that returns `200` with the v1 document to `OpenWOP-Version: 2` is invisible to every presence-gated scenario in the suite: a scenario that skips when a v2 shape is absent records `inapplicable` whether the host *refused* major 2 or *silently handed back v1*. Both are non-failures, so the bundle looks clean while witnessing nothing.
>
> This is not hypothetical. It is the shape that let an RFC sit `Accepted` on a host serving none of it. **Verify by fetching the resource twice, with and without the header, and comparing bytes.** A host advertising two majors that returns identical bytes for both has advertised a major it does not serve.

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

**4.2 Emit bundle v3.** An unsigned v3 bundle does not exist; `--certify` refuses to write anything without a build identity and a signing key. **Use an image digest or artifact hash as the build identity, not a commit** — a merge is a promise, only a deployment is a witness.

**4.3 Read the dispositions, not the exit code.** See "Verify the artifact" below.

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

The same rule applies to publishing: a green publish job is a wrapper claim. A registry `404` immediately after a successful publish is indistinguishable from a failed publish — propagation ran 2 to 9 minutes in practice. **Read the job log for the confirmation line before raising an alarm.**

---

## Deploy notes

- **Backend first, then frontend**, if you serve both.
- **Redeploy a content-identical half rather than leave build stamps disagreeing.** It feels wasteful. It is not: a verifier that reports "frontend MISMATCH ← someone else's deploy is live" *falsely and permanently* sends the next operator hunting a parallel deployer who does not exist. **A gate that cries wolf once gets ignored the time it is right.**
- **Re-read traffic after the build, before promoting.** The build is minutes long; that is the window in which something moves under you.
- **Confirm the change on the wire by measuring the delta**, not the value: fetch the outgoing revision and the incoming one and diff them. Observing that a field is `3` is weaker than observing it was absent and became `3`.

---

## Open items a third host should expect

- `keyId` is documented as registry-minted, but self-tier attribution only needs a host to vouch for its own key. Minting a local id is currently the honest thing to do at `self` tier; a registry mint is what `independent` tier will need.
- Certification refuses with one message for two different states — "a claimed profile has UNCLASSIFIED floor requirements" prints when **nothing ran**, which reads as forty failures.
- Installing the suite may require `--legacy-peer-deps`, which **silently skips the `spec-artifacts` peer**, after which the suite refuses to start on a corpus-stamp mismatch. Name the peer explicitly rather than relying on the flag.

---

## See also

- `spec/v2/core/persistence.md` — era key, reader and writer rules, the coexistence table
- `spec/v2/core/versioning.md` — the overlap rule and header grammar
- `spec/v2/core/conformance.md` — bundle v3, signature attribution
- RFC 0167 §F — the ten cut-gate predicates, rendered by `scripts/check-cut-gates.mjs`
- `examples/hosts/v2-reference` — a host written from the spec rather than from v1 host code
