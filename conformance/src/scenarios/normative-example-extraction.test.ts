/**
 * RFC 0149 §D — normative examples are extracted and validated against the
 * same schemas conformance uses.
 *
 * "Normative examples MUST be extracted into fixtures and validated against
 * the same schemas used by conformance" (§D). Until now a fenced example was
 * prose to every validator in the corpus: `capability-example-root-layout`
 * catches one wrong SHAPE (the `capabilities` wrapper), but an example could
 * carry a misspelled field, a wrong enum value, or a stale required property
 * and every gate stayed green — a green corpus teaching a non-conformant
 * document.
 *
 * Mechanism — a declaration, not a heuristic:
 *
 *   <!-- normative-example: <name>.schema.json -->
 *   ```json
 *   { ... }
 *   ```
 *
 * The HTML comment on the line immediately before a ```json / ```jsonc fence
 * declares that the fenced body is a WHOLE instance of the named schema. The
 * scenario extracts each declared example at test time and validates it with
 * Ajv against `schemas/<name>` — the identical schema files and registration
 * (`fixtures-valid.test.ts` enumerates the directory the same way) that every
 * other conformance leg uses. Extraction is in-process rather than committed
 * under `fixtures/`: a committed copy of a prose example is a second source
 * of truth that drifts, which is the defect §D exists to remove.
 *
 * Non-vacuity guards (RFC 0148 §A — an extractor that matches nothing must
 * not pass):
 *   - the corpus MUST contain declared examples (floor asserted);
 *   - every fenced JSON block in spec/v1 that parses and validates as a whole
 *     instance of some non-permissive schema MUST be declared — an example
 *     that IS a schema instance is a normative example, and the marker is how
 *     it says so; a new whole-document example added without the marker fails
 *     here rather than silently escaping validation;
 *   - every declared example MUST parse as strict JSON (jsonc comments and
 *     ellipses are prose, not instances) and MUST validate;
 *   - every discovery-shaped example (root `protocolVersion` +
 *     `supportedEnvelopes`) MUST be declared against `capabilities.schema.json`
 *     ("all normative discovery examples ... validate" — RFC 0149 acceptance);
 *   - §E: no declared discovery example carries credential- or tenant-shaped
 *     keys.
 *
 * Server-free; always-on in the corpus layout (spec prose is not shipped in the
 * published package, so `V1_DIR === null` skips the describe there).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: extracts fenced prose examples and validates them against the schema files on disk; no host is contacted';

const MARKER = /^<!--\s*normative-example:\s*([a-z0-9-]+\.schema\.json)\s*-->\s*$/;

interface Fenced {
  readonly file: string;
  /** 1-based line of the ``` opener. */
  readonly line: number;
  readonly info: string;
  readonly body: string;
  /** Schema declared by a marker on the preceding line, if any. */
  readonly declared: string | null;
}

function fencedBlocks(dir: string): Fenced[] {
  const out: Fenced[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const open = /^```(json|jsonc)(\s.*)?$/.exec(lines[i]!.trim());
      if (open === null) continue;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== '```') {
        body.push(lines[j]!);
        j++;
      }
      const prev = i > 0 ? (lines[i - 1] ?? '') : '';
      const m = MARKER.exec(prev.trim());
      out.push({ file: name, line: i + 1, info: open[1] ?? 'json', body: body.join('\n'), declared: m?.[1] ?? null });
      i = j;
    }
  }
  return out;
}

/** Stray markers: a marker line NOT immediately followed by a fence opener. */
function strayMarkers(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!MARKER.test(lines[i]!.trim())) continue;
      const next = (lines[i + 1] ?? '').trim();
      if (!/^```(json|jsonc)(\s|$)/.test(next)) out.push(`spec/v1/${name}:${i + 1}`);
    }
  }
  return out;
}

function parseStrict(body: string): unknown | undefined {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isDiscoveryShaped(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['protocolVersion'] === 'string' &&
    Array.isArray((v as Record<string, unknown>)['supportedEnvelopes'])
  );
}

/** Register every schema in the directory (S14 pattern) and hand back validators by file name. */
function validators(): { byFile: Map<string, ValidateFunction>; permissive: Set<string> } {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const files = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
  const docs = new Map<string, { $id?: string }>();
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(SCHEMAS_DIR, f), 'utf8')) as { $id?: string };
    docs.set(f, doc);
    ajv.addSchema(doc);
  }
  const byFile = new Map<string, ValidateFunction>();
  for (const [f, doc] of docs) {
    const v = doc.$id === undefined ? undefined : ajv.getSchema(doc.$id);
    if (v !== undefined) byFile.set(f, v);
  }
  // A schema that accepts `{}` AND `{x:1}` constrains nothing at the root; a
  // whole-document match against it says nothing about the example, so it is
  // excluded from the "must be declared" auto-detection (still usable as an
  // explicit declaration).
  const permissive = new Set([...byFile.entries()].filter(([, v]) => v({}) === true && v({ x: 1 }) === true).map(([f]) => f));
  return { byFile, permissive };
}

const CREDENTIAL_KEY = /^(apiKey|api_key|token|accessToken|refreshToken|secret|clientSecret|password|authorization|bearer|tenantId|tenant_id|organizationId)$/i;
function credentialShapedKeys(v: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) {
    v.forEach((x, i) => out.push(...credentialShapedKeys(x, `${path}[${i}]`)));
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(k)) out.push(`${path}.${k}`);
      out.push(...credentialShapedKeys(x, `${path}.${k}`));
    }
  }
  return out;
}

describe.skipIf(V1_DIR === null)('RFC 0149 §D — normative examples are extracted and validated against the conformance schemas', () => {
  // `describe.skipIf` still RUNS this factory in the published layout (vitest
  // collects skipped suites), so nothing here may touch the prose directory
  // when it is absent — the guards below keep collection green in the tarball.
  const v1Dir = V1_DIR ?? '';
  const blocks = V1_DIR === null ? [] : fencedBlocks(v1Dir);
  const declared = blocks.filter((b) => b.declared !== null);
  const { byFile, permissive } = V1_DIR === null ? { byFile: new Map<string, ValidateFunction>(), permissive: new Set<string>() } : validators();

  it('the extractor finds fenced examples and the corpus declares normative ones (non-vacuity floor)', () => {
    expect(blocks.length, 'spec/v1 MUST contain fenced json/jsonc examples').toBeGreaterThan(100);
    expect(declared.length, 'spec/v1 MUST declare normative examples with <!-- normative-example: … -->').toBeGreaterThanOrEqual(20);
    expect(byFile.size, 'schemas/ MUST register').toBeGreaterThan(50);
  });

  it('every marker names a schema that exists and sits immediately above a json/jsonc fence', () => {
    const unknown = declared.filter((b) => !byFile.has(b.declared as string)).map((b) => `spec/v1/${b.file}:${b.line} → ${String(b.declared)}`);
    expect(unknown, 'normative-example markers naming a schema that does not exist in schemas/').toEqual([]);
    expect(strayMarkers(v1Dir), 'normative-example markers not directly followed by a ```json fence').toEqual([]);
  });

  it('every declared example parses as strict JSON — jsonc comments and ellipses are prose, not instances', () => {
    const unparsable = declared.filter((b) => parseStrict(b.body) === undefined).map((b) => `spec/v1/${b.file}:${b.line} (${b.info}) declared ${String(b.declared)}`);
    expect(unparsable, 'declared normative examples MUST be strict JSON').toEqual([]);
  });

  it('every declared example VALIDATES against its declared schema — the same schema file conformance uses', () => {
    const failures: string[] = [];
    for (const b of declared) {
      const doc = parseStrict(b.body);
      if (doc === undefined) continue; // reported by the leg above
      const v = byFile.get(b.declared as string);
      if (v === undefined) continue; // reported by the leg above
      if (v(doc) !== true) {
        const errs = (v.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('; ');
        failures.push(`spec/v1/${b.file}:${b.line} ✗ ${String(b.declared)}: ${errs}`);
      }
    }
    expect(failures, 'RFC 0149 §D: a normative example that does not validate teaches a non-conformant document').toEqual([]);
  });

  it('every fenced JSON block that IS a whole instance of a (non-permissive) schema is declared — no undeclared normative example', () => {
    const undeclared: string[] = [];
    for (const b of blocks) {
      if (b.declared !== null) continue;
      const doc = parseStrict(b.body);
      if (doc === undefined) continue;
      const hits = [...byFile.entries()].filter(([f, v]) => !permissive.has(f) && v(doc) === true).map(([f]) => f);
      if (hits.length > 0) undeclared.push(`spec/v1/${b.file}:${b.line} validates as ${hits.join(' | ')} — add <!-- normative-example: <one of these> --> above the fence`);
    }
    expect(undeclared, 'whole-document examples MUST be declared so they are validated on every run').toEqual([]);
  });

  it('every discovery-shaped example is declared against capabilities.schema.json and validates (RFC 0149: "all normative discovery examples ... validate")', () => {
    const discovery = blocks.filter((b) => isDiscoveryShaped(parseStrict(b.body)));
    expect(discovery.length, 'spec/v1 MUST carry at least one whole discovery example').toBeGreaterThan(0);
    const wrong = discovery.filter((b) => b.declared !== 'capabilities.schema.json').map((b) => `spec/v1/${b.file}:${b.line} declared ${String(b.declared)}`);
    expect(wrong, 'discovery-shaped examples MUST be declared normative-example: capabilities.schema.json').toEqual([]);
    const v = byFile.get('capabilities.schema.json');
    expect(v).toBeDefined();
    for (const b of discovery) expect((v as ValidateFunction)(parseStrict(b.body)), `spec/v1/${b.file}:${b.line}`).toBe(true);
  });

  it('§E: no declared discovery example carries credential- or tenant-shaped keys', () => {
    const offenders: string[] = [];
    for (const b of declared.filter((x) => x.declared === 'capabilities.schema.json')) {
      for (const p of credentialShapedKeys(parseStrict(b.body))) offenders.push(`spec/v1/${b.file}:${b.line} ${p}`);
    }
    expect(offenders, 'RFC 0149 §E: no discovery example may contain credentials or tenant data').toEqual([]);
  });

  it('sabotage: a declared example with a wrong enum value is caught by the same validator path', () => {
    // Guard against a validator that compiles to `true` (strict:false + a
    // schema that failed to register would do that silently).
    const v = byFile.get('error-envelope.schema.json');
    expect(v).toBeDefined();
    expect((v as ValidateFunction)({ error: 'not_found', message: 'gone', retriable: 'yes' })).toBe(false);
    expect((v as ValidateFunction)({ error: 'not_found', message: 'gone' })).toBe(true);
  });
});
