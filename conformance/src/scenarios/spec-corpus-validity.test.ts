/**
 * Spec-corpus validity — server-free check that the openwop spec artifacts
 * are internally consistent. Catches drift between prose docs, JSON
 * Schemas, OpenAPI, AsyncAPI, and the fixture catalog.
 *
 * Runs purely against on-disk files. Designed for CI gating: any
 * structural break in the spec fails this scenario before reaching the
 * server-required suite.
 *
 * Coverage:
 *   1. Every JSON Schema in `../../schemas/` parses + compiles (Ajv2020).
 *   2. Every fixture JSON validates against workflow-definition schema.
 *      (delegated to fixtures-valid.test.ts; cross-referenced here)
 *   3. OpenAPI 3.1 YAML parses + has required top-level fields.
 *   4. AsyncAPI 3.1 YAML parses + has required top-level fields.
 *   5. Every prose .md doc carries a `Status:` legend tag.
 *   6. Every $ref in OpenAPI/AsyncAPI to ../schemas/*.json resolves to a
 *      file that exists on disk.
 *   7. Every OpenAPI operationId is represented in conformance/coverage.md.
 *   8. README.md's spec/v1 document index matches the on-disk docs.
 *   9. Local Markdown links resolve to files in the repo checkout.
 *  10. schemas/README.md lists every `*.schema.json` file.
 *  11. AsyncAPI message names stay aligned with RunEventType enum values.
 *  12. JSON Schema `$id` values match their canonical openwop.dev URLs.
 *  13. Absolute JSON Schema `$ref`s point at schema `$id`s in this corpus.
 *  14. OpenAPI operationIds are unique and operation tags are declared.
 *  15. AsyncAPI operations, channels, and message names are internally consistent.
 *  16. conformance/README.md scenario counts match `src/scenarios/*.test.ts`.
 *  17. run-event-payloads.schema.json covers every RunEventType exactly once.
 *  18. OpenAPI security/public-route declarations and REST endpoint catalog agree.
 *  19. OpenAPI error specializations compose the canonical ErrorEnvelope.
 *  20. REST/auth/idempotency prose examples keep contextual error metadata under details.
 *  21. SDK error-code helpers expose canonical HTTP envelope codes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve as pathResolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  API_DIR,
  CONFORMANCE_README_PATH,
  COVERAGE_DOC_PATH,
  FIXTURES_DIR,
  FIXTURES_DOC_PATH,
  GO_TYPES_PATH,
  LAYOUT,
  PYTHON_TYPES_PATH,
  README_PATH,
  SCENARIOS_DIR,
  SCHEMAS_DIR,
  TYPESCRIPT_RUN_HELPERS_PATH,
  V1_DIR,
} from '../lib/paths.js';

// Layout-aware paths come from `lib/paths.ts`. Three layouts:
//   - Repo (github.com/openwop/openwop): schemas/api at repo root,
//     prose docs under spec/v1/, fixtures.md under conformance/.
//   - In-tree mirror (openwop/openwop under ): same
//     shape, just rooted differently.
//   - Published tarball (`@openwop/openwop-conformance`): schemas/api
//     vendored at the package root by `prepack`, prose docs not
//     bundled, fixtures.md ships next to the fixtures directory.
//
// Tests that depend on prose docs or fixtures.md skip cleanly when the
// resolver returns null for those paths under the published layout.

// ── Helpers ─────────────────────────────────────────────────────────────

function listJsonFiles(dir: string): string[] {
  // Recurse into subdirectories so e.g. `schemas/envelopes/*.schema.json`
  // appears as `envelopes/<file>` to match the README's path-prefixed
  // table entries. Preserves the non-recursive-relative-output contract
  // for files directly under `dir`.
  const out: string[] = [];
  const walk = (subPath: string): void => {
    const fullPath = subPath === '' ? dir : `${dir}/${subPath}`;
    for (const entry of readdirSync(fullPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(subPath === '' ? entry.name : `${subPath}/${entry.name}`);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        out.push(subPath === '' ? entry.name : `${subPath}/${entry.name}`);
      }
    }
  };
  walk('');
  return out;
}

function listScenarioTestFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();
}

function listTextFilesRecursive(dir: string, extensions: Set<string>): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTextFilesRecursive(fullPath, extensions));
    } else if ([...extensions].some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectJsonRefs(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string') refs.push(obj.$ref);
    for (const child of Object.values(obj)) visit(child);
  };
  visit(value);
  return refs;
}

/** Minimal YAML parser substitute — assert the file is parseable as
 *  YAML 1.2 by checking it's valid via the spec's structural fields.
 *  We don't pull in `js-yaml` to keep the conformance package's
 *  dep surface minimal; instead we read enough of the file to assert
 *  the openapi:/asyncapi: top-level keys are present.
 */
function readYamlHeader(path: string): {
  raw: string;
  topLevelKeys: Set<string>;
} {
  const raw = readFileSync(path, 'utf8');
  const topLevelKeys = new Set<string>();
  for (const line of raw.split('\n')) {
    // Skip comments + indented lines + blanks.
    if (line.startsWith('#') || line.startsWith(' ') || line.startsWith('\t') || line.trim() === '') {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0) {
      topLevelKeys.add(line.slice(0, colon));
    }
  }
  return { raw, topLevelKeys };
}

/** Extract every `$ref:` value from a YAML or JSON file (string scan). */
function extractRefs(raw: string): string[] {
  const refs: string[] = [];
  const re = /\$ref:\s*['"]?([^'"\s\n]+)['"]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1]) refs.push(m[1]);
  }
  return refs;
}

function extractOpenApiOperationIds(raw: string): string[] {
  const ids: string[] = [];
  const re = /^\s+operationId:\s*([A-Za-z0-9_-]+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1]) ids.push(m[1]);
  }
  return ids;
}

interface OpenApiOperation {
  readonly path: string;
  readonly method: string;
  readonly operationId: string;
  readonly clearsSecurity: boolean;
  readonly responseStatusCodes: readonly string[];
}

function extractOpenApiOperations(raw: string): OpenApiOperation[] {
  const operations: OpenApiOperation[] = [];
  let currentPath: string | null = null;
  let currentMethod: string | null = null;
  let currentOperationId: string | null = null;
  let currentClearsSecurity = false;
  let currentResponseStatusCodes: string[] = [];

  function flush(): void {
    if (currentPath && currentMethod && currentOperationId) {
      operations.push({
        path: currentPath,
        method: currentMethod,
        operationId: currentOperationId,
        clearsSecurity: currentClearsSecurity,
        responseStatusCodes: currentResponseStatusCodes,
      });
    }
    currentMethod = null;
    currentOperationId = null;
    currentClearsSecurity = false;
    currentResponseStatusCodes = [];
  }

  for (const line of raw.split('\n')) {
    const pathMatch = line.match(/^  (\/.*):\s*$/);
    if (pathMatch) {
      flush();
      currentPath = pathMatch[1] ?? null;
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (methodMatch) {
      flush();
      currentMethod = methodMatch[1] ?? null;
      continue;
    }

    if (currentMethod) {
      const operationIdMatch = line.match(/^\s{6}operationId:\s*([A-Za-z0-9_-]+)\s*$/);
      if (operationIdMatch) {
        currentOperationId = operationIdMatch[1] ?? null;
      }
      if (/^\s{6}security:\s*\[\]\s*(?:#.*)?$/.test(line)) {
        currentClearsSecurity = true;
      }
      const responseCodeMatch = line.match(/^\s{8}'([0-9]{3})':/);
      if (responseCodeMatch?.[1]) {
        currentResponseStatusCodes.push(responseCodeMatch[1]);
      }
    }
  }

  flush();
  return operations;
}

interface RestEndpointCatalogRow {
  readonly method: string;
  readonly path: string;
  readonly auth: string;
  readonly scope: string;
}

function extractRestEndpointCatalogRows(markdown: string): RestEndpointCatalogRow[] {
  const rows: RestEndpointCatalogRow[] = [];
  const re = /^\|\s*`([A-Z]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    rows.push({
      method: (m[1] ?? '').toLowerCase(),
      path: (m[2] ?? '').trim(),
      auth: (m[3] ?? '').trim(),
      scope: (m[4] ?? '').trim(),
    });
  }
  return rows;
}

function extractOpenApiComponentSchemaBlock(raw: string, schemaName: string): string {
  const startRe = new RegExp(`^    ${schemaName}:\\s*$`, 'm');
  const startMatch = startRe.exec(raw);
  expect(startMatch, `OpenAPI components.schemas.${schemaName} MUST exist`).not.toBeNull();

  const start = startMatch?.index ?? 0;
  const nextSchemaRe = /^    [A-Za-z0-9_-]+:\s*$/gm;
  nextSchemaRe.lastIndex = start + (startMatch?.[0].length ?? 0);
  const nextMatch = nextSchemaRe.exec(raw);
  return raw.slice(start, nextMatch?.index ?? raw.length);
}

function extractDeclaredOpenApiTags(raw: string): string[] {
  const tagsStart = raw.indexOf('\ntags:\n');
  const pathsStart = raw.indexOf('\n# ─────────────────────────────────────────────────────────────────────────────\n# PATHS', tagsStart);
  expect(tagsStart, 'OpenAPI MUST include top-level tags').toBeGreaterThanOrEqual(0);
  expect(pathsStart, 'OpenAPI tags block MUST precede paths block').toBeGreaterThan(tagsStart);

  const tagsBlock = raw.slice(tagsStart, pathsStart);
  const tags: string[] = [];
  const re = /^\s+- name:\s*([A-Za-z0-9_-]+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagsBlock)) !== null) {
    if (m[1]) tags.push(m[1]);
  }
  return tags;
}

function extractOpenApiOperationTags(raw: string): string[] {
  const tags: string[] = [];
  const re = /^\s+tags:\s*\[([^\]]+)\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const names = (m[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    tags.push(...names);
  }
  return tags;
}

function findRunEventTypeEnum(schema: unknown): string[] {
  const visit = (value: unknown): string[] | null => {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (
      Array.isArray(obj.enum) &&
      obj.enum.every((entry) => typeof entry === 'string') &&
      obj.enum.includes('run.started')
    ) {
      return obj.enum as string[];
    }
    for (const child of Object.values(obj)) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };

  const found = visit(schema);
  expect(found, 'run-event.schema.json MUST contain the RunEventType enum').not.toBeNull();
  return found ?? [];
}

function extractAsyncApiMessageNames(raw: string): string[] {
  const messagesStart = raw.indexOf('\n  messages:\n');
  const schemasStart = raw.indexOf('\n  # ── Schemas', messagesStart);
  expect(messagesStart, 'AsyncAPI MUST include components.messages').toBeGreaterThanOrEqual(0);
  expect(schemasStart, 'AsyncAPI messages block MUST precede schemas block').toBeGreaterThan(messagesStart);

  const messagesBlock = raw.slice(messagesStart, schemasStart);
  const names: string[] = [];
  const re = /^\s{6}name:\s*([^\s#]+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(messagesBlock)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractTopLevelYamlKeysBetween(raw: string, startMarker: string, endMarker: string): string[] {
  const start = raw.indexOf(startMarker);
  const end = raw.indexOf(endMarker, start);
  expect(start, `YAML block start marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `YAML block end marker not found after ${startMarker}: ${endMarker}`).toBeGreaterThan(start);

  const block = raw.slice(start + startMarker.length, end);
  const keys: string[] = [];
  const re = /^\s{2}([A-Za-z0-9_-]+):\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[1]) keys.push(m[1]);
  }
  return keys;
}

function extractAsyncApiOperationChannelRefs(raw: string): string[] {
  const operationsStart = raw.indexOf('\noperations:\n');
  const componentsStart = raw.indexOf('\n# ─────────────────────────────────────────────────────────────────────────────\n# COMPONENTS', operationsStart);
  expect(operationsStart, 'AsyncAPI MUST include operations').toBeGreaterThanOrEqual(0);
  expect(componentsStart, 'AsyncAPI operations block MUST precede components block').toBeGreaterThan(operationsStart);

  const operationsBlock = raw.slice(operationsStart, componentsStart);
  const refs: string[] = [];
  const re = /^\s{6}\$ref:\s*'#\/channels\/([A-Za-z0-9_-]+)'\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(operationsBlock)) !== null) {
    if (m[1]) refs.push(m[1]);
  }
  return refs;
}

function extractReadmeDocumentIndex(readme: string): string {
  const start = readme.indexOf('## Document index');
  const end = readme.indexOf('## Quickstart', start);
  expect(start, 'README.md MUST contain a "## Document index" section').toBeGreaterThanOrEqual(0);
  expect(end, 'README.md Document index MUST be followed by "## Quickstart"').toBeGreaterThan(start);
  return readme.slice(start, end);
}

function listMarkdownFilesRecursive(dir: string): string[] {
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist']);
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      const child = join(dir, entry.name);
      if (relative(dir, child).startsWith('site/out')) continue;
      files.push(...listMarkdownFilesRecursive(child));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(join(dir, entry.name));
    }
  }

  return files;
}

function stripFencedCodeBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function stripInlineCodeSpans(markdown: string): string {
  // Strip double-backtick spans first so the inner segment of a span
  // containing a literal backtick (``foo `bar` baz``) doesn't get
  // mis-stripped by the single-backtick pass, leaving stray openers
  // that could pair with later backticks elsewhere in the file.
  return markdown.replace(/``[^`\n]+``/g, '').replace(/`[^`\n]*`/g, '');
}

function extractLocalMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(stripInlineCodeSpans(stripFencedCodeBlocks(markdown)))) !== null) {
    let raw = (m[1] ?? '').trim();
    raw = raw.replace(/\s+"[^"]*"$/, '').trim();
    if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);

    if (
      raw === '' ||
      raw.startsWith('#') ||
      raw.startsWith('/') ||
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('mailto:') ||
      raw.startsWith('data:') ||
      raw.includes('://')
    ) {
      continue;
    }

    links.push(raw);
  }

  return links;
}

// ── Scenarios ───────────────────────────────────────────────────────────

describe('spec-corpus: JSON Schemas compile under Ajv2020', () => {
  const schemaFiles = listJsonFiles(SCHEMAS_DIR);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  // Pre-register every schema with the Ajv instance so cross-file `$ref`s
  // resolve regardless of compile order. Without this, a cross-ref from
  // an alphabetically-earlier file (e.g. capabilities.schema.json) to a
  // later one (e.g. prompt-kind.schema.json) fails with "can't resolve
  // reference." `addSchema` only registers — it doesn't compile — so
  // per-file compilation errors still surface in their own `it()` below.
  for (const file of schemaFiles) {
    try {
      ajv.addSchema(readJson(join(SCHEMAS_DIR, file)) as Record<string, unknown>);
    } catch {
      // Bad schemas surface in the per-file `compile()` below; swallow
      // here so registration order doesn't short-circuit reporting.
    }
  }

  it('finds at least three schemas (workflow-definition, run-event, suspend-request)', () => {
    expect(schemaFiles.length).toBeGreaterThanOrEqual(3);
    expect(schemaFiles).toContain('workflow-definition.schema.json');
    expect(schemaFiles).toContain('run-event.schema.json');
    expect(schemaFiles).toContain('suspend-request.schema.json');
  });

  for (const file of schemaFiles) {
    it(`${file} parses + compiles`, () => {
      const schema = readJson(join(SCHEMAS_DIR, file)) as Record<string, unknown>;
      expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema['$id'], `${file} $id MUST match its canonical openwop.dev URL`).toBe(
        `https://openwop.dev/spec/v1/${file}`,
      );
      expect(typeof schema['title']).toBe('string');
      // `compile` uses the schemas registered by `addSchema` above to
      // resolve cross-file `$ref`s — throws on structural issues.
      const validate = ajv.getSchema(schema['$id'] as string) ?? ajv.compile(schema);
      expect(typeof validate).toBe('function');
    });
  }
});

describe('spec-corpus: schemas/README.md index matches schema files', () => {
  const schemaFiles = listJsonFiles(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
  const schemasReadmePath = join(SCHEMAS_DIR, 'README.md');

  it('schemas/README.md exists next to schema files', () => {
    expect(existsSync(schemasReadmePath), 'schemas/README.md MUST exist').toBe(true);
  });

  it('schemas/README.md lists every *.schema.json exactly once', () => {
    const readme = readFileSync(schemasReadmePath, 'utf8');
    const tableStart = readme.indexOf('| Schema | Source spec | Coverage |');
    const tableEnd = readme.indexOf('## Validating against the schemas', tableStart);

    expect(tableStart, 'schemas/README.md MUST include the schema index table').toBeGreaterThanOrEqual(0);
    expect(tableEnd, 'schemas/README.md schema index MUST precede validation instructions').toBeGreaterThan(tableStart);

    const table = readme.slice(tableStart, tableEnd);
    const mentioned = table
      .split('\n')
      .map((line) => line.match(/^\|\s+`([^`]+\.schema\.json)`\s+\|/)?.[1])
      .filter((name): name is string => typeof name === 'string');

    for (const file of schemaFiles) {
      const occurrences = mentioned.filter((name) => name === file).length;
      expect(
        occurrences,
        `schemas/README.md MUST list ${file} exactly once`,
      ).toBe(1);
    }

    for (const file of mentioned) {
      expect(
        schemaFiles,
        `schemas/README.md lists ${file}, but no matching schema file exists`,
      ).toContain(file);
    }
  });
});

describe('spec-corpus: absolute JSON Schema refs resolve inside the corpus', () => {
  const schemaFiles = listJsonFiles(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
  const schemaIds = new Set(
    schemaFiles.map((file) => {
      const schema = readJson(join(SCHEMAS_DIR, file)) as Record<string, unknown>;
      return schema.$id;
    }),
  );

  for (const file of schemaFiles) {
    it(`${file} absolute $refs point to known schema ids`, () => {
      const schema = readJson(join(SCHEMAS_DIR, file));
      const refs = collectJsonRefs(schema)
        .filter((ref) => ref.startsWith('https://openwop.dev/spec/v1/'))
        .map((ref) => ref.split('#')[0] ?? ref);

      for (const ref of refs) {
        expect(
          schemaIds.has(ref),
          `${file} has absolute $ref ${ref}, but no schema file declares that $id`,
        ).toBe(true);
      }
    });
  }
});

describe('spec-corpus: RunEventType payload index matches event enum', () => {
  const runEventSchema = readJson(join(SCHEMAS_DIR, 'run-event.schema.json')) as Record<string, unknown>;
  const payloadSchema = readJson(join(SCHEMAS_DIR, 'run-event-payloads.schema.json')) as Record<string, unknown>;

  function typeIndexProperties(): Record<string, unknown> {
    const defs = payloadSchema.$defs as Record<string, unknown> | undefined;
    const typeIndex = defs?._typeIndex as Record<string, unknown> | undefined;
    const properties = typeIndex?.properties as Record<string, unknown> | undefined;
    expect(properties, 'run-event-payloads.schema.json MUST include $defs._typeIndex.properties').toBeDefined();
    return properties ?? {};
  }

  it('payload type-index keys exactly match RunEventType enum values', () => {
    const runEventTypes = findRunEventTypeEnum(runEventSchema).sort();
    const indexedTypes = Object.keys(typeIndexProperties()).sort();

    expect(indexedTypes, 'run-event-payloads.schema.json _typeIndex MUST cover every RunEventType').toEqual(
      runEventTypes,
    );
  });

  it('payload type-index refs point to declared payload $defs', () => {
    const defs = payloadSchema.$defs as Record<string, unknown> | undefined;
    expect(defs, 'run-event-payloads.schema.json MUST declare $defs').toBeDefined();

    for (const [eventType, entry] of Object.entries(typeIndexProperties())) {
      const ref = (entry as Record<string, unknown>).$ref;
      expect(typeof ref, `_typeIndex.${eventType} MUST be a $ref`).toBe('string');
      const defName = String(ref).match(/^#\/\$defs\/([A-Za-z0-9_-]+)$/)?.[1];
      expect(defName, `_typeIndex.${eventType} MUST reference #/$defs/<name>`).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(defs ?? {}, defName ?? ''),
        `_typeIndex.${eventType} references missing payload definition "${defName}"`,
      ).toBe(true);
    }
  });

  it('payload schema description states the current RunEventType variant count', () => {
    const runEventTypes = findRunEventTypeEnum(runEventSchema);
    const description = payloadSchema.description;

    expect(typeof description, 'run-event-payloads.schema.json MUST carry a description').toBe('string');
    expect(
      description,
      'run-event-payloads.schema.json description MUST state the current RunEventType variant count',
    ).toContain(`${runEventTypes.length} variants from \`run-event.schema.json#$defs.RunEventType\``);
  });
});

describe('spec-corpus: OpenAPI 3.1 spec is structurally valid', () => {
  const openapiPath = join(API_DIR, 'openapi.yaml');

  it('exists', () => {
    expect(existsSync(openapiPath)).toBe(true);
  });

  it('declares openapi: 3.1 + required top-level keys', () => {
    const { topLevelKeys, raw } = readYamlHeader(openapiPath);
    expect(topLevelKeys.has('openapi')).toBe(true);
    expect(topLevelKeys.has('info')).toBe(true);
    expect(topLevelKeys.has('paths')).toBe(true);
    expect(topLevelKeys.has('components')).toBe(true);
    expect(raw).toMatch(/^openapi:\s*3\.1(?:\.[0-9]+)?\s*$/m);
  });

  it('every $ref to ../schemas/*.json resolves to a real file', () => {
    const { raw } = readYamlHeader(openapiPath);
    const refs = extractRefs(raw).filter((r) => r.startsWith('../schemas/'));
    expect(refs.length).toBeGreaterThan(0); // at least one schema reference
    for (const ref of refs) {
      const abs = pathResolve(API_DIR, ref.split('#')[0] ?? ref);
      expect(existsSync(abs), `OpenAPI $ref points at missing file: ${ref}`).toBe(true);
    }
  });

  it('operationIds are unique', () => {
    const { raw } = readYamlHeader(openapiPath);
    const operationIds = extractOpenApiOperationIds(raw);
    const duplicates = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);

    expect(operationIds.length, 'OpenAPI MUST declare operationIds for public routes').toBeGreaterThan(0);
    expect(duplicates, `OpenAPI operationIds MUST be unique; duplicates: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('every operation tag is declared in the top-level tags list', () => {
    const { raw } = readYamlHeader(openapiPath);
    const declaredTags = new Set(extractDeclaredOpenApiTags(raw));
    const operationTags = extractOpenApiOperationTags(raw);

    expect(declaredTags.size, 'OpenAPI MUST declare at least one top-level tag').toBeGreaterThan(0);
    expect(operationTags.length, 'OpenAPI operations MUST carry tags').toBeGreaterThan(0);

    for (const tag of operationTags) {
      expect(
        declaredTags.has(tag),
        `OpenAPI operation tag "${tag}" MUST be declared in the top-level tags list`,
      ).toBe(true);
    }
  });

  it('declares ApiKeyAuth as the global default security requirement', () => {
    const { raw } = readYamlHeader(openapiPath);

    expect(raw, 'OpenAPI MUST declare global ApiKeyAuth security').toMatch(
      /^security:\n\s+- ApiKeyAuth:\s*\[\]\s*$/m,
    );
    expect(raw, 'OpenAPI MUST define ApiKeyAuth as an HTTP bearer security scheme').toMatch(
      /^\s{4}ApiKeyAuth:\n\s{6}type:\s*http\n\s{6}scheme:\s*bearer\s*$/m,
    );
  });

  it('only documented public or signed-token operations clear security', () => {
    const { raw } = readYamlHeader(openapiPath);
    const publicOperationIds = new Set([
      'getCapabilities',
      'getOpenApiSpec',
      'inspectInterruptByToken',
      'resolveInterruptByToken',
    ]);

    const operations = extractOpenApiOperations(raw);
    expect(operations.length, 'OpenAPI MUST expose operations').toBeGreaterThan(0);

    for (const operation of operations) {
      expect(
        operation.clearsSecurity,
        `OpenAPI operation ${operation.operationId} security override MUST match its public/signed-token status`,
      ).toBe(publicOperationIds.has(operation.operationId));
    }
  });

  it('protected operations document canonical 401 and 403 auth failure responses', () => {
    const { raw } = readYamlHeader(openapiPath);
    const operations = extractOpenApiOperations(raw);

    expect(operations.length, 'OpenAPI MUST expose operations').toBeGreaterThan(0);

    for (const operation of operations) {
      if (operation.clearsSecurity) continue;
      expect(
        operation.responseStatusCodes,
        `Protected OpenAPI operation ${operation.operationId} MUST document 401 Unauthenticated`,
      ).toContain('401');
      expect(
        operation.responseStatusCodes,
        `Protected OpenAPI operation ${operation.operationId} MUST document 403 Forbidden`,
      ).toContain('403');
    }
  });

  it('typed error specializations compose the canonical Error schema', () => {
    const { raw } = readYamlHeader(openapiPath);

    for (const schemaName of ['RunClaimConflict', 'UnsupportedStreamMode']) {
      const block = extractOpenApiComponentSchemaBlock(raw, schemaName);
      expect(
        block,
        `OpenAPI ${schemaName} MUST compose the canonical Error schema`,
      ).toContain("- $ref: '#/components/schemas/Error'");
      expect(
        block,
        `OpenAPI ${schemaName} MUST keep typed metadata under details`,
      ).toMatch(/^\s{12}details:\s*$/m);
      expect(
        block,
        `OpenAPI ${schemaName} MUST require the canonical error/message/details top-level fields`,
      ).toContain('required: [error, message, details]');
    }
  });
});

describe.skipIf(COVERAGE_DOC_PATH === null)('spec-corpus: OpenAPI operation coverage map', () => {
  const openapiPath = join(API_DIR, 'openapi.yaml');
  const coverageDocPath = COVERAGE_DOC_PATH as string;

  it('every OpenAPI operationId is represented in conformance/coverage.md', () => {
    const { raw } = readYamlHeader(openapiPath);
    const operationIds = extractOpenApiOperationIds(raw);
    const coverage = readFileSync(coverageDocPath, 'utf8');

    expect(operationIds.length, 'OpenAPI MUST declare operationIds for public routes').toBeGreaterThan(0);

    for (const operationId of operationIds) {
      expect(
        coverage,
        `conformance/coverage.md MUST mention OpenAPI operationId "${operationId}"`,
      ).toContain(`\`${operationId}\``);
    }
  });
});

describe.skipIf(V1_DIR === null)('spec-corpus: REST endpoint catalog matches OpenAPI paths', () => {
  const openapiPath = join(API_DIR, 'openapi.yaml');
  const restEndpointsDocPath = V1_DIR === null ? '' : join(V1_DIR, 'rest-endpoints.md');

  it('every OpenAPI operation has a matching method/path row in rest-endpoints.md', () => {
    const { raw } = readYamlHeader(openapiPath);
    const operations = extractOpenApiOperations(raw);
    const catalogRows = extractRestEndpointCatalogRows(readFileSync(restEndpointsDocPath, 'utf8'));
    const catalogKeys = new Set(catalogRows.map((row) => `${row.method} ${row.path}`));

    expect(operations.length, 'OpenAPI MUST expose operations').toBeGreaterThan(0);
    expect(catalogRows.length, 'rest-endpoints.md MUST include endpoint catalog rows').toBeGreaterThan(0);

    for (const operation of operations) {
      const key = `${operation.method} ${operation.path}`;
      expect(
        catalogKeys.has(key),
        `rest-endpoints.md MUST document OpenAPI operation ${operation.operationId} as ${key}`,
      ).toBe(true);
    }
  });

  it('REST catalog auth/scope columns match OpenAPI security overrides', () => {
    const { raw } = readYamlHeader(openapiPath);
    const operations = extractOpenApiOperations(raw);
    const catalogRows = extractRestEndpointCatalogRows(readFileSync(restEndpointsDocPath, 'utf8'));
    const catalogByKey = new Map(catalogRows.map((row) => [`${row.method} ${row.path}`, row]));

    for (const operation of operations) {
      const row = catalogByKey.get(`${operation.method} ${operation.path}`);
      expect(row, `rest-endpoints.md MUST document ${operation.method.toUpperCase()} ${operation.path}`).toBeDefined();
      if (!row) continue;

      if (operation.clearsSecurity) {
        expect(
          ['None', 'Signed token'],
          `${operation.operationId} clears OpenAPI security, so rest-endpoints.md MUST mark auth as None or Signed token`,
        ).toContain(row.auth);
        expect(
          row.scope,
          `${operation.operationId} clears OpenAPI security, so rest-endpoints.md MUST mark scope as None`,
        ).toBe('None');
      } else {
        expect(
          row.auth,
          `${operation.operationId} inherits OpenAPI ApiKeyAuth, so rest-endpoints.md MUST mark auth as API key`,
        ).toBe('API key');
        expect(
          row.scope,
          `${operation.operationId} inherits OpenAPI ApiKeyAuth, so rest-endpoints.md MUST name a non-empty non-None scope`,
        ).not.toBe('None');
      }
    }
  });
});

describe.skipIf(V1_DIR === null)('spec-corpus: error examples use canonical details slot', () => {
  const v1Dir = V1_DIR as string;
  const docsToCheck = ['auth.md', 'idempotency.md', 'rest-endpoints.md'];

  for (const file of docsToCheck) {
    it(`${file} does not document retry/conflict metadata as top-level error fields`, () => {
      const content = readFileSync(join(v1Dir, file), 'utf8');

      expect(
        content,
        `${file} MUST NOT show retryAfter as a top-level error field; use details.retryAfter`,
      ).not.toMatch(/\{\s*(?:[^{}]|\{[^{}]*\})*error:[^{}]*retryAfter[^{}]*\}/);
      expect(
        content,
        `${file} MUST NOT show activeRunId/activeHost as top-level error fields; use details.{activeRunId,activeHost}`,
      ).not.toMatch(/\{\s*(?:[^{}]|\{[^{}]*\})*error:[^{}]*(activeRunId|activeHost)[^{}]*\}/);
    });
  }
});

describe.skipIf(
  TYPESCRIPT_RUN_HELPERS_PATH === null || PYTHON_TYPES_PATH === null || GO_TYPES_PATH === null,
)(
  'spec-corpus: SDK HTTP error helpers match canonical REST vocabulary',
  () => {
    // describe.skipIf still evaluates the body for test registration; defaults guard against null
    // dirname() when sources are missing under the published-tarball layout. it() blocks below are
    // skipped at run time, so the path values are never actually read. The sentinel is
    // intentionally an obviously-invalid path so a stack trace from any future code that DOES
    // dereference it points the reader at this comment.
    const UNUSED_IN_PUBLISHED_LAYOUT = '/__sdk_paths_unused_in_published_layout__';
    const sdkSources = {
      typescript: TYPESCRIPT_RUN_HELPERS_PATH ?? UNUSED_IN_PUBLISHED_LAYOUT,
      python: PYTHON_TYPES_PATH ?? UNUSED_IN_PUBLISHED_LAYOUT,
      go: GO_TYPES_PATH ?? UNUSED_IN_PUBLISHED_LAYOUT,
    };
    const sdkReadmes = {
      typescript: pathResolve(dirname(sdkSources.typescript), '..', 'README.md'),
      python: pathResolve(dirname(sdkSources.python), '..', '..', 'README.md'),
      go: pathResolve(dirname(sdkSources.go), 'README.md'),
    };
    const typescriptDist = {
      indexDts: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'index.d.ts'),
      indexJs: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'index.js'),
      runHelpersDts: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'run-helpers.d.ts'),
      runHelpersJs: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'run-helpers.js'),
    };
    const typescriptDistMaps = {
      indexDts: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'index.d.ts.map'),
      indexJs: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'index.js.map'),
      runHelpersDts: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'run-helpers.d.ts.map'),
      runHelpersJs: pathResolve(dirname(sdkSources.typescript), '..', 'dist', 'run-helpers.js.map'),
    };
    const sdkChangelogs = {
      typescript: pathResolve(dirname(sdkSources.typescript), '..', 'CHANGELOG.md'),
      python: pathResolve(dirname(sdkSources.python), '..', '..', 'CHANGELOG.md'),
      go: pathResolve(dirname(sdkSources.go), 'CHANGELOG.md'),
    };

    it('TypeScript exports HTTP_ERROR_CODES and isHttpErrorCode', () => {
      const source = readFileSync(sdkSources.typescript, 'utf8');

      expect(source, 'TypeScript SDK MUST export HTTP_ERROR_CODES').toContain('export const HTTP_ERROR_CODES');
      expect(source, 'TypeScript SDK MUST export isHttpErrorCode').toContain('export function isHttpErrorCode');
    });

    it('Python exports HTTP_ERROR_CODES and is_http_error_code', () => {
      const source = readFileSync(sdkSources.python, 'utf8');

      expect(source, 'Python SDK MUST export HTTP_ERROR_CODES').toContain('HTTP_ERROR_CODES = frozenset');
      expect(source, 'Python SDK MUST export is_http_error_code').toContain('def is_http_error_code');
    });

    it('Go exports HTTPErrorCodes and IsHTTPErrorCode', () => {
      const source = readFileSync(sdkSources.go, 'utf8');

      expect(source, 'Go SDK MUST export HTTPErrorCodes').toContain('var HTTPErrorCodes = []string');
      expect(source, 'Go SDK MUST export IsHTTPErrorCode').toContain('func IsHTTPErrorCode');
    });

    it('SDK READMEs document the HTTP error helper surface', () => {
      expect(readFileSync(sdkReadmes.typescript, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(sdkReadmes.typescript, 'utf8')).toContain('isHttpErrorCode');
      expect(readFileSync(sdkReadmes.python, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(sdkReadmes.python, 'utf8')).toContain('is_http_error_code');
      expect(readFileSync(sdkReadmes.go, 'utf8')).toContain('HTTPErrorCodes');
      expect(readFileSync(sdkReadmes.go, 'utf8')).toContain('IsHTTPErrorCode');
    });

    it('SDK changelogs mention the HTTP error helper surface', () => {
      expect(readFileSync(sdkChangelogs.typescript, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(sdkChangelogs.typescript, 'utf8')).toContain('isHttpErrorCode');
      expect(readFileSync(sdkChangelogs.python, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(sdkChangelogs.python, 'utf8')).toContain('is_http_error_code');
      expect(readFileSync(sdkChangelogs.go, 'utf8')).toContain('HTTPErrorCodes');
      expect(readFileSync(sdkChangelogs.go, 'utf8')).toContain('IsHTTPErrorCode');
    });

    it('TypeScript dist exports the HTTP error helper surface', () => {
      for (const [label, path] of Object.entries(typescriptDist)) {
        expect(existsSync(path), `TypeScript dist artifact ${label} MUST exist`).toBe(true);
      }

      expect(readFileSync(typescriptDist.indexDts, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(typescriptDist.indexDts, 'utf8')).toContain('HttpErrorCode');
      expect(readFileSync(typescriptDist.indexDts, 'utf8')).toContain('isHttpErrorCode');
      expect(readFileSync(typescriptDist.indexJs, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(typescriptDist.indexJs, 'utf8')).toContain('isHttpErrorCode');
      expect(readFileSync(typescriptDist.runHelpersDts, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(typescriptDist.runHelpersDts, 'utf8')).toContain('HttpErrorCode');
      expect(readFileSync(typescriptDist.runHelpersJs, 'utf8')).toContain('HTTP_ERROR_CODES');
      expect(readFileSync(typescriptDist.runHelpersJs, 'utf8')).toContain('isHttpErrorCode');
    });

    it('TypeScript dist metadata uses openwop branding', () => {
      for (const path of Object.values(typescriptDist)) {
        const source = readFileSync(path, 'utf8');
        expect(source, `${path} MUST NOT contain legacy MyndHyve package names`).not.toContain('@myndhyve');
        expect(source, `${path} MUST use @openwop package naming`).toContain('@openwop');
      }
    });

    it('TypeScript dist source maps point back to src and avoid legacy branding', () => {
      for (const [label, path] of Object.entries(typescriptDistMaps)) {
        expect(existsSync(path), `TypeScript dist source map ${label} MUST exist`).toBe(true);
        const sourceMap = readJson(path) as { sources?: unknown };
        const raw = readFileSync(path, 'utf8');

        expect(raw, `${path} MUST NOT contain legacy MyndHyve package names`).not.toContain('@myndhyve');
        expect(Array.isArray(sourceMap.sources), `${path} MUST declare source files`).toBe(true);
        expect(
          (sourceMap.sources as string[]).every((source) => source.startsWith('../src/')),
          `${path} MUST map to TypeScript source files under ../src`,
        ).toBe(true);
      }
    });

    for (const code of [
      'unauthenticated',
      'forbidden',
      'key_expired',
      'key_revoked',
      'validation_error',
      'not_found',
      'rate_limited',
      'run_already_active',
      'idempotency_in_flight',
      'unsupported_stream_mode',
      'credential_forbidden',
      'internal_error',
    ]) {
      it(`all SDK HTTP error helpers include ${code}`, () => {
        for (const [sdk, path] of Object.entries(sdkSources)) {
          const source = readFileSync(path, 'utf8');
          expect(source, `${sdk} SDK MUST include canonical REST code ${code}`).toContain(code);
        }
      });
    }
  },
);

describe.skipIf(SCENARIOS_DIR === null || CONFORMANCE_README_PATH === null)(
  'spec-corpus: conformance README scenario counts match source tree',
  () => {
    const scenariosDir = SCENARIOS_DIR as string;
    const conformanceReadmePath = CONFORMANCE_README_PATH as string;

    it('README suite count equals src/scenarios/*.test.ts count', () => {
      const scenarioFiles = listScenarioTestFiles(scenariosDir);
      const readme = readFileSync(conformanceReadmePath, 'utf8');

      expect(scenarioFiles.length, 'conformance suite MUST contain scenario test files').toBeGreaterThan(0);
      expect(
        readme,
        'conformance/README.md MUST state the current scenario-file count in "What\'s Covered"',
      ).toContain(`The current suite has ${scenarioFiles.length} scenario files under \`src/scenarios/\`.`);
      expect(
        readme,
        'conformance/README.md MUST state the current scenario-file count near historical notes',
      ).toContain(`Current source tree: ${scenarioFiles.length} scenario files.`);
    });
  },
);

describe('spec-corpus: AsyncAPI 3.1 spec is structurally valid', () => {
  const asyncapiPath = join(API_DIR, 'asyncapi.yaml');

  it('exists', () => {
    expect(existsSync(asyncapiPath)).toBe(true);
  });

  it('declares asyncapi: 3.1 + required top-level keys', () => {
    const { topLevelKeys, raw } = readYamlHeader(asyncapiPath);
    expect(topLevelKeys.has('asyncapi')).toBe(true);
    expect(topLevelKeys.has('info')).toBe(true);
    expect(topLevelKeys.has('channels')).toBe(true);
    expect(topLevelKeys.has('operations')).toBe(true);
    expect(raw).toMatch(/^asyncapi:\s*3\.1(?:\.[0-9]+)?\s*$/m);
  });

  it('every $ref to ../schemas/*.json resolves to a real file', () => {
    const { raw } = readYamlHeader(asyncapiPath);
    const refs = extractRefs(raw).filter((r) => r.startsWith('../schemas/'));
    for (const ref of refs) {
      const abs = pathResolve(API_DIR, ref.split('#')[0] ?? ref);
      expect(existsSync(abs), `AsyncAPI $ref points at missing file: ${ref}`).toBe(true);
    }
  });

  it('named RunEventDoc messages use event names from run-event.schema.json', () => {
    const { raw } = readYamlHeader(asyncapiPath);
    const messageNames = extractAsyncApiMessageNames(raw);
    const runEventSchema = readJson(join(SCHEMAS_DIR, 'run-event.schema.json'));
    const runEventTypes = new Set(findRunEventTypeEnum(runEventSchema));
    // `run.annotated` (RFC 0056) is a live SSE notification carrying an
    // Annotation — NOT a RunEventDoc and deliberately NOT in the RunEventType
    // enum (annotations are a side-resource, excluded from fork/replay).
    const syntheticMessageNames = new Set(['state.snapshot', 'ai.message.chunk', 'any', 'run.annotated']);

    expect(messageNames.length, 'AsyncAPI MUST declare named SSE messages').toBeGreaterThan(0);

    for (const name of messageNames) {
      if (syntheticMessageNames.has(name)) continue;
      expect(
        runEventTypes.has(name),
        `AsyncAPI message name "${name}" MUST exist in run-event.schema.json RunEventType enum, or be documented as synthetic`,
      ).toBe(true);
    }
  });

  it('operation channel refs point to declared channels', () => {
    const { raw } = readYamlHeader(asyncapiPath);
    const channels = new Set(
      extractTopLevelYamlKeysBetween(
        raw,
        '\nchannels:\n',
        '\n# ─────────────────────────────────────────────────────────────────────────────\n# OPERATIONS',
      ),
    );
    const channelRefs = extractAsyncApiOperationChannelRefs(raw);

    expect(channels.size, 'AsyncAPI MUST declare channels').toBeGreaterThan(0);
    expect(channelRefs.length, 'AsyncAPI operations MUST reference channels').toBeGreaterThan(0);

    for (const ref of channelRefs) {
      expect(
        channels.has(ref),
        `AsyncAPI operation references missing channel "${ref}"`,
      ).toBe(true);
    }
  });

  it('channel keys and message names are unique', () => {
    const { raw } = readYamlHeader(asyncapiPath);
    const channelKeys = extractTopLevelYamlKeysBetween(
      raw,
      '\nchannels:\n',
      '\n# ─────────────────────────────────────────────────────────────────────────────\n# OPERATIONS',
    );
    const messageNames = extractAsyncApiMessageNames(raw);

    const duplicateChannels = channelKeys.filter((key, index) => channelKeys.indexOf(key) !== index);
    const duplicateMessages = messageNames.filter((name, index) => messageNames.indexOf(name) !== index);

    expect(duplicateChannels, `AsyncAPI channel keys MUST be unique; duplicates: ${duplicateChannels.join(', ')}`).toEqual([]);
    expect(duplicateMessages, `AsyncAPI message names MUST be unique; duplicates: ${duplicateMessages.join(', ')}`).toEqual([]);
  });
});

describe.skipIf(V1_DIR === null)('spec-corpus: prose docs carry a Status: legend tag', () => {
  // `describe.skipIf` skips test EXECUTION but still evaluates the
  // describe callback at registration time so vitest can discover the
  // `it()` calls inside. That means the readdirSync below runs even
  // when V1_DIR is null (published-tarball layout) — read from a
  // safe-and-empty fallback when V1_DIR isn't bundled.

  // META_DOCS aren't normative spec docs and don't carry the
  // STUB / DRAFT / OUTLINE / FINAL maturity tag:
  //   - README.md, CHANGELOG.md, CONTRIBUTING.md, QUICKSTART.md — entry/index docs
  //   - CODE_OF_CONDUCT.md, GOVERNANCE.md, ROADMAP.md, SECURITY.md — project meta-docs
  //   - PUBLISHING.md — operational/release docs
  const META_DOCS = new Set([
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'GOVERNANCE.md',
    'ROADMAP.md',
    'SECURITY.md',
    'PUBLISHING.md',
    'QUICKSTART.md',
  ]);
  const proseFiles =
    V1_DIR === null
      ? []
      : readdirSync(V1_DIR)
          .filter((f) => f.endsWith('.md') && !META_DOCS.has(f))
          .sort();

  it('finds the expected prose doc set', () => {
    // Spec README §Document index lists 11 prose docs. If this drifts,
    // the README needs updating in the same PR that adds/removes a doc.
    expect(proseFiles.length).toBeGreaterThanOrEqual(11);
  });

  for (const file of proseFiles) {
    it(`${file} declares a Status: tag (STUB / DRAFT / OUTLINE / FINAL | Stable / Stabilizing / Draft / Experimental)`, () => {
      // V1_DIR is non-null here — proseFiles is empty when V1_DIR is null
      // so this loop body never runs in the published-tarball layout.
      const content = readFileSync(join(V1_DIR as string, file), 'utf8');
      // Match either ">**Status:" or "**Status:" near the top of file.
      expect(
        content,
        `${file} must include a "Status:" legend tag near its header`,
      ).toMatch(/\*\*Status:\s*(STUB|DRAFT|OUTLINE|FINAL|Stable|Stabilizing|Draft|Experimental)\b/);
    });
  }
});

describe.skipIf(V1_DIR === null || README_PATH === null)('spec-corpus: README document index matches spec/v1', () => {
  // describe.skipIf skips test execution but still evaluates the describe callback at registration
  // time. Guard each side-effecting read against null so the body registers cleanly under the
  // published-tarball layout where V1_DIR / README_PATH resolve to null.
  const v1Dir = V1_DIR;
  const readmePath = README_PATH ?? '';

  const proseFiles =
    v1Dir === null
      ? []
      : readdirSync(v1Dir)
          .filter((f) => f.endsWith('.md'))
          .sort();

  it('README Total count equals the number of spec/v1 prose docs', () => {
    const index = extractReadmeDocumentIndex(readFileSync(readmePath, 'utf8'));
    const totalMatch = index.match(/\*\*Total\*\*:\s+(\d+)\s+docs\./);

    expect(totalMatch, 'README.md document index MUST include a "**Total**: N docs." line').not.toBeNull();
    expect(Number(totalMatch?.[1]), 'README.md document total MUST match spec/v1/*.md count').toBe(
      proseFiles.length,
    );
  });

  it('README document index links every spec/v1 prose doc exactly once', () => {
    const index = extractReadmeDocumentIndex(readFileSync(readmePath, 'utf8'));
    const linkRegex = /\]\(\.\/spec\/v1\/([^)]+\.md)\)/g;
    const linkedDocs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(index)) !== null) {
      if (m[1]) linkedDocs.push(m[1]);
    }

    for (const file of proseFiles) {
      const occurrences = linkedDocs.filter((linked) => linked === file).length;
      expect(
        occurrences,
        `README.md document index MUST link ./spec/v1/${file} exactly once`,
      ).toBe(1);
    }
  });
});

describe.skipIf(README_PATH === null)('spec-corpus: local Markdown links resolve', () => {
  // describe.skipIf skips test execution but still evaluates the body for registration; default
  // to '.' so dirname() never receives null in the published-tarball layout.
  const repoRoot = README_PATH === null ? '.' : dirname(README_PATH);
  const markdownFiles = README_PATH === null ? [] : listMarkdownFilesRecursive(repoRoot);

  it('finds Markdown files to check', () => {
    expect(markdownFiles.length, 'repo checkout should contain Markdown docs').toBeGreaterThan(0);
  });

  for (const file of markdownFiles) {
    const relFile = relative(repoRoot, file);
    it(`${relFile} has no broken local Markdown file links`, () => {
      const links = extractLocalMarkdownLinks(readFileSync(file, 'utf8'));
      for (const link of links) {
        const filePart = link.split('#')[0] ?? link;
        if (filePart === '') continue;

        let decoded = filePart;
        try {
          decoded = decodeURIComponent(filePart);
        } catch {
          // Keep the raw path; existence check below will fail with a useful message.
        }

        const target = pathResolve(dirname(file), decoded);
        // Published-tarball layout: the conformance README references ../spec/v1/... and other paths
        // that resolve OUTSIDE the package boundary. Repo layout has the full tree available. The
        // `target === repoRoot || target.startsWith(repoRoot + sep)` form avoids a sibling-path
        // false-negative when repoRoot=/foo/bar and target=/foo/barbaz.
        if (LAYOUT === 'published' && target !== repoRoot && !target.startsWith(repoRoot + '/')) continue;
        expect(
          existsSync(target),
          `${relFile} links to missing local target: ${link}`,
        ).toBe(true);
      }
    });
  }
});

describe.skipIf(README_PATH === null)('spec-corpus: public docs avoid private implementation breadcrumbs', () => {
  // describe.skipIf skips test execution but still evaluates the body for registration; guard each
  // path read against null/missing-dir so the body never throws under the published-tarball layout.
  const repoRoot = README_PATH === null ? '.' : dirname(README_PATH);
  const securityDir = join(repoRoot, 'SECURITY');
  const publicTextFiles =
    README_PATH === null
      ? []
      : [
          README_PATH,
          join(repoRoot, 'QUICKSTART.md'),
          join(repoRoot, 'QUICKSTART-10MIN.md'),
          join(repoRoot, 'sdk', 'typescript', 'README.md'),
          join(repoRoot, 'sdk', 'python', 'README.md'),
          join(repoRoot, 'sdk', 'go', 'README.md'),
          ...(CONFORMANCE_README_PATH ? [CONFORMANCE_README_PATH] : []),
          ...(FIXTURES_DOC_PATH ? [FIXTURES_DOC_PATH] : []),
          ...listTextFilesRecursive(join(repoRoot, 'examples'), new Set(['.md', 'package.json'])),
          ...(existsSync(securityDir)
            ? readdirSync(securityDir).filter((f) => f.endsWith('.md') || f.endsWith('.yaml')).map((f) => join(securityDir, f))
            : []),
          ...(V1_DIR !== null ? ((v1Dir: string) => readdirSync(v1Dir).filter((f) => f.endsWith('.md')).map((f) => join(v1Dir, f)))(V1_DIR) : []),
          ...readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json')).map((f) => join(SCHEMAS_DIR, f)),
        ].filter((path) => existsSync(path));

  const banned = [
    { label: 'private workflow-runtime paths', pattern: /services\/workflow-runtime/ },
    { label: 'private workflow-engine paths', pattern: /packages\/workflow-engine/ },
    { label: 'internal PRD references', pattern: /PRD §/ },
    { label: 'old openwop plan references', pattern: /openwop plan/i },
    { label: 'pre-v1 release markers', pattern: /\bv0\.(?:1|2|3)\b/i },
    { label: 'scaffold release wording', pattern: /\bscaffold\b/i },
    { label: 'incorrect OpenWOP article', pattern: /\b(?:A|a) OpenWOP\b/ },
    { label: 'lowercase compliance adjective', pattern: /\bopenwop-(?:compliant|conforming)\b/ },
    { label: 'lowercase OpenWOP phrase', pattern: /\bopenwop (?:host|node|workflow|runs|gives)\b/ },
    { label: 'private workflow-engine examples', pattern: /@your-org\/workflow-engine|workflow-engine implementation/ },
    { label: 'deployment-specific Cloud Run advice', pattern: /Cloud-Run-first|Cloud Run/ },
    { label: 'reference implementation breadcrumbs', pattern: /Reference impl:/ },
    { label: 'bootstrap governance breadcrumbs', pattern: /bootstrap-phase|lead-maintainer fiat|single-maintainer/i },
    { label: 'old gap-planning references', pattern: /openwop plan|G(?:10|12|22|23)|WOP-era|prior WOP/i },
    { label: 'private implementation source paths', pattern: /functions\/src|src\/core\/workflow/ },
    { label: 'reference implementation source breadcrumbs', pattern: /Reference implementation:/ },
  ];

  it('scans public docs and schemas', () => {
    expect(publicTextFiles.length, 'public docs/schemas list MUST be non-empty').toBeGreaterThan(0);
  });

  for (const file of publicTextFiles) {
    const relFile = relative(repoRoot, file);
    it(`${relFile} has no private implementation or pre-v1 breadcrumbs`, () => {
      const text = readFileSync(file, 'utf8');
      for (const { label, pattern } of banned) {
        expect(text, `${relFile} MUST NOT contain ${label}`).not.toMatch(pattern);
      }
    });
  }
});

describe.skipIf(FIXTURES_DOC_PATH === null)('spec-corpus: fixtures.json catalog matches fixtures.md', () => {
  // FIXTURES_DOC_PATH is non-null here — assertion narrows for TS.
  const fixturesDocPath = FIXTURES_DOC_PATH as string;
  const PACK_MANIFEST_FIXTURES_DIR = join(FIXTURES_DIR, 'pack-manifests');
  const PROMPT_TEMPLATE_FIXTURES_DIR = join(FIXTURES_DIR, 'prompt-templates');
  // Top-level workflow fixtures + pack-manifest fixtures + prompt-
  // template fixtures from their respective sub-directories. All are
  // documented in fixtures.md so the regex scan below MUST cover them.
  const fixtureJsonFiles = [
    ...readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
    ...readdirSync(PACK_MANIFEST_FIXTURES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
    ...readdirSync(PROMPT_TEMPLATE_FIXTURES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, '')),
  ].sort();

  it('every fixture id mentioned in fixtures.md has a corresponding JSON', () => {
    const doc = readFileSync(fixturesDocPath, 'utf8');
    // Match `conformance-<word>` identifiers in the catalog table or
    // per-fixture sections. Use word-boundary so "conformance-noop"
    // captures cleanly without bleeding into adjacent text.
    //
    // PROPOSED-section IDs are intentionally documented without backing
    // JSONs (the fixture is blocked on a future spec/impl change). Two
    // markers indicate a section is documenting a future fixture:
    //   1. "(PROPOSED v..." in the heading — design proposal
    //   2. "impl pending" in the heading — spec firm, runtime not yet
    //      shipped (e.g., F4's cap-breach fixture awaiting CC-1 counter)
    // We strip §sections matching either marker before scanning.
    // The catalog table also contains rows for PROPOSED / impl-pending
    // fixtures; strip those too.
    let docWithoutProposed = doc.replace(
      /^##\s+[^\n]*\((PROPOSED\s+v[^\n)]+|[^)]*impl pending)\)[\s\S]*?(?=^##\s+|^---\s*$)/gm,
      '',
    );
    docWithoutProposed = docWithoutProposed.replace(
      /^\|[^\n]*(PROPOSED|impl pending)[^\n]*\n/gm,
      '',
    );
    // Match `conformance-<id>` only at a real fixture-id boundary —
    // require the preceding character to NOT be `[a-z0-9-]`, so that
    // longer strings like `openwop-conformance-canary-secret` do NOT
    // false-match `conformance-canary-secret` as a fixture id. The
    // negative lookbehind keeps the regex JS-compatible.
    const idRegex = /(?<![a-z0-9-])conformance-[a-z][a-z0-9-]*\b/g;
    const cited = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(docWithoutProposed)) !== null) {
      cited.add(m[0]);
    }
    for (const cite of cited) {
      expect(
        fixtureJsonFiles,
        `fixtures.md cites fixture id "${cite}" but no matching ${cite}.json exists`,
      ).toContain(cite);
    }
  });

  it('every fixture JSON file is referenced by fixtures.md', () => {
    const doc = readFileSync(fixturesDocPath, 'utf8');
    for (const id of fixtureJsonFiles) {
      expect(
        doc,
        `fixture ${id}.json exists but fixtures.md does not document it`,
      ).toContain(id);
    }
  });
});
