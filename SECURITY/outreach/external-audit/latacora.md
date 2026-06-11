# Latacora — Outreach Email

**Subject:** External security review — OpenWOP protocol (fixed-bid quote request)

**To:** <hello@latacora.com>

**Notes:**

- Latacora's typical engagement is smaller + faster turnaround than the others; good fit if you want to start with a focused scope rather than the full engagement.
- They specialize in security partnerships for early-stage projects — protocol governance pre-tripwire might appeal to them.
- Lower-mid range of our budget ($15-25K) likely aligns best.

---

**Body:**

Hi Latacora team,

I'm the lead maintainer of OpenWOP (<https://github.com/openwop/openwop>), an open wire-level protocol for multi-agent workflow orchestration. We're commissioning an independent security review and I'd like a fixed-bid quote.

**Why Latacora:** the project is at the inflection point your engagement framing fits — public protocol with one steward maintainer, approaching the governance tripwire for vendor-neutral org migration. We're not pre-product but we're pre-third-party-adoption. An audit at this stage de-risks the upcoming non-steward host recruitments.

**Scope summary** (full spec: `SECURITY/external-audit-engagement.md`):

If a smaller-focused scope works better for your team, the engagement doc lets us anchor on the auth + webhook + node-pack-signing layer (~80 hrs, lower end of our $15K–$40K budget). The full scope adds multi-agent extensions + WASM ABI + a 90-day retest.

The focused-scope deliverables:

- Threat model + spec review for `auth.md` + `auth-profiles.md` (audit-log integrity, OAuth2 client credentials, mTLS profile, OIDC user-bearer profile)
- `webhooks.md` HMAC scheme + signature-algorithm versioning + replay-attack resistance
- `node-packs.md` + `registry-operations.md` Ed25519 + Sigstore signing chain + supply-chain controls
- Reference impl review at pinned commit: SQLite host (~3,600 LOC), 3 reference SDKs (~2,860 LOC), 4 in-scope `core.openwop.*` node packs (BYOK / HTTP / MCP / triggers), with a 5th (`agent-examples`) deferred pending the v1.2+ remote-runtime spec

**Specific questions** (engagement-doc §2.2 — the focused-scope subset): SR-1 secret-redaction, audit-log integrity soundness, webhook HMAC under replay, node-pack signing tamper + key-rotation, multi-tenant isolation across the shared idempotency cache.

**Budget range:** $15K–$40K USD fixed-bid; focused scope anchors at the $15-20K mark.

**Engagement window:** start within 60 days. Latacora's faster turnaround is part of the appeal.

**Embargo:** 90-day per `SECURITY.md` §6.

**Deliverables** (engagement-doc §3): findings + CVSS + CWE + reproducible PoC; executive summary suitable for our public site; threat-model annotations; remediation tracker JSON.

Engagement preconditions confirmed: audit-log integrity conformance PASS on the reference host (2026-05-11); Phase 1 done + Phase 2 substantively done. The Postgres-host module ports are deferred follow-ups that **will not land during the review window** (matches engagement-doc §5).

Happy to walk the scope on a call or talk through where Latacora's engagement shape fits best. **If interested, reply with a 30-minute slot from `<your Calendly link>` or propose three windows.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Engagement scope: <https://github.com/openwop/openwop/blob/main/SECURITY/external-audit-engagement.md>
