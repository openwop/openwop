# External Pack Author Recruitment

> **Status: drafts ready; outreach not sent.** Distinct from host recruitment in [`external-host.md`](external-host.md): a pack is a smaller, easier commitment than a full host. The open step is choosing 3–5 specific Tier 1 or Tier 2 candidates and tailoring the template to each.
>
> A non-steward pack author is the smallest, cheapest path to an external composition partner, which the project needs to move from "incubating protocol" to "credible open standard."

## Why this matters

The registry at `packs.openwop.dev` hosts 156 steward-published packs, and every one traces back to the single steward maintainer (the steward also operates the MyndHyve host that owns the `vendor.myndhyve` namespace). [`docs/PACK-CATALOG.md`](../PACK-CATALOG.md) breaks them down by namespace. The project says third parties can extend OpenWOP without committing to a host, but no non-steward author has done it yet.

Recruiting the first external pack author:

1. Proves the publish flow works for someone other than the steward. It is documented in [`docs/PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md) and has only been steward-tested.
2. Adds an "External pack authors" entry to `INTEROP-MATRIX.md`, with the same weight as a non-steward host.
3. Costs less than recruiting a host: one engineer can ship a pack as a side project.

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

OpenWOP node packs (<https://github.com/openwop/openwop/blob/main/spec/v2/core/packs.md>) let you distribute signed workflow node implementations to any OpenWOP host. `<your tool>` would fit naturally — your `<X capability>` becomes a node-pack with a typed envelope; users invoke it as part of a longer workflow with HITL + retries + replay handled by the host (not by your tool).

The publish flow is a pull request (<https://github.com/openwop/openwop/blob/main/docs/PACK-AUTHOR-QUICKSTART.md>):

1. In a clone of `github.com/openwop/openwop-registry`, scaffold the pack and build a deterministic, Ed25519-signed tarball with the registry's scripts.
2. Open a PR against `openwop/openwop-registry` with the pack source, the signed artifacts and your public key.
3. The registry gate validates the signature and manifest; on merge the pack is served from `packs.openwop.dev`.

The first external pack author goes on `INTEROP-MATRIX.md` as the first non-steward pack contributor. That's a real ecosystem signal — your tool gets a portable workflow-integration surface that any OpenWOP host can load.

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
Spec: <https://github.com/openwop/openwop>
Pack catalogue: <https://packs.openwop.dev/v2/index.json>
Publish docs: <https://github.com/openwop/openwop/blob/main/docs/PACK-AUTHOR-QUICKSTART.md>

## Send checklist

1. Identify 3-5 specific Tier 1 or Tier 2 candidates. Use the criteria above; lean toward vendors where you have a personal connection or where their public API shape is already documented as workflow-shaped.
2. Customize the `<your tool>` / `<X capability>` placeholders for each candidate. Generic outreach has a ~5% reply rate; tool-specific outreach is closer to 25%.
3. Send 3-5 in parallel (Tuesday/Wednesday).
4. Track replies in `MAINTAINERS.md` §"Recruitment log" §"External pack authors".

## After a successful recruitment

When the first external pack ships:

1. Verify the publish flow worked: the signature verifies, `/v2/packs/<name>/index.json` on `packs.openwop.dev` lists the version, and the tarball and signature round-trip through a host that advertises `packs`.
2. Add an `INTEROP-MATRIX.md` row under "External pack authors" with the pack's name + author + license + brief description.
3. Fold any friction from the walk-through into [`docs/PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md). A first author's experience is the most valuable feedback the publish flow will get.
4. Use this as the case study in the next round of host-recruitment outreach (`docs/recruitment/external-host.md`) — "we now have N external pack authors" is real ecosystem evidence.

## See also

- [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) — manifests, registry tree, signing
- [`docs/PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md) — the publish flow, end to end
- [`docs/PACK-CATALOG.md`](../PACK-CATALOG.md) — what is published today
- `MAINTAINERS.md` §"Recruitment log" §"External pack authors" — per-target tracking
- [openwop/openwop-registry](https://github.com/openwop/openwop-registry) — the registry, its scripts and its publishing gate
