/**
 * Front-end plugin packs — `frontend-plugin-packs.md` (RFC 0117). Public test for
 * the four protocol-tier SECURITY invariants `frontend-plugin-isolation` /
 * `frontend-plugin-egress` / `frontend-plugin-rpc-allowlist` / `frontend-plugin-no-byok`,
 * plus the manifest shape and the `ui-plugin/1` host-RPC + version-token concurrency
 * contract.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probe — `frontend-plugin-manifest.schema.json`
 *      and `ui-plugin-message.schema.json` enforce the wire shape: a valid manifest /
 *      message validates; a backend `runtime` member, a `uiPlugins[]` entry missing
 *      `entry`, an out-of-allowlist `method`, and any envelope `additionalProperties`
 *      are rejected. The `version`-token concurrency contract (the `artifact_conflict`
 *      error code + `currentVersion`) is schema-pinned. No credential-bearing field is
 *      admitted on the envelope (`frontend-plugin-no-byok`).
 *
 *   B. Capability-gated behavioral leg — on a host advertising
 *      `capabilities.uiPlugins.supported: true` that exposes the
 *      `POST /v1/host/sample/ui-plugin/rpc` test seam, an undeclared-method request
 *      MUST be refused with `method_not_allowed` (`frontend-plugin-rpc-allowlist`), and
 *      a stale `artifact.write` MUST be refused with `artifact_conflict` + `currentVersion`
 *      and MUST NOT persist (§Concurrency). Hosts without the seam soft-skip (404);
 *      unadvertised hosts skip via the behavior gate. (No conformant host advertises
 *      `uiPlugins` yet — these legs soft-skip until the openwop-app reference host (ADR
 *      0153) lands, the first witness that graduates the invariants to protocol.)
 *
 * @see spec/v1/frontend-plugin-packs.md
 * @see SECURITY/invariants.yaml ids: frontend-plugin-{isolation,egress,rpc-allowlist,no-byok}
 * @see RFCS/0117-frontend-plugin-packs.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const MANIFEST_SCHEMA = join(SCHEMAS_DIR, 'frontend-plugin-manifest.schema.json');
const MESSAGE_SCHEMA = join(SCHEMAS_DIR, 'ui-plugin-message.schema.json');

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
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(MANIFEST_SCHEMA, 'utf8')));

  it('a well-formed frontend-plugin manifest validates', () => {
    expect(
      validate(validManifest()),
      `frontend-plugin-packs.md §The pack — a valid manifest MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('a backend `runtime` member is rejected (a plugin is sandboxed UI, not a node entry)', () => {
    const m = { ...validManifest(), runtime: { language: 'javascript', entry: 'index.mjs' } };
    expect(
      validate(m),
      'node-packs.md §Pack kinds — a kind:"frontend-plugin" manifest carrying `runtime` MUST be rejected (pack_kind_invalid)',
    ).toBe(false);
  });

  it('a uiPlugins[] entry missing `entry` is rejected', () => {
    const m = validManifest();
    delete (m.uiPlugins as Array<Record<string, unknown>>)[0].entry;
    expect(validate(m), 'a uiPlugins[] entry missing `entry` MUST NOT validate').toBe(false);
  });

  it('an `entry` path with `..` traversal is rejected', () => {
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0].entry = '../escape.mjs';
    expect(validate(m), 'an `entry` path MUST NOT contain `..` (path-traversal)').toBe(false);
  });

  it('a hostApi method outside the closed allowlist is rejected (frontend-plugin-rpc-allowlist)', () => {
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0].hostApi = ['artifact.read', 'host.exec'];
    expect(
      validate(m),
      'frontend-plugin-packs.md §Host-RPC — only the closed allowlist methods are permitted; `host.exec` MUST NOT validate',
    ).toBe(false);
  });

  it('an empty uiPlugins[] is rejected (a pack MUST declare at least one plugin)', () => {
    const m = { ...validManifest(), uiPlugins: [] };
    expect(validate(m), 'a frontend-plugin pack MUST declare at least one uiPlugins[] entry').toBe(false);
  });

  it('a canvas-preview entry with canvasTypes + host.announce validates (RFC 0130)', () => {
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0] = {
      pluginId: 'gantt-preview',
      surface: 'canvas-preview',
      canvasTypes: ['canvas.gantt'],
      entry: 'ui/preview.html',
      hostApi: ['artifact.read', 'host.announce'],
    };
    expect(
      validate(m),
      `frontend-plugin-packs.md §The pack (RFC 0130) — a canvas-preview entry MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('a surface outside the closed set is still rejected (RFC 0130 keeps the enum closed)', () => {
    const m = validManifest();
    (m.uiPlugins as Array<Record<string, unknown>>)[0].surface = 'omni-panel';
    expect(
      validate(m),
      'frontend-plugin-packs.md §The pack — the surface enum stays closed; an unknown surface MUST NOT validate',
    ).toBe(false);
  });
});

describe('ui-plugin/1 message: schema layer (always-on, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(MESSAGE_SCHEMA, 'utf8')));

  it('a valid artifact.write request carrying a version token validates', () => {
    const req = {
      openwop: 'ui-plugin/1',
      type: 'request',
      id: 7,
      method: 'artifact.write',
      params: { artifactId: 'a-1', version: 'opaque-v1', payload: {} },
    };
    expect(validate(req), `a valid artifact.write request MUST validate. Errors: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('an artifact_conflict response carries currentVersion (version-token concurrency)', () => {
    const res = {
      openwop: 'ui-plugin/1',
      type: 'response',
      id: 7,
      ok: false,
      error: { code: 'artifact_conflict', currentVersion: 'opaque-v2' },
    };
    expect(
      validate(res),
      `frontend-plugin-packs.md §Concurrency — a stale write surfaces artifact_conflict + currentVersion. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('a request with a method outside the allowlist is schema-rejected', () => {
    const req = { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'host.exec' };
    expect(validate(req), 'a method outside the ui-plugin/1 allowlist MUST NOT validate').toBe(false);
  });

  it('a message without the ui-plugin/1 protocol tag is rejected', () => {
    const req = { openwop: 'ui-plugin/2', type: 'request', id: 1, method: 'artifact.read' };
    expect(validate(req), 'a host MUST ignore messages whose ui-plugin tag it does not recognize').toBe(false);
  });

  it('no credential-bearing field is admitted on the envelope (frontend-plugin-no-byok)', () => {
    // additionalProperties:false on every envelope variant — a stray apiKey/token at the
    // envelope root cannot ride the boundary.
    for (const leak of ['apiKey', 'token', 'clientSecret', 'authorization']) {
      const req = { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'artifact.read', [leak]: 'xxx' };
      expect(
        validate(req),
        `frontend-plugin-no-byok — a credential-named envelope field ("${leak}") MUST NOT validate (additionalProperties:false)`,
      ).toBe(false);
    }
  });
});

describe('frontend-plugin: isolation advertisement (always-on, capability shape)', () => {
  // RFC 0119: `isolation` is a categorical model, not a single browser const. A conformant host
  // advertises a member of the enum (cross-origin-iframe default) or an x-host-* vendor model —
  // every value denotes the SAME mandatory property (in-process loading is a protocol-tier MUST NOT,
  // regardless of mechanism). cross-origin-iframe stays valid + default, so existing browser hosts
  // pass unchanged; a weaker/unknown non-x-host value is rejected.
  const CONFORMANT_ISOLATION = ['cross-origin-iframe', 'wasm', 'process', 'container', 'vm'];
  const X_HOST = /^x-host-[a-z0-9-]+-[a-z0-9-]+$/;
  it('a host advertising uiPlugins MUST advertise a conformant isolation model', async () => {
    const uiPlugins = await readCapabilityFamily<{ supported?: boolean; isolation?: string }>('uiPlugins');
    if (!uiPlugins?.supported) return; // unadvertised → out of scope (graceful degradation)
    const iso = uiPlugins.isolation;
    expect(
      iso !== undefined && (CONFORMANT_ISOLATION.includes(iso) || X_HOST.test(iso)),
      driver.describe(
        'frontend-plugin-packs.md §Isolation (RFC 0119)',
        'frontend-plugin-isolation — isolation MUST be a conformant model (cross-origin-iframe default | wasm | process | container | vm | x-host-*); every value denotes the same property, in-process loading is a protocol-tier MUST NOT regardless of mechanism',
      ),
    ).toBe(true);
  });
});

describe('frontend-plugin: host-RPC behavior (capability-gated)', () => {
  it('an undeclared host-RPC method is refused with method_not_allowed', async () => {
    const uiPlugins = await readCapabilityFamily<{ supported?: boolean }>('uiPlugins');
    if (!behaviorGate('uiPlugins.supported', uiPlugins?.supported === true)) return;

    const res = await driver.post('/v1/host/sample/ui-plugin/rpc', {
      message: { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'host.exec' },
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    const body = res.json as { ok?: boolean; error?: { code?: string } } | undefined;
    expect(
      body?.ok,
      driver.describe('frontend-plugin-packs.md §Host-RPC', 'an undeclared method MUST NOT execute'),
    ).toBe(false);
    expect(
      body?.error?.code,
      driver.describe(
        'frontend-plugin-packs.md §Host-RPC',
        'frontend-plugin-rpc-allowlist — an undeclared method surfaces method_not_allowed',
      ),
    ).toBe('method_not_allowed');
  });

  it('a stale artifact.write is refused with artifact_conflict + currentVersion (no persist)', async () => {
    const uiPlugins = await readCapabilityFamily<{ supported?: boolean; hostApi?: string[] }>('uiPlugins');
    if (!behaviorGate('uiPlugins.supported', uiPlugins?.supported === true)) return;
    if (!(uiPlugins?.hostApi ?? []).includes('artifact.write')) return; // write unsupported → out of scope

    const res = await driver.post('/v1/host/sample/ui-plugin/rpc', {
      message: {
        openwop: 'ui-plugin/1',
        type: 'request',
        id: 2,
        method: 'artifact.write',
        params: { artifactId: 'conformance-canary', version: 'stale-token', payload: {} },
      },
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    const body = res.json as { ok?: boolean; error?: { code?: string; currentVersion?: string } } | undefined;
    expect(
      body?.error?.code,
      driver.describe(
        'frontend-plugin-packs.md §Concurrency',
        'a stale artifact.write version surfaces artifact_conflict (host MUST NOT persist)',
      ),
    ).toBe('artifact_conflict');
    expect(
      typeof body?.error?.currentVersion,
      driver.describe('frontend-plugin-packs.md §Concurrency', 'artifact_conflict carries the host currentVersion for re-read/merge'),
    ).toBe('string');
  });
});
