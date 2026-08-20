# RFC 0117: Front-End Plugin Packs (Sandboxed UI Extensions)

| Field | Value |
| --- | --- |
| **RFC** | 0117 |
| **Title** | Front-End Plugin Packs (Sandboxed UI Extensions) |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-27 |
| **Updated** | 2026-07-06 (`Active → Accepted` — **single-witness** bootstrap steward waiver + maintainer autonomy grant; tier-1 reference host openwop-app advertises `uiPlugins {supported:true, isolation:"cross-origin-iframe"}` live + serves the `kind:"frontend-plugin"` loader boundary [host code merged openwop-app#1408, ADR 0300]. See [Amendment record](#amendment-record). |
| **Affects** | `node-packs.md` (new `kind`), `host-capabilities.md` (`host.uiPlugins`), `capabilities.md`, `registry-operations.md`, a new `spec/v1/frontend-plugin-packs.md`, conformance scenarios, `SECURITY/invariants.yaml` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |
| **Amended by** | [RFC 0119](./0119-isolation-model-mechanism-neutrality.md) — generalizes the `isolation` advertisement from a single browser mechanism (`cross-origin-iframe`) to a categorical, mechanism-neutral model (additive); §Isolation + §Host-RPC reframed to the property + a transport-agnostic channel binding. · [RFC 0130](./0130-canvas-preview-plugin-surface.md) — adds the `canvas-preview` surface (plugin-rendered live preview inside a host-owned canvas editor), the OPTIONAL `canvasTypes` manifest field, and three core `ui-plugin/1` methods (`host.documentChanged`, `host.selectionChanged` events; `host.announce` request) — additive. |

## Summary

This RFC adds a `kind: "frontend-plugin"` pack that lets a registry distribute a **signed, isolated user-interface extension** — for example, a canvas editor, a custom artifact viewer, or a settings panel — that a host loads at runtime and enables through its own admin surface. The wire contract specifies **only** the manifest shape, the **mandatory cross-origin-iframe isolation model**, a **closed host-RPC message protocol**, capability gating, and signing; it deliberately specifies **no rendering runtime, framework, or component model** (the plugin's bundle is opaque bytes the host runs in a sandbox). This is the one carve-out RFC 0071 explicitly deferred ("viewers and field widgets remain host-domain"), now made portable **without** turning OpenWOP into a renderer: the host still owns the renderer (the sandbox + the RPC boundary), the pack only supplies sandboxed bytes.

## Motivation

RFC 0071 (artifact-type + chat-card packs) made artifact *data* portable but left *rendering* host-private, because "openwop is the wire contract … not a renderer" (`positioning.md`). That is correct for declarative artifacts the host already knows how to draw. It is insufficient for **interactive, host-novel UI** — a drag-and-drop app-builder editor, a CAD viewer, a spreadsheet grid — where the value *is* the bespoke front-end. Today such a feature can only ship as in-tree, compiled host code (the openwop-app reference host compiles 35+ frontend features statically; its marketplace installs backend packs only). There is no portable, cross-host way to **download a UI extension and enable it** — the "100% extendable host" use case.

The spec is the right place to solve this **only for the contract**, not the runtime: without a normative isolation model and message protocol, every host would invent an incompatible (and likely unsafe) plugin loader, and no plugin would be portable. The dangerous failure mode — loading third-party UI **in-process** (module federation, a bare `<script>`, a same-origin iframe) — must be a normative **MUST NOT**, or "extensible UI" becomes "arbitrary code execution with the host's full privileges." Prevailing practice agrees: Figma runs plugin UI in a sandboxed iframe behind `postMessage`; Anthropic's Artifacts render model-authored code in a **separate-origin** sandboxed iframe under strict CSP. This RFC standardizes that boundary so plugins are portable and safe by construction, while leaving the host free to implement the sandbox however it likes.

## Proposal

### 1. New pack kind — `frontend-plugin`

A new `kind` for the node-pack manifest family (`node-packs.md`). A pack manifest MUST declare exactly one of `nodes` / `chains` / `agents` / `artifactTypes` / `cards` / `uiPlugins` (this RFC adds the last). The `uiPlugins` array describes one or more UI extensions.

```jsonc
{
  "name": "vendor.acme.canvas-editor",
  "version": "1.2.0",
  "kind": "frontend-plugin",
  "uiPlugins": [
    {
      "pluginId": "vendor.acme.canvas-editor.app-builder",
      "title": "App Builder Canvas",
      "schemaVersion": 1,
      // Contribution points — WHERE the host may mount this plugin. A host
      // honors only the surfaces it recognizes; unknown surfaces are ignored.
      "surfaces": ["artifact-viewer", "route"],
      // For artifact-viewer: which artifact types this plugin renders.
      "artifactTypes": ["vendor.acme.canvas.app-builder"],
      // For route: the host-namespaced path the plugin owns.
      "route": "/plugins/vendor.acme.canvas-editor",
      // The sandboxed entry document, relative to the pack tarball. The host
      // serves this from an ISOLATED ORIGIN (see §2). Bytes are opaque to OpenWOP.
      "entry": "ui/index.html",
      // The closed set of host-RPC methods this plugin may call (§3). The host
      // MUST reject any method not in this allowlist.
      "hostApi": ["artifact.read", "artifact.write", "host.toast", "host.navigate"],
      // OPTIONAL advisory rendering hints (reuses ai-envelope §"Rendering hints").
      "rendering": { "display": "panel", "minHeight": 320 }
    }
  ],
  "runtime": { "language": "static", "format": "spa", "entry": "ui/index.html" }
}
```

A `uiPlugins` pack MUST NOT also declare executable backend `nodes` in the same pack (a plugin is presentation-only; backend behavior ships as a separate node/agent pack the plugin calls via host-RPC). `pluginId` MUST be registry-namespaced (`vendor.*` / `core.*`) per `registry-operations.md`.

### 2. Isolation model (normative — the load-bearing requirement)

A host that advertises `host.uiPlugins: supported` and loads a `frontend-plugin`:

- **MUST** execute the plugin `entry` inside a boundary that is **origin/execution-isolated from the host application** — the plugin has no access to the host's execution context, host DOM (where one exists), host-origin storage, or host credentials. A cross-origin sandboxed `<iframe>` (a distinct origin from the host UI, with the `sandbox` attribute) is the canonical browser mechanism; an equivalent WASM / OS-process / container / VM sandbox that provides the same isolation property is equally conformant. The host advertises **which** mechanism via `capabilities.uiPlugins.isolation` (RFC 0119: a categorical enum — `cross-origin-iframe` default, or `wasm`/`process`/`container`/`vm`/`x-host-*`).
- **MUST NOT** load plugin bytes into the host's own execution context (no in-process module federation, no host-origin `<script>`, no same-origin iframe). _This is a protocol-tier MUST NOT with a public conformance test, **regardless of the advertised `isolation` mechanism**._
- **MUST** apply a deny-by-default egress policy to the plugin context (a Content-Security-Policy `connect-src 'none'` where the substrate is a browser; the equivalent sandbox egress control otherwise — unless a capability grants otherwise) so a plugin cannot exfiltrate host data.
- **MUST** mediate **all** plugin↔host interaction through the §3 `ui-plugin/1` RPC channel; the plugin has no other handle to the host (no shared globals, no direct DOM access, no host cookies/storage).

The spec does not mandate *how* the host builds the sandbox (iframe origin scheme, CSP nonce strategy, WASM-VM vs. browser origin) — only that the isolation properties above hold, and that the advertised `capabilities.uiPlugins.isolation` value names the mechanism truthfully. This preserves `positioning.md`: the host owns the renderer; the wire owns the boundary (the **property**, not the browser technology).

### 3. Host-RPC message protocol

Plugin↔host communication is a request/response + event protocol. Every message is an object with a `type` and a monotonic `id` (for response correlation). The host exposes **only** the methods a plugin declared in `hostApi` **and** that the host recognizes; a call to an undeclared or unknown method MUST be rejected with an `error` response (never silently executed).

**Channel binding (RFC 0119, normative).** The host **MUST** deliver `ui-plugin/1` envelopes across the isolation boundary as discrete messages with request/response correlation by the envelope `id`. The **transport is host-internal** and follows the advertised `isolation` mechanism: browser `window.postMessage` for `cross-origin-iframe`, a host-import/export call for `wasm`, an IPC channel for `process`/`container`/`vm`. The envelope shape (the `openwop: "ui-plugin/1"` tag, `type` ∈ request/response/event, `id`, `method`, `result`/`error`) is transport-agnostic and **MUST** be identical across all isolation models. A host **MUST NOT** expose any plugin↔host channel other than this mediated RPC.

The following make the binding sound across non-browser transports (a browser `MessagePort` provides the first two for free; a byte-stream transport does not). Surfaced by the MyndHyve implementer review from a live non-iframe `ui-plugin/1` Worker bridge, resolving RFC 0119 Unresolved Question #1:

- **Framing & ordering (RFC 0119).** The transport **MUST** preserve message-boundary framing and per-channel ordering of envelopes, so that "correlation by `id`" is well-defined. A browser `MessagePort` satisfies this inherently; a byte-stream transport (IPC / stdio / shared-memory) **MUST** add framing (e.g. length-prefixing) or equivalent — `id`-correlated envelopes **MUST NOT** be permitted to interleave or fragment.
- **WASM single-import (RFC 0119).** For `isolation: "wasm"`, "no other channel" means the host **MUST NOT** bind any host import to the plugin module other than the single `ui-plugin/1` RPC entrypoint (no ambient host functions). This is the WASM-mechanism form of the `frontend-plugin-isolation` MUST NOT — a WASM guest can otherwise import arbitrary host functions as a silent side channel the iframe model cannot express — and mirrors the closed `openwop` import namespace RFC 0008 §C already mandates for backend WASM node-packs.
- **Backpressure (RFC 0119).** Hosts **SHOULD** bound the number of concurrent in-flight request `id`s and **MAY** refuse excess requests with an ordinary error response on the **existing** channel (never a new channel, and without a new error code in v1.x). Browser `postMessage` queues are effectively unbounded; a byte-stream host with no bound grows memory under a chatty plugin.

```jsonc
// plugin → host (request)
{ "openwop": "ui-plugin/1", "id": 7, "type": "request", "method": "artifact.read",
  "params": { "artifactId": "..." } }
// host → plugin (response)
{ "openwop": "ui-plugin/1", "id": 7, "type": "response", "ok": true, "result": { /* ... */ } }
// host → plugin (event, e.g. theme change)
{ "openwop": "ui-plugin/1", "type": "event", "event": "host.themeChanged", "data": { "theme": "dark" } }
```

This RFC defines a **closed core method vocabulary** (hosts MAY support a subset; plugins degrade per §5):

| Method | Direction | Contract |
| --- | --- | --- |
| `host.ready` | host→plugin event | Sent once the channel is open + the initial context (locale, theme, the bound `artifactId`/route params) is delivered. |
| `artifact.read` | plugin→host | Read an artifact the host already authorized for this surface. Returns the typed payload (RFC 0071). MUST be tenant/authz-checked host-side. |
| `artifact.write` | plugin→host | Persist an edit to the **host-owned working copy** (never the immutable source). Optimistic-concurrency via an opaque `version` token. |
| `host.navigate` | plugin→host | Request the host navigate to a host-namespaced route. The host validates the target. |
| `host.toast` | plugin→host | Surface a transient host notification (text only; no markup). |
| `host.themeChanged` / `host.localeChanged` | host→plugin event | Advisory; plugins SHOULD honor. |

A host MAY extend the vocabulary with host-namespaced methods (`x-<host>.*`); plugins MUST treat unknown host extensions as absent.

### 4. Capability advertisement

A host that supports this RFC advertises it at `/.well-known/openwop`:

```diff
   "host": {
+    "uiPlugins": {
+      "supported": true,
+      "surfaces": ["artifact-viewer", "route"],
+      "hostApi": ["artifact.read", "artifact.write", "host.toast", "host.navigate"],
+      "isolation": "cross-origin-iframe"
+    }
   }
```

`surfaces` and `hostApi` advertise the subset the host honors. A pack whose `surfaces`/`hostApi` are not a subset of the host's advertised sets is **installable but inert on the unsupported parts** (§5), never an error.

### 5. Graceful degradation (forward-compat)

- A host that does **not** advertise `host.uiPlugins` ignores `frontend-plugin` packs entirely (they install as inert metadata or are skipped by the registry installer). An `artifact-viewer` plugin that is absent falls back to the host's generic artifact rendering (RFC 0071 hints) — **no blank surface**.
- A plugin MUST function (read-only at minimum) when an optional `hostApi` method is unavailable, and MUST degrade a missing `surface` to nothing rather than erroring.
- The `openwop: "ui-plugin/1"` envelope tag versions the protocol; a host MUST ignore messages whose protocol tag it does not recognize.

### 6. Signing & trust

A `frontend-plugin` pack is signed with the same **Ed25519 + SRI** scheme as node packs (`node-packs.md`); the registry verifies the signature + namespace allow-list before publication, and the host **MUST** verify the signature before loading (fail-closed). Because plugin bytes are executable (in their sandbox), the registry submission policy (`registry-operations.md`) gains a **"front-end review"** checkpoint: a `frontend-plugin` pack MUST declare its `hostApi` + `surfaces` (the capability surface a reviewer audits), and the manifest's declared `connect-src` exceptions (if any) MUST be explicit and reviewed.

### Examples

**Positive** — a host advertising `host.uiPlugins.surfaces: ["artifact-viewer"]` + `hostApi: ["artifact.read","artifact.write"]` loads `vendor.acme.canvas-editor.app-builder` in a cross-origin sandboxed iframe; the plugin calls `artifact.read` → gets the typed payload → renders an editor → calls `artifact.write` with the edited payload + version → the host persists to its working copy. Valid.

**Negative (rejected at validation)** — a manifest with `"runtime": { "language": "javascript", "entry": "index.mjs" }` under `kind: "frontend-plugin"` (a plugin is sandboxed UI, not a backend node entry), or a `uiPlugins[]` entry missing `entry`/`pluginId`/`hostApi`, fails schema validation. **Negative (conformance MUST-NOT)** — a host that loads the plugin via a same-origin iframe or in-process module federation FAILS the `frontend-plugin-isolation` invariant test, regardless of manifest validity.

## Compatibility

**Additive.** Backward-compatibility clauses:

- The new `kind: "frontend-plugin"` and `host.uiPlugins` capability are **optional**; existing hosts and packs are unaffected (a host that ignores the kind/capability is conformant — §5). No existing field changes type or optionality.
- New schemas (`frontend-plugin-manifest.schema.json`, the `ui-plugin/1` message schema) are net-new; no existing schema gains a required field.
- The new conformance scenarios are **capability-gated** on `host.uiPlugins.supported`; they are skipped (not failed) on hosts that don't advertise it, so every existing v1.x conformance pass remains valid.

Lands in **v1.x**.

## Security

This RFC introduces executable third-party UI, so it adds protocol-tier invariants (each gets a public conformance test in `SECURITY/invariants.yaml`):

- **`frontend-plugin-isolation`** — a host loading a plugin MUST do so in an origin-isolated, sandboxed context; loading in the host's own execution context or a same-origin iframe is a **MUST NOT**.
- **`frontend-plugin-egress`** — the plugin document MUST be served under a CSP that denies network egress by default (`connect-src 'none'` unless a reviewed exception is granted).
- **`frontend-plugin-rpc-allowlist`** — the host MUST reject any `hostApi` method not in the plugin's declared, host-recognized allowlist; host-RPC calls are **server-mediated and authz-checked** (the plugin holds no credentials).
- **`frontend-plugin-no-byok`** — BYOK credential material MUST NOT cross the RPC boundary to a plugin; a plugin that needs a provider call asks the host, which performs it host-side.
- **Signing** — the host MUST verify the Ed25519 signature before loading (fail-closed), per `node-packs.md`.

These mirror the SR-1 / CTI-1 discipline of `agent-memory.md`: a MUST-NOT without a public test is not enforceable.

## Conformance

New capability-gated scenarios in `conformance/src/scenarios/frontend-plugin-packs.test.ts`:

1. **Manifest validation** — valid/invalid `frontend-plugin` manifests round-trip through `frontend-plugin-manifest.schema.json` (negative: missing `entry`, backend `runtime`, undeclared namespace).
2. **Isolation invariant** — a host advertising `host.uiPlugins` serves the plugin `entry` from a distinct origin with `sandbox` + a deny-egress CSP (the `frontend-plugin-isolation` + `frontend-plugin-egress` proof).
3. **RPC allowlist** — a call to an undeclared `hostApi` method returns an `error` response, not a silent execution.
4. **Degradation** — a host *without* `host.uiPlugins` treats an `artifact-viewer` plugin as absent and falls back to RFC 0071 rendering (no error, no blank surface).

## Alternatives considered

- **Keep rendering fully host-private (status quo, RFC 0071).** Rejected: it forecloses portable interactive UI — the explicit "100% extendable host" use case — and pushes every host to an ad-hoc, likely-unsafe loader.
- **Standardize a component model (a normative JSON UI tree the host renders).** Rejected here as the *primary* mechanism: it cannot express arbitrary interactive editors (a CAD viewer, a drag-drop canvas) and would balloon into a parallel UI framework in the spec — exactly what `positioning.md` forbids. (Note: the *constrained-JSON-against-a-host-catalog* pattern — e.g. A2UI / RFC 0102 — remains the right tool for **declarative** agent-authored surfaces; this RFC is for **host-novel interactive** UI that catalog rendering can't express. The two are complementary.)
- **In-process module federation (Backstage dynamic-plugin style).** Rejected: federated remotes execute with the host's full privileges — acceptable for first-party plugins, unacceptable for registry-distributed third-party code. The isolation MUST-NOT exists precisely to forbid this.
- **Ship the bundle bytes in the spec's scope (a normative renderer runtime).** Rejected: violates `positioning.md`. This RFC keeps bytes opaque — the spec owns the *boundary* (isolation + RPC + manifest), not the *renderer*.

## Resolved questions (resolved at `Active`)

Because `Active` locks the wire shape, all four opens are resolved in-RFC at the `Draft → Active` waiver. Each resolution adopts the floor and leaves the richer shape to a **future additive** method/sub-flag, so none narrows or pre-commits the locked manifest + RPC surface:

1. **Persistent plugin state — RESOLVED: `artifact.write` only in v1.** No scoped `host.kv` RPC method is added; plugins persist exclusively via the existing `artifact.write` allowlist entry. A keyed plugin-local store, if a real adopter needs it, is a future additive `hostApi` method gated under a bumped `ui-plugin/*` vocabulary — it does not change the v1 allowlist.
2. **Inter-plugin composition — RESOLVED: no in v1 (one sandbox per surface).** A `route` plugin MUST NOT embed another plugin; each surface is exactly one cross-origin sandbox, keeping the trust model and CSP boundary single-tenant per frame. Nested composition, if ever introduced, is an additive surface that does not relax this isolation MUST.
3. **Versioned `hostApi` deprecation — RESOLVED: additive/safety-fix discipline on `ui-plugin/N`.** The host-RPC vocabulary is versioned `ui-plugin/1`; new methods are additive within a version, and any breaking method change bumps the major (`ui-plugin/2`) and is advertised as a distinct supported version — the same `COMPATIBILITY.md` discipline the rest of the wire follows.
4. **Streaming — RESOLVED: request/response in v1.** `artifact.read` is whole-response in v1; a streaming/chunked variant, if a real large-artifact adopter needs it, is a future additive `hostApi` method and does not alter the v1 request/response shape.

## Adoption / reference

The openwop-app reference host is the intended first adopter (Track 2 of its ADR 0153 canvas program): its canvas editors (app-builder, etc.) become `frontend-plugin` packs loaded in a cross-origin sandbox, enabled through the existing feature-toggle admin — closing the "download a canvas editor plugin" gap that ADR 0153 Track 1 deliberately deferred. Per the bootstrap-phase rule, this RFC MUST reach at least `Accepted` (with the isolation + egress invariants implemented + tested) before that host work lands.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- All four invariants witnessed: `frontend-plugin-rpc-allowlist` (undeclared `host.exec` → `method_not_allowed`, steward-curl-verified on the wire) + `frontend-plugin-no-byok` (RPC envelope carries no secret, steward-verified) + `frontend-plugin-isolation` (advert `cross-origin-iframe` steward-verified + `PLUGIN_SANDBOX` allow-scripts-without-allow-same-origin FE unit-test) + `frontend-plugin-egress` (`PLUGIN_CSP` deny-egress + `withPluginCsp` srcDoc injection FE unit-test — the plugin is served under the deny-egress CSP by the loader).
- Ruling: isolation/egress are **serve/apply-control MUSTs** (falsifiable by wire + FE unit test); the browser's runtime enforcement of correctly-applied sandbox+CSP is a platform guarantee (§4-parallel).
- Tier-2 (second host / non-iframe mechanism) witness carried forward as the named gap.
- Defense-in-depth follow-up RESOLVED 2026-07-06 (openwop-app#1414): the backend deny-egress CSP response header on the entry endpoint was initially a no-op [Firebase Hosting global CSP overrode `/api/**`]; a scoped `firebase.json` header rule now makes it authoritative — steward-re-curl-verified the entry endpoint returns `default-src 'none'` with no `connect-src`, so the backend second layer is.
- real end-to-end alongside the load-bearing frontend `withPluginCsp` srcDoc meta.).
- 2026-06-27 (`Draft → Active` — steward waiver of the 7-day additive comment window per `GOVERNANCE.md` lazy consensus; all four Open questions resolved in-RFC because `Active` locks the wire shape).
