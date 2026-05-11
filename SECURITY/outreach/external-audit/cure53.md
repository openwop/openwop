# Cure53 — Outreach Email

**Subject:** External security review — OpenWOP protocol (fixed-bid quote request)

**To:** info@cure53.de

**Notes:**
- Cure53's strengths are web security + crypto-protocol-adjacent reviews (Mullvad, Signal, OpenPGP.js, NTPSec). Strong fit for the audit-log + webhook + node-pack crypto layers.
- Recent LLM-adjacent work (per their published reports) makes them a good fit for the prompt-injection + MCP trust-boundary parts of our scope.
- Typical engagement is small-medium; could anchor at our $15-25K range for a focused crypto-heavy scope.

---

**Body:**

Hi Cure53 team,

I'm the lead maintainer of OpenWOP (https://github.com/openwop/openwop), an open wire-level protocol for multi-agent workflow orchestration. We're commissioning an independent security review and I'd like a fixed-bid quote.

**Why Cure53 specifically:** your published work on crypto-protocol reviews (Mullvad, Signal, OpenPGP.js) maps onto our audit-log + webhook + node-pack crypto layers, and your recent LLM-adjacent reviews are the closest published track record I've found for the prompt-injection + MCP-trust-boundary parts of the engagement.

**Scope summary** (full spec: `SECURITY/external-audit-engagement.md`):

Crypto-protocol layers:
- **Audit-log integrity** (`auth-profiles.md`): SHA-256 hash chain over RFC 8785 canonical-JSON entries + Ed25519-signed checkpoints over a merkle root. Threat model: privileged admin with storage-write but no signing-key access.
- **Webhook HMAC** (`webhooks.md`): `HMAC-SHA256(secret, {timestamp}.{rawBody})` with versioning header for forward compat.
- **Node-pack signing** (`registry-operations.md`): Ed25519 + Sigstore signing chain over pack tarballs.

LLM-adjacent layers:
- **Prompt-injection containment** (`mcp-integration.md` + `threat-model-prompt-injection.md`): the `<UNTRUSTED>` marker discipline — can adversarial MCP tool responses leak into trusted state?
- **MCP trust boundary** + **A2A composition** drift points.

Plus the broader scope: 3 reference hosts at pinned commit, 3 reference SDKs (TS / Python / Go), 5 spec-canonical node packs, RFCs 0002–0008.

**Specific questions** (engagement-doc §2.2): SR-1 secret-redaction, audit-log integrity soundness, webhook HMAC under replay, node-pack signing tamper + key-rotation, prompt-injection containment, multi-tenant isolation, WASM ABI safety, replay safety vs deleted memory.

**Budget range:** $15K–$40K USD fixed-bid. Cure53's focused-crypto sweet spot anchors at $20-25K for the audit + webhook + pack-signing layer; upper range for the full scope with retest.

**Engagement window:** start within 60 days.

**Embargo:** 90-day per `SECURITY.md` §6.

**Deliverables** (engagement-doc §3): findings + CVSS + CWE + PoC; executive summary; threat-model annotations; remediation tracker JSON. Cure53's public report format aligns well with the executive-summary + findings-detail shape.

Engagement preconditions: audit-log integrity conformance PASS on the reference host (2026-05-11); Phase 1 + Phase 2 partial landed.

Happy to scope on a call.

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Engagement scope: https://github.com/openwop/openwop/blob/main/SECURITY/external-audit-engagement.md
