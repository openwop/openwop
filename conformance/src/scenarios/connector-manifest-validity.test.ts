/**
 * connector-manifest-validity — RFC 0045 §A/§B verification.
 *
 * Status: DRAFT. RFC 0045 (connector pack manifest & action model) is `Draft`.
 * The optional `connector` block + `Connector` / `ConnectorAuth` $defs have
 * landed in `schemas/node-pack-manifest.schema.json`.
 *
 * Server-free schema + semantic validation. Two contracts:
 *   1. Schema validity (§A): a well-formed `connector` block validates; a
 *      block missing `id`/`displayName` or an action missing `typeId` is
 *      rejected. Both ConnectorAuth variants (oauth2 / credential) validate.
 *   2. Action resolution (§B): every `connector.actions[].typeId` and
 *      `connector.triggers[]` entry MUST resolve to a `nodes[].typeId` in the
 *      same manifest; an unresolved reference is `connector_action_unresolved`.
 *
 * The Connector subschema is extracted self-contained (Connector + its
 * ConnectorAuth + NodeAuth $defs) so ajv compiles it without resolving the
 * parent manifest's external `agent-manifest.schema.json` $ref.
 *
 * @see RFCS/0045-connector-pack-manifest-action-model.md
 * @see schemas/node-pack-manifest.schema.json §Connector
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

interface SchemaDefs {
  $defs: Record<string, unknown>;
  $schema: string;
}

const manifestSchema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'node-pack-manifest.schema.json'), 'utf8'),
) as SchemaDefs;

// Self-contained Connector schema: root = Connector, carrying the $defs it
// references (ConnectorAuth → NodeAuth). No external $ref resolution needed.
const connectorSchema = {
  $schema: manifestSchema.$schema,
  ...(manifestSchema.$defs.Connector as Record<string, unknown>),
  $defs: {
    ConnectorAuth: manifestSchema.$defs.ConnectorAuth,
    NodeAuth: manifestSchema.$defs.NodeAuth,
  },
};

// §B action/trigger resolution — the semantic check the registry applies
// beyond pure JSON Schema (typeIds must resolve to real nodes).
interface ConnectorAction {
  typeId: string;
}
interface ConnectorBlock {
  actions?: ConnectorAction[];
  triggers?: string[];
}
function unresolvedReferences(nodeTypeIds: string[], connector: ConnectorBlock): string[] {
  const known = new Set(nodeTypeIds);
  const refs = [
    ...(connector.actions ?? []).map((a) => a.typeId),
    ...(connector.triggers ?? []),
  ];
  return refs.filter((t) => !known.has(t));
}

describe('category: connector-manifest validity — schema shape (RFC 0045 §A)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(connectorSchema);

  it('positive: a well-formed connector block (oauth2 auth) validates', () => {
    const ok = validate({
      id: 'salesforce',
      displayName: 'Salesforce',
      auth: { type: 'oauth2', provider: 'salesforce', scopes: ['api'] },
      actions: [
        { typeId: 'vendor.acme.salesforce.upsert', displayName: 'Upsert', idempotent: true, rateLimit: { requests: 100, perSeconds: 60 } },
        { typeId: 'vendor.acme.salesforce.query', displayName: 'Query', paginated: true },
      ],
      triggers: ['vendor.acme.salesforce.onRecordChange'],
    });
    expect(ok, req('openwop.it.connector-manifest-validity.positive-a-well-formed-connector-block-oauth2-auth-validates', 'RFC 0045 §A/§B', JSON.stringify(validate.errors))).toBe(true);
  });

  it('positive: credential-auth variant validates', () => {
    const ok = validate({
      id: 'stripe',
      displayName: 'Stripe',
      auth: { type: 'credential', key: 'stripe-secret-key', scope: 'workspace' },
      actions: [{ typeId: 'vendor.acme.stripe.charge', displayName: 'Charge' }],
    });
    expect(ok, req('openwop.it.connector-manifest-validity.positive-credential-auth-variant-validates', 'RFC 0045 §A/§B', JSON.stringify(validate.errors))).toBe(true);
  });

  it('negative: connector missing displayName is rejected', () => {
    expect(validate({ id: 'salesforce' }), req('openwop.it.connector-manifest-validity.negative-connector-missing-displayname-is-rejected', 'RFC 0045 §A/§B', 'negative: connector missing displayName is rejected')).toBe(false);
  });

  it('negative: an action missing typeId is rejected', () => {
    const ok = validate({
      id: 'salesforce',
      displayName: 'Salesforce',
      actions: [{ displayName: 'Upsert' }],
    });
    expect(ok, req('openwop.it.connector-manifest-validity.negative-an-action-missing-typeid-is-rejected', 'RFC 0045 §A/§B', 'negative: an action missing typeId is rejected')).toBe(false);
  });

  it('negative: an unknown ConnectorAuth type is rejected', () => {
    const ok = validate({
      id: 'salesforce',
      displayName: 'Salesforce',
      auth: { type: 'basic', user: 'x' },
    });
    expect(ok, req('openwop.it.connector-manifest-validity.negative-an-unknown-connectorauth-type-is-rejected', 'RFC 0045 §A/§B', 'negative: an unknown ConnectorAuth type is rejected')).toBe(false);
  });
});

describe('category: connector-manifest validity — action resolution (RFC 0045 §B)', () => {
  const nodeTypeIds = [
    'vendor.acme.salesforce.upsert',
    'vendor.acme.salesforce.query',
    'vendor.acme.salesforce.onRecordChange',
  ];

  it('all action + trigger typeIds resolve to nodes[] in the same manifest', () => {
    const unresolved = unresolvedReferences(nodeTypeIds, {
      actions: [{ typeId: 'vendor.acme.salesforce.upsert' }, { typeId: 'vendor.acme.salesforce.query' }],
      triggers: ['vendor.acme.salesforce.onRecordChange'],
    });
    expect(unresolved, req('openwop.it.connector-manifest-validity.all-action-trigger-typeids-resolve-to-nodes-in-the-same-manifest', 'RFC 0045 §A/§B', 'every connector.actions[].typeId + triggers[] MUST resolve to a nodes[].typeId')).toEqual([]);
  });

  it('an action typeId not in nodes[] is flagged (connector_action_unresolved)', () => {
    const unresolved = unresolvedReferences(nodeTypeIds, {
      actions: [{ typeId: 'vendor.acme.salesforce.does-not-exist' }],
    });
    expect(unresolved, req('openwop.it.connector-manifest-validity.an-action-typeid-not-in-nodes-is-flagged-connector-action-unresolved', 'RFC 0045 §A/§B', 'an action typeId not in nodes[] is flagged (connector_action_unresolved)')).toContain('vendor.acme.salesforce.does-not-exist');
  });
});
