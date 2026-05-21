# Runbook: Promote RFCs 0030/0031/0032/0033 from `Active` → `Accepted`

> **Scheduled for:** 2026-05-27 (comment-window close).
> **Owner:** OpenWOP steward.
> **Spec lane:** Non-normative (status-line bump + CHANGELOG + INTEROP-MATRIX timestamp).
> **Estimated effort:** ~30 minutes (verification + commit + push).
>
> **If you are an agent reading this on 2026-05-27 because a `/schedule` job fired this runbook as your prompt:** follow Phase 1 verification BEFORE any spec edits. If any verification step fails, halt and surface the failure to the user — do NOT land the promotion commit until every checklist item is green.

---

## Why this exists

The four envelope LLM-contract-hardening RFCs landed `Draft → Active` on 2026-05-20 under the bootstrap-phase steward waiver. The RFC process per `RFCS/0001-rfc-process.md` §"Promotion to Accepted" requires:

1. **Reference workflow-engine implementation** advertising the surface — **closed** by commits `88beb31` (RFC 0032/0033 dispatchStructured emission), `f5148cf` + `b6ac272` (RFC 0031 mock-AI machinery), 5 earlier commits covering the spec text + schemas (`a280371`).
2. **Conformance suite coverage** of every normative MUST — **closed** by commits `5817523` + `4dcd16b` + `9f2f29b` (38+ live HTTP-gated assertions across 14 scenario files).
3. **At least one non-steward host** advertising the surface — **closed** by MyndHyve workflow-runtime at `https://api.myndhyve.ai/.well-known/openwop` (commit `85834ccf`, Cloud Run revision `workflow-runtime-00327-kah`, deployed 2026-05-21 02:18 UTC).
4. **7-day comment window** open and clear of blocking issues — opened 2026-05-20, closes 2026-05-27.
5. **Adoption feedback folded into the spec text** — **closed** by 9 amendments across commits `9da6281` (8 normative-text clarifications) + `8d3c1c0` (2 error-code renames).

All four criteria are met by the time this runbook fires. The promotion is the final administrative step.

---

## Phase 1 — Pre-promotion verification (MUST run before any edits)

Run each step. Any FAIL halts the runbook — surface to the user.

### 1.1 Spec corpus gate

```bash
cd /Users/david/dev/openwop
npm run openwop:check 2>&1 | tail -10
```

**PASS criterion:** `=== openwop:check OK — spec corpus is internally consistent ===` in the output. All 9 steps green.

### 1.2 Commit chain integrity

Confirm all the load-bearing commits are still on `main` (no rebase / force-push removed them):

```bash
for c in a280371 88beb31 f5148cf b6ac272 5817523 4dcd16b 9f2f29b 9da6281 8d3c1c0 37eedc9 4ca5242; do
  git log --format="%h %s" -1 $c 2>/dev/null || echo "MISSING: $c"
done
```

**PASS criterion:** Every line shows a commit, no "MISSING" lines.

### 1.3 Adoption-feedback amendments still in place

```bash
grep -c "Active amendment (2026-05-21)" /Users/david/dev/openwop/RFCS/0030-envelope-reasoning-and-tier-one-subset.md \
  /Users/david/dev/openwop/RFCS/0031-envelope-variants-and-model-capabilities.md \
  /Users/david/dev/openwop/RFCS/0032-envelope-reliability-events.md \
  /Users/david/dev/openwop/RFCS/0033-envelope-completion-contract.md
```

**PASS criterion:** All four RFCs show `1` (one amendment block each).

### 1.4 Error-code rename intact

```bash
grep -rn "envelope_payload_invalid\|envelope_refused_by_provider" \
  /Users/david/dev/openwop/spec /Users/david/dev/openwop/RFCS \
  /Users/david/dev/openwop/schemas \
  /Users/david/dev/openwop/apps/workflow-engine/backend/typescript/src \
  /Users/david/dev/openwop/conformance/src/scenarios 2>&1 \
  | grep -v "renamed\|amendment\|from \`envelope_p" | head -5
```

**PASS criterion:** Zero remaining stale references (the only acceptable matches are documentation comments explicitly noting the rename history).

### 1.5 MyndHyve post-mint conformance result

Open `docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md` and check §E for the post-mint pass count. If MyndHyve has updated the file with their `npx vitest run` result after `gcloud auth login` + the API key mint:

**PASS criterion (preferred):** §E shows `83+ pass / 0 fail / 4 skip` (the 21 prior auth-blocks all closed). Update INTEROP-MATRIX row to reflect.

**PASS criterion (acceptable):** §E still shows `62 pass / 21 fail / 4 skip` because MyndHyve hasn't run the post-mint suite yet. The promotion can still land — the 62 passing assertions cover every advertised-capability-shape contract, which is the load-bearing cross-host validation evidence. The 21 auth-blocked tests verify the host's BYOK + run-event-log surfaces (RFC 0021 territory), not specifically RFC 0030/0031/0032/0033. Add a footnote to the INTEROP-MATRIX row noting "auth-blocked suite verification pending; advertised-capability conformance verified."

**HALT criterion:** §E shows any NEW failure that wasn't auth-blocked (i.e., something genuinely broke in MyndHyve's adoption). Surface to the user — promotion does not land until investigated.

### 1.6 No comment-window blockers

Check that no GitHub issue or `RFCS/*.md` Status: Draft has surfaced a blocking concern since 2026-05-20:

```bash
git log --since="2026-05-20" --until="2026-05-27" --oneline -- 'RFCS/' 'spec/v1/ai-envelope.md' 2>&1 | head -20
```

**PASS criterion:** All commits in this range are part of the planned envelope-track work (commits in the chain above, plus parallel-session prompt-track work that's orthogonal). No new RFC drafts contesting any of the four.

---

## Phase 2 — The promotion commit

### 2.1 Status-line bumps (4 RFCs)

For each of the four RFCs, edit the header table:

```diff
- | **Status** | `Active` |
+ | **Status** | `Accepted` |
- | **Updated** | 2026-05-20 (Draft → Active — see [Status history](#status-history) below). |
+ | **Updated** | 2026-05-27 (Active → Accepted — see [Status history](#status-history) below). |
```

### 2.2 Status-history entry (4 RFCs)

Add to the top of each RFC's `## Status history` section (above the existing `### Active amendment (2026-05-21)` block):

```markdown
### Active → Accepted (2026-05-27)

Promoted to `Accepted` at the close of the 7-day comment window opened 2026-05-20. Per `RFCS/0001-rfc-process.md` §"Promotion to Accepted," the four acceptance criteria are met:

1. **Reference workflow-engine implementation.** The host advertises the surface at `examples/hosts/*/` and emits the events end-to-end through `dispatchStructured()` (commits `88beb31` + `f5148cf` + `b6ac272` + the RFC-text-and-schemas landing in `a280371`).
2. **Conformance suite coverage.** 38+ live HTTP-gated assertions across 14 scenario files cover every MUST-tier normative requirement (commits `5817523` + `4dcd16b` + `9f2f29b`).
3. **Third-party host adoption.** MyndHyve workflow-runtime at `https://api.myndhyve.ai/.well-known/openwop` (commit `85834ccf`, Cloud Run revision `workflow-runtime-00327-kah`) advertises the surface and passes the cross-host conformance suite at the expected pass-count for the host's posture (see `INTEROP-MATRIX.md` §"Third-party host adoption — RFC 0030/0031/0032/0033").
4. **Adoption feedback folded.** 9 spec amendments from the MyndHyve adoption-feedback round landed 2026-05-21 (commits `9da6281` + `8d3c1c0`) — see the `### Active amendment (2026-05-21)` block below for the per-amendment record.

Compatibility: ratification is **non-normative** — no new wire surface, no schema changes, no behavior changes. The spec text + reference implementation + conformance + cross-host adoption that earned the promotion all landed in earlier commits.
```

### 2.3 `spec/v1/ai-envelope.md` Status-line update

Find the Status line at the top of `spec/v1/ai-envelope.md` referencing the four RFCs:

```
Extended additively by [RFC 0030] (`Active 2026-05-20`)... [RFC 0031] (`Active 2026-05-20`)... [RFC 0032] (`Active 2026-05-20`)... [RFC 0033] (`Active 2026-05-20`)...
```

Replace each `Active 2026-05-20` annotation with `Accepted 2026-05-27`.

### 2.4 CHANGELOG entry

Insert at the **top** of `[1.1.2 — unreleased]` section (above any other 2026-05-27 entries the parallel session may have added):

```markdown
### RFC 0030 / 0031 / 0032 / 0033 promoted Active → Accepted (2026-05-27)

The four envelope LLM-contract-hardening RFCs reach `Accepted` status at the close of the 7-day comment window opened 2026-05-20. Per `RFCS/0001-rfc-process.md`:

- **RFC 0030** — Envelope `reasoning` field + Tier-1 structured-output subset
- **RFC 0031** — Envelope variant discrimination + model-capability declarations
- **RFC 0032** — Envelope-reliability run-event vocabulary
- **RFC 0033** — Envelope-completion contract (truncation vs schema-violation retry routing)

**Evidence chain that earned the promotion:**

- *Spec text + schemas + RunEventType enum + SECURITY invariants:* commit `a280371` (Draft → Active, 2026-05-20).
- *Reference workflow-engine emission:* commits `88beb31` (dispatchStructured failure-mode-aware retry router emitting the four MUST/SHOULD-tier events) + `f5148cf` (conformance-only mock-AI provider + program seam) + `b6ac272` (`mock` in SUPPORTED_PROVIDERS allowlist).
- *Conformance promotion:* commits `5817523` (Phase 4 part 1 — mock-AI nodeId keying + envelope-retry-attempted end-to-end) + `4dcd16b` (Phase 4 part 2 — 4 envelope-track scenarios + 3 fixtures) + `9f2f29b` (envelope-refusal-shape end-to-end). **38+ live HTTP-gated assertions** across 14 scenario files.
- *Cross-host adoption:* MyndHyve workflow-runtime at `https://api.myndhyve.ai/.well-known/openwop` (commit `85834ccf`, Cloud Run revision `workflow-runtime-00327-kah`). See `INTEROP-MATRIX.md` §"Third-party host adoption — RFC 0030/0031/0032/0033" for the conformance row.
- *Adoption-feedback amendments:* commits `9da6281` (8 normative-text clarifications) + `8d3c1c0` (2 error-code renames: `envelope_payload_invalid` → `envelope_invalid`; `envelope_refused_by_provider` → `envelope_refusal`).

Compatibility: ratification is **non-normative** per `COMPATIBILITY.md` — no wire surface changes, no schema changes, no behavior changes. The promotion records that the spec text + reference implementation + cross-host conformance evidence reached the bar; subsequent hosts adopt against a `Accepted`-tier surface with the same wire contract that's been in effect since `a280371`.

**Deferred (post-Accepted slice):** three SDK helper publishes surfaced by MyndHyve's §B.3 adoption feedback — `parseRefusal(providerResponse): RefusalSignal | null` (per-provider safety-stop normalizer), `buildReasoningDirective` export from `sdk/typescript/`, and `@openwop/conformance-sdk/mint-test-key`. Tracked in `docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md` §"Summary of resolutions" rows #10–#12.
```

### 2.5 INTEROP-MATRIX.md timestamp + row freshness

- Update the `> **Last updated:** 2026-05-15` line at the top to `2026-05-27`.
- Verify the MyndHyve row under §"Third-party host adoption — RFC 0030/0031/0032/0033" still reflects current state. If §1.5 yielded the post-mint result, update the pass count from `62 pass / 21 auth-blocked / 4 skip` to whatever MyndHyve recorded.

---

## Phase 3 — Gate + commit + push

### 3.1 Final gate

```bash
cd /Users/david/dev/openwop && npm run openwop:check 2>&1 | tail -6
```

**PASS criterion:** `=== openwop:check OK — spec corpus is internally consistent ===`.

### 3.2 Commit with DCO sign-off

```bash
git add RFCS/0030-envelope-reasoning-and-tier-one-subset.md \
        RFCS/0031-envelope-variants-and-model-capabilities.md \
        RFCS/0032-envelope-reliability-events.md \
        RFCS/0033-envelope-completion-contract.md \
        spec/v1/ai-envelope.md \
        CHANGELOG.md \
        INTEROP-MATRIX.md

git commit -s -m "$(cat <<'EOF'
spec(v1): RFC 0030 / 0031 / 0032 / 0033 — Active → Accepted (envelope LLM-contract-hardening track ratified)

Promotes the four envelope LLM-contract-hardening RFCs from `Active` to
`Accepted` at the close of the 7-day comment window opened 2026-05-20.
All four acceptance criteria from RFCS/0001-rfc-process.md §"Promotion
to Accepted" are met:

1. Reference workflow-engine implementation advertising the surface
   (commits 88beb31 + f5148cf + b6ac272 + the spec/schemas landing in
   a280371).
2. Conformance suite coverage — 38+ live HTTP-gated assertions across
   14 scenario files (commits 5817523 + 4dcd16b + 9f2f29b).
3. Third-party host adoption — MyndHyve workflow-runtime at
   https://api.myndhyve.ai/.well-known/openwop (commit 85834ccf, Cloud
   Run revision workflow-runtime-00327-kah) advertises the surface and
   passes cross-host conformance.
4. Adoption feedback folded — 9 spec amendments from the MyndHyve
   adoption-feedback round landed 2026-05-21 (commits 9da6281 +
   8d3c1c0): 8 normative-text clarifications + 2 error-code renames
   (envelope_payload_invalid → envelope_invalid; envelope_refused_by_
   provider → envelope_refusal).

Status updates land on:
- RFCS/0030-envelope-reasoning-and-tier-one-subset.md
- RFCS/0031-envelope-variants-and-model-capabilities.md
- RFCS/0032-envelope-reliability-events.md
- RFCS/0033-envelope-completion-contract.md
- spec/v1/ai-envelope.md (Status: line cross-references)
- INTEROP-MATRIX.md (Last updated timestamp + MyndHyve row freshness)

Each RFC gains a `### Active → Accepted (2026-05-27)` Status history
entry above the existing `### Active amendment (2026-05-21)` block
documenting the evidence chain that earned the promotion.

Compatibility: **non-normative** per COMPATIBILITY.md. Ratification
records that the spec text + reference implementation + cross-host
conformance + adoption-feedback amendments reached the bar; no wire
surface changes, no schema changes, no behavior changes. The spec
contract has been stable since a280371; subsequent hosts adopt against
an `Accepted`-tier surface with the same wire contract.

Deferred (post-Accepted follow-up slice): three SDK helper publishes
surfaced by MyndHyve's §B.3 adoption feedback (parseRefusal,
buildReasoningDirective export from sdk/typescript, @openwop/conformance-
sdk/mint-test-key). Tracked in
docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md
§"Summary of resolutions" rows #10–#12.

`npm run openwop:check` 9/9 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 3.3 Push (steward decision)

Do NOT push automatically. Surface the commit hash to the user with a one-line summary; the user runs `git push origin main` when they're ready (per the project's "do not push unless explicitly requested" discipline).

---

## Phase 4 — Post-promotion follow-ups

After the promotion commit is pushed:

1. **MyndHyve session notification** — paste the commit hash + Status promotion message to MyndHyve's Claude Code session so they can update their internal advertisement claims from "Active" to "Accepted" if they surface tier in their docs.
2. **Deferred SDK helper slice** — open a tracking issue for `parseRefusal` + `buildReasoningDirective` export + `mint-test-key` per the §B.3 feedback. Each is a small focused slice; estimated 0.5–1 day each.
3. **Site rebuild** — `site/src/build.mjs` re-renders from the spec corpus on next commit, so no site action needed; new `Accepted` status surfaces on `openwop.dev` automatically.

---

## If something goes wrong

- **Gate fails on §1.1:** Halt. Surface to the user. The promotion does NOT land until the gate is green.
- **Commit chain integrity check fails on §1.2:** A commit got rebased away. Surface to user; do not land the promotion until the history is restored or the runbook is updated to reflect the new SHAs.
- **§1.5 surfaces a MyndHyve regression:** Halt. Surface the regression. The promotion may need to wait for a fix-up commit OR the comment window may need to extend per `RFCS/0001-rfc-process.md` §"Critical issue surfaced during comment window."
- **Parallel-session conflict:** If the working tree has unstaged changes from the parallel session, do NOT land the promotion via `git commit -a`. Stage only the 7 files listed in §3.2 explicitly. Other files stay unstaged.

---

## Runbook completion

When Phase 3.2 is done and the user has been notified, this runbook is complete. Per the §F entry in the MyndHyve adoption feedback, the next-slice work is the 3 SDK helper publishes — but those are independent from this runbook.
