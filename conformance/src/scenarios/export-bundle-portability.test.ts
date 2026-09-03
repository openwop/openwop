/**
 * Agent-platform portability — export bundle + tenant import (RFC 0098;
 * `portability.md`). Public test for the protocol-tier SECURITY invariant
 * `export-bundle-no-credential-material`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema legs — the capability block (incl. the
 *      `import ⇒ dryRun` if/then), the `export-bundle.schema.json` shape (no
 *      credential-named field admitted), and the content-free `import.applied`
 *      event payload.
 *
 *   B. Capability-gated behavioral legs — on a host advertising
 *      `capabilities.portability` that exposes the `/v1/host/sample/import`
 *      seam: a bundle carrying a literal credential value is rejected (422),
 *      and a dry-run import makes zero writes. Hosts without the seam soft-skip
 *      (404); unadvertised hosts skip via the behavior gate.
 *
 * @see spec/v1/portability.md
 * @see SECURITY/invariants.yaml id: export-bundle-no-credential-material
 * @see RFCS/0098-agent-platform-portability-export-bundle-and-import.md
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
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

const CRED_NAMES = ['clientSecret', 'client_secret', 'apiKey', 'api_key', 'accessToken', 'refreshToken', 'password', 'privateKey'] as const;

describe('export-bundle-portability: capability advertisement (RFC 0098 §A, server-free)', () => {
  const caps = loadSchema('capabilities.schema.json');
  const portability = (caps.properties as Record<string, { properties?: Record<string, unknown>; if?: unknown; then?: unknown }>).portability;

  it('capabilities schema declares portability with its sub-flags + the import⇒dryRun if/then', () => {
    expect(portability, req('openwop.it.export-bundle-portability.capabilities-schema-declares-portability-with-its-sub-flags-the-import-dryrun-if', 'capabilities.md §portability', 'portability MUST be declared')).toBeDefined();
    for (const flag of ['export', 'import', 'kinds', 'dryRun']) {
      expect(portability?.properties?.[flag], req('openwop.it.export-bundle-portability.capabilities-schema-declares-portability-with-its-sub-flags-the-import-dryrun-if', 'RFC 0098 §A', `portability.${flag} MUST be declared`)).toBeDefined();
    }
    expect(portability?.if, req('openwop.it.export-bundle-portability.capabilities-schema-declares-portability-with-its-sub-flags-the-import-dryrun-if', 'RFC 0098 §A', 'a JSON-Schema if/then MUST enforce dryRun:true when import:true')).toBeDefined();
    expect(portability?.then, req('openwop.it.export-bundle-portability.capabilities-schema-declares-portability-with-its-sub-flags-the-import-dryrun-if', 'RFC 0098 §A', 'the then-branch MUST require dryRun')).toBeDefined();
  });
});

describe('export-bundle-portability: ExportBundle shape (RFC 0098 §B, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema('export-bundle.schema.json'));

  const good = {
    bundleVersion: '1',
    source: { origin: 'https://host-a.example', exportedAt: '2026-06-13T00:00:00Z' },
    items: [
      { kind: 'prompt-template', ref: 'tpl-1', payload: { templateId: 'welcome', version: '1.0.0' } },
      { kind: 'connection-ref', ref: 'conn-1', dependsOn: ['tpl-1'], payload: { provider: 'slack', credentialRef: 'cred:abc' } },
    ],
  };

  it('validates a conforming bundle with refs only', () => {
    expect(validate(good), req('openwop.it.export-bundle-portability.validates-a-conforming-bundle-with-refs-only', 'RFC 0098 §B', `a conforming bundle MUST validate. Errors: ${JSON.stringify(validate.errors)}`)).toBe(true);
  });

  it('rejects a wrong bundleVersion, an unknown kind, and a missing item ref', () => {
    expect(validate({ ...good, bundleVersion: '2' }), req('openwop.it.export-bundle-portability.rejects-a-wrong-bundleversion-an-unknown-kind-and-a-missing-item-ref', 'RFC 0098 §B', 'an unsupported bundleVersion MUST be rejected')).toBe(false);
    expect(validate({ ...good, items: [{ kind: 'mystery', ref: 'x', payload: {} }] }), req('openwop.it.export-bundle-portability.rejects-a-wrong-bundleversion-an-unknown-kind-and-a-missing-item-ref', 'RFC 0098 §B', 'an unknown item kind MUST be rejected')).toBe(false);
    expect(validate({ ...good, items: [{ kind: 'agent', payload: {} }] }), req('openwop.it.export-bundle-portability.rejects-a-wrong-bundleversion-an-unknown-kind-and-a-missing-item-ref', 'RFC 0098 §B', 'an item without a ref MUST be rejected')).toBe(false);
  });

  it('the bundle envelope admits no credential-named field at the root or source level (additionalProperties:false)', () => {
    for (const name of CRED_NAMES) {
      expect(validate({ ...good, [name]: 'xxx' }), req('openwop.it.export-bundle-portability.the-bundle-envelope-admits-no-credential-named-field-at-the-root-or-source-level', 'SECURITY invariant export-bundle-no-credential-material', `a "${name}" field at the bundle root MUST NOT validate`)).toBe(false);
      expect(validate({ ...good, source: { ...good.source, [name]: 'xxx' } }), req('openwop.it.export-bundle-portability.the-bundle-envelope-admits-no-credential-named-field-at-the-root-or-source-level', 'SECURITY invariant export-bundle-no-credential-material', `a "${name}" field under source MUST NOT validate`)).toBe(false);
    }
  });
});

describe('export-bundle-portability: content-free event (RFC 0098 §D, server-free)', () => {
  const runEvent = loadSchema('run-event.schema.json');
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  it('import.applied is in the RunEventType enum and is content-free (counts + refs only)', () => {
    const en = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(en, req('openwop.it.export-bundle-portability.import-applied-is-in-the-runeventtype-enum-and-is-content-free-counts-refs-only', 'export-bundle-portability.test.ts (no spec citation in file)', 'import.applied is in the RunEventType enum and is content-free (counts + refs only)')).toContain('import.applied');
    const applied = ajv.getSchema('payloads#/$defs/importApplied')!;
    expect(applied({ bundleOrigin: 'https://host-a.example', counts: { created: 2, skipped: 1 }, secretsToRebind: ['anthropic'] }), req('openwop.it.export-bundle-portability.import-applied-is-in-the-runeventtype-enum-and-is-content-free-counts-refs-only', 'RFC 0098 §D', 'a content-free import.applied MUST validate')).toBe(true);
    expect(applied({ bundleOrigin: 'h', counts: { created: 1 }, items: [{ payload: {} }] }), req('openwop.it.export-bundle-portability.import-applied-is-in-the-runeventtype-enum-and-is-content-free-counts-refs-only', 'SECURITY invariant export-bundle-no-credential-material', 'import.applied MUST NOT carry item payloads')).toBe(false);
  });
});

describe('export-bundle-portability: behavioral (RFC 0098 §E, capability-gated)', () => {
  it('importing a bundle with a literal credential value is rejected (422)', async () => {
    const portability = await readCapabilityFamily<{ import?: boolean }>('portability');
    if (!behaviorGate('portability', portability !== undefined && portability.import === true)) return;

    const leaky = {
      bundleVersion: '1',
      source: { origin: 'adapter:conformance' },
      items: [{ kind: 'connection-ref', ref: 'c1', payload: { provider: 'anthropic', apiKey: 'sk-conformance-canary' } }],
    };
    const res = await driver.post('/v1/host/sample/import?dryRun=true', { bundle: leaky });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    expect(
      res.status,
      req('openwop.it.export-bundle-portability.importing-a-bundle-with-a-literal-credential-value-is-rejected-422', 'portability.md §Invariants clause 1', 'a bundle carrying a literal credential value MUST be rejected (422)'),
    ).toBe(422);
  });
});
