#!/usr/bin/env node
/**
 * check-tree-matches-head — the gate proves the TREE is good. Nothing proves
 * the tree is what you pushed.
 *
 * ## Why this exists
 *
 * `openwop:check` validates the working tree. That is the right thing while you
 * are working — you want the gate to see your edits. But it means a green gate
 * says nothing about the commit you are about to make, and the gap between them
 * is exactly one `git add`.
 *
 * On 2026-08-13 that gap cost a publish. The status generator updated the root
 * `README.md` scenario count; the gate went green on a tree that contained the
 * fix; the commit staged explicit paths and **missed that one file**; the tag
 * was cut from the commit, and CI preflight failed on `claims "436 conformance
 * scenario files" but actual is 437`. npm never received the version I had
 * already told a peer session was publishing.
 *
 * **Explicit-path staging is the rule that prevents `git add -A` accidents, and
 * it is precisely what made this possible** — you stage what you meant, and miss
 * what a generator touched behind you. The two failure modes are opposite and
 * you cannot avoid both by being careful; one of them needs a check.
 *
 * ## What it does
 *
 * Reports files that are **modified but not committed** — the delta between what
 * the gate just validated and what `HEAD` actually contains. Generated and
 * derived files are called out separately, because those are the ones a
 * generator touches without being asked and therefore the ones most likely to
 * be missed while staging by hand.
 *
 * ## Advisory, deliberately
 *
 * This does **not** fail the gate. Running `openwop:check` mid-edit with a dirty
 * tree is the normal case, and a check that reds on ordinary work would be
 * turned off within a day — and a disabled check is worse than no check,
 * because the repo still reads as though it has one.
 *
 * What it buys is that the divergence becomes **visible at the moment it
 * matters** — you have just watched the gate go green, and the next thing you
 * see is which of the files it validated are not yet in a commit.
 *
 * Credit where due: the diagnosis is `openwop-app-1`'s, from the crosstalk
 * thread — *"the gate proves the tree is good, and nothing proves the tree is
 * what you pushed."*
 */

import { execFileSync } from 'node:child_process';

/**
 * Files a generator writes. Being on this list does not make a change wrong —
 * it makes it easy to leave behind, because nobody typed it.
 */
const DERIVED = [
  'README.md',
  'RFCS/README.md',
  'docs/PROTOCOL-STATUS.md',
  'spec/v1/core-standard-manifest.json',
  'conformance/README.md',
];

/**
 * NOTE: do NOT `.trim()` the whole output. Porcelain v1 lines begin with a
 * two-character status field, and an unstaged modification starts with a SPACE
 * (` M path`). Trimming the payload eats that space on the first line only, so
 * the first file reported loses a character of its path — `cripts/…` — while
 * every subsequent line is fine. Caught within a minute of writing it, by a
 * tool whose entire job is telling you which paths to stage.
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).replace(/\n+$/, '');
}

try {
  // Porcelain v1: XY<space>path. X = index, Y = worktree. Untracked is '??'.
  const lines = git(['status', '--porcelain']).split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    console.log('=== check-tree-matches-head OK — working tree matches HEAD ===');
    process.exit(0);
  }

  // `XY path`, where either status char may be a space. Parsed by shape rather
  // than by index arithmetic, so a leading-space status cannot shift the path.
  const entries = lines
    .map((l) => /^(..) (.*)$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ code: m[1], path: m[2].trim() }));
  const uncommitted = entries.filter((e) => e.code !== '??');
  const untracked = entries.filter((e) => e.code === '??');
  const derived = uncommitted.filter((e) => DERIVED.some((d) => e.path === d || e.path.endsWith(`/${d}`)));

  console.log('=== check-tree-matches-head — the gate validated this tree, not HEAD ===\n');
  console.log(`  ${uncommitted.length} modified, ${untracked.length} untracked\n`);

  if (derived.length > 0) {
    console.log('  GENERATED / DERIVED — a generator wrote these; nobody typed them, so');
    console.log('  they are the ones explicit-path staging misses:\n');
    for (const e of derived) console.log(`    ${e.code}  ${e.path}`);
    console.log('');
  }

  const rest = uncommitted.filter((e) => !derived.includes(e));
  if (rest.length > 0) {
    console.log('  OTHER MODIFIED:\n');
    for (const e of rest.slice(0, 20)) console.log(`    ${e.code}  ${e.path}`);
    if (rest.length > 20) console.log(`    … and ${rest.length - 20} more`);
    console.log('');
  }

  console.log('  Advisory, not a failure — a dirty tree mid-edit is the normal case.');
  console.log('  But if you are about to commit or tag: the gate you just watched go');
  console.log('  green ran against THIS tree. Anything above that you do not stage is');
  console.log('  absent from what you push, and CI will run the same gate on that.\n');
} catch (err) {
  // Not a git checkout, or git unavailable. Not a corpus problem; say so and move on.
  console.log(`=== check-tree-matches-head skipped — ${err.message.split('\n')[0]} ===`);
}
