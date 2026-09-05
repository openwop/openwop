#!/usr/bin/env node
/**
 * check-retention-floors — old-major artifacts stay installable for 12 months
 * from the 2.0.0 publish (spec/v2/core/overview.md §v1 end-of-support, "Old-major
 * retention floors"; charter Phase 5).
 *
 * Reads spec/v2/retention-floors.json (the identities and each line's last 1.x
 * version) and the v2.0.0 tag's commit date from git (null until the cut). Then:
 *
 *   - always: validates the registry, prints the floor state — "not started",
 *     "open until <date>", or "closed <date>" — and, before the cut, exits 0.
 *   - with --network (or OPENWOP_RETENTION_PROBE_FILE naming canned probe
 *     results): each artifact's `lastOldMajor` MUST be present in its registry
 *     document while the floor is open; a missing version is a failure. After
 *     the floor closes the probe is reported, not failed.
 *
 * The probe file override exists so the coherence scenario can drive this both
 * ways offline: {"<name>": ["<version>", …]} per artifact. `OPENWOP_TODAY` and
 * `OPENWOP_RETENTION_RELEASE_DATE` are overridable for the same reason. A gate
 * green because the floor has not started prints the same nothing as one green
 * because every version is present, so the state is printed on every run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REG = join(ROOT, 'spec', 'v2', 'retention-floors.json');
const network = process.argv.includes('--network');
const probeFile = process.env['OPENWOP_RETENTION_PROBE_FILE'];
const TODAY = (process.env['OPENWOP_TODAY'] ?? new Date().toISOString()).slice(0, 10);

const reg = JSON.parse(readFileSync(REG, 'utf8'));
const failures = [];

// Registry shape — hand-kept, so validated.
if (!Number.isInteger(reg.windowMonths) || reg.windowMonths < 1) failures.push('windowMonths must be a positive integer');
if (typeof reg.releaseTag !== 'string') failures.push('releaseTag must be a string');
for (const a of reg.artifacts ?? []) {
  for (const k of ['ecosystem', 'name', 'lastOldMajor']) if (typeof a[k] !== 'string' || !a[k]) failures.push(`${a.name ?? '?'}: ${k} missing`);
  if (!Number.isInteger(a.oldMajor)) failures.push(`${a.name}: oldMajor must be an integer`);
  const major = String(a.lastOldMajor).replace(/^v/, '').split('.')[0];
  if (String(a.oldMajor) !== major) failures.push(`${a.name}: lastOldMajor ${a.lastOldMajor} is not on major ${a.oldMajor}`);
  if (!a.probe?.url || !a.probe?.versionsAt) failures.push(`${a.name}: probe.url and probe.versionsAt are required`);
}

// The floor start: the release tag's commit date, from git — never from this file.
function releaseDate() {
  if (process.env['OPENWOP_RETENTION_RELEASE_DATE']) return process.env['OPENWOP_RETENTION_RELEASE_DATE'].slice(0, 10);
  const r = spawnSync('git', ['log', '-1', '--format=%cI', reg.releaseTag], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim().slice(0, 10) : null;
}
function addMonths(iso, months) { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); }

const start = releaseDate();
const closes = start ? addMonths(start, reg.windowMonths) : null;
const state = start === null
  ? `not started — the ${reg.releaseTag} tag does not exist yet; every old-major artifact MUST stay installable from the cut for ${reg.windowMonths} months`
  : TODAY < closes ? `open — 2.0.0 published ${start}; floor closes ${closes}; today ${TODAY}` : `closed ${closes} — 2.0.0 published ${start}; today ${TODAY}; the floor no longer binds`;
const open = start !== null && TODAY < closes;

// Probes.
async function versionsFor(a) {
  if (probeFile) {
    const canned = JSON.parse(readFileSync(probeFile, 'utf8'));
    return Array.isArray(canned[a.name]) ? canned[a.name] : [];
  }
  const res = await fetch(a.probe.url, { headers: { accept: 'application/json, text/plain' } });
  if (!res.ok) throw new Error(`${a.probe.url} answered ${res.status}`);
  if (a.probe.versionsAt === 'lines') return (await res.text()).split('\n').map((s) => s.trim()).filter(Boolean);
  const doc = await res.json();
  const at = doc?.[a.probe.versionsAt];
  return at && typeof at === 'object' ? Object.keys(at) : [];
}

const probed = [];
if (network || probeFile) {
  for (const a of reg.artifacts ?? []) {
    try {
      const versions = await versionsFor(a);
      const present = versions.includes(a.lastOldMajor);
      probed.push(`${a.ecosystem} ${a.name}@${a.lastOldMajor}: ${present ? 'present' : 'MISSING'} (${versions.length} version(s) listed)`);
      if (!present && open) failures.push(`${a.ecosystem} ${a.name}@${a.lastOldMajor} is not installable while the retention floor is open (closes ${closes}) — an old-major consumer cannot rebuild (overview.md §Old-major retention floors)`);
      if (!present && start === null) failures.push(`${a.ecosystem} ${a.name}@${a.lastOldMajor} is not installable before the cut — the floor cannot start from a version that is already gone`);
    } catch (e) {
      failures.push(`${a.ecosystem} ${a.name}: probe failed — ${e.message}`);
    }
  }
}

console.log(`check-retention-floors: ${state}`);
for (const p of probed) console.log(`  ${p}`);
if (!network && !probeFile) console.log(`  (registries not probed — pass --network to verify the ${(reg.artifacts ?? []).length} pinned version(s) are installable)`);
if (failures.length) { console.error('=== check-retention-floors FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`=== check-retention-floors OK — ${(reg.artifacts ?? []).length} old-major artifact(s); floor ${start === null ? 'not started' : open ? 'open' : 'closed'} ===`);
