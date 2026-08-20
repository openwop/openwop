#!/usr/bin/env node
/**
 * RFC 0156 §F — the assurance manifest.
 *
 * `docs/ASSURANCE-STATUS.json` (+ its `.md` projection) states, from the live
 * tree and nothing else, what the corpus may CLAIM about itself: who governs
 * it and from how many organizations, how many bootstrap waivers were spent
 * and how many have been reviewed, where the independent audit stands, whether
 * any Tier-3 host exists, which suite/corpus versions are current, which
 * Critical/High program risks are still open, and — derived from all of the
 * above per RFC 0147 §A's claim table — which claims are permitted today.
 *
 * Every field is DERIVED. Nothing here is typed by hand, so the manifest
 * cannot say something the tree does not; and `--check` (run by openwop:check)
 * fails when the file on disk differs from a fresh derivation, so it cannot go
 * stale either. The projection links each input to the file it was read from,
 * which is what §F means by "inputs MUST link to immutable evidence" inside a
 * git history.
 *
 * `--check` ALSO runs the §F claims gate: the public claim surfaces (README,
 * ROADMAP, governance/security/compat docs, INTEROP-MATRIX, docs/*.md,
 * conformance/README) MUST NOT carry a claim token the manifest does not
 * permit. Negated / quoted / banned-in-context uses ("we do NOT claim…",
 * "§A bans the phrase 'industry standard'") are recognised and exempt, so the
 * honest disclaimers KNOWN-LIMITS is full of do not trip it.
 *
 *   node scripts/generate-assurance-status.mjs --write
 *   node scripts/generate-assurance-status.mjs --check
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = resolve(ROOT, 'docs/ASSURANCE-STATUS.json');
const OUT_MD = resolve(ROOT, 'docs/ASSURANCE-STATUS.md');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// ---------------------------------------------------------------- inputs

function maintainers() {
  const md = read('MAINTAINERS.md');
  const rows = [];
  const section = md.slice(md.indexOf('## Current maintainers'));
  for (const line of section.split('\n').slice(1)) {
    if (line.startsWith('## ') && !line.includes('Current maintainers')) break;
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(@[^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (m && !/^-+$/.test(m[1]) && m[1] !== 'Name') rows.push({ name: m[1], github: m[2], affiliation: m[3], role: m[4], activeSince: m[5] });
  }
  return rows;
}

function waivers() {
  const dir = resolve(ROOT, 'RFCS');
  let exercised = 0;
  const rfcs = [];
  for (const f of readdirSync(dir).filter((x) => /^\d{4}-.*\.md$/.test(x)).sort()) {
    const t = readFileSync(join(dir, f), 'utf8');
    if (/comment window waived/i.test(t)) {
      exercised++;
      rfcs.push(f.slice(0, 4));
    }
  }
  // A retrospective review record is a `Retrospective review` heading or a
  // register row saying so; none exists yet, and the count says so.
  let reviewed = 0;
  const regDir = resolve(ROOT, 'RFCS/registers');
  if (existsSync(regDir)) {
    for (const f of readdirSync(regDir)) {
      if (/retrospective review (complete|closed|done)/i.test(readFileSync(join(regDir, f), 'utf8'))) reviewed++;
    }
  }
  return { bootstrapWaiversExercised: exercised, rfcs, retrospectiveReviewsCompleted: reviewed };
}

function audit() {
  const findings = JSON.parse(read('SECURITY/external-audit-findings.json'));
  const eng = read('SECURITY/external-audit-engagement.md');
  const tracker = {};
  const sec = eng.slice(eng.indexOf('## 8. Status tracker'));
  for (const line of sec.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (m && m[1] !== 'Step' && !/^-+$/.test(m[1])) tracker[m[1]] = m[2] === '✅' ? (m[3].match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? 'done') : null;
  }
  const open = (findings.findings ?? []).filter((f) => f.status !== 'closed' && f.status !== 'remediated');
  const highOrCritical = open.filter((f) => /^(high|critical)$/i.test(String(f.severity ?? '')));
  return {
    engagement: tracker['Contract signed'] ? 'engaged' : 'unscheduled',
    tracker,
    findingsBundleVersion: findings.bundleVersion ?? null,
    findingsTotal: (findings.findings ?? []).length,
    openHighOrCritical: highOrCritical.length,
    retestDate: tracker['Remediation lands'] ?? null,
    publicReport: tracker['Public report posted'] ?? null,
  };
}

function tier3() {
  const im = read('INTEROP-MATRIX.md');
  // A Tier-3 row names a different organization; the matrix marks the
  // steward-affiliated sibling explicitly as tier-2 and says no tier-3 exists.
  const hasTier3Row = /\btier-3\b(?![^|]*\b(no|none|not|would|until|needs?|requires?)\b)/i.test(im) && /\|\s*\*\*[^|]*\(tier-3\)/i.test(im);
  return { tier3HostExists: hasTier3Row, evidence: 'INTEROP-MATRIX.md' };
}

function versions() {
  const suite = JSON.parse(read('conformance/package.json')).version;
  const changelog = read('CHANGELOG.md');
  const rel = changelog.match(/^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})/m);
  return { conformanceSuite: suite, corpusRelease: rel ? rel[1] : null, corpusReleaseDate: rel ? rel[2] : null };
}

function risks() {
  const dir = resolve(ROOT, 'RFCS/registers');
  const open = [];
  const transferredRows = [];
  let total = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.risks.md')).sort()) {
    const rfc = f.slice(0, 4);
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const m = line.match(/^\|\s*(R\d+)\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*[^|]*\|\s*\**(Critical|High|Medium|Low)\**\s*\|[^|]*\|[^|]*\|\s*([^|]*?)\s*\|\s*$/);
      if (!m) continue;
      total++;
      const [, id, title, score, status] = m;
      if (score !== 'Critical' && score !== 'High') continue;
      // A row counts as closed only on an EXPLICIT disposition marker, and never
      // when the cell negates one. The previous test matched the bare substring
      // `closed` anywhere in the status cell, which is the
      // substring-of-a-different-concept failure:
      //
      //   · RFC 0151 R1 ("Compensation executes twice", Critical) reads
      //     "Open — ... unwitnessed" and was counted CLOSED from 2026-08-16,
      //     purely because the cell mentions "(G1 closed 2026-08-16)" — a
      //     different item's closure.
      //   · A row stating a risk "cannot be closed by repository work" was
      //     counted closed by saying so.
      //
      // This count is not cosmetic: project-wide gates have been keyed to it, so a
      // false closure silently loosens a constraint.
      const negated = /\b(cannot|can ?not|could not|will not|never|not)\s+be\s+(closed|resolved)\b|\bnot closed\b/i.test(status);
      const explicitlyClosed =
        /\*\*(CLOSED|Closed)\b/.test(status) ||
        /~~/.test(status) ||
        /Realised and remediated/i.test(status);
      const closed = explicitlyClosed && !negated;
      // A risk may also be TRANSFERRED — real and open, but tracked on a named
      // surface outside this register. a disposition of "Closed OR transferred" is what
      // register sweeps turn on, so a count that cannot express `transferred`
      // cannot express the condition it reports. Reported separately rather than
      // folded into either bucket: a transferred risk is not closed, and reading
      // it as unaddressed is equally wrong.
      const transferred = !closed && /\*\*(?:OPEN\s+—\s+)?TRANSFERRED\b/i.test(status);
      if (closed) continue;
      const row = { rfc, id, score, title: title.length > 90 ? title.slice(0, 87) + '…' : title, status: status.replace(/\*\*/g, '').slice(0, 160) };
      if (transferred) transferredRows.push(row);
      open.push(row);
    }
  }
  return { rowsScanned: total, openCriticalOrHigh: open, transferred: transferredRows.map((r) => `${r.rfc}/${r.id}`),
    programOpenCriticalOrHigh: open.filter((r) => Number(r.rfc) >= 147).map((r) => `${r.rfc}/${r.id}`) };
}

// -------------------------------------------------------- permitted claims

/** RFC 0147 §A claim table, evaluated against the inputs above. */
function claims(inputs) {
  const orgs = new Set(inputs.governance.maintainers.map((m) => m.affiliation.toLowerCase())).size;
  const crossOrg = orgs >= 2;
  const audited = inputs.audit.engagement === 'engaged' && inputs.audit.publicReport !== null && inputs.audit.openHighOrCritical === 0;
  const t3 = inputs.tier3.tier3HostExists;
  const table = [
    { claim: 'fully-conformant (unqualified)', tokens: ['fully conformant', 'fully-conformant', 'full conformance'], permitted: false, requires: 'exact profile, protocol and suite versions, configuration, run date, executed/skip counts, corrected signed bundle — i.e. only the QUALIFIED form is ever permitted' },
    { claim: 'current-A2A compatible', tokens: [], permitted: false, requires: 'A2A 1.0 profile AND a real-peer result (RFC 0152 acceptance: real upstream peer in CI is externally gated)' },
    { claim: 'current-MCP compatible', tokens: [], permitted: false, requires: 'MCP 2026-07-28 profile AND a real-peer result (RFC 0153: pinned real peer externally gated)' },
    { claim: 'production multi-region', tokens: ['production multi-region', 'production-multi-region'], permitted: false, requires: 'live or production-equivalent partition/failover exercise with effect-safety evidence (RFC 0150 R3 open, no fencing host)' },
    { claim: 'independently validated', tokens: ['independently validated', 'independently-validated'], permitted: t3 && audited, requires: 'Tier-3 result plus independent security audit' },
    { claim: 'vendor-neutral standard / industry standard / A-grade', tokens: ['industry standard', 'industry-standard', 'vendor-neutral standard', 'A-grade'], permitted: crossOrg && t3, requires: 'activated cross-org governance plus Tier-3 adoption' },
    { claim: 'best-in-class durable orchestration', tokens: ['best-in-class'], permitted: false, requires: 'correct effect identity/replay plus accepted compensation profile AND production evidence' },
  ];
  return { evaluatedAgainst: 'RFCS/0147-protocol-integrity-and-standards-readiness-program.md §A claim table', independentOrganizations: orgs, crossOrgGovernanceActive: crossOrg, auditComplete: audited, table };
}

// ------------------------------------------------------------- derivation

export function derive() {
  const governance = { source: 'MAINTAINERS.md', maintainers: maintainers() };
  const inputs = { governance, waivers: { source: 'RFCS/*.md, RFCS/registers/*', ...waivers() }, audit: { source: 'SECURITY/external-audit-engagement.md §8, SECURITY/external-audit-findings.json', ...audit() }, tier3: tier3(), versions: { source: 'conformance/package.json, CHANGELOG.md', ...versions() }, risks: { source: 'RFCS/registers/*.risks.md', ...risks() } };
  const c = claims(inputs);
  return {
    $comment: 'RFC 0156 §F assurance manifest. DERIVED by scripts/generate-assurance-status.mjs from the files each section names; --check fails when this file disagrees with the tree. Hand edits are overwritten.',
    rfc: '0156',
    ...inputs,
    claims: c,
  };
}

function projection(m) {
  const yes = (b) => (b ? 'yes' : 'no');
  const lines = [];
  lines.push('# Assurance status (RFC 0156 §F)');
  lines.push('');
  lines.push('> **Generated** by `scripts/generate-assurance-status.mjs` from the live tree; `docs/ASSURANCE-STATUS.json` is the machine form and `--check` (in `openwop:check`) fails when either disagrees with the sources named in each section. Do not hand-edit — change the source and regenerate.');
  lines.push('');
  lines.push('## Governance');
  lines.push('');
  lines.push(`Source: \`${m.governance.source}\`. **${m.governance.maintainers.length} maintainer(s)** across **${m.claims.independentOrganizations} organization(s)**; cross-organization governance active: **${yes(m.claims.crossOrgGovernanceActive)}** (RFC 0038 / RFC 0156 §A tripwire).`);
  lines.push('');
  lines.push('| Name | GitHub | Affiliation | Role | Since |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const x of m.governance.maintainers) lines.push(`| ${x.name} | ${x.github} | ${x.affiliation} | ${x.role} | ${x.activeSince} |`);
  lines.push('');
  lines.push('## Bootstrap waivers');
  lines.push('');
  lines.push(`Source: \`${m.waivers.source}\`. **${m.waivers.bootstrapWaiversExercised}** RFC(s) reached \`Accepted\` under a waived comment window (${m.waivers.rfcs.join(', ')}); **${m.waivers.retrospectiveReviewsCompleted}** retrospective review(s) completed (RFC 0156 §B).`);
  lines.push('');
  lines.push('## Independent security audit');
  lines.push('');
  lines.push(`Source: \`${m.audit.source}\`. Engagement: **${m.audit.engagement}**; findings bundle v${m.audit.findingsBundleVersion}: ${m.audit.findingsTotal} finding(s), ${m.audit.openHighOrCritical} open High/Critical; retest: ${m.audit.retestDate ?? '—'}; public report: ${m.audit.publicReport ?? '—'}.`);
  lines.push('');
  lines.push('| Step | Done |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(m.audit.tracker)) lines.push(`| ${k} | ${v ?? '—'} |`);
  lines.push('');
  lines.push('## Tier-3 evidence');
  lines.push('');
  lines.push(`Source: \`${m.tier3.evidence}\`. A host from a different organization publishes valid evidence: **${yes(m.tier3.tier3HostExists)}**.`);
  lines.push('');
  lines.push('## Versions');
  lines.push('');
  lines.push(`Source: \`${m.versions.source}\`. Conformance suite **${m.versions.conformanceSuite}**; corpus release **${m.versions.corpusRelease}** (${m.versions.corpusReleaseDate}).`);
  lines.push('');
  lines.push('## Open Critical / High program risks');
  lines.push('');
  lines.push(`Source: \`${m.risks.source}\` (${m.risks.rowsScanned} rows scanned). **${m.risks.openCriticalOrHigh.length}** open across all registers, of which **${m.risks.programOpenCriticalOrHigh.length}** belong to the RFC 0147 program (RFCs ≥ 0147) — the set RFC 0156's claims are gated on. Older registers were never dispositioned; \`Open\` there means \"the mitigation is the normative MUST in the row\", not an unaddressed risk:`);
  lines.push('');
  lines.push(`Of those, **${m.risks.transferred.length}** are explicitly **transferred** to a named tracked surface (${m.risks.transferred.join(', ') || 'none'}) — real and open, but dispositioned. A register sweep turns on "Closed **or transferred**", so both are reported; an open row and a transferred row are not the same state and are not reported as one.`);
  lines.push('');
  lines.push('| RFC | Risk | Score | Status (head) |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of m.risks.openCriticalOrHigh) lines.push(`| ${r.rfc} | ${r.id} — ${r.title} | ${r.score} | ${r.status} |`);
  lines.push('');
  lines.push('## Permitted claims (RFC 0147 §A)');
  lines.push('');
  lines.push(`Evaluated against \`${m.claims.evaluatedAgainst}\`. Audit complete: **${yes(m.claims.auditComplete)}**. A claim marked **no** MUST NOT appear on a public surface except negated, quoted, or in a sentence that names its evidence bar; \`--check\` scans README, ROADMAP, the governance/security/compatibility documents, INTEROP-MATRIX, docs/ and conformance/README for the tokens.`);
  lines.push('');
  lines.push('| Claim | Permitted | Requires |');
  lines.push('| --- | --- | --- |');
  for (const c of m.claims.table) lines.push(`| ${c.claim} | **${yes(c.permitted)}** | ${c.requires} |`);
  lines.push('');
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------ claims gate

const CLAIM_SURFACES = ['README.md', 'ROADMAP.md', 'GOVERNANCE.md', 'SECURITY.md', 'COMPATIBILITY.md', 'INTEROP-MATRIX.md', 'CONTRIBUTING.md', 'conformance/README.md'];
const EXEMPT_CONTEXT = /\b(not|no|never|without|cannot|can't|isn't|is not|are not|does not|do not|bans?|banned|forbid|forbidden|prohibit|before making|before any|until|would (require|need)|requires?|needs?|the phrase|claim(s|ed|ing)?|coverage|grade[ds]? (it|as)|records it as)\b/i;

function claimsGate(manifest) {
  const forbidden = manifest.claims.table.filter((c) => !c.permitted).flatMap((c) => c.tokens.map((t) => ({ token: t, claim: c.claim })));
  const files = [...CLAIM_SURFACES];
  const docs = resolve(ROOT, 'docs');
  if (existsSync(docs)) for (const f of readdirSync(docs)) if (f.endsWith('.md') && f !== 'ASSURANCE-STATUS.md') files.push(join('docs', f));
  const hits = [];
  for (const rel of files) {
    const p = resolve(ROOT, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (/Status:?\**\s*archived\b|preserved for traceability/i.test(text.slice(0, 1200))) continue; // frozen historical snapshot (same predicate as check-doc-pack-claims)
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const { token, claim } of forbidden) {
        const re = new RegExp(token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/ /g, '[ -]'), 'gi');
        let m;
        while ((m = re.exec(line)) !== null) {
          const before = line.slice(Math.max(0, m.index - 90), m.index);
          const after = line.slice(m.index + m[0].length, m.index + m[0].length + 60);
          const quoted = /["'“‘`]\s*$/.test(before) || /^\s*["'”’`]/.test(after);
          if (quoted || EXEMPT_CONTEXT.test(before) || EXEMPT_CONTEXT.test(after)) continue;
          hits.push(`${rel}:${i + 1}: "${m[0]}" (claim: ${claim}) — …${before.slice(-50)}[${m[0]}]${after.slice(0, 40)}…`);
        }
      }
    });
  }
  return hits;
}

// ------------------------------------------------------------------- main

const mode = process.argv[2];
const fresh = derive();
if (mode === '--write') {
  writeFileSync(OUT_JSON, JSON.stringify(fresh, null, 2) + '\n');
  writeFileSync(OUT_MD, projection(fresh));
  console.log(`wrote docs/ASSURANCE-STATUS.{json,md}: ${fresh.governance.maintainers.length} maintainer(s) / ${fresh.claims.independentOrganizations} org(s), ${fresh.waivers.bootstrapWaiversExercised} waivers, audit ${fresh.audit.engagement}, tier-3 ${fresh.tier3.tier3HostExists}, ${fresh.risks.openCriticalOrHigh.length} open Critical/High, ${fresh.claims.table.filter((c) => c.permitted).length}/${fresh.claims.table.length} claims permitted`);
} else if (mode === '--check') {
  const onDiskJson = existsSync(OUT_JSON) ? readFileSync(OUT_JSON, 'utf8') : '';
  const onDiskMd = existsSync(OUT_MD) ? readFileSync(OUT_MD, 'utf8') : '';
  const problems = [];
  if (onDiskJson !== JSON.stringify(fresh, null, 2) + '\n') problems.push('docs/ASSURANCE-STATUS.json is stale');
  if (onDiskMd !== projection(fresh)) problems.push('docs/ASSURANCE-STATUS.md is stale');
  const hits = claimsGate(fresh);
  if (problems.length > 0 || hits.length > 0) {
    for (const p of problems) console.error(`${p} — run: node scripts/generate-assurance-status.mjs --write`);
    if (hits.length > 0) {
      console.error(`RFC 0156 §F claims gate: ${hits.length} claim token(s) on a public surface that the assurance manifest does not permit:`);
      for (const h of hits) console.error(`  - ${h}`);
      console.error('  Negate it, quote it, or name its evidence bar in the same sentence — or earn it and regenerate the manifest.');
    }
    process.exit(1);
  }
  console.log(`assurance status is current and no unpermitted claim token is on a public surface (${fresh.claims.table.filter((c) => c.permitted).length}/${fresh.claims.table.length} claims permitted; ${fresh.risks.openCriticalOrHigh.length} open Critical/High risks)`);
} else {
  console.log(JSON.stringify(fresh, null, 2));
}
