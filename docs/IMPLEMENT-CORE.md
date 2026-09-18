# Implement a conforming OpenWOP host

> **Read this instead of the corpus.** v2 is the current protocol major
> (`spec/v2/README.md`; corpus tag in `spec/v2/release.json`), and a new host
> targets it. The normative v2 text is **twenty documents in `spec/v2/core/`**,
> held under a 25,000-word budget by `scripts/check-core-budget.mjs`. Everything
> under `spec/v2/ext/` is an extension you may ignore until you want it.
>
> The size of the corpus, not its content, has been the main barrier to an
> independent implementation, and an independent implementation is the one thing
> the protocol most needs. If anything here is wrong or under-specified for a
> real implementer, that is a defect worth a PR.
>
> **Implementing v1 instead?** v1 is the maintained parallel track until v1
> end-of-support (`spec/v2/core/overview.md` §"v1 end-of-support"). The v1 bar is
> [`spec/v1/core-standard-profile.md`](../spec/v1/core-standard-profile.md) and
> [`spec/v1/core-standard-manifest.json`](../spec/v1/core-standard-manifest.json);
> the v1 documents this page used to point at are
> [`rest-endpoints.md`](../spec/v1/rest-endpoints.md),
> [`capabilities.md`](../spec/v1/capabilities.md),
> [`stream-modes.md`](../spec/v1/stream-modes.md),
> [`interrupt.md`](../spec/v1/interrupt.md) and
> [`idempotency.md`](../spec/v1/idempotency.md) §A. Run the suite with `--target-major 1`.

## What conformance actually requires

A v2 profile is a predicate over the declaration file, published in
[`spec/v2/profiles.json`](../spec/v2/profiles.json). There is no `profiles[]`
field on the v2 discovery root; the suite derives your profiles from which
families you advertise (`spec/v2/core/capabilities.md` §7). Two profiles matter to
a new host:

| Profile | Predicate | Floor scenarios |
| --- | --- | --- |
| `openwop-discovery-core` | metadata `protocolVersions`, `preferredVersion` | 3: `v2-capabilities-root-closed`, `v2-preferred-version-default`, `v2-version-header-honored` |
| `openwop-core-standard` | families `interrupt`, `replay`, `webhooks`, `idempotency`, `eventLog` | 13: `v2-interrupt-token-scheme`, `v2-effect-seam-manifest`, `v2-webhook-durable-delivery`, `v2-idempotency-key-grammar`, `v2-era-key`, `v2-era-stamp-universal`, `v2-event-type-closed`, `v2-poll-cursor-v2`, `v2-run-cancel`, `v2-run-bulk-cancel`, `v2-run-pause-resume`, `v2-run-options-limits`, `v2-sse-last-event-id` |

`overview.md` §"Profile claim vocabulary" fixes what a claim means: an
unqualified "OpenWOP conformant" statement MUST mean `openwop-core-standard`, and
a discovery-only claim MUST say `openwop-discovery-core`. The alias
`openwop-core` is deleted in v2.

**The v2 floor is larger than the v1 floor.** In v1, replay, fork and webhooks
were optional for core-standard. In v2 the predicate names `replay` and
`webhooks`, and advertising a surface binds its security behaviour
(`security-defaults.md` §"The rule"): a `replay` host MUST suppress external
effects during a replay fork and publish `GET /host/effect-seams`; a `webhooks`
host MUST retry, dead-letter and deliver at least once. If you are not ready for
that, `openwop-discovery-core` is the honest smaller claim.

Two v1 floor rows have no v2 floor scenario of their own: `auth` (cross-tenant
refusal) and `failure-path`. The obligations still bind — tenant isolation in
`identity.md` and `security-defaults.md`, the terminal `error` object in
`runs.md` §Snapshot — but `profiles.json` does not list a floor scenario for them.

## The documents you need

`overview.md` §"Reading order" is the authoritative order. For the
`openwop-core-standard` floor, read these, all in `spec/v2/core/`:

1. **[`overview.md`](../spec/v2/core/overview.md)** — axioms, the closed-enum growth rule, the claim vocabulary.
2. **[`versioning.md`](../spec/v2/core/versioning.md)** §1 — `protocolVersions[]`, `preferredVersion`, the `OpenWOP-Version` header, and the path rule: v2 operations are unversioned (`/runs`, not `/v2/runs`).
3. **[`capabilities.md`](../spec/v2/core/capabilities.md)** §1–§3, §7 — one well-known resource, the capability record, the closed root.
4. **[`runs.md`](../spec/v2/core/runs.md)** — the run surface table, create, snapshot, cancel, pause/resume, fork.
5. **[`events.md`](../spec/v2/core/events.md)** — the closed event envelope, `sequence`, the SSE channel, the poll cursor, era-2 logs.
6. **[`errors.md`](../spec/v2/core/errors.md)** and **[`headers.md`](../spec/v2/core/headers.md)** — one registry of codes (`spec/v2/errors.json`) and every `OpenWOP-*` header.
7. **[`interrupt.md`](../spec/v2/core/interrupt.md)**, **[`idempotency.md`](../spec/v2/core/idempotency.md)**, **[`replay.md`](../spec/v2/core/replay.md)**, **[`webhooks.md`](../spec/v2/core/webhooks.md)** — the four families the predicate names besides `eventLog`.
8. **[`identity.md`](../spec/v2/core/identity.md)** — the Subject that owns every run and the tenant-bound id grammar (§5).
9. **[`security-defaults.md`](../spec/v2/core/security-defaults.md)** — the obligation table; what advertising each surface binds.

`persistence.md` matters as soon as you store events; `conformance.md` matters
when you produce a bundle. The machine contract is
[`api/v2/openapi.yaml`](../api/v2/openapi.yaml),
[`api/v2/asyncapi.yaml`](../api/v2/asyncapi.yaml) and
[`schemas/v2/`](../schemas/v2/); the operation list is
[`spec/v2/path-manifest.json`](../spec/v2/path-manifest.json).

## What you can ignore, and for how long

| Surface | Ignore until |
| --- | --- |
| Agents, roster, org chart, memory, prompts | You want agents. Their families are optional records in `capabilities.md` §5. |
| Packs (`packs.md` and the three per-kind pack documents) | You want third-party code in your runs. Advertising `packs` binds the sandbox invariants (`security-defaults.md`). |
| Compensation | You have effects worth unwinding. Advertising `compensation` binds its plan and read projection. |
| A2A and MCP (`interop.md`) | You want to talk to other ecosystems. |
| Auth lanes beyond what you use | Your deployment needs them. Each lane in `auth.lanes[]` binds its own obligations (`identity.md`). |
| The seams profile `openwop-conformance-seams-v2` | You want the four seam-driven scenarios measured. It is a test mount (`conformance.md` §"The seams profile"), not a capability. |
| Everything in `spec/v2/ext/` | You want that extension. Each document declares its own witness class and maturity. |

**None of these are second-class.** They are optional because a small core is one
people can implement. In v2 the rule for all of them is the same: a family you do
not support is **omitted**, since presence of the record is the claim
(`capabilities.md` §2).

## Verifying yourself

Install the suite and its contract peer at the same version (`conformance/README.md`
explains why both are needed), then run the major-2 scenarios:

```bash
npx @openwop/openwop-conformance \
  --base-url https://your-host.example \
  --api-key "$KEY" \
  --target-major 2
```

`--target-major` defaults from your `preferredVersion`, which through the overlap
MUST be a `1.x` member if you also serve v1 (`versioning.md` §1.1). A dual-stack
host that omits the flag measures v1. `--filter <pattern>` narrows the run, as in v1.

Most rows will record `inapplicable` or `blocked`. `inapplicable` means the
requirement does not bind your host; `blocked` means it was not measured, and a
bundle with `totals.blocked > 0` does not certify (`conformance.md` §"Bundle v3").
Read [`conformance/coverage.md`](../conformance/coverage.md) for the vocabulary.

Then produce a signed v3 certification bundle (the CLI default):

```bash
npx @openwop/openwop-conformance --base-url … --api-key … --target-major 2 \
  --certify bundle.json \
  --host-build commit:<sha> --signing-key key.pem --signing-key-id <keyId>
```

An unsigned v3 bundle does not exist, and `keyId` must be published in your
discovery `signingKeys[]` or the signature attests integrity only
(`conformance.md` §"Bundle v3"). Claimed profiles are derived from your discovery
document, not from anything you assert.

## Three things implementers get wrong

1. **Advertising a surface you have not wired.** In v2 the advertisement binds the
   security behaviour, not just the endpoint. Under `OPENWOP_REQUIRE_BEHAVIOR=true`
   an advertised profile with a missing seam fails instead of recording `blocked`
   (`conformance/coverage.md`). Omit the record until it works.
2. **Mounting v2 at `/v2/…`, or not under the advertised major at all.** There is
   no `/v2/` path space. If `/v1/<op>` answers and `/<op>` returns `404` under
   major 2, you MUST NOT advertise major 2 (`versioning.md` §1.2). Tenant-bound ids
   must also survive your front door (`identity.md` §5).
3. **Substituting instead of refusing.** A workflow that needs a capability you do
   not advertise MUST be rejected with `422 capability_required` (`runs.md` §Create),
   and every error is a registered code in the closed `{ error, message, details? }`
   envelope (`errors.md`).

## Signing keys, and the one step that silently does nothing

A certification bundle is signed with Ed25519. You sign with a **PKCS8 private key**; you publish the **raw 32-byte public key, base64url, unpadded — exactly 43 characters** in your own discovery document's `signingKeys[]`. Those are different encodings of different halves, and nothing converts one to the other for you. Publish a PEM or an SPKI blob and it fails the schema pattern; publish nothing and your signature **attests integrity only** — it proves the bundle was not altered after signing and says nothing about who signed it, because anyone can mint a keypair and a key id at will.

Generate the pair:

```bash
node -e 'const {generateKeyPairSync}=require("node:crypto");
const {privateKey}=generateKeyPairSync("ed25519");
require("node:fs").writeFileSync("host.pem", privateKey.export({type:"pkcs8",format:"pem"}));'
```

Derive the value you publish — the last 32 bytes of the SPKI DER are the raw key:

```bash
node -e 'const {createPublicKey}=require("node:crypto");
const k=createPublicKey(require("node:fs").readFileSync("host.pem"));
const der=k.export({type:"spki",format:"der"});
console.log(der.subarray(der.length-32).toString("base64")
  .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""));'
```

Put that string in `signingKeys[]` with `alg: "ed25519"` and the same `keyId` you pass to `--signing-key-id`. **A verifier resolves that `keyId` in YOUR discovery document** — there is no key list the steward keeps, and no approval step. That is what makes the trust root self-asserted: you publish the key, and anyone can check the bundle against it.

Do not use `openssl genpkey` recipes written for the node-pack signing surface; those emit SPKI PEM and will not match the pattern.

## When you are done

Publish your bundle and open a PR adding a row to the v2 table in
[`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md); checked-in bundles live in
`evidence/v2-host-bundles/`, and a row is verified with
`node scripts/check-cut-gates.mjs --host-bundle <bundle>`. Every host in that table
today is steward-built or steward-affiliated, so a row from an implementer outside
this project is the most useful evidence the protocol can get. **Publish it
whatever it says.** A bundle with blocked and inapplicable rows is evidence; a
bundle that was tuned until it was green is not.
