/**
 * Agent-manifest loader (RFC 0070 / RFC 0003 §C/§D).
 *
 * Parses a pack's `agents[]` array, resolves each agent's `systemPromptRef`
 * and `handoff.*SchemaRef` against the pack directory (the `installAgents`
 * step from RFC 0003 §ImplNotes), and registers the resolved manifests into
 * the in-process AgentRegistry. Mirrors `tarballLoader.loadPackFromManifest`
 * for the node side.
 *
 * Resolution rules are normative (RFC 0003):
 *   §C systemPromptRef — referenced file MUST exist, be UTF-8, and MUST NOT
 *      escape the pack root (no `../`, no absolute paths).
 *   §D handoff.{task,return}SchemaRef — same path rules; the referenced file
 *      MUST be a valid JSON document (a JSON Schema 2020-12 doc); we parse it
 *      so the dispatch path can validate task/return payloads.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, isAbsolute, normalize, relative } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { getAgentRegistry, type ResolvedAgentManifest, type AgentSchemaValidator } from '../executor/agentRegistry.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('packs.agentLoader');

/** Compile a handoff JSON Schema into a validator at load (RFC 0003 §D). Throws
 *  if the schema is not a valid JSON Schema 2020-12 document (so the agent is
 *  skipped at load rather than failing opaquely at dispatch). `ajv` is fresh per
 *  pack-load, so a `$id` reused across packs never collides on a shared instance. */
function compileValidator(ajv: Ajv2020, schema: unknown, kind: string): AgentSchemaValidator {
  let fn: ValidateFunction;
  try {
    fn = ajv.compile(schema as object);
  } catch (err) {
    throw new Error(`${kind} is not a valid JSON Schema 2020-12 document: ${err instanceof Error ? err.message : String(err)}`);
  }
  return (value: unknown) => {
    const ok = fn(value) as boolean;
    return ok ? { ok: true } : { ok: false, errors: ajv.errorsText(fn.errors, { separator: '; ' }) };
  };
}

interface RawAgentManifest {
  agentId?: unknown;
  persona?: unknown;
  modelClass?: unknown;
  systemPrompt?: unknown;
  systemPromptRef?: unknown;
  toolAllowlist?: unknown;
  memoryShape?: unknown;
  confidence?: unknown;
  handoff?: { taskSchemaRef?: unknown; returnSchemaRef?: unknown };
  label?: unknown;
  description?: unknown;
}

/** Resolve a tarball-relative ref against the pack dir, enforcing RFC 0003
 *  §C path rules. Returns the absolute path, or throws on violation. */
function resolveRef(packDir: string, ref: string, kind: string): string {
  if (isAbsolute(ref)) {
    throw new Error(`${kind} '${ref}' is an absolute path (RFC 0003 §C: refs MUST be tarball-relative)`);
  }
  const abs = normalize(join(packDir, ref));
  const rel = relative(packDir, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${kind} '${ref}' escapes the pack root (RFC 0003 §C: no path traversal)`);
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(`${kind} '${ref}' does not exist in the pack`);
  }
  return abs;
}

/** Read a UTF-8 file, rejecting content that isn't valid UTF-8 (RFC 0003 §C). */
function readUtf8(abs: string, kind: string): string {
  const buf = readFileSync(abs);
  const text = buf.toString('utf-8');
  // A round-trip mismatch indicates the bytes were not valid UTF-8.
  if (Buffer.from(text, 'utf-8').length !== buf.length) {
    throw new Error(`${kind} at '${abs}' is not valid UTF-8 (RFC 0003 §C)`);
  }
  return text;
}

/**
 * Load and register all agents declared in `packDir/pack.json`'s `agents[]`.
 * Returns the resolved manifests it registered. Agents that fail resolution
 * (bad ref, traversal, malformed handoff schema) are skipped with a logged
 * error — one bad agent MUST NOT block the rest of the pack.
 */
export function loadAgentsFromManifest(packDir: string): ResolvedAgentManifest[] {
  const manifestPath = join(packDir, 'pack.json');
  if (!existsSync(manifestPath)) return [];
  let manifest: { name?: string; version?: string; agents?: RawAgentManifest[] };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    log.warn('failed to parse pack.json for agents', { packDir, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
  if (!Array.isArray(manifest.agents) || manifest.agents.length === 0) return [];

  const packName = typeof manifest.name === 'string' ? manifest.name : packDir;
  const packVersion = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  const registry = getAgentRegistry();
  const loaded: ResolvedAgentManifest[] = [];
  // Fresh Ajv per pack-load: handoff schema files within a pack carry distinct
  // `$id`s, and a per-load instance means a `$id` reused across two packs never
  // collides on a shared registry (the documented Ajv `compile` gotcha).
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  for (const raw of manifest.agents) {
    try {
      if (typeof raw.agentId !== 'string' || typeof raw.persona !== 'string' || typeof raw.modelClass !== 'string') {
        throw new Error('agent manifest missing required agentId / persona / modelClass');
      }
      // RFC 0003 §B — an agent's agentId MUST share the pack's namespace tier.
      // Registries enforce this on submission; a host defensively skips a
      // mismatched agent rather than installing a misattributed identity.
      if (typeof manifest.name === 'string' && raw.agentId !== packName && !raw.agentId.startsWith(`${packName}.`)) {
        throw new Error(`agentId '${raw.agentId}' is outside pack namespace '${packName}' (RFC 0003 §B)`);
      }

      // §C system prompt — inline XOR ref (schema enforces; we resolve the ref).
      let systemPrompt: string;
      let systemPromptRef: string | undefined;
      if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.length > 0) {
        systemPrompt = raw.systemPrompt;
      } else if (typeof raw.systemPromptRef === 'string' && raw.systemPromptRef.length > 0) {
        systemPromptRef = raw.systemPromptRef;
        systemPrompt = readUtf8(resolveRef(packDir, raw.systemPromptRef, 'systemPromptRef'), 'systemPromptRef');
      } else {
        throw new Error('agent manifest has neither systemPrompt nor systemPromptRef');
      }

      // §D handoff schema refs — resolve + parse + pre-compile a validator at
      // load (RFC 0003 §D: refs MUST be valid JSON Schema 2020-12 docs;
      // compileValidator throws here if not, so the agent is skipped at load).
      let handoff: ResolvedAgentManifest['handoff'];
      if (raw.handoff && typeof raw.handoff === 'object') {
        handoff = {};
        const h = raw.handoff;
        if (typeof h.taskSchemaRef === 'string') {
          handoff.taskSchemaRef = h.taskSchemaRef;
          handoff.taskSchema = JSON.parse(readUtf8(resolveRef(packDir, h.taskSchemaRef, 'handoff.taskSchemaRef'), 'handoff.taskSchemaRef'));
          handoff.validateTask = compileValidator(ajv, handoff.taskSchema, 'handoff.taskSchemaRef');
        }
        if (typeof h.returnSchemaRef === 'string') {
          handoff.returnSchemaRef = h.returnSchemaRef;
          handoff.returnSchema = JSON.parse(readUtf8(resolveRef(packDir, h.returnSchemaRef, 'handoff.returnSchemaRef'), 'handoff.returnSchemaRef'));
          handoff.validateReturn = compileValidator(ajv, handoff.returnSchema, 'handoff.returnSchemaRef');
        }
      }

      const resolved: ResolvedAgentManifest = {
        agentId: raw.agentId,
        persona: raw.persona,
        modelClass: raw.modelClass,
        systemPrompt,
        systemPromptRef,
        toolAllowlist: Array.isArray(raw.toolAllowlist) ? raw.toolAllowlist.filter((t): t is string => typeof t === 'string') : undefined,
        memoryShape: (raw.memoryShape && typeof raw.memoryShape === 'object') ? raw.memoryShape as ResolvedAgentManifest['memoryShape'] : undefined,
        confidence: (raw.confidence && typeof raw.confidence === 'object') ? raw.confidence as ResolvedAgentManifest['confidence'] : undefined,
        handoff,
        label: typeof raw.label === 'string' ? raw.label : undefined,
        description: typeof raw.description === 'string' ? raw.description : undefined,
        packName,
        packVersion,
      };
      registry.register(resolved);
      loaded.push(resolved);
    } catch (err) {
      log.error('skipping agent manifest that failed resolution', {
        packDir,
        agentId: typeof raw.agentId === 'string' ? raw.agentId : '(unknown)',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (loaded.length > 0) {
    log.info('loaded manifest agents', { packName, count: loaded.length });
  }
  return loaded;
}
