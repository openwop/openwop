/**
 * Front-end plugin packs — the schema layer of `frontend-plugin-packs.md`
 * (RFC 0117, RFC 0130): `frontend-plugin-manifest.schema.json` and
 * `ui-plugin-message.schema.json` enforce the wire shape of a manifest and of a
 * `ui-plugin/1` message, including the closed host-RPC allowlist
 * (`frontend-plugin-rpc-allowlist`) and an envelope that admits no
 * credential-bearing field (`frontend-plugin-no-byok`).
 *
 * Corpus-only (it reads no host), so it lives in `src/coherence/` and never in a
 * host bundle (`spec/v2/core/conformance.md` §Two products). It was the
 * always-on layer of the `frontend-plugin-packs` scenario until RFC 0238 G3.
 *
 * @see spec/v1/frontend-plugin-packs.md
 * @see RFCS/0238-ui-plugin-observation-path.md (gap G3)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';
const MANIFEST_SCHEMA = join(SCHEMAS_DIR, 'frontend-plugin-manifest.schema.json');
const MESSAGE_SCHEMA = join(SCHEMAS_DIR, 'ui-plugin-message.schema.json');

/** Compiled on first use: outside a spec checkout the schemas are absent and every leg skips first. */
function compiler(path: string): () => ValidateFunction {
  let fn: ValidateFunction | undefined;
  return () => {
    if (fn === undefined) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      fn = ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
    }
    return fn;
  };
}

function validManifest(): Record<string, unknown> {
  return {
    name: 'vendor.acme.canvas-editor',
    version: '1.0.0',
    kind: 'frontend-plugin',
    engines: { openwop: '>=1.2.0' },
    uiPlugins: [
      {
        pluginId: 'app-builder',
        surface: 'artifact-viewer',
        entry: 'ui/app-builder.mjs',
        hostApi: ['artifact.read', 'artifact.write'],
      },
    ],
  };
}

describe('frontend-plugin manifest: schema layer (always-on, server-free)', () => {
  const validate = compiler(MANIFEST_SCHEMA);

  it('a well-formed frontend-plugin manifest validates', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(
      validate()(validManifest()),
      req('openwop.it.frontend-plugin-schemas.a-well-formed-frontend-plugin-manifest-validates', 'frontend-plugin-packs.md', `frontend-plugin-packs.md §The pack — a valid manifest MUST validate. Errors: ${JSON.stringify(validate().errors)}`),
    ).toBe(true);
  });

  it('a backend `runtime` member is rejected (a plugin is sandboxed UI, not a node entry)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = { ...validManifest(), runtime: { language: 'javascript', entry: 'index.mjs' } };
    expect(
      validate()(m),
      req('openwop.it.frontend-plugin-schemas.a-backend-runtime-member-is-rejected-a-plugin-is-sandboxed-ui-not-a-node-entry', 'frontend-plugin-packs.md', 'node-packs.md §Pack kinds — a kind:"frontend-plugin" manifest carrying `runtime` MUST be rejected (pack_kind_invalid)'),
    ).toBe(false);
  });

  it('a uiPlugins[] entry missing `entry` is rejected', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = validManifest();
    delete (m.uiPlugins as Array<Record<string, unknown>>)[0].entry;
    expect(validate()(m), req('openwop.it.frontend-plugin-schemas.a-uiplugins-entry-missing-entry-is-rejected', 'frontend-plugin-packs.md', 'a uiPlugins[] entry missing `entry` MUST NOT validate')).toBe(false);
  });

  it('an `entry` path with `..` traversal is rejected', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0].entry = '../escape.mjs';
    expect(validate()(m), req('openwop.it.frontend-plugin-schemas.an-entry-path-with-traversal-is-rejected', 'frontend-plugin-packs.md', 'an `entry` path MUST NOT contain `..` (path-traversal)')).toBe(false);
  });

  it('a hostApi method outside the closed allowlist is rejected (frontend-plugin-rpc-allowlist)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0].hostApi = ['artifact.read', 'host.exec'];
    expect(
      validate()(m),
      req('openwop.it.frontend-plugin-schemas.a-hostapi-method-outside-the-closed-allowlist-is-rejected-frontend-plugin-rpc-al', 'frontend-plugin-packs.md', 'frontend-plugin-packs.md §Host-RPC — only the closed allowlist methods are permitted; `host.exec` MUST NOT validate'),
    ).toBe(false);
  });

  it('an empty uiPlugins[] is rejected (a pack MUST declare at least one plugin)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = { ...validManifest(), uiPlugins: [] };
    expect(validate()(m), req('openwop.it.frontend-plugin-schemas.an-empty-uiplugins-is-rejected-a-pack-must-declare-at-least-one-plugin', 'frontend-plugin-packs.md', 'a frontend-plugin pack MUST declare at least one uiPlugins[] entry')).toBe(false);
  });

  it('a canvas-preview entry with canvasTypes + host.announce validates (RFC 0130)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0] = {
      pluginId: 'gantt-preview',
      surface: 'canvas-preview',
      canvasTypes: ['canvas.gantt'],
      entry: 'ui/preview.html',
      hostApi: ['artifact.read', 'host.announce'],
    };
    expect(
      validate()(m),
      req('openwop.it.frontend-plugin-schemas.a-canvas-preview-entry-with-canvastypes-host-announce-validates-rfc-0130', 'RFC 0130', `frontend-plugin-packs.md §The pack (RFC 0130) — a canvas-preview entry MUST validate. Errors: ${JSON.stringify(validate().errors)}`),
    ).toBe(true);
  });

  it('a surface outside the closed set is still rejected (RFC 0130 keeps the enum closed)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0].surface = 'omni-panel';
    expect(
      validate()(m),
      req('openwop.it.frontend-plugin-schemas.a-surface-outside-the-closed-set-is-still-rejected-rfc-0130-keeps-the-enum-close', 'RFC 0130', 'frontend-plugin-packs.md §The pack — the surface enum stays closed; an unknown surface MUST NOT validate'),
    ).toBe(false);
  });
});

describe('ui-plugin/1 message: schema layer (always-on, server-free)', () => {
  const validate = compiler(MESSAGE_SCHEMA);

  it('a valid artifact.write request carrying a version token validates', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const reqBody = {
      openwop: 'ui-plugin/1',
      type: 'request',
      id: 7,
      method: 'artifact.write',
      params: { artifactId: 'a-1', version: 'opaque-v1', payload: {} },
    };
    expect(validate()(reqBody), req('openwop.it.frontend-plugin-schemas.a-valid-artifact-write-request-carrying-a-version-token-validates', 'frontend-plugin-packs.md', `a valid artifact.write request MUST validate. Errors: ${JSON.stringify(validate().errors)}`)).toBe(true);
  });

  it('an artifact_conflict response carries currentVersion (version-token concurrency)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const res = {
      openwop: 'ui-plugin/1',
      type: 'response',
      id: 7,
      ok: false,
      error: { code: 'artifact_conflict', currentVersion: 'opaque-v2' },
    };
    expect(
      validate()(res),
      req('openwop.it.frontend-plugin-schemas.an-artifact-conflict-response-carries-currentversion-version-token-concurrency', 'frontend-plugin-packs.md', `frontend-plugin-packs.md §Concurrency — a stale write surfaces artifact_conflict + currentVersion. Errors: ${JSON.stringify(validate().errors)}`),
    ).toBe(true);
  });

  it('a request with a method outside the allowlist is schema-rejected', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const reqBody = { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'host.exec' };
    expect(validate()(reqBody), req('openwop.it.frontend-plugin-schemas.a-request-with-a-method-outside-the-allowlist-is-schema-rejected', 'frontend-plugin-packs.md', 'a method outside the ui-plugin/1 allowlist MUST NOT validate')).toBe(false);
  });

  it('a message without the ui-plugin/1 protocol tag is rejected', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const reqBody = { openwop: 'ui-plugin/2', type: 'request', id: 1, method: 'artifact.read' };
    expect(validate()(reqBody), req('openwop.it.frontend-plugin-schemas.a-message-without-the-ui-plugin-1-protocol-tag-is-rejected', 'frontend-plugin-packs.md', 'a host MUST ignore messages whose ui-plugin tag it does not recognize')).toBe(false);
  });

  it('no credential-bearing field is admitted on the envelope (frontend-plugin-no-byok)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    // additionalProperties:false on every envelope variant — a stray apiKey/token at the
    // envelope root cannot ride the boundary.
    for (const leak of ['apiKey', 'token', 'clientSecret', 'authorization']) {
      const reqBody = { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'artifact.read', [leak]: 'xxx' };
      expect(
        validate()(reqBody),
        req('openwop.it.frontend-plugin-schemas.no-credential-bearing-field-is-admitted-on-the-envelope-frontend-plugin-no-byok', 'frontend-plugin-packs.md', `frontend-plugin-no-byok — a credential-named envelope field ("${leak}") MUST NOT validate (additionalProperties:false)`),
      ).toBe(false);
    }
  });
});
