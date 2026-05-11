# Doyensec — Outreach Email

**Subject:** External security review — OpenWOP protocol (fixed-bid quote request)

**To:** info@doyensec.com (or via their contact form at https://www.doyensec.com/contact.html)

**Notes:**
- Doyensec's strength is web + workflow systems; they've done OpenWOP-adjacent reviews (Temporal, Argo, Pulumi).
- Their public reports show systematic threat-model annotations — good fit for our engagement-doc §3 deliverable shape.
- Typical engagement is medium-sized; aligns with the $20-30K mid-range of our budget.

---

**Body:**

Hi Doyensec team,

I'm the lead maintainer of OpenWOP (https://github.com/openwop/openwop), an open wire-level protocol for multi-agent workflow orchestration — similar problem space to Temporal / Argo / Step Functions but AI-native. We're commissioning an independent security review and I'd like a fixed-bid quote.

**Why I'm reaching out to Doyensec specifically:** your published work on workflow-orchestration systems (Temporal, Argo) maps cleanly onto our threat-model categories. Engagement-doc §2.2 lists eight specific questions the review answers; the workflow-adjacent ones (multi-tenant isolation, replay safety, node-pack supply-chain) are where I'd expect your team to surface the highest-value findings.

**Scope summary** (full spec: `SECURITY/external-audit-engagement.md`):

- 5 threat models + 7 spec docs covering auth, webhooks (HMAC), node-pack registry (Ed25519 + supply chain), MCP trust boundary, multi-region idempotency, audit-log integrity (hash chain + signed checkpoints)
- 3 reference hosts at pinned commit: TS in-memory (~1,250 LOC), SQLite (~3,600 LOC), Python stdlib (~870 LOC). A 4th Postgres-backed host (~1,400 LOC) is at a run-lifecycle slice with module ports as deferred follow-ups that **will not land during the review window**.
- 3 reference SDKs (TS / Python / Go, ~2,860 LOC)
- 4 in-scope `core.openwop.*` node packs (BYOK / HTTP / MCP / triggers), with a 5th (`agent-examples`) deferred pending the v1.2+ remote-runtime spec
- RFCs 0002–0008 (multi-agent extensions + WASM ABI)

**Specific questions** (engagement-doc §2.2): SR-1 secret-redaction invariant, audit-log integrity soundness, webhook HMAC replay, node-pack signing under documented supply-chain threats, prompt-injection containment, multi-tenant isolation across the shared idempotency cache, WASM ABI safety, replay safety vs deleted memory.

**Budget range:** $15K–$40K USD fixed-bid. Doyensec mid-range (~$25K) would fit the auth + webhook + node-pack + multi-tenant scope cleanly; full upper-range covers multi-agent + WASM ABI + retest.

**Engagement window:** start within 60 days.

**Embargo:** 90-day per `SECURITY.md` §6.

**Deliverables** (engagement-doc §3): findings + CVSS + CWE + reproducible PoC; executive summary; threat-model annotations marking each MUST/MUST-NOT as enforced / unenforced / underspecified; remediation tracker JSON.

Engagement preconditions confirmed: audit-log integrity conformance PASS on the reference host (2026-05-11); Phase 1 done + Phase 2 substantively done. The Postgres-host module ports are deferred follow-ups that **will not land during the review window** (matches engagement-doc §5).

Happy to walk the scope on a call or answer questions over email. **If interested, reply with a 30-minute slot from `<your Calendly link>` or propose three windows.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Engagement scope: https://github.com/openwop/openwop/blob/main/SECURITY/external-audit-engagement.md
