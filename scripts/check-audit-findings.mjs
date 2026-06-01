#!/usr/bin/env node
/**
 * check-audit-findings — the external-security-audit remediation gate.
 *
 * The independent standards-readiness review required: "Complete the external
 * security audit and close high/critical findings before standardizing pack
 * execution and registry behavior." The steward cannot *complete* a vendor audit
 * from inside this repo, but it CAN mechanize the second half of that
 * requirement: once the audit report lands and findings are recorded in
 * `SECURITY/external-audit-findings.json`, an OPEN high/critical finding MUST
 * block the corpus gate (and thus any release / standardization claim).
 *
 * This is the same accountability pattern as `protocol:status:check` (drift is a
 * hard CI failure) and `check-security-invariants.sh` (a protocol-tier MUST-NOT
 * without a test is a hard CI failure): the obligation is enforced by the gate,
 * not by a promise.
 *
 * Behavior:
 *   - validates the tracker's shape against the load-bearing rules of
 *     `external-audit-findings.schema.json` (bundleVersion, per-finding required
 *     fields, severity/status vocab, findingId pattern, status-conditional
 *     fields);
 *   - FAILS (exit 1) if any finding is `severity ∈ {critical, high}` AND
 *     `status ∈ {open, in-progress}` — i.e. a known serious finding that is not
 *     yet mitigated/fixed (or explicitly `wontfix` with a rationale);
 *   - passes on the pre-audit state (`findings: []`).
 *
 * Pure Node 20+ stdlib — no npm install, mirrors the other `scripts/check-*.mjs`.
 *
 * Exit codes:
 *   0 — tracker shape valid AND no open high/critical finding
 *   1 — an open high/critical finding blocks standardization
 *   2 — tracker shape malformed (cannot proceed)
 *
 * @see SECURITY/external-audit-findings.schema.json
 * @see SECURITY/external-audit-engagement.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKER = path.join(root, 'SECURITY', 'external-audit-findings.json');

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'informational']);
const STATUSES = new Set(['open', 'in-progress', 'mitigated', 'fixed', 'wontfix', 'duplicate']);
const BLOCKING_SEVERITY = new Set(['critical', 'high']);
const BLOCKING_STATUS = new Set(['open', 'in-progress']);
const FINDING_ID = /^OPENWOP-AUDIT-[0-9]{4}-[0-9]{3}$/;

function fail(code, message) {
  console.error(`\n=== check-audit-findings FAILED ===\n${message}`);
  process.exit(code);
}

console.log(`=== check-audit-findings — verifying ${TRACKER} ===\n`);

if (!fs.existsSync(TRACKER)) {
  fail(2, `Tracker not found at ${TRACKER}. Expected the (possibly empty) external-audit findings tracker.`);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(TRACKER, 'utf8'));
} catch (e) {
  fail(2, `Tracker is not valid JSON: ${e.message}`);
}

const shapeErrors = [];
if (doc.bundleVersion !== '1') shapeErrors.push(`bundleVersion MUST be "1" (got ${JSON.stringify(doc.bundleVersion)}).`);
if (!Array.isArray(doc.findings)) shapeErrors.push('findings MUST be an array.');

const findings = Array.isArray(doc.findings) ? doc.findings : [];
const seenIds = new Set();
for (const [i, f] of findings.entries()) {
  const where = `findings[${i}]${f && f.findingId ? ` (${f.findingId})` : ''}`;
  if (!f || typeof f !== 'object') {
    shapeErrors.push(`${where}: MUST be an object.`);
    continue;
  }
  for (const req of ['findingId', 'title', 'severity', 'status', 'summary']) {
    if (f[req] === undefined || f[req] === null || f[req] === '') shapeErrors.push(`${where}: missing required field "${req}".`);
  }
  if (f.findingId !== undefined && !FINDING_ID.test(f.findingId)) shapeErrors.push(`${where}: findingId MUST match OPENWOP-AUDIT-YYYY-NNN.`);
  if (f.findingId !== undefined) {
    if (seenIds.has(f.findingId)) shapeErrors.push(`${where}: duplicate findingId.`);
    seenIds.add(f.findingId);
  }
  if (f.severity !== undefined && !SEVERITIES.has(f.severity)) shapeErrors.push(`${where}: invalid severity "${f.severity}".`);
  if (f.status !== undefined && !STATUSES.has(f.status)) shapeErrors.push(`${where}: invalid status "${f.status}".`);
  // Status-conditional integrity: a closed finding must say HOW it was closed.
  if (f.status === 'wontfix' && !f.wontfixRationale) shapeErrors.push(`${where}: status "wontfix" requires "wontfixRationale".`);
  if (f.status === 'duplicate' && !f.duplicateOf) shapeErrors.push(`${where}: status "duplicate" requires "duplicateOf".`);
  if ((f.status === 'fixed' || f.status === 'mitigated') && !(Array.isArray(f.remediationCommits) && f.remediationCommits.length > 0)) {
    shapeErrors.push(`${where}: status "${f.status}" requires at least one entry in "remediationCommits".`);
  }
}

if (shapeErrors.length > 0) {
  fail(2, `Tracker shape is malformed:\n  - ${shapeErrors.join('\n  - ')}`);
}

const bySeverity = {};
for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
const blocking = findings.filter((f) => BLOCKING_SEVERITY.has(f.severity) && BLOCKING_STATUS.has(f.status));

console.log(`Findings tracked: ${findings.length}`);
if (findings.length > 0) {
  for (const sev of ['critical', 'high', 'medium', 'low', 'informational']) {
    if (bySeverity[sev]) console.log(`  ${sev.padEnd(14)}${bySeverity[sev]}`);
  }
}
if (doc.engagementCompletedAt) console.log(`Audit completed: ${doc.engagementCompletedAt}${doc.auditVendor ? ` (${doc.auditVendor})` : ''}`);
else console.log('Audit state:    pre-completion (engagement open or not yet started).');

if (blocking.length > 0) {
  const lines = blocking.map((f) => `  ${f.findingId} [${f.severity}/${f.status}] ${f.title}`).join('\n');
  fail(
    1,
    `${blocking.length} open high/critical finding(s) block standardization until mitigated, fixed, or explicitly wontfix'd:\n${lines}\n\n` +
      `Per SECURITY/external-audit-engagement.md, a high/critical finding MUST be remediated (status fixed/mitigated with a remediationCommit) before a release or standardization claim.`,
  );
}

console.log('\n=== check-audit-findings OK — no open high/critical external-audit finding blocks standardization ===');
