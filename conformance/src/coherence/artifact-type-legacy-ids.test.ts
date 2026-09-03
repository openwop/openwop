/**
 * artifact-type-legacy-ids — RFC 0141, legacy identifiers and the replay
 * migration constraint.
 *
 * Hosts predating RFC 0071 carry artifact-type ids outside the canonical
 * reverse-DNS pattern (`doc.one-pager`, `canvas.checklist`). The corpus never
 * said what those values are or how a host may migrate — and the constraint
 * that matters (an identifier migration MUST NOT rewrite the run-event log)
 * was only derivable by composing THREE documents. It got mis-derived once,
 * in a merged RFC, before being corrected (RFC 0138, 2026-08-07). RFC 0141
 * states the composed conclusion in one normative place; these legs pin it.
 *
 * PROSE-PINNING, always-on, server-free (the RFC 0138 part-3 pattern): the
 * schema cannot express "MUST NOT rewrite history", so the corpus stating the
 * rule IS the testable surface. Leg 1 anchors the prose to the schema pattern
 * it interprets, so the two cannot drift apart silently.
 *
 * WHAT THIS DOES NOT COVER — stated, not discovered later:
 *  - No leg exercises a HOST's alias behavior. That a host resolves aliases in
 *    validation is witnessed at openwop-app by its own sabotage-verified tests
 *    (openwop-app#3030), not by this suite.
 *  - No leg can detect a host that rewrote its log — a rewritten log is
 *    indistinguishable from an honest one after the fact. The prohibition is
 *    enforceable only by the host's own replay integrity.
 *
 * @see spec/v1/artifact-type-packs.md §"Legacy identifiers and migration"
 * @see RFCS/0141-legacy-artifact-type-identifiers.md
 * @see spec/v1/replay.md §"Determinism guarantees"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

describe('artifact-type-legacy-ids: the canonical pattern is the anchor (RFC 0141, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'artifact-type-pack-manifest.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  const validate = ajv.compile(schema);
  const pack = (artifactTypeId: string): Record<string, unknown> => ({
    name: 'community.openwop.legacy-probe',
    version: '1.0.0',
    kind: 'artifact-type',
    engines: { openwop: '>=1.1.0 <2.0.0' },
    artifactTypes: [{ artifactTypeId, schemaRef: 'schemas/x.json' }],
  });

  it('leg 1a — a bare legacy id (`doc.one-pager`) is REJECTED by the manifest schema', () => {
    expect(
      validate(pack('doc.one-pager')),
      req('openwop.it.artifact-type-legacy-ids.leg-1a-a-bare-legacy-id-doc-one-pager-is-rejected-by-the-manifest-schema', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'the canonical pattern is definitional, not aspirational — a legacy spelling has never been a conformant published identifier'),
    ).toBe(false);
  });

  it('leg 1b — a canonical id still validates (the anchor is not over-tight)', () => {
    expect(
      validate(pack('community.openwop.doc.one-pager')),
      req('openwop.it.artifact-type-legacy-ids.leg-1b-a-canonical-id-still-validates-the-anchor-is-not-over-tight', 'artifact-type-packs.md §"The `ArtifactType` declaration"', 'the reverse-DNS form the migration targets is accepted'),
    ).toBe(true);
  });
});

describe('artifact-type-legacy-ids: the corpus states the migration rules normatively (RFC 0141)', () => {
  const doc = V1_DIR ? readFileSync(join(V1_DIR, 'artifact-type-packs.md'), 'utf8') : '';

  it.skipIf(V1_DIR === null)('leg 2 — never wire-conformant, no grandfather clause, no obligation to migrate', () => {
    expect(
      /never\W{0,4}\s*wire-conformant/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-2-never-wire-conformant-no-grandfather-clause-no-obligation-to-migrate', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'legacy identifiers were NEVER wire-conformant — status is stated, not implied'),
    ).toBe(true);
    expect(
      /no grandfather clause/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-2-never-wire-conformant-no-grandfather-clause-no-obligation-to-migrate', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'no grandfather clause exists or is implied'),
    ).toBe(true);
    expect(
      /no obligation to migrate/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-2-never-wire-conformant-no-grandfather-clause-no-obligation-to-migrate', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'the unregistered tier is a legitimate permanent home — migration is optional'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('leg 3 — a migrating host MUST NOT rewrite historical event-carried identifiers, tied to replay', () => {
    expect(
      /MUST NOT\W{0,4}\s*rewrite historical\W{0,4}\s*`artifact\.created\.artifactType`/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-3-a-migrating-host-must-not-rewrite-historical-event-carried-identifiers-tie', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'the rewrite prohibition is normative, naming the event field — not derivable-only across three documents'),
    ).toBe(true);
    expect(
      /replay\.md.{0,80}fixed history|fixed history.{0,120}replay/is.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-3-a-migrating-host-must-not-rewrite-historical-event-carried-identifiers-tie', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'the prohibition is tied to replay.md fixed-history semantics, so the derivation travels with the rule'),
    ).toBe(true);
    expect(
      /silently demoting a typed artifact|silently demot/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-3-a-migrating-host-must-not-rewrite-historical-event-carried-identifiers-tie', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'the silent-demotion failure mode is named — the reason a rewrite is worse than the non-conformant name'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('leg 4 — the alias is permanent and MUST resolve where validation is decided', () => {
    expect(
      /permanent, not transitional/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-4-the-alias-is-permanent-and-must-resolve-where-validation-is-decided', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'immutable history makes the alias permanent — a host planning to delete it later has misunderstood the constraint'),
    ).toBe(true);
    expect(
      /everywhere registration is decided\W{0,4}\s*schema validation included/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-4-the-alias-is-permanent-and-must-resolve-where-validation-is-decided', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'aliasing lookup but not validation silently demotes typed artifacts behind a green result — the MUST covers validation by name'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('leg 5 — an alias map is a host shim, NOT a conformance claim', () => {
    expect(
      /compatibility shim\W{0,4}\s*not a conformance claim/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-5-an-alias-map-is-a-host-shim-not-a-conformance-claim', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'a host serving legacy ids through an alias is not "conformant under its old names"'),
    ).toBe(true);
    expect(
      /MUST NOT\W{0,4}\s*advertise or imply otherwise/i.test(doc),
      req('openwop.it.artifact-type-legacy-ids.leg-5-an-alias-map-is-a-host-shim-not-a-conformance-claim', 'artifact-type-packs.md §"Legacy identifiers and migration"', 'the shim MUST NOT be advertised as conformance'),
    ).toBe(true);
  });
});
