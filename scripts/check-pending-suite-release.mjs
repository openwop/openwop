#!/usr/bin/env node
/**
 * check-pending-suite-release — did a suite bump on `main` ever reach npm?
 *
 * ## The hole this closes
 *
 * `check-published-suite-identity.mjs` answers "if this version IS on npm, do
 * its contents still match the tree?". It deliberately PASSES when the version
 * is absent, because that is exactly what a freshly-bumped, not-yet-tagged
 * version looks like. Correct for that gate — and it means a bump that is
 * never tagged is indistinguishable from one that is about to be.
 *
 * Nothing else looked either. `@openwop/openwop-conformance` once accumulated
 * 25 unpublished bumps (1.73.0 → 1.98.0) while npm served 1.73.0; a peer
 * session noticed, no gate could.
 *
 * The first CI run of this check corrected an assumption behind its own
 * design. A version that was pinned, superseded, and never published is not
 * rare — it is the NORMAL case here, 59 of the last 120. The suite is bumped
 * on most merges and tagged in batches, so gaps in the version line are the
 * release cadence, not a fault. What actually hurt was never the gaps; it was
 * the CURRENT pin sitting unpublished while npm served something older.
 *
 * ## Two findings, deliberately weighted differently
 *
 *   PENDING (fails past the grace window) — main's CURRENT pin is unpublished.
 *     This is the one that hurts: consumers on `@latest` are served something
 *     older than what the corpus claims, and every day it persists widens the
 *     gap. Recoverable at any time by tagging, which is why it is worth failing
 *     loudly about.
 *
 *   SKIPPED (reported, never fails) — a version that was main's pin at some
 *     point, was superseded, and was never published. Routine, and doubly
 *     un-failable: it is the normal cadence, AND it is unrecoverable, since
 *     the tree that version named is gone and publishing it now would be a lie
 *     about what it contained. Reported as a count with a small sample, so the
 *     number stays visible without burying the one line that matters.
 *
 * ## Why the grace window, and why this is not in `openwop:check`
 *
 * A bump legitimately lands on main BEFORE its tag — that gap is the release
 * process working, not failing. So a bare "pinned but unpublished" test would
 * fire on every correct release. The grace window (default 24h, override with
 * OPENWOP_PENDING_RELEASE_GRACE_HOURS) separates "mid-release" from "forgotten".
 *
 * It must NOT run in `openwop:check`, which gates pull requests. Main's pin
 * being stale is the maintainer's business, not a contributor's: reding
 * someone's unrelated PR because a tag was missed punishes the wrong person
 * and teaches everyone that red means nothing. This runs on a schedule
 * against main, where the finding is actionable by whoever sees it.
 *
 * ## Outcomes
 *
 *   OK       current pin is published, or is inside the grace window
 *   FAIL     current pin unpublished past the grace window (exit 1)
 *   UNKNOWN  registry unreachable — NOT a pass; exit 2 under --require-network
 *            or CI=true, tolerated locally so offline work is unaffected
 *
 * Usage: node scripts/check-pending-suite-release.mjs [--require-network] [--history N]
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'conformance/package.json';
const REQUIRE_NETWORK = process.argv.includes('--require-network');
const STRICT = REQUIRE_NETWORK || process.env['CI'] === 'true';

const GRACE_HOURS = Number(process.env['OPENWOP_PENDING_RELEASE_GRACE_HOURS'] ?? '24');
if (!Number.isFinite(GRACE_HOURS) || GRACE_HOURS < 0) {
  process.stdout.write(`  FAIL — OPENWOP_PENDING_RELEASE_GRACE_HOURS must be a non-negative number.\n`);
  process.exit(1);
}

// How far back to walk for superseded-but-never-published versions. Bounded so
// the check stays fast on a long history; the bound is REPORTED rather than
// applied silently, because "we looked at everything" and "we looked at the
// last N" are different claims.
const historyFlag = process.argv.indexOf('--history');
const HISTORY_LIMIT = historyFlag !== -1 ? Number(process.argv[historyFlag + 1]) : 120;

const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const { name, version: current } = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST), 'utf8'));
process.stdout.write(`=== check-pending-suite-release — did every ${name} bump on main reach npm? ===\n`);

// ---- 1. What does the registry hold? One request, all versions. -------------
let publishedVersions;
try {
  const raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw);
  publishedVersions = new Set(Array.isArray(parsed) ? parsed : [parsed]);
} catch (err) {
  const stderr = String(err.stderr ?? err.message ?? '');
  if (/E404|is not in this registry|No match found/i.test(stderr)) {
    publishedVersions = new Set();
  } else {
    process.stdout.write(
      `  UNKNOWN — could not reach the registry to list versions of ${name}.\n` +
        `  This is NOT a pass: "could not look" and "looked and found it" are different claims.\n` +
        `  ${stderr.trim().split('\n').slice(0, 2).join(' / ')}\n` +
        (STRICT
          ? `  Treating UNKNOWN as a FAILURE: this environment is expected to reach the registry.\n`
          : `  Tolerated locally (exit 0) so offline work is unaffected.\n`),
    );
    process.exit(STRICT ? 2 : 0);
  }
}

// ---- 2. Every version this manifest has ever been pinned to, newest first ---
let commits = [];
try {
  commits = git(['log', `-${HISTORY_LIMIT}`, '--format=%H', '--', MANIFEST]).split('\n').filter(Boolean);
} catch {
  /* shallow clone or no history — the current-pin check below still runs */
}

/** version -> ISO date it first appeared, walking oldest→newest so the date is the introduction. */
const introduced = new Map();
for (const sha of [...commits].reverse()) {
  let v;
  try {
    v = JSON.parse(git(['show', `${sha}:${MANIFEST}`])).version;
  } catch {
    continue; // manifest absent or unparseable at that commit
  }
  if (v && !introduced.has(v)) {
    introduced.set(v, git(['log', '-1', '--format=%cI', sha]));
  }
}

const walkedAll = commits.length < HISTORY_LIMIT;
process.stdout.write(
  `  Examined ${commits.length} commit(s) touching ${MANIFEST}` +
    (walkedAll ? ` (entire history).\n` : ` — the last ${HISTORY_LIMIT}, NOT the entire history.\n`) +
    `  ${introduced.size} distinct version(s) pinned in that window.\n` +
    `  ${publishedVersions.size} version(s) exist on npm in total — that is the registry's whole\n` +
    `  history, NOT the overlap with the window, so the two numbers do not subtract.\n`,
);

// ---- 3. SKIPPED: pinned at some point, superseded, never published ----------
const skipped = [...introduced.keys()].filter((v) => v !== current && !publishedVersions.has(v));
if (skipped.length > 0) {
  // Routine here, not anomalous: the suite version is bumped on most merges and
  // tagged in batches, so a superseded-unpublished version is the NORMAL case —
  // the first CI run of this check found 59 of them. Printing all 59 every day
  // would bury the one line that matters, so the count is the finding and the
  // list is a sample. Never fatal, for the same reason: a check that fails on
  // the normal case is a check people learn to ignore.
  const SHOW = 5;
  const recent = skipped
    .slice()
    .sort((a, b) => String(introduced.get(b)).localeCompare(String(introduced.get(a))))
    .slice(0, SHOW);
  process.stdout.write(
    `\n  ${skipped.length} version(s) were pinned on main, superseded, and never published.\n` +
      `  This is expected: the suite is bumped on most merges and tagged in batches, so a\n` +
      `  version that never shipped is the normal case rather than a defect. Reported so the\n` +
      `  count is visible rather than zero; never fatal, because the tree each one named is\n` +
      `  gone and publishing it now would misrepresent its contents.\n` +
      `  Most recent ${Math.min(SHOW, skipped.length)}:\n` +
      recent.map((v) => `    ${v}  (pinned ${introduced.get(v).slice(0, 10)})\n`).join('') +
      (skipped.length > SHOW ? `    … and ${skipped.length - SHOW} older, not listed.\n` : ''),
  );
}

// ---- 4. PENDING: the current pin ------------------------------------------
if (publishedVersions.has(current)) {
  process.stdout.write(`\n  OK — main's pin ${name}@${current} is published.\n`);
  process.exit(0);
}

const introISO = introduced.get(current);
if (!introISO) {
  process.stdout.write(
    `\n  OK — ${name}@${current} is unpublished, but no commit in the window examined\n` +
      `  introduced it, so its age is unknown and this check will not guess.\n`,
  );
  process.exit(0);
}

const ageHours = (Date.now() - Date.parse(introISO)) / 3_600_000;
const age = ageHours < 48 ? `${ageHours.toFixed(1)}h` : `${(ageHours / 24).toFixed(1)}d`;

if (ageHours <= GRACE_HOURS) {
  process.stdout.write(
    `\n  OK — ${name}@${current} is not on npm yet, pinned ${age} ago (grace ${GRACE_HOURS}h).\n` +
      `  A bump landing on main before its tag is the release process working.\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `\n  FAIL — ${name}@${current} has been main's pin for ${age} and is still not on npm.\n` +
    `  npm serves an older version, so consumers on @latest get something the corpus\n` +
    `  no longer describes. This does not resolve on its own — the tag is a manual step.\n\n` +
    `  Fix:  git tag ${name.split('/').pop()}/v${current} <main-sha> && git push origin ${name.split('/').pop()}/v${current}\n` +
    `  Then verify the published tarball, not the green checkmark.\n`,
);
process.exit(1);
