#!/usr/bin/env node
/**
 * RFC 0156 §B — the retrospective-review packet (`docs/SECTION-B-REVIEW-PACKET.md`).
 *
 * §B requires a cross-organization review of every waived RFC in eleven subject
 * areas. `docs/WAIVER-RETROSPECTIVE-REGISTER.md` records outcomes; this packet
 * is what a reviewer from another organization reads first: every open row,
 * grouped by the §B subject area it most plausibly falls under, with the RFC's
 * status, its declared evidence tier and where to read it.
 *
 * The grouping is a READING AID, not a §B scope assessment. The register's
 * "§B scope" column stays `in-scope-pending-assessment` until a reviewer
 * records otherwise; this script never writes it, and never writes an outcome.
 *
 *   node scripts/generate-review-packet.mjs --write   regenerate
 *   node scripts/generate-review-packet.mjs --check   fail when the packet is stale (openwop:check)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'docs', 'WAIVER-RETROSPECTIVE-REGISTER.md');
const OUT = join(ROOT, 'docs', 'SECTION-B-REVIEW-PACKET.md');
const mode = process.argv.includes('--write') ? 'write' : 'check';

/** §B's eleven subject areas, in the order a row is assigned to its FIRST match. */
const AREAS = [
  ['Identity and authorization', /\b(auth|authori[sz]|identity|oauth|oidc|credential|bearer|issuer|saml|scim|login|actor)/i],
  ['Tenant isolation', /\b(tenant|isolation|cross-tenant|workspace|head-of-line)/i],
  ['Secrets', /\b(secret|byok|redact|key material|vault)/i],
  ['Packs and registry', /\b(pack|registry|manifest|signing|signature|extension)/i],
  ['Execution sandboxing', /\b(sandbox|wasm|runner|self-hosted|egress)/i],
  ['Idempotency', /\b(idempoten|exactly-once|dedup|duplicate)/i],
  ['Replay', /\b(replay|fork|event log|event-log|checkpoint|canonical json|jcs|digest)/i],
  ['External effects', /\b(webhook|effect|compensation|a2a|mcp|push|delivery|outbound)/i],
  ['Conformance and certification', /\b(conformance|certif|bundle|witness|evidence|suite|profile)/i],
  ['Governance', /\b(governance|steward|maintainer|lifecycle|deprecat|retire|status|claims|assurance)/i],
];

const reg = readFileSync(REGISTER, 'utf8');
const rows = [];
for (const line of reg.split('\n')) {
  const m = /^\|\s*(\d{4})\s*\|\s*(.+?)\s*\|\s*([a-z-]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*`([a-z-]+)`\s*\|?\s*$/.exec(line);
  if (m) rows.push({ rfc: m[1], title: m[2], scope: m[3], org: m[4], date: m[5], outcome: m[6] });
}

const rfcFiles = readdirSync(join(ROOT, 'RFCS')).filter((f) => /^\d{4}-.*\.md$/.test(f));
const fileFor = (n) => rfcFiles.find((f) => f.startsWith(`${n}-`));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const cell = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const groups = new Map(AREAS.map(([name]) => [name, []]));
groups.set('Other (assign during review)', []);
for (const r of rows) {
  const f = fileFor(r.rfc);
  const text = f ? readFileSync(join(ROOT, 'RFCS', f), 'utf8') : '';
  const status = (/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(text) ?? [])[1] ?? '—';
  const updated = (/\|\s*\*\*Updated\*\*\s*\|([^\n]*)/.exec(text) ?? [, ''])[1];
  const tier = (/Evidence tier:\s*\**\s*([^.;(]+)/i.exec(updated) ?? [])[1]?.trim() ?? 'not declared (predates RFC 0174 §B.1, or not yet Accepted)';
  const override = /STEWARD OVERRIDE of RFC 0147 §A\.6|steward override of RFC 0147 §A\.6/i.test(text) ? 'steward override of RFC 0147 §A.6' : 'bootstrap waiver';
  // The register row's own risk class, when the waiver recorded one — "(identity and
  // authorization; Active by steward override …)" — is the author's statement and wins.
  // Otherwise the TITLE alone: summaries mention every area in passing.
  const declared = (/\(([^();]+);[^()]*\)\s*$/.exec(r.title) ?? [])[1] ?? '';
  const area = (declared && AREAS.find(([, re]) => re.test(declared))?.[0])
    || AREAS.find(([, re]) => re.test(r.title))?.[0]
    || 'Other (assign during review)';
  groups.get(area).push({ ...r, file: f, status, tier: clip(tier, 90), override });
}

const open = rows.filter((r) => r.outcome !== 'ratified').length;
let md = `# RFC 0156 §B retrospective-review packet

> **GENERATED** by \`scripts/generate-review-packet.mjs\` from \`docs/WAIVER-RETROSPECTIVE-REGISTER.md\` and \`RFCS/\`. Do not edit by hand; \`openwop:check\` fails when it is stale.

## What this is, and who it is for

RFC 0156 §B: RFCs affecting auth, identity, tenant isolation, secrets, packs, execution sandboxing, idempotency, replay, external effects, conformance/certification, or governance **MUST** receive a retrospective **cross-organization** review. Every RFC below was accepted with its public comment window shortened, either under the bootstrap waiver or by explicit steward override of RFC 0147 §A.6. Each such acceptance is **provisional** until a reviewer from an organization other than the steward's records an outcome.

This packet is for that reviewer. **${rows.length} RFCs are listed; ${open} have no discharging outcome.** The steward, the steward's sessions, and steward-affiliated hosts (MyndHyve is tier-2, not independent) cannot supply the review. Recording one of their reviews as \`ratified\` is the substitution §B's last clause forbids.

## How to review one RFC

1. Read the RFC (linked) — Summary, Proposal, and \`### Falsifiability\`. The evidence tier in its \`Updated\` field names what witnessed it.
2. Answer, for the §B area it sits under:
   - Does the normative text prevent the harm the area names, or only describe it?
   - Is each MUST observable, and does its falsifiability row name a test that can actually fail? (Every witness row names the sabotage that turns it red.)
   - Did shortening the comment window hide an objection a wider audience would have raised? Name it if so.
   - Is anything claimed as witnessed that the cited evidence does not show?
3. Record one outcome from §B's closed vocabulary (\`ratified | corrective-rfc-required | provisional | withdrawn\`) by a pull request that edits the RFC's row in \`docs/WAIVER-RETROSPECTIVE-REGISTER.md\`: your organization in **Reviewer org**, the date, the outcome. For anything but \`ratified\`, open an issue naming the defect or the pending work and link it from the PR. The PR must be authored by the reviewer (DCO sign-off), not by the steward on the reviewer's behalf.
4. You may also narrow the **§B scope** column (\`out-of-scope\` with a one-line rationale). That too is a reviewer judgement, never a mechanical one.

Grouping below is a reading aid only: it assigns each RFC to the risk class its waiver recorded, else to the first §B area its title names. It is not a scope assessment.

`;
for (const [name, list] of groups) {
  if (list.length === 0) continue;
  md += `## ${name} (${list.length})\n\n| RFC | Title | Status | Waiver | Evidence tier | Outcome |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const r of list.sort((a, b) => a.rfc.localeCompare(b.rfc))) {
    const link = r.file ? `[${r.rfc}](../RFCS/${r.file})` : r.rfc;
    md += `| ${link} | ${cell(clip(r.title.replace(/\s*\([^()]*\)\s*$/, ''), 110))} | \`${r.status}\` | ${r.override} | ${cell(r.tier)} | \`${r.outcome}\` |\n`;
  }
  md += '\n';
}

if (mode === 'write') {
  writeFileSync(OUT, md);
  console.log(`wrote docs/SECTION-B-REVIEW-PACKET.md: ${rows.length} RFCs, ${open} open`);
} else {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== md) {
    console.error('=== generate-review-packet --check FAILED — docs/SECTION-B-REVIEW-PACKET.md is stale; run: node scripts/generate-review-packet.mjs --write ===');
    process.exit(1);
  }
  console.log(`=== generate-review-packet OK — ${rows.length} RFCs, ${open} open ===`);
}
