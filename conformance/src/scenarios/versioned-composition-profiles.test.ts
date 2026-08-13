/**
 * RFC 0152 + RFC 0153 — versioned A2A and MCP composition, shape only.
 *
 * **Stated first, because RFC 0147 §A.5 turns on it:** this file proves the
 * discovery schema admits the versioned shapes §A describes and rejects the ones
 * it forbids. It contacts no peer. It is therefore **not** evidence that this
 * host interoperates with any A2A 1.0 or MCP 2026-07-28 implementation, and
 * neither RFC can reach a defensible `Accepted` on it. Both additionally require
 * a real upstream peer in CI, which is not a corpus deliverable.
 *
 * The defect both RFCs address is the same, which is why they land together:
 * **`supported: true` with no version is a claim a peer cannot negotiate
 * against.** It asserts the host speaks *some* A2A or *some* MCP. Two hosts can
 * both advertise it, share no revision, and discover that only when a call
 * fails — and the failure surfaces at the peer, not at the handshake that was
 * supposed to prevent it. Versioning the advertisement moves the disagreement to
 * the one place both sides are looking.
 *
 * Two shape choices worth keeping:
 *
 *   - **MCP versions are date-patterned, not free strings.** MCP revisions *are*
 *     dates. Accepting `latest` or `2026-7-28` would let two hosts disagree
 *     about which revision they share while both validate.
 *   - **The MCP feature list is closed.** An unrecognized feature name is
 *     indistinguishable from a typo, and a peer that silently ignores one has
 *     negotiated a capability neither side implements.
 *
 * Server-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

/**
 * Schemas ship inside the package; RFC prose does not. Deriving both from
 * `V1_DIR` — null in the published tarball — and casting the null away with
 * `as string` is what took this file down at import when installed from npm.
 */
const RFCS_DIR = V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'RFCS');

function caps(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
}

/** Compile one capability family in isolation. */
function familyValidator(family: string) {
  const schema = caps() as { properties: Record<string, object> };
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema.properties[family] as object);
}

describe('RFC 0152 §A — A2A versioned discovery', () => {
  const validate = familyValidator('a2a');

  /**
   * The `a2a` family independently requires `agentCardUrl` (RFC 0100: it must
   * GET-resolve credential-less). Every fixture below carries it.
   *
   * This is not tidiness. Without it the NEGATIVE legs would have failed
   * validation for the missing card URL rather than for the version defect they
   * name — passing for the wrong reason, which is the vacuity this whole
   * program exists to close, committed inside a test written to prevent it.
   */
  const a2a = (over: Record<string, unknown>) => ({
    supported: true,
    agentCardUrl: 'https://host.example/.well-known/agent-card.json',
    ...over,
  });

  it('a versioned advertisement validates', () => {
    expect(
      validate(a2a({
        protocolVersions: ['1.0', '0.3'],
        preferredVersion: '1.0',
        profiles: ['a2a-1.0', 'a2a-0.3-legacy'],
        durableTasks: true,
      })),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('a legacy-only host can say so explicitly', () => {
    // The point of naming the legacy profile: a deprecation you can see is one
    // you can time-bound. A bare `supported: true` hides the same fact.
    expect(
      validate(a2a({ protocolVersions: ['0.3'], preferredVersion: '0.3', profiles: ['a2a-0.3-legacy'] })),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('an empty version list is rejected', () => {
    expect(
      validate(a2a({ protocolVersions: [] })),
      'RFC 0152 §A: an A2A-capable host MUST advertise a NON-EMPTY `protocolVersions`. An empty ' +
        'array is the bare `supported: true` problem wearing a schema — it validates and tells a ' +
        'peer nothing it can negotiate against.',
    ).toBe(false);
  });

  it('duplicate versions are rejected', () => {
    expect(validate(a2a({ protocolVersions: ['1.0', '1.0'] }))).toBe(false);
  });

  it('a malformed version is rejected', () => {
    for (const v of ['1', 'v1.0', 'latest', '1.0.0']) {
      expect(
        validate(a2a({ protocolVersions: [v] })),
        `RFC 0152 §A: '${v}' is not an A2A major.minor version`,
      ).toBe(false);
    }
  });

  it('a malformed profile id is rejected', () => {
    expect(validate(a2a({ protocolVersions: ['1.0'], profiles: ['a2a-latest'] }))).toBe(false);
    expect(validate(a2a({ protocolVersions: ['1.0'], profiles: ['a2a-1.0'] }))).toBe(true);
  });
});

describe('RFC 0153 §A — MCP versioned discovery', () => {
  const validate = familyValidator('mcp');

  it('a versioned advertisement validates', () => {
    expect(
      validate({
        supported: true,
        protocolVersions: ['2026-07-28', '2025-06-18'],
        preferredVersion: '2026-07-28',
        profiles: ['mcp-2026-07-28', 'mcp-2025-06-18-legacy'],
        features: ['server-discover', 'mrtr', 'cacheable-lists', 'extensions'],
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('versions use MCP date form exactly', () => {
    // MCP revisions ARE dates. `latest` or a non-padded month would let two
    // hosts disagree about which revision they share while both validate.
    for (const v of ['latest', '2026-7-28', '2026-07', 'v2026-07-28']) {
      expect(
        validate({ supported: true, protocolVersions: [v] }),
        `RFC 0153 §A: '${v}' is not MCP's date form`,
      ).toBe(false);
    }
    expect(validate({ supported: true, protocolVersions: ['2026-07-28'] })).toBe(true);
  });

  it('the feature list is closed', () => {
    expect(
      validate({ supported: true, protocolVersions: ['2026-07-28'], features: ['server-discover', 'telepathy'] }),
      'RFC 0153 §A: an unrecognized feature name is indistinguishable from a typo, and a peer ' +
        'that silently ignores one has negotiated a capability neither side implements.',
    ).toBe(false);
  });

  it('an empty version list is rejected', () => {
    expect(validate({ supported: true, protocolVersions: [] })).toBe(false);
  });
});

describe.skipIf(RFCS_DIR === null)('RFC 0152 + 0153 — what these do NOT establish', () => {
  it('both RFCs keep their upstream-peer acceptance items unticked and annotated', () => {
    // RFC 0147 §A.5 forbids `Accepted` on shape-only evidence for a behavioral
    // requirement. Schema validity is not interop: nothing here speaks to a
    // peer, and both RFCs require a real upstream implementation in CI. This
    // leg exists so the suite cannot read as more than it is.
    for (const [file, needle] of [
      ['0152-a2a-1-0-versioned-composition.md', 'Real upstream A2A 1.0 peer passes in CI.'],
      ['0153-mcp-2026-07-28-versioned-composition.md', 'Pinned real MCP current peer passes in CI.'],
    ] as const) {
      const rfc = readFileSync(join(RFCS_DIR as string, file), 'utf8');
      expect(
        new RegExp(`- \\[ \\] ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(rfc),
        `${file}: the upstream-peer item MUST remain unticked and annotated — no peer is contacted ` +
          'anywhere in this corpus, and interop is the one thing a schema cannot demonstrate.',
      ).toBe(true);
    }
  });
});
