# External Pack Author Recruitment

> **Status: framework + outreach template ready (2026-05-11; freshness re-confirmed 2026-05-21).** Distinct from the host-recruitment work in `external-host.md` — packs are smaller, easier-to-commit-to surfaces than a full host. The blocker remains identifying 3–5 specific Tier 1 / Tier 2 candidates and customizing the template per recipient. 2026-05-21 update: registry pack count grew from 3 → 62, but every published pack is still steward-published — the broader pack inventory does not change the recruitment objective (a non-steward pack author).

## Why this matters

The hosted node-pack registry at `packs.openwop.dev` is live with **62 steward-published packs** as of 2026-05-21: 22 `core.openwop.*` framework primitives, 1 `community.openwop-team.demo`, 1 `vendor.openwop.rust-hello` WASM reference, 38 `vendor.myndhyve.*` canvas-vertical packs. The steward operates the myndhyve.ai reference host that owns the `vendor.myndhyve` namespace claim, so every pack on the registry today traces back to the single steward maintainer. The pack-ecosystem claim in the project's positioning is "third parties can extend OpenWOP without a host commitment" — but no non-steward third party has done that yet.

Recruiting the first external pack author:

1. Validates that the publish flow at `registry-operations.md` actually works for a non-steward author (it's been steward-tested only).
2. Adds an "External pack authors" subsection to `INTEROP-MATRIX.md` with the same composition-evidence weight as a non-steward host.
3. Costs less external effort than recruiting a host — packs are a smaller surface and one engineer can typically commit a pack as a side project.

## Target selection criteria

### Tier 1: vendors with an existing internal automation product who'd benefit from exposing it as a portable node

The pitch: "your `<X>` capability becomes a node-pack with a typed envelope; users invoke it as part of a longer workflow with HITL + retries + replay handled by the host."

Good fits:
- **Small dev-tools vendors** where one engineer can ship a pack as a side project. Examples: Linear (Issues / Cycles API), Sourcegraph (Code Search / Cody), Vercel (Build / Edge Functions), Resend (transactional email), Stripe (payment workflows).
- **Smaller B2B SaaS** with public APIs that fit a workflow node shape — anything that takes inputs and produces a typed result.

### Tier 2: maintainers of existing tools-via-MCP servers

The pitch: "your MCP server already exposes a tool catalog; wrapping it as an OpenWOP node-pack gives workflow-orchestrated access (HITL + retries + replay) on top of MCP's tool-exposure surface."

Good fits:
- Authors of MCP servers in `modelcontextprotocol/servers` (the Anthropic-curated catalog).
- Authors of independent MCP servers (e.g., `mcp-github-server`, `mcp-filesystem-server`).

This is a smaller pitch because the wrapping work is light — the MCP server already exists; the pack is a thin OpenWOP node that invokes the MCP `tools/call` endpoint and adapts the response to OpenWOP's typed envelope.

## Outreach template

**Subject:** First external OpenWOP node pack — would `<your tool>` fit?

**Body:**

Hi `<name>`,

OpenWOP node packs (https://github.com/openwop/openwop/blob/main/spec/v1/node-packs.md) let you distribute signed workflow node implementations to any OpenWOP-compliant host. `<your tool>` would fit naturally — your `<X capability>` becomes a node-pack with a typed envelope; users invoke it as part of a longer workflow with HITL + retries + replay handled by the host (not by your tool).

The publish flow is documented at `spec/v1/registry-operations.md`:

1. Build a signed tarball (`scripts/build-pack-tarball.mjs` from this repo does it deterministically + signs with Ed25519).
2. Open a PR against `github.com/openwop/openwop` with the manifest + signature.
3. CI validates the signature + the manifest shape; on merge it publishes to `packs.openwop.dev`.

The first external pack author goes on `INTEROP-MATRIX.md` as the first non-steward pack contributor. That's a real ecosystem signal — your tool gets a portable workflow-integration surface that any OpenWOP-compliant host honors.

I'm happy to:
- Walk through the publish flow end-to-end in a single 30-minute working session.
- Author the first pack manifest with you (you tell me the API shape; I handle the OpenWOP wire-translation).
- Land the PR under `vendor.<your-org>.<tool>` or `community.<your-handle>.<tool>` — your call.

The first pack is the smallest possible scope — one node, one typed envelope. Future versions can grow.

**If interested, reply with a 15-minute slot from `<your Calendly link>` or propose three windows. Even a "not a fit / no bandwidth" reply is useful — it sharpens who I reach out to next.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: https://github.com/openwop/openwop
Pack catalogue: https://packs.openwop.dev/v1/index.json
Publish docs: https://github.com/openwop/openwop/blob/main/spec/v1/registry-operations.md

## Send checklist

1. Identify 3-5 specific Tier 1 or Tier 2 candidates. Use the criteria above; lean toward vendors where you have a personal connection or where their public API shape is already documented as workflow-shaped.
2. Customize the `<your tool>` / `<X capability>` placeholders for each candidate. Generic outreach has a ~5% reply rate; tool-specific outreach is closer to 25%.
3. Send 3-5 in parallel (Tuesday/Wednesday).
4. Track replies in `MAINTAINERS.md` §"Recruitment log" §"External pack authors".

## After a successful recruitment

When the first external pack ships:

1. Verify the publish flow worked: signature validates on `packs.openwop.dev`, the manifest at `/v1/packs/<name>/index.json` renders cleanly, the tarball download + signature round-trip works via `examples/hosts/sqlite/`'s pack-loader.
2. Add an `INTEROP-MATRIX.md` row under "External pack authors" with the pack's name + author + license + brief description.
3. Add a `docs/PACK-PUBLISH-WALKTHROUGH.md` documenting any friction surfaced during the walk-through — first-author experience is the most valuable feedback the publish flow will get.
4. Use this as the case study in the next round of host-recruitment outreach (`docs/recruitment/external-host.md`) — "we now have N external pack authors" is real ecosystem evidence.

## See also

- `spec/v1/node-packs.md` — the pack-manifest spec
- `spec/v1/registry-operations.md` — the publish flow + lifecycle ops
- `MAINTAINERS.md` §"Recruitment log" §"External pack authors" — per-target tracking
- `scripts/build-pack-tarball.mjs` — the deterministic tarball builder + Ed25519 signer
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Phase 3 T3.3 — the planning trail
