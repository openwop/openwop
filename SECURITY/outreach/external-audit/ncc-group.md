# NCC Group — Outreach Email

**Subject:** External security review — OpenWOP protocol (fixed-bid quote request)

**To:** <cryptoservices@nccgroup.com> (or their standard intake at <info@nccgroup.com>)

**Notes:**

- NCC Group's Cryptography Services team is the natural fit — the engagement touches Ed25519 signing, HMAC webhooks, hash-chained audit logs, all crypto-protocol-adjacent.
- Their public NCC-CR-XXXX report series is publicly available; the WhatsApp + Let's Encrypt + Mullvad reviews are good reference points.
- Their typical engagement is on the larger end; the upper budget bracket is the realistic anchor.

---

**Body:**

Hi NCC Group team,

I'm the lead maintainer of OpenWOP (<https://github.com/openwop/openwop>), an open wire-level protocol for multi-agent workflow orchestration. We're commissioning an independent security review and I'd like a fixed-bid quote — particularly interested in your Cryptography Services team given the engagement's focus on signed audit logs, HMAC webhooks, and Ed25519-signed node packs.

**Scope summary** (full spec: `SECURITY/external-audit-engagement.md` in the repo):

Crypto-protocol-heavy surfaces:

- **Audit-log integrity** (`auth-profiles.md` §"Audit-log integrity"): hash chain (SHA-256 over RFC 8785 canonical-JSON entries) + Ed25519-signed checkpoints over a merkle root. Threat model: privileged-admin-with-storage-write but no signing-key access.
- **Webhook HMAC** (`webhooks.md`): `HMAC-SHA256(secret, {timestamp}.{rawBody})` with `X-openwop-Signature-Algorithm: v1` versioning header. Replay-attack resistance + signature-algo migration story.
- **Node-pack signing** (`registry-operations.md`): Ed25519 over pack tarball; signing-key rotation via dual-sign grace period; Sigstore as an alternative trust path.

Plus the broader protocol scope:

- 5 threat models, 7 spec docs, 3 reference hosts at pinned commit (TS in-memory ~1,250 LOC, SQLite ~3,600 LOC, Python ~870 LOC; a 4th Postgres-backed host is at a run-lifecycle slice ~1,400 LOC with module ports as deferred follow-ups that **will not land during the review window**), 3 reference SDKs (~2,860 LOC), 4 in-scope `core.openwop.*` node packs (BYOK / HTTP / MCP / triggers), RFCs 0002–0008 (multi-agent extensions + WASM ABI).

**Specific questions** (engagement-doc §2.2): see linked spec, but the crypto-focused ones are SR-1 secret-redaction, audit-log integrity soundness, webhook HMAC under documented replay scenarios, node-pack signing under tamper + key-rotation timing, WASM ABI safety (RFC 0008 §G + §K) for determinism + memory cap.

**Budget range:** $15K–$40K USD fixed-bid. Crypto-focused scope (audit-log + webhook + pack-signing) anchors at the $25K mark; full multi-agent + WASM ABI scope at the upper end with a 90-day retest.

**Engagement window:** start within 60 days.

**Embargo:** 90-day per `SECURITY.md` §6.

**Deliverables** (engagement-doc §3): findings + CVSS/CWE + reproducible PoC; executive summary; threat-model annotations; remediation tracker as machine-readable JSON; optional 90-day retest.

Preconditions confirmed: audit-log integrity conformance scenarios PASS on the reference host (verified 2026-05-11); Phase 1 done + Phase 2 substantively done. The Postgres-host module ports are explicit follow-ups that **will not land during the review window** (matches engagement-doc §5).

Happy to scope on a call. **If interested, reply with a 30-minute slot from `<your Calendly link>` or propose three windows.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Engagement scope: <https://github.com/openwop/openwop/blob/main/SECURITY/external-audit-engagement.md>
