# OpenWOP Spec v1 — Front-End Plugin Packs (Sandboxed UI Extensions)

> **Status: Draft · v1.x — RFC 0117 `Active`.** Normative surface for [RFC 0117 — Front-End Plugin Packs](../../RFCS/0117-frontend-plugin-packs.md) — a registry-distributable, **signed, sandboxed** user-interface extension a host loads at runtime in a cross-origin isolated iframe and talks to over the closed `ui-plugin/1` host-RPC boundary. Companion to [`node-packs.md`](./node-packs.md) §Pack kinds (the `kind` discriminator), [`artifact-type-packs.md`](./artifact-type-packs.md) (RFC 0071, the host-private rendering this opens a portable carve-out from), and [`capabilities.md`](./capabilities.md) (`capabilities.uiPlugins`). `Active → Accepted` waits on a host advertising `capabilities.uiPlugins.supported` + passing the gated isolation/egress/RPC/concurrency scenarios non-vacuously (the openwop-app reference host's ADR 0153 canvas-editor program is the first intended consumer). Keywords MUST, SHOULD, MAY, MUST NOT, SHOULD NOT follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

## Why this exists

RFC 0071 made the *content* a node produces portable — an artifact-type pack declares a
typed artifact (a document, a slide deck, a CAD drawing) — but deliberately left the
**viewer** host-private: "viewers and field widgets remain host-domain." That carve-out is
correct as a default (the spec must not become a UI framework), but it forecloses the one
thing the "100% extendable host" use case needs: a third party shipping an *interactive*
surface — a canvas editor, a custom artifact viewer, a settings panel — that runs on **any**
conformant host without a host-side code change. Today the only options are (a) the host
hard-codes every viewer, or (b) each host invents an ad-hoc, likely-unsafe plugin loader —
exactly the cross-host portability break the pack ecosystem exists to prevent.

This document specifies the **boundary**, not a renderer. The wire owns four things and
nothing else: the **manifest** shape (`frontend-plugin-manifest.schema.json`), the
**mandatory isolation model** (a mechanism-neutral property; `cross-origin-iframe` default — RFC 0119), the **closed `ui-plugin/1` host-RPC
protocol** (`ui-plugin-message.schema.json`) with its method allowlist, and **signing**. The
plugin's `entry` bundle stays **opaque bytes** the host runs in a sandbox — OpenWOP defines
no component model, no rendering runtime, no framework. The host still owns the renderer
(the sandbox + the RPC seam); the pack only supplies sandboxed bytes.

The surface is **optional and capability-gated**: a host advertises
`capabilities.uiPlugins.supported: true` to opt in; a host that does not is fully conformant
and renders no plugin surface (it degrades to RFC 0071 host rendering, §Degradation).

## The pack

A front-end plugin pack is a registry pack whose `pack.json` carries `kind: "frontend-plugin"`
and validates against [`frontend-plugin-manifest.schema.json`](../../schemas/frontend-plugin-manifest.schema.json)
(`node-packs.md` §Pack kinds). It declares one or more `uiPlugins[]` entries, each with:

- **`pluginId`** — stable identity within the pack; a host enables/disables by this id in its
  own admin surface.
- **`surface`** — one of `artifact-viewer` (renders a typed RFC 0071 artifact), `route` (a
  standalone admin/tool page), or `settings-panel` (a configuration panel).
- **`entry`** — pack-relative path to the opaque entry bundle loaded in the sandbox. The path
  MUST NOT contain `..` or a leading `/` (the schema pattern forbids both).
- **`hostApi`** — the closed allowlist of `ui-plugin/1` methods this plugin is permitted to
  call (§Host-RPC).
- **`connectSrc`** (OPTIONAL) — explicit `connect-src` CSP exceptions; absent → deny-egress
  (§Security).

A `kind: "frontend-plugin"` manifest MUST NOT carry a backend `runtime` member (a plugin is
sandboxed UI, not a node entry); a host MUST reject such a manifest at registration with
`pack_kind_invalid` (`node-packs.md` §Pack kinds). A `uiPlugins[]` entry missing `pluginId`,
`surface`, `entry`, or `hostApi` fails manifest validation.

## Signing

A front-end plugin pack is signed with the same **Ed25519 + Subresource-Integrity** scheme as
node packs (`node-packs.md` §Signing); the registry verifies the signature and the namespace
allow-list before publication, and the host **MUST** verify the signature before loading,
**fail-closed** (an unverifiable pack is not loaded). Because plugin bytes are executable in
their sandbox, the registry submission policy (`registry-operations.md`) gains a **front-end
review** checkpoint: a `frontend-plugin` pack MUST declare its `hostApi` + `surface` (the
capability surface a reviewer audits), and any `connectSrc` exceptions MUST be explicit and
reviewed.

## Isolation (mandatory)

A host that advertises `capabilities.uiPlugins.supported: true` MUST execute every plugin `entry`
in an **origin/execution-isolated sandbox** — the plugin has no access to the host's execution
context, host DOM, host-origin storage, or host credentials. A **cross-origin, sandboxed iframe**
(a distinct origin from the host application, with an HTML `sandbox` attribute that withholds
same-origin privileges) is the canonical browser mechanism; an equivalent WASM / OS-process /
container / VM sandbox enforcing the same property is equally conformant. In-process loading,
same-origin iframes, and module federation (the federated remote executing with the host's
privileges) are a **protocol-tier MUST NOT** (`frontend-plugin-isolation`) — **regardless of the
advertised mechanism**. The host advertises **which** mechanism via
`capabilities.uiPlugins.isolation` — a categorical enum (RFC 0119): `cross-origin-iframe`
(default), `wasm`, `process`, `container`, `vm`, or an `x-host-*` vendor model. The field names
the mechanism; it never relaxes the property.

A plugin holds **no credentials** and has **no ambient host authority**: every privileged
action goes through the host-mediated, authz-checked `ui-plugin/1` RPC (§Host-RPC). The plugin
MUST function (read-only at minimum) when an optional `hostApi` method is unavailable, and MUST
degrade a missing `surface` to nothing rather than erroring (§Degradation).

## Host-RPC (`ui-plugin/1`)

Plugin↔host communication is a request/response + event protocol over `postMessage`, validated
against [`ui-plugin-message.schema.json`](../../schemas/ui-plugin-message.schema.json). Every
message carries `openwop: "ui-plugin/1"` (the protocol-version tag — a host MUST ignore messages
whose tag it does not recognize) and is a `request` (plugin→host), a `response` (host→plugin,
correlated by the monotonic `id`), or an `event` (host→plugin, one-way).

The host exposes **only** the methods the plugin declared in its manifest `hostApi` **and**
that the host advertises in `capabilities.uiPlugins.hostApi`. A call to any other method MUST be
rejected with a `response` `{ ok: false, error: { code: "method_not_allowed" } }` — never
silently executed (`frontend-plugin-rpc-allowlist`). The method vocabulary is versioned
`ui-plugin/1`; new methods are additive within the version, and any breaking method change bumps
the major (`ui-plugin/2`) and is advertised as a distinct supported version.

The v1 method set:

| Method | Direction | Semantics |
| --- | --- | --- |
| `artifact.read` | plugin→host | Read an artifact the host already authorized for this surface. Returns the typed payload (RFC 0071) **plus an opaque `version` token** (§Concurrency). MUST be tenant/authz-checked host-side. |
| `artifact.write` | plugin→host | Persist an edit to the **host-owned working copy** (never the immutable source). REQUIRES `params.version` (§Concurrency). |
| `host.toast` | plugin→host | Surface a transient host notification. |
| `host.navigate` | plugin→host | Request the host navigate to a host-owned route. |

## Concurrency (optimistic, `version` token)

A host that advertises `artifact.write` in `capabilities.uiPlugins.hostApi` MUST enforce
**optimistic concurrency** on plugin-authored edits, modeled on the RFC 0059 `host.workspace`
`If-Match`/ETag pattern:

1. `artifact.read` MUST return an **opaque `version`** token in its `result`.
2. `artifact.write` MUST require the caller to pass the last-read `version` in `params.version`.
   On a **stale or unknown** token the host MUST reject with
   `{ ok: false, error: { code: "artifact_conflict", currentVersion: <current> } }` and MUST
   NOT persist the edit. `currentVersion` lets the plugin re-read/merge and retry. (This is the
   parallel of `workspace_conflict` + `details.currentVersion` in `agent-workspace.md`.)
3. On success the host MUST return the **new `version`** in the `result`, so the editor
   continues without a re-read.
4. The token is **opaque and host-minted**: a plugin MUST round-trip it verbatim and MUST NOT
   parse or construct it. This avoids leaking host storage internals and keeps the contract
   decoupled from any particular storage engine.

The `version` token is a host-storage concern carried only on the `ui-plugin/1` channel; it is
**not** a run-event-log field and introduces no replay non-determinism. **Cross-host caveat
(v1.x-silent):** the token is opaque and host-defined — a token minted on host A is not
guaranteed valid on host B, exactly as `agent-workspace.md`'s `etag` portability is silent. A
plugin surface is bound to a single host session/working-copy, so this is sufficient.

## Degradation

A host that does **not** advertise `capabilities.uiPlugins.supported: true` MUST reject
`kind: "frontend-plugin"` packs at registration and render no plugin surface — falling back to
its RFC 0071 host-private rendering with **no error and no blank surface**. A host that
advertises the capability but not a particular `surface` (or a particular `hostApi` method) MUST
treat a plugin requiring the unsupported part as **installable-but-inert** on that part: a
missing `surface` degrades to nothing; an unavailable optional `hostApi` method leaves the
plugin functioning read-only. None of these is an error.

## Capability advertisement

A host advertises support under the top-level `capabilities.uiPlugins` object
(`capabilities.schema.json`):

```json
{
  "uiPlugins": {
    "supported": true,
    "isolation": "cross-origin-iframe",
    "surfaces": ["artifact-viewer", "route", "settings-panel"],
    "hostApi": ["artifact.read", "artifact.write", "host.toast", "host.navigate"],
    "maxEntryBytes": 2097152
  }
}
```

`isolation` MUST be a member of the conformant model set — `cross-origin-iframe` (default), `wasm`, `process`, `container`, `vm`, or an `x-host-*` vendor model (RFC 0119); every value denotes the same mandatory isolation property. `surfaces` / `hostApi`
let an author detect partial support; a pack whose `surface`/`hostApi` is not a subset of the
host's advertised sets is installable-but-inert on the unsupported parts (§Degradation), never a
registration error.

## Security

Four protocol-tier invariants gate this surface (`SECURITY/invariants.yaml`,
`SECURITY/threat-model-prompt-injection.md` §Front-end plugin surface):

- **`frontend-plugin-isolation`** — the host MUST load a plugin only in a cross-origin sandboxed
  iframe; in-process / same-origin / module-federation loading is forbidden.
- **`frontend-plugin-egress`** — absent declared `connectSrc` exceptions, the host MUST serve the
  plugin under a deny-egress CSP: no network egress beyond the `ui-plugin/1` host-RPC channel.
- **`frontend-plugin-rpc-allowlist`** — the host MUST reject any `hostApi` method not in the
  plugin's declared, host-recognized allowlist with `method_not_allowed`; host-RPC calls are
  server-mediated and authz-checked (the plugin holds no credentials).
- **`frontend-plugin-no-byok`** — no BYOK credential material ever crosses the `ui-plugin/1`
  boundary into the sandbox; the plugin operates purely through host-mediated, authz-checked
  RPC.

## Open spec gaps

| Gap | Disposition |
| --- | --- |
| Persistent plugin-local state beyond `artifact.write` (a scoped `host.kv` method) | Out of scope for v1 (RFC 0117 §Resolved Q1); a future additive `hostApi` method under a bumped `ui-plugin/*` vocabulary. |
| Inter-plugin composition (a `route` embedding an `artifact-viewer`) | Forbidden in v1 — one sandbox per surface (RFC 0117 §Resolved Q2). |
| Streaming `artifact.read` for large artifacts | Whole-response in v1 (RFC 0117 §Resolved Q4); a future additive method. |
| Cross-host `version`-token portability | v1.x-silent — opaque, host-defined (§Concurrency), mirroring `agent-workspace.md` `etag`. |
| `Active → Accepted` | Pending a host advertising `capabilities.uiPlugins.supported` + passing the gated scenarios non-vacuously (dual-witness per the graduation rule). |
