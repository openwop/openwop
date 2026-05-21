/**
 * RFC 0028 §A reference implementation — in-memory PromptStore backing
 * the `/v1/prompts*` REST surface.
 *
 * Splits templates into two layers:
 *   - **host** — immutable, loaded from
 *     `apps/workflow-engine/conformance-fixtures/prompt-templates/`
 *     at boot. These satisfy `listPromptTemplates` + `getPromptTemplate`
 *     against the host's built-in catalog. Carry `meta.source: 'host'`.
 *     Cannot be deleted or updated via the REST surface (403).
 *   - **user** — mutable, created at run time via `POST /v1/prompts`.
 *     Carry `meta.source: 'user'`. Mutable iff
 *     `capabilities.prompts.mutableLibrary: true`.
 *
 * Pack-sourced templates (`meta.source: 'pack'`) require the pack-
 * install flow per RFC 0028 §B — that's a separate slice; this module
 * leaves a `packTemplates` slot that the pack-install path can populate.
 *
 * Persistence: in-memory only. State wipes on process restart, matching
 * the workflow-engine sample's "demo-grade" posture for every host
 * surface (see ARCHITECTURE.md §"Path to real backends"). Production
 * hosts swap this module for a storage-adapter-backed implementation.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Mirror of PromptKind from schemas/prompt-kind.schema.json. */
export type PromptKind = 'system' | 'user' | 'few-shot' | 'schema-hint';

/** Mirror of PromptTemplate from schemas/prompt-template.schema.json. */
export interface PromptTemplate {
  templateId: string;
  version: string;
  kind: PromptKind;
  text: string;
  name?: string;
  description?: string;
  variables?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required: boolean;
    source?: 'input' | 'variable' | 'secret' | 'context';
    extractPath?: string;
    defaultValue?: unknown;
    description?: string;
  }>;
  modelHints?: {
    modelClass?: string;
    temperature?: number;
    maxTokens?: number;
    envelopeType?: string;
  };
  tags?: string[];
  meta?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    source?: 'host' | 'pack' | 'user';
    packName?: string;
    packVersion?: string;
  };
}

interface StoredTemplate {
  template: PromptTemplate;
  /** SHA-256 of the canonical body — used for ETag generation. */
  etag: string;
}

const __filename = fileURLToPath(import.meta.url);
// host/promptStore.ts (under apps/workflow-engine/backend/typescript/src/host/)
// → apps/workflow-engine/conformance-fixtures/prompt-templates/
//
// 5 `..` segments climb: host → src → typescript → backend → workflow-engine.
const FIXTURES_DIR = join(__filename, '..', '..', '..', '..', '..', 'conformance-fixtures', 'prompt-templates');

// Layered storage. Lookup precedence: user → pack → host (mutating
// endpoints only see `user`; reads collapse all three).
const hostTemplates = new Map<string, StoredTemplate>();
const packTemplates = new Map<string, StoredTemplate>();
const userTemplates = new Map<string, Map<string, StoredTemplate>>();
// userTemplates is keyed by templateId → (versionString → entry) so
// PUT can snapshot prior versions per RFC 0028 §A.

let initialized = false;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function buildStored(template: PromptTemplate): StoredTemplate {
  return { template, etag: sha256(JSON.stringify(template)) };
}

/** Boot-time loader. Reads every JSON fixture under
 *  `conformance-fixtures/prompt-templates/` and registers it as a
 *  host-source template. Idempotent. */
export function ensurePromptStoreInitialized(): void {
  if (initialized) return;
  initialized = true;
  if (!existsSync(FIXTURES_DIR)) return;
  for (const f of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as PromptTemplate;
    // Force meta.source: 'host' regardless of what the fixture
    // declares — the fixtures live in the host's library.
    const template: PromptTemplate = {
      ...raw,
      meta: { ...(raw.meta ?? {}), source: 'host' },
    };
    hostTemplates.set(template.templateId, buildStored(template));
  }
}

export interface ListFilter {
  kind?: PromptKind;
  tag?: string;
  modelClass?: string;
  source?: 'host' | 'pack' | 'user';
}

/** List templates matching the supplied filter. */
export function listTemplates(filter: ListFilter = {}): PromptTemplate[] {
  ensurePromptStoreInitialized();
  const candidates: PromptTemplate[] = [];
  // User layer: take the latest version of each templateId.
  for (const versions of userTemplates.values()) {
    const latest = pickLatest([...versions.values()]);
    if (latest) candidates.push(latest.template);
  }
  for (const entry of packTemplates.values()) candidates.push(entry.template);
  for (const entry of hostTemplates.values()) candidates.push(entry.template);
  return candidates.filter((t) => applyFilter(t, filter));
}

function applyFilter(t: PromptTemplate, f: ListFilter): boolean {
  if (f.kind && t.kind !== f.kind) return false;
  if (f.tag && !(t.tags ?? []).includes(f.tag)) return false;
  if (f.modelClass && t.modelHints?.modelClass !== f.modelClass) return false;
  if (f.source && t.meta?.source !== f.source) return false;
  return true;
}

function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function pickLatest(entries: StoredTemplate[]): StoredTemplate | undefined {
  return entries.slice().sort((a, b) => semverCompare(b.template.version, a.template.version))[0];
}

export interface GetResult {
  template: PromptTemplate;
  etag: string;
  source: 'host' | 'pack' | 'user';
}

/** Fetch a single template by templateId. Optional `version` pins;
 *  optional `libraryId` disambiguates when multiple installed packs
 *  ship the same templateId. Returns `null` when not found,
 *  `'ambiguous'` when multiple matches require disambiguation. */
export function getTemplate(
  templateId: string,
  opts: { version?: string; libraryId?: string } = {},
): GetResult | null | 'ambiguous' {
  ensurePromptStoreInitialized();
  // User layer first.
  const userVersions = userTemplates.get(templateId);
  if (userVersions) {
    if (opts.version) {
      const entry = userVersions.get(opts.version);
      if (entry) return { template: entry.template, etag: entry.etag, source: 'user' };
    } else {
      const latest = pickLatest([...userVersions.values()]);
      if (latest) return { template: latest.template, etag: latest.etag, source: 'user' };
    }
  }
  // Pack layer next — multiple packs MAY ship the same templateId;
  // libraryId disambiguates.
  const packMatches: StoredTemplate[] = [];
  for (const entry of packTemplates.values()) {
    if (entry.template.templateId !== templateId) continue;
    if (opts.version && entry.template.version !== opts.version) continue;
    if (opts.libraryId && entry.template.meta?.packName !== opts.libraryId) continue;
    packMatches.push(entry);
  }
  if (packMatches.length > 1) return 'ambiguous';
  if (packMatches.length === 1) {
    const e = packMatches[0]!;
    return { template: e.template, etag: e.etag, source: 'pack' };
  }
  // Host layer last.
  const host = hostTemplates.get(templateId);
  if (host) {
    if (opts.version && host.template.version !== opts.version) return null;
    return { template: host.template, etag: host.etag, source: 'host' };
  }
  return null;
}

export type CreateOutcome =
  | { ok: true; etag: string; locationVersion: string }
  | { ok: false; code: 'conflict' | 'invalid' | 'forbidden'; message: string };

/** Create a new user-source template. Fails when a user template with
 *  the same (templateId, version) pair already exists, or when the
 *  templateId collides with a host-source or pack-source template
 *  (those are read-only namespaces). */
export function createUserTemplate(template: PromptTemplate): CreateOutcome {
  ensurePromptStoreInitialized();
  if (hostTemplates.has(template.templateId)) {
    return {
      ok: false,
      code: 'forbidden',
      message: `templateId '${template.templateId}' collides with a host-built-in template`,
    };
  }
  if (packMatchesId(template.templateId)) {
    return {
      ok: false,
      code: 'forbidden',
      message: `templateId '${template.templateId}' collides with a pack-sourced template`,
    };
  }
  const versions = userTemplates.get(template.templateId) ?? new Map<string, StoredTemplate>();
  if (versions.has(template.version)) {
    return {
      ok: false,
      code: 'conflict',
      message: `template ${template.templateId}@${template.version} already exists`,
    };
  }
  const stamped: PromptTemplate = {
    ...template,
    meta: { ...(template.meta ?? {}), source: 'user' },
  };
  versions.set(template.version, buildStored(stamped));
  userTemplates.set(template.templateId, versions);
  return { ok: true, etag: buildStored(stamped).etag, locationVersion: template.version };
}

function packMatchesId(templateId: string): boolean {
  for (const entry of packTemplates.values()) {
    if (entry.template.templateId === templateId) return true;
  }
  return false;
}

export type UpdateOutcome =
  | { ok: true; template: PromptTemplate; etag: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'conflict' | 'invalid'; message: string };

/** Replace a user-source template. Submitted version MUST be strictly
 *  greater than the stored max version (SemVer-compared). Pack and host
 *  templates are read-only (403). */
export function updateUserTemplate(templateId: string, template: PromptTemplate): UpdateOutcome {
  ensurePromptStoreInitialized();
  if (template.templateId !== templateId) {
    return {
      ok: false,
      code: 'invalid',
      message: `body templateId '${template.templateId}' does not match path '${templateId}'`,
    };
  }
  if (hostTemplates.has(templateId)) {
    return { ok: false, code: 'forbidden', message: 'host-built-in templates are read-only' };
  }
  if (packMatchesId(templateId)) {
    return { ok: false, code: 'forbidden', message: 'pack-sourced templates are read-only' };
  }
  const versions = userTemplates.get(templateId);
  if (!versions || versions.size === 0) {
    return { ok: false, code: 'not_found', message: `no such template '${templateId}'` };
  }
  const currentLatest = pickLatest([...versions.values()])!;
  if (semverCompare(template.version, currentLatest.template.version) <= 0) {
    return {
      ok: false,
      code: 'conflict',
      message: `submitted version '${template.version}' must be strictly greater than stored '${currentLatest.template.version}'`,
    };
  }
  const stamped: PromptTemplate = {
    ...template,
    meta: { ...(template.meta ?? {}), source: 'user' },
  };
  const stored = buildStored(stamped);
  versions.set(template.version, stored);
  return { ok: true, template: stamped, etag: stored.etag };
}

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'forbidden'; message: string };

/** Delete a user-source template (all versions). */
export function deleteUserTemplate(templateId: string): DeleteOutcome {
  ensurePromptStoreInitialized();
  if (hostTemplates.has(templateId)) {
    return { ok: false, code: 'forbidden', message: 'host-built-in templates cannot be deleted' };
  }
  if (packMatchesId(templateId)) {
    return { ok: false, code: 'forbidden', message: 'pack-sourced templates cannot be deleted' };
  }
  if (!userTemplates.has(templateId)) {
    return { ok: false, code: 'not_found', message: `no such template '${templateId}'` };
  }
  userTemplates.delete(templateId);
  return { ok: true };
}

/** Pack-install hook (used by the future RFC 0028 §B install flow).
 *  Validates that templates the pack ships don't already exist as
 *  host-source (host-built-ins win that namespace collision). Caller
 *  supplies the pack metadata stamps (packName, packVersion) so each
 *  template's `meta.source: 'pack'` provenance is correctly populated. */
export function installPackTemplates(
  templates: PromptTemplate[],
  packName: string,
  packVersion: string,
): { installed: number; rejected: string[] } {
  ensurePromptStoreInitialized();
  const rejected: string[] = [];
  let installed = 0;
  for (const t of templates) {
    if (hostTemplates.has(t.templateId)) {
      rejected.push(`${t.templateId} (collides with host built-in)`);
      continue;
    }
    const stamped: PromptTemplate = {
      ...t,
      meta: {
        ...(t.meta ?? {}),
        source: 'pack',
        packName,
        packVersion,
      },
    };
    // Pack-source key uses `<packName>:<templateId>@<version>` so two
    // packs MAY ship the same templateId without colliding.
    packTemplates.set(`${packName}:${t.templateId}@${t.version}`, buildStored(stamped));
    installed++;
  }
  return { installed, rejected };
}

/** Test seam — clears the user layer (host layer survives since it's
 *  loaded from disk). Used by conformance lifecycle scenarios that
 *  need to start with a clean mutable namespace. */
export function clearUserTemplatesForTest(): void {
  userTemplates.clear();
}
