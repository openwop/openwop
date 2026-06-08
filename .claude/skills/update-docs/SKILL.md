---
name: update-docs
description: Sync openwop's user-facing and contributor-facing docs after a change lands. Covers README (Document index, status banners), CHANGELOG ([Unreleased] hygiene), INTEROP-MATRIX (host advertisements), ROADMAP (gap-closure tracks), RFCS/README (status table), QUICKSTART, PUBLISHING, MAINTAINERS, and the spec site templates. Distinguishes the doc surfaces openwop actually has from app-style docs (no canvases / hyves / dashboards exist here).
---

# Update Documentation (openwop)

You are now in **Docs Sync Mode**. Your task is to update openwop's documentation surfaces to reflect the changes made in the current session.

## Feature/Changes to document: $ARGUMENTS

openwop is a **wire-level spec project**. The "docs" surface here is not user-facing app help; it is contributor + implementer reference material plus the public credibility surface. The doc landscape:

| Surface | Purpose | Audience |
|---|---|---|
| `README.md` | Protocol overview + Document index table + status banners + publish-ready artifacts | First-time visitor, evaluators, decision-makers |
| `CHANGELOG.md` | Version-by-version compatibility record | Implementers tracking releases |
| `INTEROP-MATRIX.md` | Reference + third-party host advertisements | Implementers + integrators evaluating compatibility |
| `ROADMAP.md` | Planned work + closure tracks + vendor-neutral tripwire | Contributors, prospective maintainers, observers |
| `RFCS/README.md` + each `RFCS/NNNN-*.md` | Public design record + Status table | RFC reviewers, contributors |
| `CONTRIBUTING.md` | Per-artifact change rules + CI gate + DCO | Contributors |
| `COMPATIBILITY.md` | Additive vs safety-fix vs breaking commitment | Implementers + RFC authors |
| `GOVERNANCE.md` | Decision rules + maintainer roles | Maintainers, governance observers |
| `MAINTAINERS.md` | Current maintainer set | Everyone (tripwire surface) |
| `SECURITY.md` + `SECURITY/*.md` | Threat models, invariants, audit engagement | Security reviewers, threat-model consumers |
| `PUBLISHING.md` | Per-package release cadence + version axes | Maintainers when cutting a release |
| `QUICKSTART.md` + `QUICKSTART-10MIN.md` | Onboarding for first-time implementers | New host authors |
| `CODE_OF_CONDUCT.md` | Community baseline | Everyone |
| `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` | Internal track grading (A–C) | Maintainer planning |
| `docs/runbooks/` | Operational runbooks (e.g., signing-key rotation, embargoed disclosure) | Operators |
| `../openwop-examples/examples/hosts/{name}/conformance.md` | Public evidence file for each reference host | Implementers comparing hosts |
| `conformance/coverage.md` + `fixtures.md` | Coverage map + fixture catalog | Scenario authors |
| `../openwop-site/site/templates/` + `../openwop-site/public/` | Spec-site frontend (Firebase Hosting target) | Public visitors to `openwop.dev` |

There is **no** `src/components/docs/`, no canvas types, no design-token system. Don't write docs for those surfaces — they don't exist here.

---

## Drift patterns we've hit before (catalog)

This skill exists in large part because openwop's docs hold up multiple parallel claims about the same facts — RFC statuses, invariant counts, conformance pass rates, host capability claims — and those claims drift independently. Below is the historical-precedent catalog: each row is a real drift mode that has shipped to `main` and was caught later, with the mechanical detection command. **Always run these before declaring a docs-sync done.**

| # | Drift surface | Failure mode | Detection command |
|---|---|---|---|
| 1 | **README invariant counts ↔ `SECURITY/invariants.yaml`** | README claims "N protocol-tier / M reference-impl" but the YAML's `tier:` field counts differ — usually because invariants graduated tier and the README banner wasn't bumped. Caught by `scripts/openwop-check.sh` step 7, but worth knowing the manual recipe. | `diff <(grep -cE '^    tier: protocol$' SECURITY/invariants.yaml) <(echo $(grep -oE '[0-9]+ protocol-tier' README.md \| head -1 \| grep -oE '^[0-9]+'))` |
| 2 | **README RFC counts ↔ `RFCS/[0-9]+-*.md` Status:** | README banner says "N Accepted / M Active / K Draft" but new RFC files landed without updating the banner. Same for `41 RFCs excluding template` ↔ actual file count. | `bash scripts/openwop-check.sh` step 7 reports `claims "N" Draft RFCs but actual is M`. Manual: `grep -lE '^\\| \\*\\*Status\\*\\* \\| \`Draft\`' RFCS/[0-9]*.md \| wc -l` |
| 3 | **`docs/KNOWN-LIMITS.md` "RFCs not yet Accepted" table ↔ actual RFC Status fields** | KNOWN-LIMITS rows still list RFCs as `Active` after they were promoted to `Accepted` (or as `Draft` after promotion to `Active`). The PROTOCOL-STATUS.md generated table is authoritative; KNOWN-LIMITS is hand-maintained and lags. | `for rfc in 0025 0027 0028 0029 0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043; do f=RFCS/${rfc}-*.md; if ls $f &>/dev/null; then s=$(grep -oE '\`Draft\`\|\`Active\`\|\`Accepted\`\|\`Withdrawn\`' $f \| head -1); k=$(grep -oE "$rfc [^\|]*\| \`[A-Z][a-z]+\`" docs/KNOWN-LIMITS.md \| head -1); [ -n "$k" ] && echo "RFC $rfc actual=$s known-limits=$k"; fi; done` |
| 4 | **`conformance/coverage.md` "Updated YYYY-MM-DD" header stale** | The body of coverage.md gets line-edited but the top-of-file date stays at a months-old timestamp, signaling staleness even when content is fresh. | `grep -E 'Updated 20[0-9]{2}-[0-9]{2}-[0-9]{2}' conformance/coverage.md \| head -1` — compare against `git log -1 --format=%ai conformance/coverage.md`. |
| 5 | **`conformance/coverage.md` operation rows claim "endpoint surface in spec only" while host has impl** | When a reference host wires an endpoint, coverage.md often lags. Hit this on prompt endpoints — RFC 0028 promoted Draft → Active and the workflow-engine implemented all 6 `/v1/prompts*` routes, but coverage.md rows still said "reference host hasn't implemented the route yet." | `for op in createPromptTemplate updatePromptTemplate deletePromptTemplate; do  if grep -l "$op" ../openwop-app/backend/typescript/src/routes/*.ts ../openwop-examples/examples/hosts/*/src/routes/*.ts 2>/dev/null; then echo "$op: implemented"; if grep -E "\`$op\` \\\| None.*endpoint surface in spec only" conformance/coverage.md; then echo "  but coverage.md still claims unimplemented"; fi; fi; done` |
| 6 | **`INTEROP-MATRIX.md` pass-rate table measured against an older suite version** | The "Conformance trajectory" / pass-rate table cites suite `vX.Y.Z` but `conformance/package.json` has bumped past it. New scenarios in the newer suite shift the totals significantly (e.g., +700 tests v1.1.0 → v1.4.0). | `cur=$(jq -r .version conformance/package.json); cited=$(grep -oE 'suite v[0-9]+\\.[0-9]+\\.[0-9]+' INTEROP-MATRIX.md \| head -1); echo "current=$cur cited=$cited"` |
| 7 | **`INTEROP-MATRIX.md` host-description columns carry pass-rate claims that read as current but are historical** | Host row description columns embed claims like "Conformance close-out 2026-05-12: 700/788 = 100% of applicable tests pass; zero failures" with no retrospective marker. After the table above the description is re-measured to v1.4.0, the description still reads as a current claim and conflicts with the table. | `grep -E 'Conformance close-out [0-9]{4}\|^[\| ]+Conformance posture' INTEROP-MATRIX.md \| grep -v 'suite v'` — any line that quotes a pass-rate without a `(YYYY-MM-DD, suite vX.Y.Z)` retrospective marker is suspect. |
| 8 | **`../openwop-examples/examples/hosts/<name>/conformance.md` banner stale relative to suite** | The first 5 lines of the host evidence file cite a specific suite version + run date; if these lag conformance/package.json, the evidence reads as fresh when it's not. | `cur=$(jq -r .version conformance/package.json); for h in in-memory sqlite postgres python; do f=../openwop-examples/examples/hosts/$h/conformance*.md; cited=$(grep -oE '@openwop/openwop-conformance@[0-9.]+' $f \| head -1); echo "$h: cited=$cited current=$cur"; done` |
| 9 | **`docs/PROTOCOL-STATUS.md` not regenerated after sources moved** | This file is generated by `scripts/generate-protocol-status.mjs --write`. Whenever `INTEROP-MATRIX.md` pass-rates / `SECURITY/invariants.yaml` tier counts / RFC files / SDK helper counts / registry counts change, the generator must re-run. Caught by `--check` mode in step 7. | `node scripts/generate-protocol-status.mjs --check` exits non-zero if stale. |
| 10 | **Cross-doc file paths cited in new docs don't exist** | New explanatory docs (e.g., progress trackers, audit responses) cite paths like `../openwop-app/backend/typescript/src/host/mockAiProvider.ts` that aren't on disk. Erodes credibility of the very doc trying to demonstrate accountability. | `for f in docs/*.md RFCS/0042*.md RFCS/0043*.md docs/AUDIT-RESPONSE-2026-05.md docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md; do [ -f "$f" ] && grep -oE '[a-z][a-zA-Z0-9_-]+(/[a-zA-Z0-9._-]+)+\.(ts\|mjs\|js\|json\|yaml\|md\|py\|go\|sh)' "$f" \| sort -u \| while read p; do [ -e "$p" ] \|\| echo "$f: MISSING $p"; done; done` |
| 11 | **Reverted feature still claimed as live** | When a commit reverts a feature (e.g., commit `5864a2f` reverted 7 sandbox SECURITY tier graduations), prose docs that mentioned the now-reverted graduation as fact (`docs/KNOWN-LIMITS.md`, `README.md` parenthetical, RFC follow-up status) need to be re-aligned. | `git log --grep='revert\|undo\|fix.*revert' --oneline -5` then scan named files. |
| 12 | **`CHANGELOG.md` `[Unreleased]` empty after a doc-only session** | Doc-sync sessions that don't add a CHANGELOG line make the next release cut surprise the reader. **Detection caveat 1:** the obvious `awk '/^## \[Unreleased/,/^## \[/' CHANGELOG.md` range expression returns empty when only one `## [` heading exists in the file (the steady state until a release cut). **Detection caveat 2:** this repo's actual convention is `## [X.Y.Z — unreleased]` (e.g., `## [1.1.3 — unreleased]`), NOT bare `## [Unreleased]` — so a regex hard-coded to `\[Unreleased\]` will miss every entry. Use a permissive pattern that matches both forms. | `awk '/^## \\[[^]]*[Uu]nreleased/{flag=1;next} /^## \\[/{flag=0} flag' CHANGELOG.md \| grep -cE '^- '` |
| 13 | **Partial multi-RFC row promotion in a comma-separated KNOWN-LIMITS row** | KNOWN-LIMITS uses rows like `\| 0037, 0039, 0040, 0041 (Multi-agent execution model Phases 1–4) \| Active \|`. When some but not all of the listed RFCs promote to `Accepted` (this session: 0037 + 0039 promoted, 0040 + 0041 stayed Active), the row must be **split**, not removed. Either "remove the row" or "leave the row" is wrong — the fix is `0037, 0039, 0040, 0041` → `0040, 0041` (drop the promoted IDs) + add a post-table prose paragraph noting which IDs graduated and when. | The Drift #3 scoped-section regex above will catch this once you confirm `0037` + `0039` no longer appear anywhere inside §"RFCs not yet `Accepted`". |
| 14 | **Suite minor bump changes pass-counts even when CHANGELOG says "no new scenario files"** | A suite version bump (e.g., v1.4.0 → v1.5.0) can shift test totals without adding new files when an existing scenario gets relaxed AND the relaxation splits one strict-equality `expect(…).toBe(…)` into multiple discrete `it()` blocks. v1.5.0 grew 1558 → 1564 tests this way via the RFC 0044 vendor-kind routing relaxation. Lesson: re-measure even when CHANGELOG says no scenarios changed. | `cur=$(jq -r .version conformance/package.json); cited=$(grep -oE 'against suite v[0-9.]+' INTEROP-MATRIX.md \| head -1); [ "$cur" != "$cited" ] && echo "RE-MEASURE"` |
| 15 | **External host advertisement triggers a suite bump cascade** | A non-steward host (e.g., MyndHyve) advertising a new capability often unblocks a Draft RFC → Active → Accepted promotion **and** drives a suite minor bump to ship the relaxed assertion logic. When you see `release(conformance):` commits, expect Drift #6, #8, #10 (host conformance.md banners), and #12 to all need attention in the same docs-sync. The bumps cluster. | `git log --oneline -10 \| grep -E 'release\(conformance\)\|Active → Accepted'` — any hit means cascade work is queued. |
| 16 | **Drift #10 (file-path regex) has a high false-positive rate** | The path-extraction regex `[a-z][a-zA-Z0-9_-]+(/[a-zA-Z0-9._-]+){1,}\.(ts\|mjs\|...)` will flag (a) Markdown link-text segments where the surrounding `[`...`](full/path)` link itself resolves but the regex captured only the inner text; (b) intentional relative-shorthand citations where the doc is operating within a host-scoped paragraph (e.g., `executor/modelCapabilityGate.ts` inside a Postgres-host description that doesn't repeat `../openwop-app/backend/typescript/src/`); (c) behavioral-harness-progress-style accountability docs that intentionally name files-to-be-created. Before flagging a path as missing, verify it isn't one of these patterns. | After running Drift #10, manually inspect each MISSING hit — only ~30% on average are real bugs. |
| 17 | **Historical evidence files predating the suite-version convention** | `../openwop-examples/examples/hosts/<h>/conformance-full.md` and similar historical full-run records may carry a "Run date: 2026-05-11" but no `@openwop/openwop-conformance@X.Y.Z` citation because they predate versioned-suite convention. Drift #8 flags these as stale (empty `cited=`). Fix recipe is NOT "re-measure" — it's "add a `Latest measurement is at conformance.md` pointer at the top so the historical file doesn't read as current." | `for f in ../openwop-examples/examples/hosts/*/conformance-full.md ../openwop-examples/examples/hosts/*/conformance-phase*.md; do [ -f "$f" ] && head -10 "$f" \| grep -qE 'Latest measurement is at\|pre-versioned-suite era' \|\| echo "$f: needs historical-marker prefix"; done` |
| 18 | **`README.md` prose RFC-status lists lag the actual `Status:` fields** | The README banner at line ~66 is the generated-status surface that `scripts/generate-protocol-status.mjs --check` keeps honest (counts match `SECURITY/invariants.yaml` + actual RFC `Status:` fields). But the **per-RFC prose lists below** ("v1.x Capability Profiles", "Active RFCs", "Draft RFCs") are hand-curated and lag promotions. The 2026-05-23 audit caught README:281 marking RFCs 0027/0030/0031/0032/0033 as `Active` after they had all promoted to `Accepted` between 2026-05-21 and 2026-05-23. Generated-status passes; prose lags silently. | Scope the comparison to the prose lists explicitly: `awk '/\*\*Active RFCs/{flag=1} /\*\*Draft RFCs\|\*\*v1 Foundation/{flag=0} flag' README.md \| grep -oE 'RFC [0-9]+' \| sort -u > /tmp/readme-active.txt; for f in RFCS/[0-9][0-9][0-9][0-9]-*.md; do id=$(basename "$f" \| grep -oE '^[0-9]+'); s=$(grep -m1 '^\| \*\*Status\*\*' "$f"); echo "$s" \| grep -q '\`Active\`' && echo "$id"; done \| sort -u > /tmp/actual-active.txt; diff /tmp/readme-active.txt /tmp/actual-active.txt` |
| 19 | **Per-track "Closing PR: TBD" strings linger AFTER a closure-snapshot table is added** | When a multi-track tracking doc (e.g., `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`) gets a closure snapshot prepended at the top of file (e.g., "Closure snapshot — 2026-05-22 (ALL TRACKS CLOSED) \| ✅ commit refs"), the per-track sections below often retain their original `Closing PR: TBD — feat(…)` strings — so the document says both "all closed" AND "still TBD" in different sections. Internal contradictions like this are exactly what external auditors flag as eroding credibility (the 2026-05-23 audit caught this verbatim in `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`). | `grep -nE "Closing PR.*TBD\|Closing commits.*TBD" docs/*.md \| head -10` — any hit on a doc that ALSO has a "ALL TRACKS CLOSED" or "✅ CLOSED end-to-end" snapshot above is a contradiction. Fix recipe: rewrite each `Closing PR: TBD — feat(…)` into `Closing commit: ✅ <sha> (date)` with the actual closing commit from the snapshot. |
| 20 | **`it.todo` callsite count diverges from "grep `it.todo`" because of comment mentions** | An external auditor's mechanical `grep -rc 'it.todo'` against `conformance/src/scenarios/` over-counts when scenario files describe their own state via comments (e.g., "Surfaced as `it.todo` so reporters track the gap"). The Phase 4 SKILL.md was caught with this same drift — comment mentions inflated 14 actual callsites to 20 reported. **Use `grep -P 'it\.todo\('` to anchor on actual callsites (the `(` rules out comment mentions); use plain `grep 'it.todo'` only when intentionally surveying the comment-as-tracking-marker pattern.** Conversely: when retiring `it.todo` blocks via cross-reference `it.skip`, leave a comment that says `it.todo` (without the `(`) so test-reporter tooling that scans for the literal can still find the marker — the `grep -P` form will correctly exclude it. | Auditor-style: `grep -rcP 'it\.todo\(' conformance/src/scenarios/ \| awk -F: '$2>0' \| sort -t: -k2 -rn \| head -20` — produces the real per-file callsite count. Pair with `grep -rcl 'it\.todo' conformance/src/scenarios/ \| wc -l` only to count files-that-mention-the-marker, not callsites. |
| 21 | **`npx -y -p @<pkg>@latest` in `openwop-check.sh` races the npm cache** | The validator toolchain (`@asyncapi/cli`, `@redocly/cli`) was historically invoked via `npx -y -p @<pkg>@latest`, which races itself when two `openwop-check.sh` runs interleave (or when the cache TTL expires mid-fetch), producing `ECOMPROMISED Lock compromised` errors that require `rm -rf /tmp/openwop-npm-cache` to recover. External auditor 2026-05-23 hit this twice. Fix landed 2026-05-23: pinned versions in repo-root `package.json#devDependencies` + scripts call `./node_modules/.bin/redocly` and `./node_modules/.bin/asyncapi` directly. **Lesson:** ANY validator-toolchain bump in this repo must go through a pinned devDependency, not `npx -y`. | `grep -nE "npx -y" scripts/openwop-check.sh .github/workflows/openwop-spec.yml 2>/dev/null` — any match outside the explanatory header comments is a regression. |
| 22 | **Internal phasing labels ("Phase N", "Track N", "Half N") in external-facing prose** | The repo uses several internal sequencing schemes — multi-agent execution model "Phase 1-4" (RFCs 0037/0039/0040/0041 — also bound to wire-shape `multiAgent.executionModel.version: 1-4`), Postgres host "Phase H/I" operational launch tracks, "Multi-Agent Shift Phase N" yet-another-scheme, ROADMAP "Phase 1 — Credibility / Phase 2 — Adoption / Phase 3 — Ecosystem", session-label "Phase A/B/C/D" audit responses, audit "Track #1-#7" harness IDs. Each makes perfect sense to whoever filed it. **None of them mean anything to an external reader.** External auditor 2026-05-24 said verbatim: "Remove all references to 'phase 4' from our documentation as no one else will know what that is." The right replacement depends on the scheme — for the multi-agent model where the integer IS on the wire, swap to `version: N` + RFC number + feature name; for purely-internal schemes, use feature-describing prose. NEVER rename: the wire-shape integer (`version: N`), advertised env vars (`OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true`), or immutable historical CHANGELOG entries. The fix recipes for #18 (README prose-list lag) + #19 (closure-snapshot contradiction) often co-occur with this — a docs-sync that touches the multi-agent prose typically catches all three drift modes in one pass. | `grep -rn "Phase [0-9A-Z]" --include="*.md" --exclude-dir=node_modules --exclude-dir=apps --exclude-dir=plans . 2>/dev/null \| grep -vE "Phase H/I\|RFC 0013 Phase \|RFC 0027 Phase A\|ROADMAP\|Phase 3 of Multi-Agent Shift\|## \[1\." \| head -30` — surfaces multi-agent prose mentions while filtering out the legitimately-different phasing schemes + historical CHANGELOG entries. Triage each hit manually; the regex is aggressive on purpose. |
| 23 | **Capability-gated behavioral scenarios pass vacuously on missing evidence** | A gated behavioral scenario (`behaviorGate(...)` / profile-gate + an event-log seam + a `drive…()` helper) correctly soft-skips when the host hasn't opted in — but then wraps its EVIDENCE assertions in conditionals so a host that DID advertise the capability + wire the seam but emits nothing still passes: `if (q.ok && events.length > 0) { expect(...) }`, `if (status === 200) { …schema-validate… }`, `expect(deliveredForKey.length <= 1)` where the spec says EXACTLY one, or `expect(causationId.length > 0)` where the spec says it MUST EQUAL a specific id. The independent audit 2026-06-01 caught `agent-eval-run` + `agent-deployment-lifecycle` + `trigger-bridge-delivery` with exactly this (closed by conformance 1.17.0). The rule: the only LEGITIMATE soft-skips are (capability/profile not advertised, event-log seam absent, the `drive…()` seam returns null). **Once the host has opted in AND returned a runId, missing evidence MUST be a hard failure** — use `requireEvents(query, where)` (`conformance/src/lib/event-log-query.ts`, asserts the query succeeded + returns typed events), and assert exact counts / equality, never `> 0` / `<= 1` / `non-empty`. A scenario-strictness change to an already-published suite version needs a conformance bump (Drift #24). | `grep -rnE 'if \([a-zA-Z]+Q?\.(ok\|events\.length\|status)\b' conformance/src/scenarios/*.test.ts \| grep -vE 'return;'` surfaces conditionals that GUARD (rather than early-`return` skip) a block — inspect each: if the guarded block holds `expect(...)` that simply won't run when the condition is false (and the condition is reachable only AFTER the opt-in gates), it is a vacuous-pass hole. Also grep `'\.length <= 1\|\.length > 0)\|causationId.*length > 0'` for the off-by-one / existence-not-equality forms. |
| 24 | **`EXPECTED_CONFORMANCE_VERSION` lags `conformance/package.json` after a release — in TWO places** | A `release(conformance)` bump changes `conformance/package.json` `version`, but the expected-version pin lives in **two** scripts: `scripts/openwop-check-publish-metadata.sh` (`EXPECTED_CONFORMANCE_VERSION="X.Y.Z"`) AND `scripts/check-npm-pack-contents.sh` (`conformancePack.version === 'X.Y.Z'`). If either lags, the respective gate fails (the audit 2026-06-01 reported package.json `1.13.0` while the scripts expected `1.11.0` — a stale-checkout artifact, but the two-place pin is the real hazard). Corollary: changing the CONTENT of scenarios at an already-published suite version (npm already serves it) without bumping leaves repo ≠ npm at the same version number — silent drift; bump instead. | `cur=$(jq -r .version conformance/package.json); a=$(grep -oE 'EXPECTED_CONFORMANCE_VERSION="[0-9.]+"' scripts/openwop-check-publish-metadata.sh \| grep -oE '[0-9.]+'); b=$(grep -oE "conformancePack.version === '[0-9.]+'" scripts/check-npm-pack-contents.sh \| grep -oE '[0-9.]+'); echo "pkg=$cur meta=$a pack=$b"; { [ "$cur" = "$a" ] && [ "$cur" = "$b" ]; } && echo OK \|\| echo MISMATCH. Before editing published-suite scenarios, run `npm view @openwop/openwop-conformance version` — if it already serves `$cur`, you MUST bump. |
| 25 | **A "failing gate / stale generated status" finding is the SHARED DEV CHECKOUT, not the canonical repo** | `protocol:status:check` / `openwop:check` / the publish-metadata gate can FAIL in `/Users/david/dev/openwop` (the shared dev checkout) while PASSING on `origin/main` — the shared checkout's local `main` drifts behind `origin/main` AND its working tree accumulates uncommitted parallel-session edits (new scenarios / flipped RFC statuses / graduated invariants) whose generated surfaces (`PROTOCOL-STATUS.md`, README counts) are regenerated at merge time on `origin/main` but not locally. The audit 2026-06-01 reported 310 scenarios / 80 protocol-tier / generated `308`-vs-README `307` — numbers matching NEITHER `origin/main` (322/88) NOR each other: the signature of a drifted local checkout. **Before reporting a gate failure or "fixing" generated files, reproduce on a FRESH `origin/main` worktree.** A regen run against a drifted local tree bakes the drift in and becomes the next stale artifact. | `git -C <repo> fetch origin -q && git -C <repo> worktree add /tmp/owp-verify origin/main --detach && ( cd /tmp/owp-verify && node scripts/generate-protocol-status.mjs --check && bash scripts/openwop-check-publish-metadata.sh ); git -C <repo> worktree remove /tmp/owp-verify --force` — green on the fresh worktree ⇒ the finding is local-checkout drift; the fix is to sync the shared checkout (or scope the claim to "local-only"), NOT to regenerate against the drifted tree. |
| 26 | **The spec corpus declares a canonical public URL the published site doesn't serve** (`$id` geometry ↔ `../openwop-site` build output) | Every `schemas/**/*.schema.json` declares `"$id": "https://openwop.dev/spec/v1/<name>.schema.json"` (envelope schemas nest one level: `.../spec/v1/envelopes/<name>.schema.json`), and `CONTRIBUTING.md` §"JSON Schemas" + the schema-discipline checks promise that exact URL resolves — but the *site* only has to **serve** it. The 2026-06-08 docs-sync found `../openwop-site/scripts/build-site.sh` copied schemas to `public/schemas/` only (for the Redoc viewer's relative `../schemas` `$ref`s), so every declared `$id` **404'd on the live site**: third-party Ajv2020 hosts resolving `$ref` against the `$id` get a 404, and the corpus's own canonical-URL claim was false. The trap: **`openwop:check` + `generate-protocol-status.mjs --check` are all green** — the schemas are *valid*; the break is purely in WHAT THE SITE SERVES, a surface no corpus-side gate (and no `update-docs` drift mode before this one) inspects. `../openwop-site`'s own `/browser` skill Step 5 is the authoritative live check, but a corpus-only docs-sync never runs it. Generalizes beyond schemas to any corpus-declared canonical URL (OpenAPI/AsyncAPI `$id`s, doc canonical links). Fixed 2026-06-08 by also publishing the schemas tree under `public/spec/v1/`. | Build the site and verify each declared `$id` lands in `public/` (deterministic, no network): `( cd ../openwop-site && OPENWOP_ROOT="$(cd ../openwop && pwd)" bash scripts/build-site.sh >/dev/null 2>&1 ); for f in $(find schemas -name '*.schema.json'); do u=$(grep -oE 'https://openwop.dev/spec/v1[^"]+' "$f" \| head -1); [ -f "../openwop-site/public${u#https://openwop.dev}" ] \|\| echo "UNSERVED $u ($f)"; done` — any `UNSERVED` line is a declared `$id` the site won't serve. `/browser` Step 5 is the live-site equivalent. |

When auditing a session, walk this table from #1 to #26 and flag any row whose detection command surfaces a hit. If you find one, the corresponding row in the **Phase 4** drift-verification section below has the fix recipe. **Run every detection command on a fresh `origin/main` worktree (Drift #25) — the shared dev checkout drifts and produces false positives.**

### Catalog meta-lesson — detection commands are themselves drift surfaces

When designing a detection command, account for:
- **Section scoping.** A doc may have multiple tables; a regex that doesn't scope can match a row in a different table (e.g., Drift #3's first iteration matched RFC 0012 in the "Profiles pending adoption" table because it didn't scope to the §"RFCs not yet `Accepted`" section).
- **Comma-separated multi-entry rows.** A regex that anchors at start-of-line misses second/third entries in a comma-list cell (`0037, 0039, 0040, 0041`). Use a "first-cell-match" pattern instead.
- **The "no closing delimiter" case for awk range expressions.** `awk '/start/,/end/'` returns empty when only `start` is present in the file (the common-case steady state). Use a flag-toggle pattern (`/start/{flag=1;next} /end/{flag=0} flag`) instead.
- **The "regex is too greedy" failure mode.** Path-globs especially. If a detection command surfaces >5 hits, manually inspect 2-3 before fixing — odds are good a non-trivial fraction are false positives.
- **The "header convention not as documented" failure mode.** Detection patterns hard-coded to keepachangelog.com style headers (`## [Unreleased]`) won't match this repo's actual `## [X.Y.Z — unreleased]` style. Always grep the actual file for representative headers before writing a regex against the assumed style. The lesson generalizes — never assume a doc follows a public convention without verification, especially for headers where the regex hard-codes the literal.
- **The "comment mentions inflate the count" failure mode.** When the marker you're counting (`it.todo`, `TBD`, `STUB`) is ALSO the marker the doc uses to track its own state in comments, naive `grep -c` over-counts by 2-3× because comment mentions get folded in with callsites. Use language-aware anchors (e.g., `grep -P 'it\.todo\('` for actual callsites) and only fall back to literal greps when intentionally surveying the comment-as-marker pattern. Drift #20 is the canonical example.
- **The "generated status passes but prose lags" failure mode.** Generated-status checks (`scripts/generate-protocol-status.mjs --check`) keep mechanical counts honest BUT only validate surfaces the generator knows about — the README banner at line ~66, the protocol-tier invariant count, the SDK helper count. Hand-curated prose lists deeper in the same file (per-RFC bullet lists, capability profile narratives) are NOT covered. Drift #18 is the canonical example. Treat "generated-status green" as necessary, not sufficient.
- **The "wrong checkout" failure mode (Drift #25).** A gate that fails in the shared dev checkout (`/Users/david/dev/openwop`) may be green on `origin/main` — the local `main` drifts behind and the working tree accumulates uncommitted parallel-session edits whose generated surfaces weren't regenerated locally. ALWAYS reproduce a "failing gate" / "stale counts" finding on a fresh `origin/main` worktree before acting. If it's green there, the finding is local-checkout drift, not a repo bug — and "fixing" it by regenerating against the drifted local tree just bakes in the drift. This is the #1 source of false-positive audit findings.
- **The "vacuous gate" failure mode (Drift #23).** When verifying that a NEW behavioral conformance scenario actually proves what it claims, don't trust "the test passes" — read its body. A capability-gated scenario that soft-skips correctly can STILL pass vacuously once a host opts in, if its evidence assertions sit behind `if (events.length > 0)` / `if (status === 200)` guards. Distinguish a legitimate early-`return` soft-skip (host hasn't opted in) from a guard that silently swallows missing evidence (host opted in but emitted nothing). The honest shape: soft-skip BEFORE the opt-in is established; hard-assert AFTER.
- **The "corpus-valid ≠ site-serves-it" failure mode (Drift #26).** Every corpus-side gate (`openwop:check`, `generate-protocol-status.mjs --check`, the schema-discipline checks) validates *content* — that a schema is well-formed and declares the right `$id`. **None of them fetch the published site.** A schema can be valid AND pass every gate while `openwop.dev` 404s it at its declared `$id` (the 2026-06-08 case: schemas served at `/schemas/` but `$id` said `/spec/v1/`). Corpus-green is necessary, not sufficient, for a *public-surface* claim. Whenever `schemas/` or `api/` change — or any doc asserts a canonical `openwop.dev` URL — run `/browser` (in `../openwop-site`) or the Drift #26 build-output `$id` check before declaring done. The break lives in the OTHER repo's build pipeline, which a corpus-only docs-sync never opens.

---

## Phase 1: Audit session changes

```bash
# What changed in this session
git diff --name-only origin/main..HEAD
git status

# Group by surface
git diff --name-only origin/main..HEAD | awk '
  /^spec\/v1\// { print "spec:", $0; next }
  /^RFCS\// { print "rfc:", $0; next }
  /^schemas\// { print "schema:", $0; next }
  /^api\// { print "api:", $0; next }
  /^conformance\// { print "conformance:", $0; next }
  /^sdk\/typescript\// { print "sdk-ts:", $0; next }
  /^sdk\/python\// { print "sdk-py:", $0; next }
  /^sdk\/go\// { print "sdk-go:", $0; next }
  /^examples\/hosts\// { print "host:", $0; next }
  /^packs\// { print "pack:", $0; next }
  /^registry\// { print "registry:", $0; next }
  /^site\// { print "site:", $0; next }
  /^public\// { print "public:", $0; next }
  /^SECURITY\// { print "security:", $0; next }
  /\.md$/ { print "doc:", $0; next }
  { print "other:", $0 }
' | sort
```

Categorize changes:
- **New / changed normative surface** → README Document index, RFCs index, CHANGELOG
- **New / changed conformance scenarios + fixtures** → conformance/coverage.md, conformance/fixtures.md, conformance/CHANGELOG.md
- **New / changed SDK methods** → sdk/<lang>/CHANGELOG.md
- **Reference host advertisement change** → INTEROP-MATRIX.md row + ../openwop-examples/examples/hosts/<name>/conformance.md evidence
- **Gap closed in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`** → README status banner + ROADMAP entry
- **Governance / maintainer / process change** → MAINTAINERS.md, GOVERNANCE.md, CONTRIBUTING.md
- **Security invariant or threat-model change** → SECURITY.md, SECURITY/*.md, SECURITY/invariants.yaml

Present a summary table of what needs updating before proceeding.

---

## Phase 2: Map each change to a doc edit

| Change | Update |
|---|---|
| New `spec/v1/<doc>.md` | README "Document index" — add a row with `Status: <legend>`, `Words: ~N`, `Covers: <one-line>` |
| Status promotion (STUB → DRAFT → FINAL) | README "Document index" row + README status banner if v1 FINAL change |
| New `RFCS/NNNN-<slug>.md` at Draft | `RFCS/README.md` — no edit needed (number is implicit); CHANGELOG.md `[Unreleased]` line |
| RFC Draft → Active | `RFCS/<file>.md` Status field; CHANGELOG line; if it lands a normative spec section, README Document index updated |
| RFC Active → Accepted | `RFCS/<file>.md` Status field with date; CHANGELOG line under the version block |
| New schema `schemas/<name>.schema.json` | If publicly relevant, add to `schemas/README.md` (catalog); also mentioned in the spec doc it backs |
| New endpoint in `api/openapi.yaml` | Cited in the relevant `spec/v1/<area>.md` + `rest-endpoints.md` catalog row; conformance/coverage.md scenario row |
| New event in `api/asyncapi.yaml` | Cited in `spec/v1/<area>.md` + `stream-modes.md` if stream-mode-visible; webhooks subscription register if eligible |
| New `conformance/src/scenarios/<area>.test.ts` | `conformance/coverage.md` row + `conformance/fixtures.md` row (if fixture added) |
| New fixture in `conformance/fixtures/` | `conformance/fixtures.md` catalog table + per-fixture contracts |
| `INTEROP-MATRIX.md` row change (host profile claim) | Update matrix row + `../openwop-examples/examples/hosts/<name>/conformance.md` evidence |
| SDK method addition | `sdk/<lang>/CHANGELOG.md` + `sdk/<lang>/README.md` if public-facing usage example |
| Closure of a gap in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` | Update the track grade; mark items DONE with date; if it closes a known credibility gap, update README + ROADMAP |
| New maintainer added | `MAINTAINERS.md`; if first non-steward maintainer → trip the vendor-neutral migration tripwire per `ROADMAP.md` + update `CONTRIBUTING.md` §"Bootstrap-phase notes" |
| New SECURITY invariant | `SECURITY/invariants.yaml`; mention in `SECURITY.md` if user-facing |
| New publishing artifact | `PUBLISHING.md` per-package section + README publish-ready artifacts list |
| Release cut | CHANGELOG `[Unreleased]` → dated version block; PUBLISHING.md release cadence notes |
| RFC Status field changed (Draft → Active or Active → Accepted) | Re-scan `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`" — promoted RFCs leave the table; new Active/Draft RFCs join. Run `node scripts/generate-protocol-status.mjs --write` because the README banner counts will drift otherwise. |
| Conformance suite minor/major bump (`conformance/package.json` version) | Trigger a re-measurement pass against all reference hosts. Update `INTEROP-MATRIX.md` pass-rate table + each `../openwop-examples/examples/hosts/<h>/conformance*.md` banner. Publish a `docs/CONFORMANCE-RUNS-YYYY-MM.md` failure-topic taxonomy doc if the suite scenario count grew meaningfully. |
| Commit reverts a previously-announced feature (`git log --grep=revert`) | Walk every doc that mentioned the feature as live + retract or prefix with `**Reverted <sha> (YYYY-MM-DD):**`. Specifically check: `docs/KNOWN-LIMITS.md`, `README.md` status banner parentheticals, any RFC follow-up status sections, host evidence files. |
| External-audit-style review request | Treat the request itself as a drift trigger — drift modes #1, #3, #4, #6, #7 are almost always live when an external reviewer arrives. Run the full Phase 4 drift sweep before responding; publish a public `docs/AUDIT-RESPONSE-YYYY-MM.md` if the review is on the record. |

---

## Phase 3: Apply the doc edits

### README.md updates

**Document index table:** the canonical list of public spec docs. Every change to `spec/v1/` requires checking this table.

```bash
# Compare disk vs README
ls spec/v1/*.md | sed 's|.*/||' | sort > /tmp/disk-docs.txt
grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sed 's|spec/v1/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
```

For each new doc, add a row:

```markdown
| [`<filename>`](./spec/v1/<filename>) | <STUB \| DRAFT \| OUTLINE \| FINAL v1> | ~N | <One-line "Covers" summary; if a post-v1 addition, append "(post-v1 addition, YYYY-MM-DD)"> |
```

**Status banner:** if FINAL v1 landed a new RFC track or closed a previously-flagged gap, update the `> **Status:** ...` block at the top. Use absolute dates.

**Publish-ready artifacts list:** if a package version bumps, update:

```markdown
> **v1.0 publish-ready artifacts.** [`@openwop/openwop`](...) · [`@openwop/openwop-conformance`](...) · [`openwop-client`](...) · [...]
```

### CHANGELOG.md updates

Top of file should have:

```markdown
## [Unreleased]

### Added
- <one-line for each additive change>

### Changed
- <one-line for each backward-compat change>

### Deprecated
- <one-line>

### Removed
- <one-line>

### Fixed
- <one-line>

### Security
- <advisory ID + one-line for safety-fix changes>
```

When cutting a release, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` and add a new empty `[Unreleased]` block on top.

For multi-package releases (suite + SDKs ship separately), each package has its own CHANGELOG (`conformance/CHANGELOG.md`, `../openwop-sdks/sdk/typescript/CHANGELOG.md`). Update the right one.

### INTEROP-MATRIX.md updates

Update the host row when:
- A reference host advertises a new profile (e.g., `openwop-interrupt-quorum`)
- A reference host re-runs the suite and counts change
- A reference host downgrades a claim (honestly, never silently)

```markdown
| **<Host>** | <Use case> | `<path>` | `<profile-1>` · `<profile-2>` · `<profile-3>` | `<scale-tier>` | <Production-profile claim or "Not claimed"> | `<path-to-evidence>` |
```

Cross-update `../openwop-examples/examples/hosts/<name>/conformance.md` with:
- Suite version (e.g., `@openwop/openwop-conformance@1.0.0`)
- Command run (e.g., `OPENWOP_BASE_URL=http://localhost:3000 npx openwop-conformance`)
- Target URL class
- Pass / fail / skip counts
- Date of run

### ROADMAP.md updates

If the session closed a gap from `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`:
- Mark the gap as closed in the plan with a date
- Update the track grade (A–C)
- Cross-reference from `ROADMAP.md` if the closure changes the public roadmap timing

Vendor-neutral migration tripwire (per `MAINTAINERS.md`): if a non-steward maintainer is added, file an RFC to flip bootstrap-phase rules and announce in `ROADMAP.md`.

### RFCS/README.md updates

Add no rows (the directory is the source of truth). If the RFC process itself changes (rare), update `RFCS/README.md` §Process and reference the RFC that proposed the change.

### conformance/coverage.md updates

For each new scenario:

```markdown
| `<spec-doc>.md §<section>` | `conformance/src/scenarios/<area>.test.ts` → `<describe block>` | Covered |
```

For capability-gated scenarios, also add a row under §"Capability-gated scenarios":

```markdown
| <Capability name> | `host.<flag>.supported` | `<area>.test.ts` |
```

### conformance/fixtures.md updates

For each new fixture:

```markdown
| `<filename>.json` | `schemas/<name>.schema.json` | <one-line purpose> | `conformance/src/scenarios/<area>.test.ts` |
```

### MAINTAINERS.md + governance docs

Only edit when:
- A maintainer is added or removed (rare; high-impact)
- Governance procedure changes via an RFC (per `RFCS/0001-rfc-process.md`)
- Bootstrap-phase rules flip (per `CONTRIBUTING.md` §"Bootstrap-phase notes" — first non-steward maintainer)

### QUICKSTART updates

Only edit when:
- A documented quickstart command stops working
- A new "hello world" path opens (e.g., a new reference host)
- The 10-minute version drifts substantially from the longer version

### Spec site (`../openwop-site/site/` + `../openwop-site/public/`)

If the change adds a new spec doc, the site regeneration picks it up automatically — `../openwop-site/site/src/build.mjs` reads `spec/v1/` at build time. But:
- If `../openwop-site/site/templates/` references a doc by name (rare), update the template
- If `../openwop-site/public/index.html` carries a version/status banner that drifts, update it
- Run `( cd ../openwop-site && OPENWOP_ROOT="$(cd ../openwop && pwd)" bash scripts/build-site.sh )` to confirm a clean build (this is the full pipeline — generator + the api/schemas sync + the canonical-`$id` publish, not just `site/src/build.mjs`)
- **If `schemas/` or `api/` changed, confirm the published surface actually serves them** — the corpus gates don't fetch the site. Run the Drift #26 build-output `$id` check (Phase 4) or `/browser` Step 5; a schema that 404s at its declared `$id` is invisible to `openwop:check`

---

## Phase 4: Spec-corpus drift verification

Run these checks before marking docs complete. Each section corresponds to a numbered drift mode in the catalog at the top of this skill — use that table to triage the failure, then apply the fix recipe here.

### Drift #1, #2, #9 — generated-status gate (the catch-all)

```bash
bash scripts/openwop-check.sh 2>&1 | grep -A20 '\[7/9\] Generated protocol status'
# OR isolated:
node scripts/generate-protocol-status.mjs --check
```

Any non-zero exit means one of:
- README claimed `N protocol-tier` invariants but YAML has different count → fix the README banner.
- README claimed `N` Draft RFCs but actual count differs → fix the README banner (new RFCs landed without bumping it).
- `docs/PROTOCOL-STATUS.md` is stale → run `node scripts/generate-protocol-status.mjs --write` and commit. Per the memory note `feedback_generator_changelog_split`: if the regen also writes CHANGELOG, split into a `chore(docs)` commit first so generator-authored entries don't muddle authored narrative.

### Drift #3 — `docs/KNOWN-LIMITS.md` RFC status table

The "RFCs not yet Accepted" table at the bottom of KNOWN-LIMITS hand-curates per-RFC commentary on why each open RFC is still open. It lags reality after RFC promotions.

```bash
# Walk every Active+Draft RFC and confirm KNOWN-LIMITS lists it correctly.
# KNOWN-LIMITS uses comma-separated multi-RFC rows (e.g. `0027, 0028, 0029`)
# so a regex that anchors at start-of-line misses non-first entries.
# Scope to just the "## RFCs not yet `Accepted`" section so we don't match
# rows in other tables (e.g. "Profiles pending non-steward adoption" which
# can legitimately cite an already-Accepted RFC as the source of a profile).
KL_OPEN=$(awk '/^## RFCs not yet `Accepted`/{flag=1;next} /^## /{flag=0} flag' docs/KNOWN-LIMITS.md)

for f in RFCS/[0-9][0-9][0-9][0-9]-*.md; do
  [ "$(basename "$f")" = "0000-template.md" ] && continue
  id=$(basename "$f" | grep -oE '^[0-9]+')
  s=$(grep -oE '`Draft`|`Active`|`Accepted`|`Withdrawn`|`Superseded`' "$f" | head -1)
  [ "$s" = '`Accepted`' ] && continue  # Accepted shouldn't appear in KNOWN-LIMITS open table
  # First cell is `| <ids + label> |` — match id with word-boundary-equivalent context.
  k=$(echo "$KL_OPEN" | grep -E "^\|[^|]*(^| )0*${id}([, )]|$)" | head -1)
  if [ -z "$k" ]; then
    echo "RFC $id ($s) — MISSING from docs/KNOWN-LIMITS.md open RFC table"
  fi
done

# Inverse check — RFCs listed in the OPEN table but actually now Accepted
for f in RFCS/[0-9][0-9][0-9][0-9]-*.md; do
  [ "$(basename "$f")" = "0000-template.md" ] && continue
  id=$(basename "$f" | grep -oE '^[0-9]+')
  s=$(grep -oE '`Draft`|`Active`|`Accepted`' "$f" | head -1)
  [ "$s" = '`Accepted`' ] || continue
  k=$(echo "$KL_OPEN" | grep -E "^\|[^|]*(^| )0*${id}([, )]|$)" | head -1)
  if [ -n "$k" ]; then
    echo "RFC $id is Accepted but still in KNOWN-LIMITS open table — remove or split row"
  fi
done
```

Fix recipe: open `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`" and either add the missing row (with status + "Why open" cell), remove rows for RFCs that have since been promoted, or **split** a multi-RFC row when only some of the listed RFCs were promoted (e.g., `0037, 0039, 0040, 0041` → `0040, 0041` after 0037 + 0039 graduated).

### Drift #4 — `conformance/coverage.md` "Updated" header

```bash
header_date=$(grep -oE 'Updated 20[0-9]{2}-[0-9]{2}-[0-9]{2}' conformance/coverage.md | head -1 | grep -oE '[0-9-]+$')
last_edit=$(git log -1 --format=%ad --date=short conformance/coverage.md)
echo "header=$header_date  last-edit=$last_edit"
```

If `header_date < last_edit` by more than ~14 days, bump the header to today's date during this docs-sync.

### Drift #5 — `conformance/coverage.md` "endpoint surface in spec only" rows

When a host wires a previously-spec-only endpoint, the corresponding `/v1/operation` row in coverage.md's REST surface table must move from "None — endpoint surface in spec only" → a scenario citation.

```bash
# Heuristic — find operation names that coverage.md still calls unimplemented
grep -E '^\| `[a-z][a-zA-Z]+` \| None' conformance/coverage.md | grep -oE '`[a-z][a-zA-Z]+`' | sort -u | while read op; do
  clean=${op//\`/}
  if grep -rln "$clean" ../openwop-app/backend/typescript/src/routes/ ../openwop-examples/examples/hosts/*/src/routes/ 2>/dev/null | head -1 >/dev/null; then
    echo "$op: coverage.md says unimplemented but found impl in: "
    grep -rln "$clean" ../openwop-app/backend/typescript/src/routes/ ../openwop-examples/examples/hosts/*/src/routes/ 2>/dev/null | head -3
  fi
done
```

Fix recipe: rewrite each row to cite the implementing host + the conformance scenario that covers it.

### Drift #6 — INTEROP-MATRIX pass-rate vs current suite version

```bash
cur=$(jq -r .version conformance/package.json)
cited=$(grep -oE 'against suite v[0-9]+\.[0-9]+\.[0-9]+' INTEROP-MATRIX.md | head -1 | grep -oE '[0-9.]+')
echo "current=$cur cited=$cited"
[ "$cur" != "$cited" ] && echo "STALE — re-measure all 4 hosts against suite $cur and update INTEROP-MATRIX + per-host conformance.md banners + run \`node scripts/generate-protocol-status.mjs --write\`"
```

Fix recipe: run the conformance suite against each reference host (in-memory / sqlite / postgres-pglite / python) and re-record the four-bucket counts (pass / fail / skip / todo) in INTEROP-MATRIX. Publish a per-failure-topic taxonomy doc (`docs/CONFORMANCE-RUNS-YYYY-MM.md`) per the `audit-response-2026-05` precedent.

### Drift #7 — INTEROP-MATRIX host-description columns with unqualified historical pass-rates

```bash
grep -nE 'Conformance close-out [0-9]{4}|Conformance posture' INTEROP-MATRIX.md | grep -vE 'suite v[0-9]+\.[0-9]+\.[0-9]+' | head -10
```

Each hit is a host-row description that quotes a pass-rate without a `(YYYY-MM-DD, suite vX.Y.Z)` retrospective marker. Fix recipe — prefix the claim:

```diff
- **Conformance close-out 2026-05-12:** 700/788 = **100% of applicable tests pass; zero failures**
+ **Conformance close-out (2026-05-12, suite v1.1.0):** 700/788 = **100% of applicable tests pass; zero failures** — retained for historical context; see the pass-rate table below for the current suite version.
```

### Drift #8 — Per-host conformance.md banner ↔ current suite

```bash
cur=$(jq -r .version conformance/package.json)
for h in in-memory sqlite postgres python; do
  for f in ../openwop-examples/examples/hosts/$h/conformance.md ../openwop-examples/examples/hosts/$h/conformance-full.md; do
    [ -f "$f" ] || continue
    cited=$(grep -oE '@openwop/openwop-conformance@[0-9.]+' "$f" | head -1 | grep -oE '[0-9.]+')
    if [ "$cited" != "$cur" ]; then
      echo "$f: cited=$cited current=$cur — re-measure or add a 'Latest measurement' banner"
    fi
  done
done
```

Fix recipe: either re-run the suite for that host and update the banner, or — if the prior measurement is still the most recent — prefix the existing banner with a retrospective date + suite-version marker (same pattern as Drift #7).

### Drift #10 — Cross-doc file paths cited in new docs don't exist

```bash
for f in docs/*.md RFCS/[0-9]*.md $(git diff --name-only origin/main..HEAD | grep '\.md$'); do
  [ -f "$f" ] || continue
  grep -oE '[a-z][a-zA-Z0-9_-]+(/[a-zA-Z0-9._-]+){1,}\.(ts|mjs|js|json|yaml|md|py|go|sh)' "$f" \
    | sort -u | while read p; do
    [ -e "$p" ] || echo "$f: MISSING $p"
  done
done | grep -v '../openwop-examples/examples/packs\|node_modules' | head -30
```

Each MISSING hit is a doc that promises a file path that doesn't resolve on disk. Fix recipe: either correct the cited path or move the cited claim from a path reference to a prose description (e.g., "the mock-AI provider, currently in `aiProviders/aiProvidersHost.ts`, gains …").

### Drift #11 — Reverted features still claimed as live in prose

```bash
# Walk recent revert commits and check whether docs still cite the reverted feature as live
git log --grep='revert\|undo\|fix.*revert' --oneline -10 | while read sha _ rest; do
  echo "=== $sha $rest ==="
  git show "$sha" --stat | head -20
done
```

For each revert, manually scan: did `docs/KNOWN-LIMITS.md`, `README.md`, RFC follow-up sections, or related host evidence files still say the reverted feature is in effect? If so, prefix with a `**Reverted 5864a2f (YYYY-MM-DD):**` marker or remove the stale claim.

### Drift #12 — `CHANGELOG.md` `[Unreleased]` empty after a non-trivial session

**Use the flag-toggle awk pattern, AND match this repo's `[X.Y.Z — unreleased]` convention.** Two caveats compound here:

1. The obvious `awk '/^## \[Unreleased\]/,/^## \[/'` range expression returns empty when only one `## [` heading exists in the file (steady state — no release has been cut since the last `[Unreleased]` rename). Use the flag-toggle form below.
2. This repo's actual header convention is `## [X.Y.Z — unreleased]` (e.g., `## [1.1.3 — unreleased]`), NOT the bare `## [Unreleased]` from keepachangelog.com. A regex hard-coded to `\[Unreleased\]` matches zero rows in this repo and gives a false-clean signal.

Use a permissive pattern that handles both forms:

```bash
awk '/^## \[[^]]*[Uu]nreleased/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md | head -40
```

The character class `[^]]*[Uu]nreleased` matches anything up to the closing bracket containing the substring `unreleased` (case-insensitive on the leading `U`), so it catches `[Unreleased]`, `[1.1.3 — unreleased]`, `[v2.0.0-unreleased]`, etc.

If the section is empty or contains only the next-version-header, and the current session shipped anything more than a typo fix, add a one-line entry. Use existing house-style: multi-paragraph descriptive blocks are normal in this repo (the Conventional Commits style is in the commit message, not the CHANGELOG).

### Drift #13 — Partial multi-RFC row promotion (split, don't remove)

When KNOWN-LIMITS has a row like `| 0037, 0039, 0040, 0041 (Multi-agent execution model Phases 1–4) | Active |` and some but not all of those RFCs promote to `Accepted`, the fix is to **edit the row in place** dropping the promoted IDs, NOT to remove the whole row:

```diff
- | 0037, 0039, 0040, 0041 (Multi-agent execution model Phases 1–4) | `Active` | … |
+ | 0040, 0041 (Multi-agent execution model Phases 3–4) | `Active` | … |
```

Also add a prose paragraph after the table documenting which IDs graduated, with the cross-host evidence citation. Drift #3's scoped-section regex catches this once you re-run it.

### Drift #14 — Suite minor bump even when CHANGELOG says "no new scenario files"

A relaxation in an existing scenario can grow the test count by splitting one strict assertion into multiple discrete `it()` blocks. v1.4.0 → v1.5.0 went 1558 → 1564 this way. **Always re-measure on a suite bump**, even when `conformance/CHANGELOG.md` claims no scenarios changed — the per-host pass-count deltas may be small (typically `+1` to `+6`) but the published total counts will drift if you don't.

```bash
cur=$(jq -r .version conformance/package.json)
cited=$(grep -oE 'against suite v[0-9.]+' INTEROP-MATRIX.md | head -1 | grep -oE '[0-9.]+')
[ "$cur" != "$cited" ] && echo "Re-measure all 4 hosts; expected delta is per the conformance/CHANGELOG.md entry for v$cur"
```

### Drift #15 — Suite bump cascade after external host adoption

A non-steward host advertising a new capability often unblocks an RFC promotion AND drives a same-day suite minor bump to ship the relaxed assertion logic. When you see `release(conformance):` plus `Active → Accepted` commits clustered together, expect Drift #6 + #8 + #10 (host conformance.md banners) + #12 to all need attention in the same docs-sync. Don't fix them one-at-a-time — schedule them as a batch.

```bash
git log --oneline -10 | grep -E 'release\(conformance\)|Active → Accepted' | head -5
# If 2+ commits hit, treat this as a cascade — do drift sweep #1 through #12 in one pass.
```

### Drift #16 — File-path detection has high false-positive rate

The Drift #10 regex catches three patterns that aren't real bugs:

1. **Markdown link-text shorthand.** `[`outreach/STATUS.md`](../SECURITY/outreach/STATUS.md)` — the link itself resolves, but the regex captured just the inner backtick text.
2. **Intentional relative-shorthand citations.** Inside a host-scoped paragraph (e.g., "Postgres host…"), a doc may say `executor/modelCapabilityGate.ts` instead of the full `../openwop-app/backend/typescript/src/executor/modelCapabilityGate.ts`. The full path resolves; the regex didn't see the surrounding context.
3. **Accountability-doc forward references.** `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` intentionally names files-to-be-created (`../openwop-examples/examples/hosts/postgres/src/sandbox-vm.ts`, `conformance/src/scenarios/secret-leakage-otel-attribute.test.ts`). These are work-in-progress claims, not assertions of current state.

Manually inspect each Drift #10 hit before flagging. Practical heuristic: if the doc says "MISSING" but the path looks like it follows a sensible naming pattern AND the doc context implies "future work" or "see Markdown link above", it's probably a false positive.

### Drift #17 — Historical evidence files predating the suite-version convention

Some `../openwop-examples/examples/hosts/<h>/conformance-*.md` files (e.g., `conformance-full.md`, `conformance-phase1.md`) are historical full-run records that predate the `@openwop/openwop-conformance@X.Y.Z` versioned-suite convention. Drift #8 will flag these with empty `cited=` strings. The fix is NOT "re-measure" — it's "add a `Latest measurement is at conformance.md` pointer at the top of the historical file so a reader doesn't mistake it for current state":

```diff
  # Full Conformance Run — SQLite Reference Host

+ > **Latest measurement is at `../openwop-examples/examples/hosts/sqlite/conformance.md`** (2026-05-22, suite v1.5.0). This file is a historical full-run record from the 2026-05-11 Phase 1 + review-fix cycle, retained for traceability.
+ >
  > **Run date:** 2026-05-11 (post Phase 1 + review-fix cycle)
- > **Conformance suite:** `@openwop/openwop-conformance` (this repo, post Phase 1 + review fixes)
+ > **Conformance suite:** `@openwop/openwop-conformance` (this repo, post Phase 1 + review fixes — pre-versioned-suite era)
```

Detection:

```bash
for f in ../openwop-examples/examples/hosts/*/conformance-full.md ../openwop-examples/examples/hosts/*/conformance-phase*.md; do
  [ -f "$f" ] && head -10 "$f" | grep -qE 'Latest measurement is at|pre-versioned-suite era' \
    || echo "$f: needs historical-marker prefix"
done
```

### Drift #18 — README prose RFC-status lists lag actual Status fields

`scripts/generate-protocol-status.mjs --check` catches the README **banner** counts (line ~66: "34 Accepted / 6 Active / 4 Draft"). But the **per-RFC prose lists below** ("v1.x Capability Profiles", "Active RFCs", "Draft RFCs") are hand-curated and lag promotions. The 2026-05-23 audit caught README:281 marking RFCs 0027/0030/0031/0032/0033 as `Active` after all 5 had promoted to `Accepted` between 2026-05-21 and 2026-05-23. Generated-status passed (banner counts were correct); the prose list silently drifted.

Detection — diff the README's prose-list claim against actual RFC Status fields:

```bash
# Authoritative set: what each RFC file actually says
for f in RFCS/[0-9][0-9][0-9][0-9]-*.md; do
  [ "$(basename "$f")" = "0000-template.md" ] && continue
  id=$(basename "$f" | grep -oE '^[0-9]+')
  s=$(grep -m1 '^| \*\*Status\*\*' "$f" | grep -oE '`Active`|`Draft`')
  [ -n "$s" ] && echo "$id $s"
done > /tmp/actual-open.txt

# What the README's prose lists claim
awk '/\*\*Active RFCs/{flag=1; next} /\*\*Draft RFCs/{flag=0} flag' README.md \
  | grep -oE 'RFC [0-9]+' | sort -u > /tmp/readme-active.txt
awk '/\*\*Draft RFCs/{flag=1; next} /\*\*v1 Foundation/{flag=0} flag' README.md \
  | grep -oE 'RFC [0-9]+' | sort -u > /tmp/readme-draft.txt

# Compare
diff /tmp/readme-active.txt <(awk '$2=="`Active`" {print "RFC "$1}' /tmp/actual-open.txt | sort -u)
diff /tmp/readme-draft.txt  <(awk '$2=="`Draft`"  {print "RFC "$1}' /tmp/actual-open.txt | sort -u)
```

Fix recipe: rewrite the relevant prose-list block to match the actual `Status:` fields. Drop promoted RFCs from `Active`, add newly-Active RFCs, move Accepted RFCs into the `v1.x Capability Profiles (all Accepted)` block.

### Drift #19 — Per-track "Closing PR: TBD" strings linger after a closure snapshot

Multi-track tracking docs (canonical: `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`) often get a closure-snapshot table prepended at the top of file when all tracks close: "Closure snapshot — 2026-05-22 (ALL TRACKS CLOSED) \| ✅ commit refs". The per-track sections below typically retain their original `Closing PR: TBD — feat(…)` strings — producing an internal contradiction where the document says both "all closed" AND "still TBD" in different sections.

External auditors flag this exact pattern as eroding credibility (the 2026-05-23 audit caught `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` with this drift). The fix is mechanical:

```bash
grep -nE "Closing PR.*TBD|Closing commits.*TBD" docs/*.md | head -10
# Any hit on a doc that ALSO has a "ALL TRACKS CLOSED" or "✅ CLOSED" snapshot above is a contradiction.
```

Fix recipe: rewrite each `Closing PR: TBD — feat(…)` into `Closing commit: ✅ <sha> (date). <one-paragraph note on implementation pivot vs. original criterion>`. The implementation pivot note is load-bearing — most close-outs land via a different mechanism than the original criterion contemplated (e.g., consolidated on workflow-engine instead of splitting across Postgres + workflow-engine).

### Drift #20 — `it.todo` callsite count diverges from naive grep due to comment mentions

External auditors counting `it.todo` markers via `grep -rc 'it.todo' conformance/src/scenarios/` over-count when scenario files describe their own state via comments (e.g., "Surfaced as `it.todo` so reporters track the gap"). The 2026-05-23 audit reported 14 callsites; naive grep returned 20 (the 6 inflation came from comment mentions); after Phase 4 cleanup the naive grep stayed at 12 (all comment mentions in the cleanup-completion notes) while actual callsites dropped to 0.

Use language-aware anchors for the real count:

```bash
# Actual callsites (the open paren rules out comment mentions):
grep -rcP 'it\.todo\(' conformance/src/scenarios/ | awk -F: '$2>0' | sort -t: -k2 -rn

# Total callsites:
grep -rcP 'it\.todo\(' conformance/src/scenarios/ | awk -F: '{s+=$2} END {print s}'

# Files-that-mention-the-marker (for cross-reference inventory):
grep -rcl 'it\.todo' conformance/src/scenarios/ | wc -l
```

Fix recipe: when retiring an `it.todo` block, choose ONE of three paths:

1. **Flip to runnable `it()`** — only when the underlying host wiring exists. The cleanest signal but the most work.
2. **`it.skip` cross-reference** — when the behavioral coverage exists elsewhere (e.g., consolidated in `sandbox-mvp-behavior.test.ts`). The block becomes `it.skip('see <other-file> §<section>')` with an explanatory comment block above. This was the 2026-05-23 Phase B path for 8 sandbox files.
3. **`it.skip` with RFC 0042 quarantine marker** — for genuinely-pending todos that are gated on host-side wiring that hasn't landed. The block becomes `it.skip('<assertion text> — out of stable profile via RFC 0042')` with a comment pointing to the experimental-tier carve-out. This was the 2026-05-23 Phase C path for 6 cross-host + replay-determinism todos.

### Drift #21 — `npx -y -p @<pkg>@latest` races the npm cache

`scripts/openwop-check.sh` historically invoked validator toolchain (`@asyncapi/cli`, `@redocly/cli`) via `npx -y -p @<pkg>@latest`. This races itself in three cases: (1) concurrent gate runs interleave on the same `/tmp/openwop-npm-cache`; (2) the cache TTL expires mid-fetch; (3) `npx -y` writes a `_locks/<lock>` file that survives a SIGKILL'd parent. All three produce `ECOMPROMISED Lock compromised` errors requiring `rm -rf /tmp/openwop-npm-cache` to recover.

External auditor 2026-05-23 hit this twice in a single session. The fix landed 2026-05-23 (this same session): pinned versions in repo-root `package.json#devDependencies` (`@asyncapi/cli@4.1.1` — last Node-22-compatible release; `@redocly/cli@2.31.4`) + `openwop-check.sh` reaches for `./node_modules/.bin/{redocly,asyncapi}` directly + one-time idempotent `npm install` at the top of the script when the bins are absent.

Detection — any `npx -y` invocation in the gate scripts is a regression:

```bash
grep -nE "npx -y" scripts/openwop-check.sh .github/workflows/openwop-spec.yml 2>/dev/null
# Empty output = no regression.
```

Lesson generalizes: ANY validator-toolchain bump in this repo MUST go through a pinned devDependency, not `npx -y`. The pinned form costs ~3 minutes of `npm install` on a fresh checkout (one-time, cached forever after); `npx -y` costs ~30s per gate run on a warm cache PLUS the occasional ECOMPROMISED rabbit hole when the cache races itself.

### Drift #22 — Internal phasing labels in external-facing prose

The repo accumulates several internal sequencing schemes that read as opaque to external readers:

- **Multi-agent execution model `Phase 1-4`** — RFCs 0037/0039/0040/0041; ALSO bound to wire-shape `multiAgent.executionModel.version: 1-4`
- **Postgres host `Phase H/I`** — operational launch tracks
- **Multi-Agent Shift `Phase 3`** — yet-another-scheme
- **ROADMAP `Phase 1 — Credibility / Phase 2 — Adoption / Phase 3 — Ecosystem`** — marketing-roadmap phasing
- **Audit-session `Phase A/B/C/D`** — per-session work-tracking labels
- **Behavioral-harness `Track #1-#7`** — per-audit-response harness IDs

External auditor 2026-05-24 was explicit: "Remove all references to 'phase 4' from our documentation as no one else will know what that is." The auditor will not carry the internal frame; they want feature-describing names.

Substitution policy (per scheme):

| Scheme | Replacement | Rationale |
|---|---|---|
| Multi-agent `Phase N` (prose) | `RFC 00NN` + feature name (e.g., "Phase 4" → "RFC 0041 (replay determinism under nondeterminism)") OR `\`version: N\`` when describing the wire shape | Multiple-way-to-cite each one; the integer IS on the wire |
| Multi-agent `Phase N` (wire-shape integer `multiAgent.executionModel.version: N`) | **NEVER RENAME** | This IS the capability version; renaming would break hosts |
| Env var `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true` | **NEVER RENAME** | Deploy-flag wire; hosts already set it |
| Postgres `Phase H/I`, Multi-Agent Shift `Phase N`, ROADMAP `Phase N` marketing | **Leave alone unless the auditor specifically asked** | Different schemes; renaming sweep them all is over-reach |
| Audit-session `Phase A/B/C/D` | Rewrite if the doc is current-state; leave if it's a dated session log | "Session label" prose ages out naturally |
| Behavioral-harness `Track #N` | Rewrite if the doc is current-state; leave in dated audit-response docs | Same logic |
| Filenames containing `PHASE-4` | `git mv` to feature-describing name + update all internal callers + add top-of-file "Renamed YYYY-MM-DD" note | Filenames are external surface; the redirect note preserves history |
| Historical CHANGELOG entries citing "Phase N" | **Leave alone** | Immutable history; rewriting is dishonest |

Detection — aggressive grep with manual triage:

```bash
grep -rn "Phase [0-9A-Z]" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=apps --exclude-dir=plans . 2>/dev/null \
  | grep -vE "Phase H/I|RFC 0013 Phase |RFC 0027 Phase A|ROADMAP|Phase 3 of Multi-Agent Shift|## \[1\." \
  | head -30
```

The grep is INTENTIONALLY aggressive — it'll surface false positives. Manually triage each hit. Heuristic: if "Phase N" is preceded or followed by "multi-agent" / "execution model" / "RFC 0037-0041", rewrite. If preceded by "Postgres" / "RFC 0013" / "ROADMAP §" / a session-date / "Multi-Agent Shift" / "Track", leave.

Fix recipe — atomic per docs-sync session:

1. `git mv` any `PHASE-N-*.md` filenames first; add top-of-file "Renamed YYYY-MM-DD" notes.
2. Update every internal caller in the same commit (use `grep -rln` to find them).
3. Rewrite spec/RFC titles (most-visible surface) before body prose.
4. Sweep body prose (status banners, section headers, version mapping tables, open-spec-gaps columns).
5. Update conformance scenario file docstrings (the test header `@see` links break otherwise).
6. **Commit Phase 4 file renames + path updates as ONE atomic commit** so the link-integrity check round-trips clean.
7. Leave historical CHANGELOG entries + dated audit-response docs alone unless the auditor specifically named them.

The cleanup naturally co-occurs with #18 (README prose-list lag) + #19 (closure-snapshot internal-contradiction). All three are "the doc says the right things to insiders but the wrong things to outsiders" — running the docs-sync after every audit response is the right cadence.

### Drift #23 — Capability-gated behavioral scenarios pass vacuously on missing evidence

A behavioral conformance scenario can soft-skip correctly (host hasn't opted in) yet STILL pass vacuously once a host advertises the capability + wires the seam, if its evidence assertions are wrapped in conditionals. The independent audit 2026-06-01 caught three (`agent-eval-run`, `agent-deployment-lifecycle`, `trigger-bridge-delivery`) and conformance 1.17.0 closed them.

```bash
# Candidates: conditionals that GUARD a block (vs an early-return soft-skip).
grep -rnE 'if \([a-zA-Z]+Q?\.(ok|events\.length|status)\b' conformance/src/scenarios/*.test.ts | grep -vE 'return;'
# Off-by-one / existence-not-equality forms:
grep -rnE '\.length <= 1|\.length > 0\)|causationId.*length > 0' conformance/src/scenarios/*.test.ts
```

For each hit, read the body: a guard is a vacuous-pass hole when (a) the condition is reachable only AFTER the opt-in gates (`behaviorGate`/profile + seam-available + `drive…() !== null`), and (b) the guarded block holds the `expect(...)` evidence assertions (which simply don't run when the condition is false).

Fix recipe — invert the structure: keep the legitimate early-`return` soft-skips (capability/profile not advertised, event-log seam absent, drive-seam null), then once a runId is returned, HARD-ASSERT the evidence. Use `requireEvents(query, where)` from `conformance/src/lib/event-log-query.ts` (asserts the query is `ok` + returns typed events — no `if (q.ok)` narrowing hole), assert exact counts (`=== 1`, `>= 1`, `=== 0` for must-not-emit) and equality (`causationId === deliveredEvent.eventId`), never `> 0` / `<= 1` / `non-empty`. **A strictness change to an already-published suite version requires a conformance bump (Drift #24).** Verify the soft-skip path still works by running the scenario against a reference host that does NOT advertise the capability (it must skip, not fail).

### Drift #24 — `EXPECTED_CONFORMANCE_VERSION` lags `conformance/package.json` (in two scripts)

```bash
cur=$(jq -r .version conformance/package.json)
a=$(grep -oE 'EXPECTED_CONFORMANCE_VERSION="[0-9.]+"' scripts/openwop-check-publish-metadata.sh | grep -oE '[0-9.]+')
b=$(grep -oE "conformancePack.version === '[0-9.]+'" scripts/check-npm-pack-contents.sh | grep -oE '[0-9.]+')
echo "pkg=$cur metadata=$a packcontents=$b"
{ [ "$cur" = "$a" ] && [ "$cur" = "$b" ]; } && echo OK || echo MISMATCH
```

Fix recipe: bump BOTH `scripts/openwop-check-publish-metadata.sh` (`EXPECTED_CONFORMANCE_VERSION=`) and `scripts/check-npm-pack-contents.sh` (`conformancePack.version === …`) to match `conformance/package.json`, plus the lockfile's two `version` fields, plus a `conformance/CHANGELOG.md` entry, then regenerate `docs/PROTOCOL-STATUS.md` (the artifact-versions table cites the suite version). Before changing scenario CONTENT at the current version, run `npm view @openwop/openwop-conformance version` — if npm already serves it, you MUST bump (repo ≠ npm at the same version is silent drift). The npm publish (per-package tag) is the steward release step, not part of the docs-sync.

### Drift #25 — A "failing gate" finding is the shared dev checkout, not the canonical repo

The single biggest source of false-positive audit findings. Before reporting a gate failure or "fixing" generated files, reproduce on a fresh `origin/main` worktree:

```bash
repo=/Users/david/dev/openwop
git -C "$repo" fetch origin -q
git -C "$repo" worktree add /tmp/owp-verify origin/main --detach
( cd /tmp/owp-verify \
  && node scripts/generate-protocol-status.mjs --check \
  && bash scripts/openwop-check-publish-metadata.sh )
git -C "$repo" worktree remove /tmp/owp-verify --force
```

If green on the fresh worktree, the finding is local-checkout drift (local `main` behind `origin/main` + uncommitted parallel-session working-tree edits), NOT a repo bug. The fix is to sync the shared checkout (or scope the claim "local-only") — NOT to regenerate against the drifted tree (that bakes the drift in). Telltale: reported counts that match NEITHER `origin/main` NOR each other (e.g., corpus says 310, generated says 308, README says 307).

### Drift #26 — Corpus declares a canonical public URL the site doesn't serve

Every `schemas/**/*.schema.json` declares its own `$id` (`https://openwop.dev/spec/v1/<name>.schema.json`; envelope schemas nest one level under `/spec/v1/envelopes/`). The corpus-side gates only check the schema is *valid* and declares the *right* `$id` — they never fetch the site, so a schema can be green everywhere yet 404 at its advertised `$id`. This is exactly what shipped: `../openwop-site/scripts/build-site.sh` copied schemas to `public/schemas/` (for the Redoc viewer's relative `../schemas` `$ref`s) but not to the `/spec/v1/` `$id` path, so third-party Ajv2020 hosts resolving `$ref` against the `$id` got a 404.

Run after ANY change to `schemas/` or `api/`, or any doc that asserts a canonical `openwop.dev` URL — it builds the site once and checks the build output (deterministic, no network, no deploy lag):

```bash
SITE=../openwop-site
CORPUS="$(pwd)"
( cd "$SITE" && OPENWOP_ROOT="$CORPUS" bash scripts/build-site.sh >/dev/null 2>&1 )
miss=0
for f in $(find schemas -name '*.schema.json'); do
  u=$(grep -oE 'https://openwop.dev/spec/v1[^"]+' "$f" | head -1)
  [ -z "$u" ] && continue
  [ -f "$SITE/public${u#https://openwop.dev}" ] || { echo "UNSERVED $u  ($f)"; miss=1; }
done
[ "$miss" = 0 ] && echo "OK — every declared \$id is served from public/"
```

Any `UNSERVED` line is a declared `$id` the published site won't honor. Fix recipe (what 2026-06-08 landed): in `../openwop-site/scripts/build-site.sh`, after the `spec/` dir copy (whose `rm -rf public/spec` would otherwise wipe it), also publish the schemas tree at its `$id` path — `cp -R "$CORPUS/schemas/." "$PUBLIC/spec/v1/"` (structure-preserving, so nested envelope schemas land at `/spec/v1/envelopes/`), then `rm -f "$PUBLIC/spec/v1/README.md"`. The `/schemas/` copy stays (Redoc depends on it). NEVER "fix" this by changing the `$id` — it is baked into 60+ schemas and downstream hosts; serve at the existing `$id` instead. `/browser` Step 5 (in `../openwop-site`) is the live-site equivalent of this check and is the authoritative final sweep.

### Doc index parity

```bash
ls spec/v1/*.md | sed 's|.*/||' | sort > /tmp/disk-docs.txt
grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sed 's|spec/v1/||' | sort -u > /tmp/readme-docs.txt
diff /tmp/disk-docs.txt /tmp/readme-docs.txt
```

### Word count drift in README rows

```bash
for row in $(grep -oE 'spec/v1/[a-z0-9-]+\.md' README.md | sort -u); do
  if [[ -f "$row" ]]; then
    actual=$(wc -w "$row" | awk '{print $1}')
    claimed=$(grep -E "\[\`$(basename $row)\`\]" README.md | head -1)
    echo "$row: actual=$actual claimed=\"$claimed\""
  fi
done | head -20
```

Round word counts to nearest 50 in README.

### CHANGELOG `[Unreleased]` non-empty

```bash
sed -n '/^## \[Unreleased\]/,/^## \[/p' CHANGELOG.md | head -40
```

A non-trivial change SHOULD add at least one line. If the line is missing, add it.

### INTEROP-MATRIX honesty

```bash
# Each row's evidence file exists
grep -E '^\| \*\*' INTEROP-MATRIX.md | awk -F '|' '{print $7}' | sed 's/^ //; s/ $//' | while read evidence; do
  [[ -z "$evidence" || "$evidence" == "evidence" ]] && continue
  [[ -f "$evidence" ]] || echo "MISSING EVIDENCE FILE: $evidence"
done
```

### Reference-host evidence file freshness

```bash
for host in in-memory sqlite python; do
  evidence="../openwop-examples/examples/hosts/$host/conformance.md"
  [[ -f "$evidence" ]] || continue
  echo "=== $evidence ==="
  grep -E "Suite version|date|run on" "$evidence" | head -3
done
```

If suite version cited is older than current `conformance/package.json` version, flag for `/update-conformance`.

### TypeScript build (when README claims publish-ready artifacts)

```bash
( cd ../openwop-sdks/sdk/typescript && npx tsc --noEmit )
( cd conformance && npx tsc --noEmit )
```

### Final visual verification

Recommend the user view:
- `README.md` rendered on GitHub
- `openwop.dev` (after `firebase deploy --only hosting` if site changed)
- `RFCS/<any new RFC>.md` rendered
- The relevant `spec/v1/<doc>.md` to confirm normative voice unchanged

---

## Workflow Commands

| Command | Action |
|---|---|
| `proceed` / `next` | Move to next phase |
| `back` | Go to previous phase |
| `skip to phase N` | Jump to phase N |
| `audit only` | Run Phase 1 only — report what needs updating |
| `drift sweep` | Run the 12-mode drift catalog from top of skill — report every hit before fixing anything |
| `index-parity` | Run the doc-index drift check |
| `evidence-refresh <host>` | Update `../openwop-examples/examples/hosts/<host>/conformance.md` after a rerun |
| `re-measure all hosts` | Run the conformance suite against in-memory + sqlite + postgres-pglite + python; update INTEROP-MATRIX + per-host banners; regen PROTOCOL-STATUS |
| `rfc-status-sync` | Walk every RFCS/NNNN-*.md, compare its `Status:` field to `docs/KNOWN-LIMITS.md` open-RFC table + `docs/PROTOCOL-STATUS.md` RFC table + `README.md` banner counts; report mismatches |
| `changelog <package>` | Show or edit a per-package CHANGELOG |
| `verify` | Run Phase 4 verification |
| `done` | Complete documentation update |

---

## Quick Reference

| What | Where |
|---|---|
| Spec doc index | `README.md` § "Document index" |
| Spec docs themselves | `spec/v1/*.md` |
| RFC archive | `RFCS/` (each `NNNN-<slug>.md` carries Status) |
| Version-by-version compat record | `CHANGELOG.md` (root) + `conformance/CHANGELOG.md` + `../openwop-sdks/sdk/typescript/CHANGELOG.md` |
| Host advertisement matrix | `INTEROP-MATRIX.md` + per-host `conformance.md` |
| Planned work + tripwires | `ROADMAP.md` |
| Internal gap tracking | `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` |
| Per-artifact change rules | `CONTRIBUTING.md` |
| Compatibility commitment | `COMPATIBILITY.md` |
| Governance + maintainers | `GOVERNANCE.md` + `MAINTAINERS.md` |
| Security policy + threat models | `SECURITY.md` + `SECURITY/*` |
| Release cadence + packages | `PUBLISHING.md` |
| Onboarding | `QUICKSTART.md`, `QUICKSTART-10MIN.md` |
| Coverage map | `conformance/coverage.md` |
| Fixture catalog | `conformance/fixtures.md` |
| Spec site frontend | `../openwop-site/site/templates/`, `../openwop-site/public/index.html`, `../openwop-site/public/styles.css` |

---

## Related Skills

| Skill | Purpose |
|---|---|
| `/ux-review` | Prose readability + RFC 2119 + cross-link integrity on touched docs |
| `/update-conformance` | Sync conformance/ scenarios, fixtures, coverage.md, fixtures.md |
| `/browser` | Validate site renders the updated corpus correctly |
| `/cleanup` | Address stale CHANGELOG entries, dead links, dishonest INTEROP-MATRIX claims |
| `/pr` | Create the PR — applies `openwop-spec` label when the doc edit touches the corpus |
