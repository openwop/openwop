# RFC 0130: Canvas Preview Plugin Surface (amends RFC 0117)

| | |
| --- | --- |
| **RFC** | 0130 |
| **Title** | Canvas Preview Plugin Surface (amends RFC 0117) |
| **Status** | Accepted |
| **Author(s)** | OpenWOP maintainers (steward: David Tufts) |
| **Created** | 2026-07-07 |
| **Updated** | 2026-07-07 — `Active → Accepted`: tier-1 reference-host evidence (single-witness bootstrap, the RFC 0117/0119 precedent) — openwop-app mounts `canvas-preview` as the pack canvas editor's center panel behind the `ui-plugins`+`canvas-packs` toggles (openwop-app#1481, ADR 0310 Phase E): advert `surfaces ⊇ ["canvas-preview"]` + `hostApi ⊇ ["host.announce"]` from the single-source dispatcher module, witness plugin pack `community.openwop.checklist-preview` (live `host.documentChanged` re-render, `host.selectionChanged` highlight, rate-limited/length-capped `host.announce` into dual live regions), with served-projection / hostApi-gate / rate-limit+cap regression tests. Earlier the same day — `Draft → Active`: steward waiver of the 7-day additive comment window per `GOVERNANCE.md` lazy consensus; wire shape locked. |
| **Affects** | `RFCS/0117-frontend-plugin-packs.md` (header `Amended by`), `spec/v1/frontend-plugin-packs.md`, `schemas/frontend-plugin-manifest.schema.json`, `schemas/capabilities.schema.json`, `conformance/src/scenarios/frontend-plugin-packs.test.ts` (capability-gated) |
| **Compatibility** | Additive (new closed-enum values, one new OPTIONAL manifest field, new `ui-plugin/1` methods under the existing unknown-method tolerance — `COMPATIBILITY.md` §4) |
| **Amends** | RFC 0117 — adds a fourth sandboxed surface (`canvas-preview`) and three core RPC methods (`host.selectionChanged`, `host.documentChanged`, `host.announce`) |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0117 defines sandboxed front-end plugins on three surfaces (`artifact-viewer`, `route`, `settings-panel`). This RFC adds a fourth: **`canvas-preview`** — a plugin-rendered live preview a host mounts as the center panel of a canvas EDITOR, so a pack-declared canvas type (whose generic host editor is data-driven) can ship a custom visual rendering without leaving RFC 0117's isolation model. It also adds three core `ui-plugin/1` methods the surface needs: two host→plugin events (`host.selectionChanged`, `host.documentChanged`) and one plugin→host request (`host.announce`). Everything else — isolation invariants, channel binding, signing, capability honesty — is inherited from RFC 0117/0119 unchanged.

## Motivation

Hosts are growing **generic canvas editors** for pack-declared canvas types: the pack ships an artifact type plus editor hints as pure data, and the host renders element lists + property panels with zero pack frontend code (the openwop-app `x-openwop-app.canvas` host extension is the reference). The data-driven floor renders a document *legibly*, but a drawing wants to look like a drawing. The only honest place for third-party *rendering code* is the RFC 0117 sandbox — a bespoke "canvas renderer channel" would recreate exactly the isolation problem 0117 solved. What is missing is small and wire-shaped: a surface name a host can mount **inside an editor**, a way for the plugin to follow the editor's live state (the document changes on every edit; the selection drives what the preview should highlight), and a way for the plugin to feed the editor's accessibility announcements instead of growing its own.

## Proposal

### 1. The `canvas-preview` surface

The `frontend-plugin` pack manifest surface enum (RFC 0117 §1) gains `canvas-preview`:

```jsonc
{
  "pluginId": "vendor.example.gantt-preview",
  "surface": "canvas-preview",
  // NEW, OPTIONAL, meaningful only for canvas-preview plugins: the canvas
  // type id(s) this preview renders. A host mounts the plugin only for
  // matching canvas documents; an empty/absent list means the plugin is
  // never auto-mounted (a host MAY still offer it explicitly).
  "canvasTypes": ["canvas.gantt"],
  "entry": "ui/index.html",
  "hostApi": ["artifact.read", "host.announce"]
}
```

- A `canvas-preview` plugin is mounted by the host **inside a host-owned editor chrome** (toolbar, lists, property panels stay host-rendered). The plugin renders ONLY the document preview.
- Every RFC 0117 §2 isolation invariant applies **unchanged and in full** (origin/execution isolation, no host-context loading, deny-by-default egress, single mediated RPC channel). This surface adds no isolation carve-outs.
- The plugin reads the document via `artifact.read` (the host serves the **editor working copy**, not the immutable source artifact). Hosts **SHOULD NOT** grant `artifact.write` to `canvas-preview` mounts — the host editor owns mutation (undo/redo, validation, optimistic concurrency); a preview that edits is an editor, which is the `route` surface's job. A host that does grant it inherits RFC 0117's `artifact.write` contract verbatim.
- `canvasTypes` values are host-namespace canvas type ids (opaque strings to the wire; hosts validate against their own canvas registries and MUST ignore entries they do not recognize).

### 2. `ui-plugin/1` core method additions

Three methods join RFC 0117 §3's closed core vocabulary (hosts MAY support a subset; plugins degrade per RFC 0117 §5):

| Method | Direction | Contract |
| --- | --- | --- |
| `host.documentChanged` | host→plugin event | Sent when the edited document changes (an edit, an undo/redo, a version restore). `data`: `{ "content": string }` — the serialized document, same encoding as `artifact.read`. Hosts SHOULD debounce bursts; plugins MUST treat the latest event as authoritative and MUST NOT assume every intermediate state is delivered. |
| `host.selectionChanged` | host→plugin event | Sent when the editor selection changes. `data`: `{ "selection": { "kind": string, "collection"?: string, "index"?: number, "path"?: number[], "frameId"?: string } }`. `kind` is host-defined (`"element"`, `"frame"`, `"node"`, `"none"`, …); plugins MUST tolerate unknown kinds and absent fields (advisory highlighting only — selection state never round-trips as authority). |
| `host.announce` | plugin→host request | `params`: `{ "message": string, "politeness"?: "polite" \| "assertive" }` (default `polite`). The host relays the text to its editor's accessibility live region — the plugin sandbox is invisible to the host page's assistive tech, so this is the one honest path for a preview to announce its state changes. Text only (no markup). Hosts MUST length-cap (SHOULD ≤ 400 characters, truncating) and SHOULD rate-limit, refusing excess with an ordinary error response on the existing channel (the RFC 0119 backpressure posture). Returns `{}`. |

`host.announce` joins the manifest `hostApi` enum and the capability advert `uiPlugins.hostApi` enum (the events are host-initiated and are not `hostApi` entries, matching `host.themeChanged`).

### 3. Capability advertisement

A host that mounts this surface advertises it: `capabilities.uiPlugins.surfaces` may include `"canvas-preview"` and `capabilities.uiPlugins.hostApi` may include `"host.announce"`. RFC 0117's honesty rule applies: advertise only what is behaviorally honored (`OPENWOP_REQUIRE_BEHAVIOR=true` posture).

## Compatibility

Additive per `COMPATIBILITY.md` §4: two closed enums gain values (validators that pin the old enums reject only NEW packs/adverts, never existing ones), one new OPTIONAL manifest field (`canvasTypes`), and new RPC methods under RFC 0117's existing normative tolerance for unknown methods/extensions. No existing field changes type, no requirement is relaxed, no error-code meaning changes.

## Conformance

Extend the capability-gated `frontend-plugin-packs` scenario: for a host advertising `uiPlugins.surfaces ⊇ ["canvas-preview"]`, (a) a `canvas-preview` manifest entry validates against the updated schema, (b) the four RFC 0117 §2 isolation invariants hold for the mounted surface exactly as for `artifact-viewer` (same probes, new surface), and (c) a `host.announce` request over the declared `hostApi` yields a response envelope (never silent execution of an undeclared method). Hosts not advertising the surface are exempt (gated).

## Alternatives considered

- **A bespoke canvas-renderer channel outside RFC 0117** — rejected: recreates the isolation problem 0117 solved; two sandboxes to audit.
- **Reusing `artifact-viewer` for editor previews** — rejected: an artifact viewer binds to an immutable artifact and has no contract for live editor state (document push, selection); overloading it would fork its semantics by context.
- **Selection as a readable resource (`selection.read`) instead of an event** — rejected: previews need push (polling across the RPC boundary on every frame is the wrong cost model); the event form matches `host.themeChanged`.
- **Granting previews `artifact.write`** — rejected as the default: mutation belongs to the host editor (undo/redo + validation + concurrency live there); the SHOULD NOT keeps the door open for hosts that want plugin-editors while keeping the reference posture read-only.

## Unresolved questions

None — kept none open because `Active` locks the wire shape (the RFC 0117 discipline).

## Implementation notes (non-normative)

The reference host (openwop-app) mounts `canvas-preview` as the center panel of its ADR 0310 canvas editor for pack-declared types (`x-openwop-app.canvas`): the host editor keeps the element lists/property panels/undo; the plugin iframe replaces the generic data renderer when an installed plugin's `canvasTypes` matches. `host.documentChanged` is emitted from the editor's history state (debounced), `host.selectionChanged` from its selection state, and `host.announce` lands in the editor's existing polite live region. The 0117 forward pointer (`Amended by`) lands with this RFC's `Active` flip, per the RFC 0119 discipline.

## Acceptance criteria

- [x] `schemas/frontend-plugin-manifest.schema.json`: `surface` enum + `canvasTypes` field + `hostApi` enum updated.
- [x] `schemas/capabilities.schema.json`: `uiPlugins.surfaces` + `uiPlugins.hostApi` enums updated.
- [x] `spec/v1/frontend-plugin-packs.md` documents the surface + the three methods.
- [x] `RFCS/0117-frontend-plugin-packs.md` header gains the `Amended by` row.
- [x] Reference host mounts the surface behind a feature toggle with a witness plugin pack, advertising `canvas-preview`/`host.announce` only where honored (openwop-app#1481).
- [x] Capability-gated conformance scenario extended (+2 always-on schema-layer scenarios; the isolation probes apply per-surface).
- [x] `Active → Accepted` flip names its implementation-evidence tier (tier-1 single-witness bootstrap, above).

## References

- RFC 0117 — Front-End Plugin Packs (Sandboxed UI Extensions)
- RFC 0119 — Front-End Plugin Isolation as a Mechanism-Neutral Property
- openwop-app ADR 0310 — Canvas Editor Framework (Tier-1 data packs / Tier-2 plugin previews)
- `COMPATIBILITY.md` §4 (additive changes), `GOVERNANCE.md` (lazy consensus / evidence tiers)
