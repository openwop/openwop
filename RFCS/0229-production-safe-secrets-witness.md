# RFC 0229: a production host can witness secret resolution without an oracle

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0229                                                            |
| **Title**         | a production host can witness secret resolution without an oracle |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-29                                                      |
| **Updated**       | 2026-09-29 — filed `Draft`. The 7-day comment window opens with the pull request and closes 2026-10-06. The window is **not** waived: this RFC touches certification and secret material, so RFC 0147 §A.6 bars a bootstrap waiver. The maintainer approved drafting it (openwop #1686 follow-up). |
| **Affects**       | `spec/v1/run-options.md` and `schemas/v2/run-options.schema.json` (an optional `runSecrets` on `createRun`) · `spec/v1/capabilities.md` §secrets and the `secrets` record of `schemas/capabilities.schema.json` (the `runSecrets` facet; the v1 seed, derived into `schemas/v2/capabilities.schema.json`) · `spec/v2/core/host-services.md` §`secrets` · `conformance/fixtures.md` (new `openwop-secrets-run-witness`) · `spec/v1/profiles.md` §`openwop-secrets` (a second floor path) · `spec/v2/declaration.json` (`secrets` requirement ids) · new scenarios `secrets-run-witness` (v1) and `v2-secrets-run-witness` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2): a new optional request field, a new facet, a new node type and fixture, and a second way to satisfy an existing floor. Nothing changes for a host that advertises none of it. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A host that advertises `secrets` cannot certify the v1 `openwop-secrets` profile unless it advertises the `openwop-smoke-byok-roundtrip` fixture. That fixture runs `conformance.secret.echo`, which resolves a secret the workflow names and returns its SHA-256 and length. A production host is right to withhold it, because a node that hashes a caller-named secret is an oracle over whatever that name reaches. This RFC gives such a host a witness it can run in production. The client supplies a high-entropy value with the run (`runSecrets`), under a reserved `run:` name that resolves only to values supplied with that same run. A new node, `core.secret.witness`, confirms the value arrived intact by comparing its digest with one the client already holds, and outputs only a boolean. The suite then checks that the value appears on no readable surface, in any common encoding. The witness proves resolution and redaction of a value the suite chose, never discloses anything about a stored secret, and becomes a second way to meet the `openwop-secrets` floor and the first requirement for the v2 `secrets` family.

## Motivation

**The floor is unreachable on production, correctly.** The `openwop-secrets` floor (`profiles.md`, RFC 0148 §C) is `byok-roundtrip.test.ts`, which needs `openwop-smoke-byok-roundtrip` (`fixtures.md`). That fixture's node resolves `config.secretId` and writes `{secretSha256, secretLength}` to the run. A host that withholds it records the floor `blocked` (RFC 0148 §A; #1686, #1708, #1812), so openwop-app's production major-1 cut cannot hold `openwop-secrets`. The two other ways out are both wrong:
- recording `inapplicable` would certify a floor that never executed;
- advertising the fixture on production exposes the oracle.

**The current design is an oracle by construction.** The secret the node resolves is named in the workflow, and its hash and length go to anyone who can read the run.
- Where the name can reach a stored secret, the node answers "is this secret equal to my guess?" offline, and leaks its length.
- The fixture contract fixes the name to the canary, but a node module registered on a host does not know that it was invoked by the fixture.

Measured in September 2026 on the three hosts:
- **The v1 reference hosts:** safe only because their resolver knows nothing but the canary.
- **Both production hosts:** gate the node behind a deployment flag, and whether a name can reach anything but the canary depends on the host's resolver chain.

The problem is the shape, not one host. A witness whose safety depends on each host's resolver configuration is not a witness a production host should be asked to run.

**What the current fixture actually proves is weak.** `byok-roundtrip` checks four things:
- the run completes;
- `secretSha256` matches `^[0-9a-f]{64}$`;
- `secretLength > 0`;
- no `value` / `password` / `plaintext` / `raw_secret` key appears next to the hash.

The suite does not know the canary, so it never checks that the hash is the canary's. Any 64-hex string passes. The redaction check looks for four key names; it does not look for the value.

**v2 has no witness at all.** The `secrets` family is `witnessable-gated` with no floor scenario and no requirement id (`spec/v2/declaration.json`). `host-services.md` §`secrets` says raw key material "MUST NOT appear in any event, log, trace, prompt, error, export or screenshot, and the host MUST test this before exposing BYOK". Today no scenario runs that test for a host.

## Proposal

### §A. Run-supplied secrets (`runSecrets`)

A host that advertises the `secrets` facet `runSecrets` (§D) accepts an optional `runSecrets` on `createRun`: an array of `{ ref, value }`.

1. `ref` MUST match `^run:[A-Za-z0-9_.-]{1,64}$`. `value` is a string of 16 to 4096 characters. The array holds at most `runSecrets.maxEntries` entries, and a `ref` appears at most once. A request that breaks any of these MUST be refused `400 validation_error`, naming the field and never the value.
2. **Resolution is bound to the run.** A `run:` ref MUST resolve only to a value supplied in the `runSecrets` of the run that is resolving it. It MUST NOT resolve from any other scope or source: another run, user, tenant, workspace, platform, or the host process environment. A `run:` ref that the run did not supply MUST fail `credential_not_found`.
3. **No shadowing.** A ref without the `run:` prefix MUST NOT resolve to a `runSecrets` value. A client therefore cannot use `runSecrets` to replace a credential the workflow names, and a stored credential cannot be reached through a `run:` name.
4. **Lifetime.** The host MUST NOT write a `runSecrets` value to any store that an operator or client can read in cleartext, and MUST discard it by the time the run is terminal. A fork or replay of the run does not inherit it: a `run:` ref in the fork fails `credential_not_found`.
5. **Redaction.** The value is a resolved secret at run scope, so every rule that already binds such a value applies to it: `host-services.md` §`secrets` and the §Memory redaction rules at v2, `observability.md` §Redaction at v1. In addition, the host MUST NOT echo it on any response. That includes the `createRun` answer, the run snapshot, and any `runSecrets` field a read returns; a read MAY return the `ref`s.
6. **Transport.** The host MUST NOT log the `createRun` request body's `runSecrets` values, including in request, access or error logs.

### §B. The witness node (`core.secret.witness`)

A host advertising `runSecrets` MUST execute the node type `core.secret.witness`. Its configuration is `{ ref, expectedSha256 }`, and the fixture (§C) supplies both from run inputs.

1. When `ref` does not begin with `run:`, the node MUST fail with `credential_forbidden` without resolving anything. It witnesses only a run-supplied value.
2. Otherwise it resolves `ref` under §A.2, failing `credential_not_found` when the run did not supply it. It computes the lowercase-hex SHA-256 of the value's UTF-8 bytes, and outputs `{ matched: <that digest equals expectedSha256> }`.
3. The node MUST NOT output, log or emit the value, its digest, its length, or any other function of it beyond `matched`.

### §C. The fixture (`openwop-secrets-run-witness`)

One node, `witness`, of type `core.secret.witness`, taking `ref` and `expectedSha256` from the run's `inputs`. A host advertising `runSecrets` MUST advertise it. It is safe to advertise in production, because by §A and §B it can only confirm a value the caller already holds.

### §D. Advertisement

- **v2:** a `secrets` facet `runSecrets: { maxEntries: integer ≥ 1 }`. It is written in the `secrets` record of the v1 seed `schemas/capabilities.schema.json` and derived into `schemas/v2/capabilities.schema.json`, as the family's other facets are.
- **v1:** the same object at `capabilities.secrets.runSecrets` (`capabilities.md` §secrets).

In both majors the facet is optional, and its absence means "`createRun` does not accept `runSecrets`". An advertising host MUST also advertise the `run` member of `secrets.scopes`.

### §E. The floor

- **v1:** `profiles.md` §`openwop-secrets` gains a second floor path. A host is certified when the discovery predicate holds and **either** `byok-roundtrip.test.ts` **or** `secrets-run-witness.test.ts` records a witnessed pass. The canary path stays for hosts that keep it. The run-witness path is the one a production host can take.
- **v2:** the `secrets` family's `requirementIds` gain the three §F rows. There is no v2 `openwop-secrets` profile, and this RFC adds none.

### §F. Conformance

The leg lives in `secrets-run-witness` (v1) and `v2-secrets-run-witness` (v2), gated on the `runSecrets` facet.

The suite draws a fresh value `C` for each run: 48 bytes from a CSPRNG, base64url-encoded (64 characters), with no fixed prefix. It supplies `C` as `runSecrets: [{ ref: "run:openwop-witness", value: C }]`, and passes `expectedSha256 = sha256(C)` and the `ref` as run inputs. Three requirements:

1. **`openwop.requirement.secrets.run-witness-resolves`.** The run completes, and `witness`'s output is `{ matched: true }`.
   - A second run passes an `expectedSha256` for a different value and must complete with `matched: false`.
   - That second run is what binds the witness to the exact bytes. The current fixture checks only that some 64-hex string came back.
2. **`openwop.requirement.secrets.run-witness-redacted`.** After each run is terminal, `C` appears in none of the following:
   - the `createRun` response and the run snapshot;
   - every event, read under the most verbose stream mode the host serves (`debug` at v2);
   - node outputs and variables;
   - the run's entry in `listRuns`, where served;
   - the debug bundle, where advertised;
   - any error body the runs produced.

   "Appears" is checked in every one of these forms:
   - raw `C`;
   - standard and URL-safe base64 of `C`'s bytes, with and without padding;
   - lowercase and uppercase hex of `C`'s bytes;
   - the percent-encoded form;
   - JSON-string-escaped `C`;
   - `sha256(C)`.

   The last one matters: the digest is itself an output §B.3 forbids.
3. **`openwop.requirement.secrets.run-witness-scope-bound`.** Each of these must end in `node.failed`, with the code shown:
   - a run whose `ref` is `openwop-conformance-canary-secret` or a fresh random name without `run:` fails `credential_forbidden`;
   - a run that passes `run:openwop-witness` but supplies no `runSecrets` fails `credential_not_found`;
   - a run that passes the `ref` supplied to an **earlier** run fails `credential_not_found`.
   - where `replay` is advertised, a `branch` fork of the first run taken before `witness` fails `credential_not_found` (§A.4: a fork does not inherit `runSecrets`).

   A pass here is the observable half of "this witness is not an oracle".

**Dispositions.**

| Condition | Disposition |
| --- | --- |
| `runSecrets` not advertised | `inapplicable`: the host offers no run-supplied secrets |
| `runSecrets` advertised, fixture not advertised | `blocked`: §C requires it |
| `createRun` refuses a well-formed `runSecrets` | `executed-fail` |

§A.6 (no logging) is not witnessable from outside; the table below says so.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 bounds and grammar refused `400` | a malformed `runSecrets` answers `400 validation_error` without the value | the suite, unaided | witnessable — gated (`runSecrets`) |
| §A.2 a `run:` ref resolves only to this run's value | an unsupplied or earlier-run `run:` ref fails `credential_not_found` | the suite, unaided | witnessable — gated |
| §A.3 no shadowing | a non-`run:` ref at the witness fails `credential_forbidden`; through §A.2 no stored secret is ever witnessed | the suite, unaided | witnessable — gated (at the witness node; a general-purpose node's resolution is not observable without its effect) |
| §A.4 lifetime, not inherited by a fork | a fork's `run:` ref fails `credential_not_found` | the suite, via `replay` / `:fork` | witnessable — gated (`runSecrets` and `replay`) |
| §A.4 not stored in cleartext | — | operator only | **unwitnessable from outside**: storage is not observable; audit and the host's own tests |
| §A.5 redaction and no echo | `C` absent on every readable surface, in every encoding | the suite, unaided | witnessable — gated |
| §A.6 not logged | — | operator only | **unwitnessable from outside**: host logs are not a protocol surface |
| §B.1–§B.3 the witness's behaviour | `matched` true and false as expected; `credential_forbidden` on a non-`run:` ref; no digest or length on any surface | the suite, unaided | witnessable — gated |
| §C the fixture is advertised with the facet | discovery lists `openwop-secrets-run-witness` | the suite, unaided | witnessable — gated |

### §G. Security argument

The attacker considered here holds the suite's credentials: an API key that can create runs of the fixture and read them, in the tenant the key is bound to. That is the strongest principal the leg needs.

**What they can do:**
- Supply values of their own choosing, and learn whether the host's digest of each equals a digest they computed. This is a fact about their own input.
- Learn that the host implements run-scoped resolution.
- Cause a bounded number of short runs, each of at most `maxEntries` values of at most 4096 characters. That load is the same as any `createRun`.

**What they cannot do:**
- **Learn anything about a stored secret.** The witness resolves only `run:` refs (§B.1), a `run:` ref resolves only to values supplied with the same run (§A.2), and no stored secret carries a `run:` ref (§A.3). There is therefore no input that makes the node read a user, tenant, workspace, platform or environment secret. The current fixture has no such bound. This is the property that makes the node safe to register in production.
- **Learn another run's supplied value.** It is not persisted in cleartext, discarded at terminal, and not inherited (§A.4). An earlier run's `ref` fails `credential_not_found` (§F.3).
- **Replace a workflow's real credential.** A `runSecrets` value never answers a non-`run:` ref (§A.3). Supplying `run:anthropic_api_key` changes nothing about what `anthropic_api_key` resolves to.
- **Read a value through the run's audience.** A viewer of the run sees `matched` and nothing else: no digest, no length (§B.3). The current fixture gives every run viewer the digest and length of the resolved secret.

**What remains for the host:**
- **Transport.** The value crosses the wire in the `createRun` body. §A.6 forbids logging it, but a host whose request-logging middleware captures bodies would violate that, and no suite can see it. This is the same exposure every BYOK key already has on the host's own secret-upload route. The RFC adds no new class, and says the residual is operator-audited.
- **Reveal endpoints.** Both production hosts expose an operator-only route that returns a stored secret's value. This RFC neither uses nor constrains them: the witness never stores `C` anywhere they could reach.
- **A real key supplied as a run secret.** A client may choose to send a real credential through `runSecrets` for ordinary BYOK use. Every rule above still binds, and the witness still outputs only `matched`.

RFC 0147 §A.6 applies, because the RFC touches certification (a floor) and secret material. The comment window is therefore run in full and not waived.

## Compatibility

**Additive.** The pieces are all optional:
- `runSecrets` on `createRun`: a v2 request that omits it is unchanged, and a host that does not advertise the facet is not required to accept it;
- the facet, the node type and the fixture;
- a second floor path that can only make a host certifiable, never uncertifiable.

**The v1 and v2 request schemas gain an optional property.** v2 `createRun` is closed (`unevaluatedProperties: false`), so a v2 host that does not advertise `runSecrets` MAY answer a request carrying it `400 validation_error`, exactly as for any unknown field. A client MUST NOT send `runSecrets` to a host that does not advertise it.

**`byok-roundtrip` is unchanged**, and a host that certifies through it still does.

## Alternatives considered

1. **Keep the canary fixture, and require hosts to pin the echo node to the canary name.** This keeps the digest and length on every run viewer's screen. It also rests the safety of a production node on each host's resolver configuration, which is the property measured to fail. Rejected.
2. **A conformance tenant whose test credentials alone can create and read a canary.** The hosts do not share a definition of a test credential:
   - one distinguishes keys by prefix or mode;
   - one by tenant binding and a seam flag;
   - the reference host by environment-configured keys.

   Defining one would be a larger RFC than this. The canary would also still be a stored secret, reachable by name. Rejected in favour of run scope, which every host already names in `secrets.scopes`.
3. **Prove use by egress.** A node sends `Authorization: Bearer C` to a suite-owned receiver, and the receiver checks the header. This proves the value was *used*, not just resolved. However:
   - it needs `httpClient` / `egressPolicy` and a public receiver;
   - it makes the witness depend on the egress guard admitting the suite's receiver;
   - it sends a secret to an external party by design.

   Deferred to a follow-up as an optional second leg (see Unresolved question 2).
4. **Output the digest instead of a boolean.** The suite knows `C`, so a digest output would work just as well for the suite. But it gives every run viewer a digest of whatever was supplied, including a real key sent through `runSecrets`. Rejected: the boolean witnesses the same fact and discloses nothing.
5. **Do nothing.** Production hosts never certify `openwop-secrets`, v2 `secrets` stays unwitnessed, and hosts that want the badge have to advertise an oracle. Rejected.

## Unresolved questions

1. **Placement of `runSecrets`.** One production host already accepts run-scoped secrets as `configurable.runSecrets`. A top-level `runSecrets` keeps secret material out of `configurable`, which hosts persist and echo. `configurable.runSecrets` would match existing code. Maintainer input is wanted before `Active`.
2. **Should an egress leg follow?** It would witness *use* as well as *resolution* (Alternative 3), gated on `httpClient` and an operator-supplied receiver, as the webhook legs are.
3. **Should the v1 canary path be deprecated** once a production host certifies through the run-witness path? This RFC keeps it, because a test host may prefer it.

## Implementation notes (non-normative)

**The suite.**
- `PROFILE_FLOOR_SCENARIOS['openwop-secrets']` needs an any-of group (`byok-roundtrip.test.ts` or `secrets-run-witness.test.ts`). The table has `required` and `requiredAnyPrefix` today, so an `requiredAnyOf` form is the smallest change. `describe-level-skip.test.ts` then covers both files as floors.
- The scan for `C` should run over the raw response bytes, not parsed JSON. An escaping difference must not hide a hit.

**The v2 reference host.** It has no `secrets` family. Implementing only run scope (this RFC's surface) would make it the reference witness, with no store behind it.

**Where hosts stand today:**
- One production host already has run-scoped secrets that are stripped before persistence, and a seam that hashes a caller-supplied canary. It is close to §A.
- The other already reserves ref namespaces and has run scope.

Both need the `run:` binding, the witness node and the facet.

## Acceptance criteria

- [ ] `Active`: the comment window closes (2026-10-06) with no unresolved objection. Then the spec text (§A–§E) lands in `run-options.md`, `capabilities.md`, `host-services.md`, `fixtures.md` and `profiles.md`, together with the schemas, facet and declaration rows.
- [ ] The two scenarios ship in a suite minor, with a negative control. A host whose witness resolves a non-`run:` ref must fail `run-witness-scope-bound`, and a host that echoes `C` must fail `run-witness-redacted`.
- [ ] `Accepted`: all three requirement ids `executed-pass` on a committed certified bundle from a host whose deployment is production (not a test posture). This is the property the RFC exists for.

## References

- openwop #1686, #1708, #1812: the `blocked` disposition for a withheld canary, and why it is correct.
- RFC 0148 §A, §C (dispositions, floors); RFC 0147 §A.6 (no waiver for certification and secrets RFCs).
- `conformance/fixtures.md` §`openwop-smoke-byok-roundtrip`; `conformance/src/scenarios/byok-roundtrip.test.ts`.
- `spec/v1/profiles.md` §`openwop-secrets`; `spec/v1/capabilities.md` §secrets; `spec/v1/run-options.md`.
- `spec/v2/core/host-services.md` §`secrets`; `spec/v2/declaration.json` (`secrets`).
- `SECURITY/threat-model-secret-leakage.md` §SR-1.
