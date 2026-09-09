/**
 * Workflow-chain gallery visibility — `internal` chains (RFC 0135).
 *
 * Server-free corpus legs (always-on): the manifest schema's §WorkflowChain carries
 * a boolean `internal` property; a chain declaring `internal: true` validates; a
 * non-boolean `internal` is rejected; the spec documents the MUST-omit-from-default-
 * gallery rule and the not-an-authorization-boundary rule.
 *
 * The gallery-omission behavior itself is host-catalog presentation with no
 * normative wire listing endpoint, so it is witnessed at the reference host (host
 * regression test), not over the wire — see RFC 0135 §Conformance.
 *
 * @see spec/v1/workflow-chain-packs.md §"Chain visibility (RFC 0135)"
 * @see schemas/workflow-chain-pack-manifest.schema.json §WorkflowChain
 * @see RFCS/0135-workflow-chain-internal-visibility.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
const MANIFEST = join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json');
// S38 (2026-08-17): `spec/` is NOT in the published package (`files`), so a path built
// from SCHEMAS_DIR/../spec ENOENTs for every npm consumer — five always-on legs reddened
// MyndHyve's bundle for a reason that had nothing to do with the host. Prose legs are
// repo-layout only: `null` in the published layout and skipped, never thrown.
const CHAIN_DOC: string | null = V1_DIR === null ? null : join(V1_DIR, 'workflow-chain-packs.md');

function packWith(internal: unknown): Record<string, unknown> {
  return {
    name: 'vendor.acme.factory',
    version: '1.0.0',
    kind: 'workflow-chain',
    engines: { openwop: '^1' },
    chains: [
      {
        chainId: 'acme.child-batch',
        version: '1.0.0',
        label: 'Child Batch (Factory child)',
        description: 'Composition-only child fragment; composed by acme.factory.',
        ...(internal !== undefined ? { internal } : {}),
        parameters: {},
        dag: { nodes: [{ id: 'build', typeId: 'core.ai.callPrompt', config: {} }] },
      },
    ],
  };
}

describe('workflow-chain-internal-flag §A: corpus (RFC 0135, always-on)', () => {
  it('the manifest §WorkflowChain declares a boolean `internal` property', () => {
    const schema = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      $defs?: Record<string, { properties?: Record<string, { type?: string }> }>;
    };
    const internal = schema.$defs?.WorkflowChain?.properties?.internal;
    expect(internal, req('openwop.it.workflow-chain-internal-flag.the-manifest-workflowchain-declares-a-boolean-internal-property', '§WorkflowChain', 'internal property present')).toBeTruthy();
    expect(internal?.type, req('openwop.it.workflow-chain-internal-flag.the-manifest-workflowchain-declares-a-boolean-internal-property', '§WorkflowChain', 'internal is boolean')).toBe('boolean');
  });

  it('a chain declaring internal: true validates; a non-boolean internal is rejected', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, unknown>);
    expect(validate(packWith(true)), req('openwop.it.workflow-chain-internal-flag.a-chain-declaring-internal-true-validates-a-non-boolean-internal-is-rejected', '§WorkflowChain', `internal:true validates: ${ajv.errorsText(validate.errors)}`)).toBe(true);
    expect(validate(packWith(undefined)), req('openwop.it.workflow-chain-internal-flag.a-chain-declaring-internal-true-validates-a-non-boolean-internal-is-rejected', '§WorkflowChain', 'absent internal stays valid (absent ⇒ false)')).toBe(true);
    expect(validate(packWith('yes')), req('openwop.it.workflow-chain-internal-flag.a-chain-declaring-internal-true-validates-a-non-boolean-internal-is-rejected', '§WorkflowChain', 'non-boolean internal rejected')).toBe(false);
  });

  it.skipIf(CHAIN_DOC === null)('the spec documents the MUST-omit-from-default-gallery + not-an-authz-boundary rules', () => {
    const doc = readFileSync(CHAIN_DOC as string, 'utf8');
    expect(doc.includes('Chain visibility (RFC 0135)'), req('openwop.it.workflow-chain-internal-flag.the-spec-documents-the-must-omit-from-default-gallery-not-an-authz-boundary-rule', '§Chain visibility', 'section present')).toBe(true);
    expect(
      /internal[\s\S]{0,600}MUST omit/i.test(doc),
      req('openwop.it.workflow-chain-internal-flag.the-spec-documents-the-must-omit-from-default-gallery-not-an-authz-boundary-rule', '§Chain visibility', 'documents MUST omit from default listing'),
    ).toBe(true);
    expect(
      /NOT an authorization boundary/i.test(doc),
      req('openwop.it.workflow-chain-internal-flag.the-spec-documents-the-must-omit-from-default-gallery-not-an-authz-boundary-rule', '§Chain visibility', 'documents internal is not an authz boundary'),
    ).toBe(true);
  });
});
