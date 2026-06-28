# RFC 0119: Front-End Plugin Isolation as a Mechanism-Neutral Property (amends RFC 0117)

| Field             | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| **RFC**           | 0119                                                                  |
| **Title**         | Front-End Plugin Isolation as a Mechanism-Neutral Property (amends RFC 0117) |
| **Status**        | `Active`                                                              |
| **Author(s)**     | David Tufts (@davidscotttufts)                                        |
| **Created**       | 2026-06-28                                                            |
| **Updated**       | 2026-06-28 (`Draft → Active` — comment window satisfied by openwop-app's explicit source-grounded ACK as the sole adoption-coupled witness; additive const→enum widen, normative surface landed in this PR) |
| **Affects**       | `RFCS/0117-frontend-plugin-packs.md` (amends §"Isolation model" + §"Host-RPC" channel binding), `schemas/capabilities.schema.json` (`uiPlugins.isolation`), `schemas/ui-plugin-message.schema.json` (description only), `schemas/frontend-plugin-manifest.schema.json` (descriptions only), `spec/v1/frontend-plugin-packs.md`, `SECURITY/invariants.yaml` (`frontend-plugin-isolation` wording), conformance scenario `frontend-plugin-packs.test.ts` (one assertion generalized) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §4 ("looser validation accepting input that previously failed") |
| **Supersedes**    | —                                                                     |
| **Superseded by** | —                                                                     |
| **Amends**        | RFC 0117 — generalizes the isolation advertisement from a single browser mechanism (`cross-origin-iframe`) to a categorical, mechanism-neutral model, reconciling the schema with RFC 0117 §2's own already-property-based prose. |

## Summary

RFC 0117 §"Isolation model" already specifies the plugin-isolation requirement as a **property** — origin + DOM isolation, deny-egress, RPC-only mediation — and explicitly blesses "an equivalent OS/web sandbox" and "WASM-VM vs. browser origin" as conformant. But the **enforced advertisement schema** (`capabilities.uiPlugins.isolation`) pins a single browser mechanism as a `const "cross-origin-iframe"` "the ONLY conformant isolation model." That contradicts RFC 0117's own §2 prose and the corpus's existing categorical isolation vocabulary (`capabilities.sandbox.isolationModel`: `wasm`/`process`/`container`/`vm`). This RFC widens `isolation` from a `const` to an `enum` (keeping `cross-origin-iframe` as a member and the browser default), reframes the `frontend-plugin-isolation` invariant in property terms, and adds a normative channel binding so the `ui-plugin/1` RPC is carriable across a non-browser isolation boundary. The isolation **property** and all four SECURITY invariants are unchanged; only the mechanism over-specification is removed.

## Motivation

The wire contract should constrain the **observable security property**, not the host's implementation technology. RFC 0117 gets this right in prose and wrong in schema:

- **The contradiction is in the merged corpus, not hypothetical.** `RFCS/0117-frontend-plugin-packs.md §2` line 74: *"The spec does not mandate **how** the host builds the sandbox (iframe origin scheme, CSP nonce strategy, **WASM-VM vs. browser origin**) — only that the isolation properties above hold."* line 69 permits *"a cross-origin `<iframe>` … **or an equivalent OS/web sandbox** that provides the same origin + DOM isolation."* Yet `schemas/capabilities.schema.json` (`uiPlugins.isolation`) reads: `"const": "cross-origin-iframe"`, *"The ONLY conformant isolation model … Pinned as a `const` so the advertisement cannot claim a weaker model."* The binding artifact says the opposite of the normative prose it is supposed to encode.

- **The corpus already solved this class of problem categorically.** `capabilities.sandbox.isolationModel` (RFC 0035, backend pack execution) is an **enum** — `["wasm", "process", "container", "vm"]` plus `x-host-*` vendor models — letting a host pick the mechanism that fits its substrate while the spec owns the *boundary*. RFC 0117 reinvented a narrower, browser-only `const` for the same "run untrusted pack bytes in an isolation boundary" problem. The right vocabulary was already in the same schema file.

- **The over-specification excludes valid hosts.** A host that enforces the *identical* property via a WASM sandbox, an OS-process boundary, or a microVM — the models RFC 0035 already enumerates — cannot honestly advertise `uiPlugins` today, even though it satisfies every isolation MUST/MUST-NOT RFC 0117 cares about. "The wire dictates a tech stack" is a real defect here, surfaced by a non-steward adopter (MyndHyve) during RFC 0117 implementation review.

**Honest non-goal (stated up front so this lands for the right reason).** Relaxing the `const` does **not** manufacture a new RFC 0117 witness. A genuinely headless durable runtime with no UI surface to render into would remain a *vacuous* `uiPlugins` host post-amendment — it has nothing to render, generalized isolation or not. This RFC is a **mechanism-neutrality correctness fix** (the schema contradicting its own §2), future-proofing the advertisement for a server-rendered / WASM-sandboxed UI-emitting host — **not** a move to graduate any specific adopter. The isolation property is exactly as strict after this change as before.

## Proposal

### 1. Widen `capabilities.uiPlugins.isolation` from `const` to a categorical `enum`

The `isolation` field lives **only** in the host-advertisement (`capabilities.uiPlugins`), **not** in the `frontend-plugin` pack manifest — so pack authors are entirely unaffected; this is a host-advertisement vocabulary widening.

```diff
   "isolation": {
     "type": "string",
-    "const": "cross-origin-iframe",
-    "description": "The ONLY conformant isolation model. In-process / same-origin / module-federation loading is a protocol-tier MUST NOT (`frontend-plugin-isolation`). Pinned as a `const` so the advertisement cannot claim a weaker model."
+    "enum": ["cross-origin-iframe", "wasm", "process", "container", "vm"],
+    "default": "cross-origin-iframe",
+    "description": "The categorical isolation model the host enforces for plugin bytes. `cross-origin-iframe` = a distinct-origin sandboxed browser frame (the browser default; RFC 0117 §2). `wasm`/`process`/`container`/`vm` mirror `sandbox.isolationModel` (RFC 0035) for non-browser hosts that enforce the SAME isolation property (no host-context execution, RPC-only mediation, deny-egress). Vendor-specific models advertise `^x-host-<host>-<key>$` per `host-extensions.md`. ALL values denote the SAME mandatory property (`frontend-plugin-isolation`); the field names the mechanism, never relaxes the property. A host advertising any value MUST enforce the §2 isolation MUST-NOTs."
   }
```

`x-host-*` vendor extension values are permitted via the existing `host-extensions.md §"Canonical prefixes"` convention (matching how `sandbox.isolationModel` already admits them); the schema gains the `^x-host-` pattern allowance alongside the enum.

### 2. RFC 0117 §"Isolation model" — restate the requirement as the property (it largely already is)

The §2 MUST-NOTs are **unchanged**. The edit makes the *mechanism examples* subordinate to the *property*, so the schema and prose agree:

- **MUST** execute plugin bytes in a boundary that is **origin/execution-isolated from the host application** such that the plugin has no access to the host's execution context, host DOM (where one exists), host-origin storage, or host credentials. A cross-origin sandboxed `<iframe>` is the canonical browser mechanism; an equivalent WASM / OS-process / container / VM sandbox that provides the same isolation property is equally conformant (`capabilities.uiPlugins.isolation` names which).
- **MUST NOT** load plugin bytes into the host's own execution context (no in-process module federation, no host-origin `<script>`, no same-origin iframe). *(Unchanged — protocol-tier MUST NOT with a public conformance test.)*
- **MUST** apply a deny-by-default egress policy to the plugin context (`connect-src 'none'`-equivalent unless a capability grants otherwise). *(Unchanged; "CSP" becomes "deny-egress policy (CSP where the substrate is a browser; the equivalent sandbox egress control otherwise)".)*
- **MUST** mediate **all** plugin↔host interaction through the §3 `ui-plugin/1` RPC channel. *(Unchanged.)*

### 3. RFC 0117 §"Host-RPC" — add a normative channel binding (the one real design addition)

RFC 0117 §3 describes delivery as `window.postMessage`. For a non-browser `isolation` value there is currently **no normative way** to carry the `ui-plugin/1` envelope — so widening the enum without this would advertise a model with no conformant transport. New normative clause:

> The host **MUST** deliver `ui-plugin/1` envelopes across the isolation boundary as discrete messages with request/response correlation by the envelope `id`. The **transport is host-internal**: browser `window.postMessage` for `cross-origin-iframe`, a host-import/export call for `wasm`, an IPC channel for `process`/`container`/`vm`. The envelope shape (the `openwop: "ui-plugin/1"` tag, `type` ∈ request/response/event, `id`, `method`, `result`/`error`) is transport-agnostic and **MUST** be identical across all isolation models. A host **MUST NOT** expose any plugin↔host channel other than this mediated RPC.

The envelope *fields* in `ui-plugin-message.schema.json` already require nothing browser-specific; only its `description` (and the manifest/capability descriptions) say "postMessage … across the cross-origin-iframe boundary" — those are de-narrated to "across the isolation boundary."

### 4. SECURITY invariant `frontend-plugin-isolation` — generalize the wording

The invariant's **intent and MUST-NOT are unchanged**; the description generalizes from iframe-specific to property terms:

> `frontend-plugin-isolation` — a host loading a plugin MUST do so in an origin/execution-isolated sandbox that denies the plugin access to the host's execution context. Loading plugin bytes in the host's own execution context — in-process module federation, a host-origin `<script>`, or a same-origin iframe — is a **MUST NOT**, regardless of the advertised `isolation` mechanism.

### Examples

**Positive (new, additive):** a WASM-sandbox host advertises `capabilities.uiPlugins.{supported: true, isolation: "wasm", surfaces: ["artifact-viewer"], hostApi: ["artifact.read","artifact.write"]}`, loads `vendor.acme.canvas-editor.app-builder` opaque bytes inside a WASM sandbox with explicit host imports (no host-context access, deny-egress), carries `ui-plugin/1` over its host-call boundary, enforces the `artifact.read`/`artifact.write` allowlist and the `version`-token optimistic concurrency. Valid — same property, non-browser mechanism.

**Positive (unchanged):** a browser host advertises `isolation: "cross-origin-iframe"` (the default) and loads the plugin in a distinct-origin sandboxed iframe behind `postMessage`. Valid exactly as before this RFC.

**Negative (unchanged MUST-NOT):** any host — browser or otherwise — that loads plugin bytes into its own execution context (same-origin iframe, in-process module federation) FAILS `frontend-plugin-isolation`, regardless of the `isolation` value it advertises.

## Compatibility

**Additive**, per `COMPATIBILITY.md §4` row: *"Looser validation accepting input that previously failed — Yes — additive (clients that sent invalid input were already broken)."*

Backward-compatibility clauses:

1. **No existing advertisement becomes invalid.** `cross-origin-iframe` remains a valid (and default) member of the enum; every host currently advertising it — including openwop-app, the RFC 0117 witness #1 currently implementing against it — stays conformant with **zero change**.
2. **The field stays a `string`; the shape is unchanged.** RFC 0117 is `Active` (which locks the *wire shape*, per `RFCS/README.md` §status). `const`→`enum` widens an allowed value-set without changing the field type or object shape — `COMPATIBILITY.md §2.2` ("optional field type-changed") is **not** triggered.
3. **No MUST relaxed (`§2.2`).** The isolation property MUST-NOTs and all four SECURITY invariants (`frontend-plugin-isolation`/`-egress`/`-rpc-allowlist`/`-no-byok`) are unchanged; every advertised `isolation` value still *guarantees the same property*. The schema is brought *up* to match RFC 0117 §2's existing prose MUST, not loosened below it.
4. **Discovery payload is server-emitted and open (`§2.1`).** Widening an enum the host advertises is the intended additive mechanism for capability vocabularies; an older consumer that only recognized `cross-origin-iframe` treats an unknown value as "a model I don't recognize" → degrade-to-unsupported, the safe direction (it never under-enforces the property, since any advertised value still guarantees it).

No migration tooling required (additive). Pack authors are unaffected (the field is host-advertisement-only).

## Conformance

- **Existing coverage:** `conformance/src/scenarios/frontend-plugin-packs.test.ts` validates the manifest, the `ui-plugin/1` allowlist (`method_not_allowed`), and the `version`-token concurrency (`artifact_conflict`/`currentVersion`) via the `host-sample-test-seams.md §ui-plugin/rpc` seam — which already routes one RPC through the host's **real** dispatcher with **no live iframe**, i.e. it is already transport-neutral and needs no change.
- **One assertion generalized:** the `frontend-plugin-isolation` leg currently asserts the browser-specific "not a same-origin iframe" shape; it generalizes to "not host-execution-context" so a non-browser isolation model can prove the property.
- **New schema legs (always-on):** assert the widened `isolation` enum accepts each new member and still rejects a weaker/unknown non-`x-host-` value; assert the `ui-plugin/1` envelope shape is unchanged.
- **Capability gating:** unchanged — all behavioral legs remain gated on `capabilities.uiPlugins.supported`.
- Ships in the next `@openwop/openwop-conformance` minor (one net-new schema-leg assertion; no net-new scenario file ⇒ patch-or-minor per the independent-bump rule, decided at release).

## Alternatives considered

1. **Do nothing — leave `isolation` as `const "cross-origin-iframe"`.** Rejected: the schema permanently contradicts RFC 0117 §2's own normative prose (an internal corpus inconsistency), and the protocol dictates a browser tech stack for a property that is mechanism-independent — excluding valid WASM/process/VM hosts that enforce the identical isolation. Doing nothing also lets the inconsistency harden as more hosts pin the `const` before 0117 graduates to `Accepted`.
2. **Drop the `isolation` advertisement entirely (let hosts self-describe in prose).** Rejected: the *property* is load-bearing and must remain machine-checkable; removing the advertised model would weaken the capability handshake and make the `frontend-plugin-isolation` gate unverifiable at discovery time. The fix is to generalize the vocabulary, not delete it.
3. **A free-form `isolation` string.** Rejected: loses the closed, reviewable vocabulary that lets a client reason about the model; reusing the established `sandbox.isolationModel` enum (+ `x-host-*` for vendors) keeps the corpus consistent and the set auditable.

## Unresolved questions

1. **Channel-binding strictness.** Is the §3 normative clause (transport host-internal; envelope identical; correlation by `id`; no other channel) sufficient, or should each non-browser model get a more prescriptive binding (e.g., a named WASM import signature)? Recommendation: keep it abstract in v1.x; prescriptive bindings can be additive follow-ons if a real WASM host needs them.
2. **Conformance bump.** Patch vs. minor for `@openwop/openwop-conformance` — one generalized assertion + new always-on schema legs, no net-new scenario file. Decide at release per the independent-minor-bump rule.
3. **`x-host-*` in the egress-policy clause.** For non-browser models, does "deny-egress equivalent" need a per-model normative floor, or is "host enforces no ambient egress" sufficient? Recommendation: sufficient for v1.x.

## Implementation notes (non-normative)

- **0117 header update deferred to `Active`.** Per `RFCS/README.md §"Amended by"`, RFC 0117 gains an `**Amended by**` forward pointer to this RFC. That edit lands when **0119 flips to `Active`** (not while it is a `Draft` proposal), so a reader of 0117 is never told it is amended by something still under discussion.
- **openwop-app is RFC 0117 witness #1, mid-implementation** against `cross-origin-iframe`. This change keeps their path valid (they keep advertising `cross-origin-iframe`), but they are the concrete browser adopter and must not be surprised — heads-up posted on the implementation channel at draft time.
- **Comment window: run it, don't instant-waive.** Although additive (and the steward waived 0117's own window via lazy consensus), this touches an `Active` RFC an external witness is actively implementing — so run the 7-day additive window (or an explicit ack-gate from openwop-app) rather than an instant waiver.
- **Surface edits land at `Active`, not at `Draft`.** This PR is the RFC proposal only. The `capabilities.schema.json` / prose / invariant / conformance edits land in the follow-up `Active` PR per process.

## Acceptance criteria

- [ ] RFC text merged (`Draft`); 7-day additive comment window run (or explicit openwop-app ack).
- [ ] On `Active`: `capabilities.schema.json` `uiPlugins.isolation` widened to the enum (+ `x-host-*`); RFC 0117 §2 + §3 prose updated; `ui-plugin-message`/manifest descriptions de-narrated; `frontend-plugin-isolation` invariant wording generalized; RFC 0117 header gains the `**Amended by**` row.
- [ ] `frontend-plugin-isolation` conformance assertion generalized + new always-on enum/envelope schema legs; ships in the next `@openwop/openwop-conformance` release.
- [ ] CHANGELOG entry under the appropriate version, classified `additive`.
- [ ] `npm run openwop:check` green on the merged tree.
- [ ] A non-browser isolation witness is **not** required for `Accepted` (the property is mechanism-neutral; the existing browser witness + the always-on schema legs prove the contract). A future WASM/process `uiPlugins` host, if one appears, becomes additional evidence.

## References

- `RFCS/0117-frontend-plugin-packs.md` §"Isolation model" + §"Host-RPC" (the amended surface).
- `schemas/capabilities.schema.json` — `uiPlugins.isolation` (`const` today) and `sandbox.isolationModel` (the categorical-enum precedent, RFC 0035).
- `COMPATIBILITY.md` §2.1 (server-emitted shapes open), §2.2 (never-in-v1.x list), §4 (looser-validation = additive).
- `RFCS/README.md` §status (`Active` locks wire shape "unless the RFC explicitly says otherwise"), §"Amended by".
- `SECURITY/invariants.yaml` — `frontend-plugin-isolation` and siblings.
- `spec/v1/host-sample-test-seams.md` §ui-plugin/rpc (the already-transport-neutral conformance seam).
