#!/usr/bin/env node
/**
 * generate-v1-eos-clock — the v1 end-of-support date, computed from the matrix
 * and the public history (spec/v2/core/overview.md §v1 end-of-support; RFC 0174
 * §B.4; charter Phase 5). "Phase 5 computes the date from the matrix; nothing
 * else MAY set it."
 *
 *   v1 support ends at the LATER of
 *     (a) every v2-table host's non-vacuous v2 bundle, plus 90 days;
 *     (b) 18 months from the 2.0.0 release — applies iff an independent host
 *         is in the matrix at release.
 *
 * The anchor for (a) is NOT `generatedAt` inside a bundle (nothing signs it) and
 * NOT a string search on the hand-kept matrix (a host's name has been in the
 * v1 table since v1). It is the committer date of the first commit at which
 * `evidence/v2-host-bundles/<host>.json` was NON-VACUOUS — some claimed profile
 * with `witnessCount ≥ 1` — read from `git log` over that one file. A third
 * party re-derives it from the public history; a re-certification replaces the
 * file and does not move it; squash-merges on this repository give author and
 * committer the same date.
 *
 * Usage:
 *   node scripts/generate-v1-eos-clock.mjs --write   # writes evidence/v1-end-of-support.json
 *   node scripts/generate-v1-eos-clock.mjs --check   # exit 1 when the file is stale
 *
 * The output is deterministic (no timestamp of its own) so `--check` is a
 * byte comparison. The clock STATE is always printed — "not anchored" and
 * "far away" must not print the same nothing.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'evidence', 'v1-end-of-support.json');
const BUNDLES = 'evidence/v2-host-bundles';
const MATRIX = join(ROOT, 'INTEROP-MATRIX.md');
const RELEASE_TAG = 'v2.0.0';
const DAYS_A = 90;
const MONTHS_B = 18;

const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'print';

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/** Host names from the INTEROP-MATRIX v2 table: rows `| **\`<name>@<version>\`** …` between the v2 heading and the next `## `. */
function v2TableHosts() {
  const md = readFileSync(MATRIX, 'utf8');
  const start = md.indexOf('## v2 release candidate');
  if (start < 0) return [];
  const rest = md.slice(start + 1);
  const end = rest.search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const hosts = [];
  for (const m of section.matchAll(/^\| \*\*`([^`@]+)@([^`]+)`\*\*/gm)) hosts.push({ name: m[1], version: m[2] });
  return hosts;
}

function nonVacuous(bundle) {
  return Array.isArray(bundle?.claimedProfiles) && bundle.claimedProfiles.some((p) => typeof p?.witnessCount === 'number' && p.witnessCount >= 1);
}

/** The first commit at which the checked-in bundle was non-vacuous, from the public history of that one file. */
function anchorFor(rel) {
  const log = git(['log', '--reverse', '--format=%H,%cI', '--', rel]);
  if (log === null) return { anchoredAt: null, anchorCommit: null, reason: 'git log failed' };
  const commits = log.trim().split('\n').filter(Boolean).map((l) => { const [sha, date] = l.split(','); return { sha, date }; });
  // One reason string for "uncommitted" and "committed but vacuous": the
  // generated file must not change when a vacuous bundle's commit count does
  // (a PR branch has one add commit; the squash-merge on main is a different
  // one). An ANCHORING transition does change the file — the anchor is the
  // merge commit's date, which the re-certification PR cannot know — so the
  // anchor lands in a follow-up commit that regenerates this file; `--check`
  // names that when it fails.
  const UNANCHORED = 'no committed version of the bundle is non-vacuous (a claimed profile with witnessCount ≥ 1); the anchor is the merge commit that first lands one';
  if (commits.length === 0) return { anchoredAt: null, anchorCommit: null, reason: UNANCHORED };
  for (const c of commits) {
    const text = git(['show', `${c.sha}:${rel}`]);
    if (text === null) continue;
    let b; try { b = JSON.parse(text); } catch { continue; }
    if (nonVacuous(b)) return { anchoredAt: c.date, anchorCommit: c.sha, reason: null };
  }
  return { anchoredAt: null, anchorCommit: null, reason: UNANCHORED };
}

function addDays(iso, days) { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function addMonths(iso, months) { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); }

function compute() {
  const hosts = v2TableHosts().map(({ name, version }) => {
    const rel = `${BUNDLES}/${name}.json`;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return { name, matrixVersion: version, bundle: rel, present: false, anchoredAt: null, anchorCommit: null, reason: 'no bundle checked in under evidence/v2-host-bundles/' };
    let latest = null; try { latest = JSON.parse(readFileSync(abs, 'utf8')); } catch { /* reported below */ }
    const a = anchorFor(rel);
    return {
      name,
      matrixVersion: version,
      bundle: rel,
      present: true,
      latest: latest ? {
        suiteVersion: latest.suite?.version ?? null,
        targetMajor: latest.suite?.targetMajor ?? null,
        witnessSha256: latest.witnessSha256 ?? null,
        evidenceTiers: [...new Set((latest.claimedProfiles ?? []).map((p) => p?.evidenceTier).filter(Boolean))],
        nonVacuous: nonVacuous(latest),
      } : { parseError: true },
      anchoredAt: a.anchoredAt,
      anchorCommit: a.anchorCommit,
      reason: a.reason,
    };
  });
  const unanchored = hosts.filter((h) => h.anchoredAt === null);
  const anchors = hosts.filter((h) => h.anchoredAt !== null).map((h) => h.anchoredAt).sort();
  const legA = hosts.length === 0
    ? { notBefore: null, reason: 'the INTEROP-MATRIX v2 table has no host row' }
    : unanchored.length > 0
      ? { notBefore: null, reason: `${unanchored.length} of ${hosts.length} v2-table host(s) not anchored: ${unanchored.map((h) => `${h.name} (${h.reason})`).join('; ')}` }
      : { notBefore: addDays(anchors[anchors.length - 1], DAYS_A), lastAnchor: anchors[anchors.length - 1], reason: null };

  const tagDate = git(['log', '-1', '--format=%cI', RELEASE_TAG]);
  const releaseDate = tagDate ? tagDate.trim() : null;
  let legB;
  if (!releaseDate) {
    legB = { notBefore: null, applies: null, releaseDate: null, reason: `the ${RELEASE_TAG} tag does not exist yet — (b) is undecidable before the cut` };
  } else {
    const independentAtRelease = hosts.some((h) => h.anchoredAt !== null && h.anchoredAt <= releaseDate && (h.latest?.evidenceTiers ?? []).includes('independent'));
    legB = independentAtRelease
      ? { notBefore: addMonths(releaseDate, MONTHS_B), applies: true, releaseDate, reason: null }
      : { notBefore: null, applies: false, releaseDate, reason: 'no independent-tier host was anchored in the matrix at release; (b) does not apply' };
  }

  let endOfSupportNotBefore = null; let state;
  if (legA.notBefore === null) state = `not anchored — ${legA.reason}`;
  else if (legB.applies === null) state = `leg (a) anchored at ${legA.notBefore}; leg (b) undecidable until ${RELEASE_TAG} is cut`;
  else if (legB.applies === false) { endOfSupportNotBefore = legA.notBefore; state = `anchored — leg (a) ${legA.notBefore}; leg (b) does not apply`; }
  else { endOfSupportNotBefore = legA.notBefore > legB.notBefore ? legA.notBefore : legB.notBefore; state = `anchored — later of (a) ${legA.notBefore} and (b) ${legB.notBefore}`; }

  return {
    $comment: 'GENERATED by scripts/generate-v1-eos-clock.mjs from INTEROP-MATRIX.md (v2 table) and the git history of evidence/v2-host-bundles/ — spec/v2/core/overview.md §v1 end-of-support. Do not edit by hand; nothing else MAY set the date.',
    rule: { legA: `every v2-table host's first non-vacuous bundle commit + ${DAYS_A} days`, legB: `${MONTHS_B} months from ${RELEASE_TAG}, iff an independent host was anchored at release` },
    hosts,
    legA,
    legB,
    endOfSupportNotBefore,
    state,
  };
}

const result = compute();
const rendered = JSON.stringify(result, null, 2) + '\n';
console.log(`v1 end-of-support clock: ${result.state}`);
for (const h of result.hosts) console.log(`  ${h.name}: ${h.anchoredAt ? `anchored ${h.anchoredAt} (${h.anchorCommit.slice(0, 8)})` : `not anchored — ${h.reason}`}`);
if (mode === 'write') {
  writeFileSync(OUT, rendered);
  console.log(`wrote ${OUT.replace(ROOT + '/', '')}`);
} else if (mode === 'check') {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (current !== rendered) {
    console.error(`=== generate-v1-eos-clock --check FAILED — ${OUT.replace(ROOT + '/', '')} is ${current === null ? 'missing' : 'stale'}; run: node scripts/generate-v1-eos-clock.mjs --write ===`);
    process.exit(1);
  }
  console.log('=== generate-v1-eos-clock OK — evidence/v1-end-of-support.json is current ===');
}
