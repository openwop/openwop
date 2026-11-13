/**
 * RFC 0263: a cited row must be shown able to fail.
 *
 * Shared by `check-accepted-predicate.mjs` (rules 5 and 6) and
 * `check-sabotage-ledger.mjs`, which the coherence scenario
 * `v2-sabotage-ledger.test.ts` drives on fixture directories, so the test
 * exercises the gate's own code.
 *
 *   §A (rule 6) — from RFC 0258, an `Active` or `Accepted` RFC's Falsifiability
 *       table names a requirement id on every row whose verdict is witnessable
 *       or seam-gated. A row with no leg yet says `planned` in its verdict, and
 *       from RFC 0260 a `planned` row blocks `Accepted`.
 *   §B — `evidence/sabotage-ledger.json` records red runs: the sabotage, the
 *       subject it ran on, the suite version, and `executed-fail`.
 *   §C (rule 5) — from RFC 0260, every id an `Accepted` RFC's table names on a
 *       witnessable row has a ledger row, on a subject that is not a certified
 *       bundle (a certified bundle recorded the pass, not the red).
 */

export const IDS_FROM = 258;
export const SABOTAGE_FROM = 260;

const WITNESSED_VERDICT = /^(witnessable|seam-gated)/i;
const ID = /openwop\.requirement\.[a-z0-9.-]+/g;

/** The rows of an RFC's Falsifiability table, header and rule lines dropped. */
export function falsifiabilityRows(text) {
  const table = text.split(/^### Falsifiability[^\n]*$/m)[1]?.split(/^## /m)[0] ?? '';
  return table.split('\n')
    .filter((l) => /^\|/.test(l) && !/^\|\s*-{2,}/.test(l) && !/^\|\s*(Requirement|§?\s*Requirement)\b/i.test(l))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const verdict = (cells[3] ?? '').replace(/\*\*/g, '');
      return { line, verdict, ids: [...line.matchAll(ID)].map((m) => m[0].replace(/\.$/, '')) };
    });
}

const witnessed = (row) => WITNESSED_VERDICT.test(row.verdict);
const planned = (row) => /\bplanned\b/i.test(row.verdict);

/** §A: every witnessable row names an id, or says `planned` (and, from 0260, not at Accepted). */
export function idRuleFailures(file, status, text) {
  const n = Number(file.slice(0, 4));
  if (n < IDS_FROM || !['Active', 'Accepted'].includes(status)) return [];
  const out = [];
  for (const row of falsifiabilityRows(text).filter(witnessed)) {
    if (row.ids.length > 0) continue;
    if (!planned(row)) out.push(`${file}: witnessable Falsifiability row names no requirement id and is not marked \`planned\` (RFC 0263 §A) — ${row.line.slice(0, 90)}`);
    else if (status === 'Accepted' && n >= SABOTAGE_FROM) out.push(`${file}: Accepted with a \`planned\` witnessable row — the row has no leg, so nothing witnessed it (RFC 0263 §A) — ${row.line.slice(0, 90)}`);
  }
  return out;
}

/** §C: every id an Accepted RFC ≥ 0260 names on a witnessable row has a red ledger row. */
export function sabotageRuleFailures(file, status, text, ledger) {
  const n = Number(file.slice(0, 4));
  if (n < SABOTAGE_FROM || status !== 'Accepted') return [];
  const rows = ledger?.rows ?? [];
  const out = [];
  for (const id of new Set(falsifiabilityRows(text).filter(witnessed).flatMap((r) => r.ids))) {
    const shown = rows.some((r) => r.result === 'executed-fail' && (r.requirementId === id || r.requirementId?.startsWith(`${id}.`)));
    if (!shown) out.push(`${file}: ${id} has no executed-fail row in evidence/sabotage-ledger.json — nothing shows the leg can fail (RFC 0263 §C)`);
  }
  return out;
}

const KEYS = new Set(['requirementId', 'scenario', 'sabotage', 'subject', 'suiteVersion', 'result', 'date', 'witnessSha256']);

/** §B: the ledger's shape. `certifiedDigests` are the witnessSha256 of every certified committed bundle. */
export function ledgerShapeFailures(doc, certifiedDigests = new Set()) {
  if (!doc || !Array.isArray(doc.rows)) return ['evidence/sabotage-ledger.json: `rows` must be an array (RFC 0263 §B)'];
  const out = [];
  doc.rows.forEach((r, i) => {
    const at = `evidence/sabotage-ledger.json rows[${i}]`;
    for (const k of Object.keys(r ?? {})) if (!KEYS.has(k)) out.push(`${at}: unknown member \`${k}\``);
    if (!/^openwop\.requirement\.\d{4}\.[a-z0-9][a-z0-9.-]*$/.test(r?.requirementId ?? '')) out.push(`${at}: requirementId must be an openwop.requirement.NNNN.<slug> id`);
    if (!/^[a-z0-9-]+\.test\.ts$/.test(r?.scenario ?? '')) out.push(`${at}: scenario must name a .test.ts file`);
    if (typeof r?.sabotage !== 'string' || r.sabotage.trim().length < 20) out.push(`${at}: sabotage must say, in a sentence, what was broken`);
    if (typeof r?.subject?.host !== 'string' || typeof r?.subject?.build !== 'string' || Object.keys(r.subject).some((k) => k !== 'host' && k !== 'build')) out.push(`${at}: subject must be exactly { host, build }`);
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(r?.suiteVersion ?? '')) out.push(`${at}: suiteVersion must be a suite version`);
    if (r?.result !== 'executed-fail') out.push(`${at}: result must be executed-fail — a sabotage that passed showed nothing`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.date ?? '')) out.push(`${at}: date must be YYYY-MM-DD`);
    if (r?.witnessSha256 !== undefined) {
      if (!/^[0-9a-f]{64}$/.test(r.witnessSha256)) out.push(`${at}: witnessSha256 must be 64 hex characters`);
      else if (certifiedDigests.has(r.witnessSha256)) out.push(`${at}: witnessSha256 names a certified committed bundle — a certified bundle recorded the pass, not the red run (RFC 0263 §C)`);
    }
  });
  return out;
}
