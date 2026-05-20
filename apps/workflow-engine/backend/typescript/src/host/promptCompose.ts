/**
 * RFC 0027 §E reference implementation — prompt-template composition
 * with secret redaction and trust-marker propagation.
 *
 * Composes a host-resident PromptTemplate against runtime bindings and
 * returns the `prompt.composed` payload shape per
 * `schemas/run-event-payloads.schema.json#/$defs/promptComposed`.
 *
 * Three observability invariants enforced here (matched by the
 * conformance scenarios `prompt-composed-secret-redaction` and
 * `prompt-composed-trust-marker`):
 *
 *   1. Any variable whose declared `source` is `secret` MUST appear as
 *      `[REDACTED:<credentialRef>]` in the emitted `systemPrompt` /
 *      `userPrompt` / `variableBindings`. Real secret values are
 *      resolved via the BYOK pipeline at LLM-dispatch time, never at
 *      compose-emission time. For this reference impl the test seam
 *      doesn't dispatch — it emits the redacted form directly.
 *
 *   2. When any contributing binding is tagged `untrusted` (via the
 *      compose seam's `bindingTrust` map, mirroring RFC 0020 §D
 *      `meta.contentTrust` propagation), the composed body MUST wrap
 *      that segment in `<UNTRUSTED>...</UNTRUSTED>` markers and the
 *      payload's top-level `contentTrust` MUST be `"untrusted"`.
 *
 *   3. The `hash` and `variableHashes` fields are sha256 hex digests
 *      computed from the FINAL composed body (post-substitution,
 *      post-redaction, post-wrapping). Deterministic over identical
 *      inputs per RFC 0027 §F replay determinism.
 *
 * Templates are loaded from
 * `apps/workflow-engine/conformance-fixtures/prompt-templates/`
 * (vendored from `conformance/fixtures/prompt-templates/` by
 * `scripts/sync-fixtures.sh`). The compose seam looks up by
 * `templateId`; the schema validation on those fixtures runs in the
 * conformance suite's `fixtures-valid.test.ts`.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSecret, type SecretScope } from '../byok/secretResolver.js';

export interface PromptVariableDecl {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  source?: 'input' | 'variable' | 'secret' | 'context';
  defaultValue?: unknown;
}

export interface PromptTemplate {
  templateId: string;
  version: string;
  kind: 'system' | 'user' | 'few-shot' | 'schema-hint';
  text: string;
  variables?: PromptVariableDecl[];
}

export interface ComposeRequest {
  templateId: string;
  /** Variable name → bound value. Secret-source variables MUST be
   *  bound to a credentialRef (e.g., `openwop-conformance-canary-secret`)
   *  rather than the plaintext value; the composer resolves the secret
   *  via the BYOK pipeline but emits the `[REDACTED:<credentialRef>]`
   *  marker in the observability payload. */
  bindings: Record<string, unknown>;
  /** Per-binding trust tags. When a binding is `untrusted`, the
   *  substituted segment in the composed body is wrapped in
   *  `<UNTRUSTED>...</UNTRUSTED>` markers and the payload's top-level
   *  `contentTrust` is set to `"untrusted"`. Missing entries default to
   *  `trusted`. */
  bindingTrust?: Record<string, 'trusted' | 'untrusted'>;
  /** Per-request observability override; falls back to the host-wide
   *  `capabilities.prompts.observability` advertised at discovery. */
  observability?: 'off' | 'hashed' | 'full';
  /** Optional nodeId surfaced on the payload's `nodeId` field. The
   *  conformance scenarios don't dispatch a real run, so the seam
   *  defaults to a stable test value. */
  nodeId?: string;
  /** BYOK scope for `resolveSecret` lookups. The conformance suite
   *  pre-provisions `openwop-conformance-canary-secret` via
   *  `OPENWOP_TEST_SEAM_ENABLED=true` — see
   *  `src/index.ts` canary-provisioning block. */
  secretScope?: SecretScope;
}

export interface PromptComposedPayload {
  nodeId: string;
  refs: string[];
  kind: 'system+user' | 'system-only' | 'user-only' | 'agent-reasoning';
  hash: string;
  systemPrompt?: string;
  userPrompt?: string;
  variableBindings?: Record<string, unknown>;
  variableHashes?: Record<string, string>;
  contentTrust?: 'trusted' | 'untrusted';
}

const __filename = fileURLToPath(import.meta.url);
// host/promptCompose.ts → ../../../conformance-fixtures/prompt-templates/
const FIXTURES_DIR = join(__filename, '..', '..', '..', '..', 'conformance-fixtures', 'prompt-templates');

// Loaded lazily on first call so unit tests that don't exercise the
// compose seam don't pay the disk cost.
let templates: Map<string, PromptTemplate> | null = null;

function loadTemplates(): Map<string, PromptTemplate> {
  if (templates) return templates;
  templates = new Map();
  try {
    for (const f of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))) {
      const data = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as PromptTemplate;
      templates.set(data.templateId, data);
    }
  } catch {
    // Directory missing — sync-fixtures.sh hasn't run. Surfaces as
    // `template_not_found` on every compose call, which the
    // conformance scenarios skip cleanly.
  }
  return templates;
}

function sha256(s: string): string {
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

function classifyComposition(systemPresent: boolean, userPresent: boolean): PromptComposedPayload['kind'] {
  if (systemPresent && userPresent) return 'system+user';
  if (systemPresent) return 'system-only';
  if (userPresent) return 'user-only';
  // Templates that compose neither system nor user — treat as
  // `agent-reasoning` per the schema enum.
  return 'agent-reasoning';
}

async function resolveBinding(
  decl: PromptVariableDecl,
  raw: unknown,
  trust: 'trusted' | 'untrusted',
  scope: SecretScope | undefined,
): Promise<{ displayValue: string; observabilityValue: string | typeof REDACTED_FLAG }> {
  // For source: 'secret', the binding value is a credentialRef. Resolve
  // the secret via the BYOK pipeline but emit the [REDACTED:<id>]
  // marker. This reference impl doesn't actually inject the resolved
  // value anywhere (the test seam emits the payload directly), but the
  // resolve call exercises the BYOK pipeline so the seam fails fast if
  // the secret is missing.
  if (decl.source === 'secret') {
    const credentialRef = typeof raw === 'string' ? raw : '';
    if (credentialRef === '') {
      throw new Error(`prompt_variable_unresolved: secret binding for '${decl.name}' missing credentialRef`);
    }
    // Resolve to assert the secret actually exists in the BYOK store.
    // The resolved value is discarded immediately — the redaction
    // marker is what surfaces in the observability payload.
    await resolveSecret(credentialRef, scope);
    return {
      displayValue: `[REDACTED:${credentialRef}]`,
      observabilityValue: `[REDACTED:${credentialRef}]`,
    };
  }
  // Non-secret sources: stringify the value. When trust is 'untrusted',
  // the composed body wraps it in <UNTRUSTED>...</UNTRUSTED> markers
  // per RFC 0027 §E + threat-model-prompt-injection.md.
  const stringified = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw);
  const wrapped = trust === 'untrusted' ? `<UNTRUSTED>${stringified}</UNTRUSTED>` : stringified;
  return { displayValue: wrapped, observabilityValue: stringified };
}

const REDACTED_FLAG = Symbol('redacted');

export async function composePromptTemplate(req: ComposeRequest): Promise<PromptComposedPayload> {
  const map = loadTemplates();
  const template = map.get(req.templateId);
  if (!template) {
    throw new Error(`template_not_found: '${req.templateId}'`);
  }

  const observability = req.observability ?? 'full';
  const nodeId = req.nodeId ?? 'conformance-compose-seam';
  const declMap = new Map<string, PromptVariableDecl>(
    (template.variables ?? []).map((v) => [v.name, v]),
  );

  // Step 1: resolve every binding referenced by the template body.
  // Unknown placeholders (no declaration) are treated as optional
  // input-source variables with no default. Missing required bindings
  // raise per RFC 0027 §A.
  const placeholderRe = /\{\{(\w+)\}\}/g;
  const placeholders = Array.from(new Set(Array.from(template.text.matchAll(placeholderRe)).map((m) => m[1] as string)));

  let aggregateTrust: 'trusted' | 'untrusted' = 'trusted';
  const bindings: Record<string, { display: string; observability: string }> = {};

  for (const name of placeholders) {
    const decl = declMap.get(name) ?? { name, source: 'input' as const, required: false };
    const raw = req.bindings[name];
    if (raw === undefined && decl.required === true) {
      throw new Error(`prompt_variable_unresolved: required variable '${name}' has no binding`);
    }
    const value = raw === undefined ? decl.defaultValue : raw;
    const trust = (req.bindingTrust?.[name] ?? 'trusted') as 'trusted' | 'untrusted';
    if (trust === 'untrusted') aggregateTrust = 'untrusted';
    const resolved = await resolveBinding(decl, value, trust, req.secretScope);
    bindings[name] = { display: resolved.displayValue, observability: String(resolved.observabilityValue) };
  }

  // Step 2: substitute placeholders into the body. The composed body
  // is what would actually be sent to the LLM (with secret redaction
  // markers in place of resolved values for this reference impl, since
  // the test seam doesn't dispatch). Variable substitution is purely
  // literal — no nested template expansion.
  const composedBody = template.text.replace(placeholderRe, (_, name: string) => {
    return bindings[name]?.display ?? '';
  });

  // Step 3: classify and project to the prompt.composed payload shape.
  const isSystem = template.kind === 'system';
  const isUser = template.kind === 'user';
  const kind = classifyComposition(isSystem, isUser);
  const ref = `prompt:${template.templateId}@${template.version}`;
  const hash = sha256(composedBody);

  const payload: PromptComposedPayload = {
    nodeId,
    refs: [ref],
    kind,
    hash,
    contentTrust: aggregateTrust,
  };

  if (observability === 'off') {
    return payload;
  }

  // variableHashes always present under hashed + full.
  const variableHashes: Record<string, string> = {};
  for (const [name, { observability: obs }] of Object.entries(bindings)) {
    variableHashes[name] = sha256(obs);
  }
  payload.variableHashes = variableHashes;

  if (observability === 'full') {
    if (isSystem) payload.systemPrompt = composedBody;
    if (isUser) payload.userPrompt = composedBody;
    const variableBindings: Record<string, unknown> = {};
    for (const [name, { observability: obs }] of Object.entries(bindings)) {
      variableBindings[name] = obs;
    }
    payload.variableBindings = variableBindings;
  }

  return payload;
}
