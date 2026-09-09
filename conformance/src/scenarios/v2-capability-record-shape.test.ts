/**
 * v2 — `capability-record-shape` (suite 2.0.0; RFC 0169 §A.1–§A.3;
 * `spec/v2/core/capabilities.md` §2 "The capability record").
 *
 * Witness class: witnessable — unaided. Every family record at the v2 root
 * carries `status`, `since`, `witness`; `until` is present iff the record is
 * not `stable`; an `until` already in the past makes the document
 * non-conformant. Which root keys are family records is read from the
 * generated `schemas/v2/capabilities.schema.json` (a property whose schema
 * requires `status`, `since`, `witness`), so metadata keys (§3.1) are never
 * mistaken for records.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2Discovery } from '../lib/v2.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/capabilities.md §2';
const STATUS = new Set(['stable', 'experimental', 'deprecated']);
const WITNESS = new Set(['witnessable-unaided', 'witnessable-gated', 'seam-gated', 'claims-check', 'negative-existence']);
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

/** Root keys the generated schema declares as family records. */
function familyKeys(): Set<string> {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8')) as { properties?: Record<string, { required?: string[] }> };
  const out = new Set<string>();
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const required = prop.required ?? [];
    if (['status', 'since', 'witness'].every((r) => required.includes(r))) out.add(key);
  }
  return out;
}

/** The records the host actually advertises, keyed by family. */
function records(doc: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const keys = familyKeys();
  return Object.entries(doc)
    .filter(([k, v]) => keys.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v))
    .map(([k, v]) => [k, v as Record<string, unknown>]);
}

/**
 * `until` in the past: a date form is compared with today's UTC date; a
 * `<major>.<minor>` form is "past" once the host already serves a version at or
 * beyond it (the deprecation horizon has been reached on this very host).
 */
function untilInPast(until: string, served: string[]): boolean {
  if (DATE.test(until)) return until < new Date().toISOString().slice(0, 10);
  const [maj, min] = until.split('.').map(Number) as [number, number];
  return served.some((v) => {
    const [a, b] = v.split('.').map(Number) as [number, number];
    return a > maj || (a === maj && b >= min);
  });
}

describe('v2 capability-record-shape (RFC 0169 §A.1–§A.3)', () => {
  it('every family record carries status, since and witness from the wire-legal sets', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const recs = records(doc);
    if (recs.length === 0) return softSkip('inapplicable', 'the host advertises no family record at the v2 root (metadata only)');
    for (const [key, rec] of recs) {
      expect(STATUS.has(String(rec['status'])), req('openwop.requirement.0169.capability-record-shape.required-fields', DOC, `${key}.status MUST be one of stable | experimental | deprecated`)).toBe(true);
      expect(typeof rec['since'] === 'string' && VERSION.test(rec['since']), req('openwop.requirement.0169.capability-record-shape.required-fields', DOC, `${key}.since MUST be present as <major>.<minor>`)).toBe(true);
      expect(WITNESS.has(String(rec['witness'])), req('openwop.requirement.0169.capability-record-shape.required-fields', DOC, `${key}.witness MUST be one of the five wire-legal classes (unwitnessable MUST NOT appear on a wire record)`)).toBe(true);
      expect('supported' in rec, req('openwop.requirement.0169.capability-record-shape.required-fields', DOC, `${key}: \`supported\` does not exist in v2 — presence of the record is the claim (§A.2)`)).toBe(false);
    }
  });

  it('`until` is present iff the record is experimental or deprecated', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const recs = records(doc);
    if (recs.length === 0) return softSkip('inapplicable', 'the host advertises no family record at the v2 root (metadata only)');
    for (const [key, rec] of recs) {
      const hasUntil = rec['until'] !== undefined;
      const stable = rec['status'] === 'stable';
      expect(hasUntil, req('openwop.requirement.0169.capability-record-shape.until-iff-not-stable', DOC, `${key}: \`until\` is REQUIRED when status is experimental or deprecated and MUST NOT be present when stable (status=${String(rec['status'])})`)).toBe(!stable);
      if (hasUntil) {
        expect(typeof rec['until'] === 'string' && (VERSION.test(rec['until']) || DATE.test(rec['until'])), req('openwop.requirement.0169.capability-record-shape.until-iff-not-stable', DOC, `${key}.until MUST be <major>.<minor> or YYYY-MM-DD`)).toBe(true);
      }
    }
  });

  it('no advertised record carries an `until` already in the past', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const served = Array.isArray(doc['protocolVersions']) ? (doc['protocolVersions'] as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    const dated = records(doc).filter(([, rec]) => typeof rec['until'] === 'string');
    if (dated.length === 0) return softSkip('inapplicable', 'no advertised family record carries an `until` (every record is stable, or none is advertised)');
    for (const [key, rec] of dated) {
      expect(untilInPast(rec['until'] as string, served), req('openwop.requirement.0169.capability-record-shape.until-not-past', 'spec/v2/core/capabilities.md §2 (`until` in the past)', `${key}.until=${String(rec['until'])} is in the past — the document is non-conformant (a validator answers 400 until_in_past)`)).toBe(false);
    }
  });
});
