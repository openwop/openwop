---
name: feedback-generator-changelog-split
description: When `scripts/generate-protocol-status.mjs --write` adds CHANGELOG entries as part of a gate-fix, commit the generator output as a separate `chore(docs)` commit BEFORE adding your own narrative entries — mixing authorship muddles history
metadata:
  type: feedback
---

The openwop gate's step [7/9] runs `scripts/generate-protocol-status.mjs` which validates `docs/PROTOCOL-STATUS.md` freshness AND also emits CHANGELOG entries describing registry-pack publication state (e.g., "Steward pre-audit publication of N `core.openwop.*` packs"). When the gate fails freshness, running `node scripts/generate-protocol-status.mjs --write` regenerates both files in one go.

**Why this matters:** If you ran the generator as part of your own work (e.g., to fix gate step 7), the generator-authored CHANGELOG entry lands in your `git status` alongside your narrative additions. Staging everything together produces a commit whose body claims authorship of content the generator actually emitted (typically describing the parallel session's pack publications, not your work).

This happened on 2026-05-17 in commit `f7da629` (RFC 0013 Phase 2): the registry-script changes touched 48 pack indexes which triggered protocol-status drift; the regen added a 50+-line "Steward pre-audit publication" CHANGELOG entry that had nothing to do with Phase 2. The commit message acknowledged this in its body, but mixing authorship still muddles history.

**How to apply:**

- When the gate fails at step 7/9 and the regen modifies BOTH `docs/PROTOCOL-STATUS.md` AND `CHANGELOG.md`, split into two commits:
  1. First commit: `chore(docs): regen PROTOCOL-STATUS + sync CHANGELOG` — stage ONLY the generator-touched files (`docs/PROTOCOL-STATUS.md` + the CHANGELOG hunks that look like generator output, not your prose).
  2. Second commit: your narrative work + your CHANGELOG entry on top.
- Use `git diff --cached -- CHANGELOG.md` after staging to spot generator-authored hunks before committing. Generator hunks typically have a recognizable shape (sectioned by date, dense bullet lists about pack publication metadata).
- If you don't want to bother with the split, at minimum write a commit-body acknowledgement (as I did in `f7da629`) so future archaeology can see what's authored vs generated.
- Pairs with [[feedback-git-add-race]] — both are "what landed in your commit isn't what you wrote" failure modes; mitigations are similar (audit `git diff --cached` before committing).
