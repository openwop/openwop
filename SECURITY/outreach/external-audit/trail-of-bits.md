# Trail of Bits — Outreach Email

**Subject:** External security review — OpenWOP protocol (fixed-bid quote request)

**To:** <sales@trailofbits.com> (or <hello@trailofbits.com> — public intake)

**Notes:**

- Trail of Bits has strong public reports on protocol-level engagements (e.g., Solana, Cosmos, Filecoin). Their findings track threat models cleanly.
- Specifically reference their multi-tenant + supply-chain work if helpful.
- Their typical engagement size matches the upper end of our budget range.

---

**Body:**

Hi Trail of Bits team,

I'm the lead maintainer of OpenWOP (<https://github.com/openwop/openwop>), an open wire-level protocol for multi-agent workflow orchestration. We're commissioning an independent security review and I'd like a fixed-bid quote.

**Scope summary** (full spec: `SECURITY/external-audit-engagement.md` in the repo):

- 5 threat models (`SECURITY/threat-model-*.md`) covering auth profiles, secret leakage, prompt injection, node-pack signing, provider policy
- 7 spec documents covering auth, webhooks (HMAC signing), node-pack registry (Ed25519 + supply chain), MCP trust boundary, multi-region idempotency, audit-log integrity (hash-chain + signed checkpoints)
- 3 reference hosts at a pinned commit: TypeScript in-memory (~1,250 LOC), SQLite-backed (~3,600 LOC), Python stdlib-only (~870 LOC). A 4th host (Postgres-backed) is at a run-lifecycle slice (~1,400 LOC); its audit / interrupts / webhooks ports are deferred follow-ups and **will not land during the review window**.
- 3 reference SDKs (TypeScript, Python, Go — ~2,860 LOC total)
- 4 in-scope `core.openwop.*` node packs (BYOK / HTTP / MCP / triggers), with a 5th (`agent-examples`) deferred pending the v1.2+ remote-runtime spec
- RFCs 0002–0008 (multi-agent extensions + WASM ABI)

**Specific questions the review answers** (engagement-doc §2.2): SR-1 secret-redaction invariant, audit-log integrity hash-chain + signed-checkpoint design, webhook HMAC under documented replay scenarios, node-pack signing + key-rotation, prompt-injection containment (`<UNTRUSTED>` marker), multi-tenant isolation, WASM ABI safety (RFC 0008 §G + §K), replay safety vs deleted memory content.

**Budget range:** $15K–$40K USD fixed-bid. Lower end: focused auth + webhook + pack-signing layer (~80 hrs). Upper end: full multi-agent + WASM ABI scope (~200 hrs) including a 90-day retest.

**Deliverables** (engagement-doc §3): findings report with CVSS + CWE + reproducible PoC, executive summary suitable for our public site, threat-model annotations marking each MUST/MUST-NOT as enforced / unenforced / underspecified, remediation tracker as machine-readable JSON, optional retest within 90 days.

**Engagement window:** looking to start within the next 60 days.

**Embargo:** 90-day per `SECURITY.md` §6, extendable to 180 for safety-fix breaks. NDA before non-public access (the protocol is public; the NDA is narrow — pre-disclosure findings only).

**Preconditions we commit to** (engagement-doc §5):

- `openwop-audit-log-integrity` conformance scenarios PASS on the reference host (✓ verified 2026-05-11)
- Phase 1 done; Phase 2 substantively done with the Postgres-host module ports (audit / interrupts / webhooks / observability for the 4th host) as a known follow-up that **will not land during the review window** (matches engagement-doc §5 "no in-flight normative changes during the review window")
- Repository pinned to a specific commit for the review duration
- A maintainer available to answer questions within 1 business day

Happy to walk through the scope on a call or answer questions over email — whichever is faster for your team. **If interested, reply with a 30-minute slot from `<your Calendly link>` or propose three windows that work.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Repository: <https://github.com/openwop/openwop>
Engagement scope: <https://github.com/openwop/openwop/blob/main/SECURITY/external-audit-engagement.md>
