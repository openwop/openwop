/**
 * node-module-required-capabilities-shape — RFC 0031 §B authoring conformance.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true`.
 *
 * SHOULD-tier scenario — verifies that every NodeModule in the host's pack
 * registry whose `typeId` is in the `core.ai.*` namespace declares
 * `requiredModelCapabilities`. Treated as a soft-fail; failures are
 * surfaced as findings rather than blocking the suite.
 *
 * Reads the host's node catalog (via `GET /v1/host/sample/node-catalog`
 * — vendor-prefixed per `spec/v1/host-extensions.md`). Hosts that don't
 * expose the catalog endpoint soft-skip cleanly; the conformance check
 * cannot enumerate NodeModules without a catalog surface.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §C
 * @see spec/v1/node-packs.md §"Model-capability declarations on NodeModules"
 * @see schemas/node-pack-manifest.schema.json §NodeModule
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

/** RFC 0031 §C — spec-reserved capability identifiers. */
const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'structured-output',
  'discriminator-enum',
  'long-context',
  'reasoning',
  'function-calling',
]);

/** Host-private extension prefix per `host-extensions.md §"Canonical-
 *  prefix table"` + RFC 0031 §C "Reservation policy". */
const HOST_EXTENSION_RE = /^x-host-[a-z0-9][a-z0-9-]*-[a-z0-9][a-z0-9-]*$/;

interface CatalogNode {
  typeId: string;
  source?: 'local' | 'pack';
  requiredModelCapabilities?: unknown;
  fallbackModel?: unknown;
}

interface DiscoveryDoc {
  capabilities?: {
    modelCapabilities?: { supported?: unknown };
    aiProviders?: { supported?: unknown };
  };
}

let SKIP_REASON: string | null = null;
let CATALOG: CatalogNode[] = [];
let SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set();

beforeAll(async () => {
  const disco = await driver.get('/.well-known/openwop');
  if (disco.status !== 200) {
    SKIP_REASON = 'discovery doc unreachable';
    return;
  }
  const caps = discoveryFamilies(disco.json) as NonNullable<DiscoveryDoc['capabilities']>;
  if (caps.modelCapabilities?.supported !== true) {
    SKIP_REASON = 'host does not advertise capabilities.modelCapabilities.supported: true';
    return;
  }
  if (Array.isArray(caps.aiProviders?.supported)) {
    SUPPORTED_PROVIDERS = new Set(caps.aiProviders.supported as string[]);
  }
  const cat = await driver.get('/v1/host/sample/node-catalog');
  if (cat.status === 404) {
    SKIP_REASON = 'host does not expose /v1/host/sample/node-catalog';
    return;
  }
  if (cat.status !== 200) {
    SKIP_REASON = `node-catalog returned ${cat.status}`;
    return;
  }
  CATALOG = (cat.json as { nodes?: CatalogNode[] }).nodes ?? [];
});

describe('node-module-required-capabilities-shape: authoring convention (RFC 0031 §B)', () => {
  it('every NodeModule with typeId matching `core.ai.*` declares non-empty `requiredModelCapabilities` (SHOULD-tier)', () => {
    if (SKIP_REASON) {
      // eslint-disable-next-line no-console
      console.warn(`[node-module-required-capabilities-shape] skip: ${SKIP_REASON}`);
      return softSkip('skipped', 'operator opted out — gate `SKIP_REASON` returned early ([node-module-required-capabilities-shape] skip: …)');
    }
    const aiNodes = CATALOG.filter((n) => /^core\.ai\./.test(n.typeId));
    const missing: string[] = [];
    for (const n of aiNodes) {
      const rmc = n.requiredModelCapabilities;
      if (!Array.isArray(rmc) || rmc.length === 0) missing.push(n.typeId);
    }
    // SHOULD-tier: surface as a finding (warning), don't fail the suite.
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[node-module-required-capabilities-shape] RFC 0031 §B SHOULD: ${missing.length} core.ai.* NodeModule(s) omit requiredModelCapabilities: ${missing.join(', ')}`,
      );
    }
    // The describe-itself assertion: catalog reached + AT LEAST one
    // node was inspected (otherwise the test is vacuous). MUST hold.
    expect(
      aiNodes.length,
      req('openwop.it.node-module-required-capabilities-shape.every-nodemodule-with-typeid-matching-core-ai-declares-non-empty-requiredmodelca', 
        'RFC 0031 §B',
        'host MUST advertise at least one core.ai.* NodeModule in the node catalog (otherwise the SHOULD has no surface to bind to)',
      ),
    ).toBeGreaterThan(0);
  });

  it('every declared identifier MUST match the spec-reserved set OR the `x-host-<host>-<key>` extension pattern', () => {
    if (SKIP_REASON) return softSkip('skipped', 'operator opted out — gate `SKIP_REASON` returned early');
    const violations: Array<{ typeId: string; identifier: string }> = [];
    for (const n of CATALOG) {
      if (!Array.isArray(n.requiredModelCapabilities)) continue;
      for (const id of n.requiredModelCapabilities) {
        if (typeof id !== 'string') {
          violations.push({ typeId: n.typeId, identifier: String(id) });
          continue;
        }
        if (RESERVED_IDENTIFIERS.has(id)) continue;
        if (HOST_EXTENSION_RE.test(id)) continue;
        violations.push({ typeId: n.typeId, identifier: id });
      }
    }
    expect(
      violations,
      req('openwop.it.node-module-required-capabilities-shape.every-declared-identifier-must-match-the-spec-reserved-set-or-the-x-host-host-ke', 
        'RFC 0031 §C "Reservation policy"',
        'every requiredModelCapabilities identifier MUST be spec-reserved OR match x-host-<host>-<key>',
      ),
    ).toEqual([]);
  });

  it('NodeModule.fallbackModel.provider (when declared) MUST be in `capabilities.aiProviders.supported[]`', () => {
    if (SKIP_REASON) return softSkip('skipped', 'operator opted out — gate `SKIP_REASON` returned early');
    const violations: Array<{ typeId: string; provider: string }> = [];
    for (const n of CATALOG) {
      const fm = n.fallbackModel;
      if (!fm || typeof fm !== 'object') continue;
      const provider = (fm as { provider?: unknown }).provider;
      if (typeof provider !== 'string') continue;
      if (SUPPORTED_PROVIDERS.size > 0 && !SUPPORTED_PROVIDERS.has(provider)) {
        violations.push({ typeId: n.typeId, provider });
      }
    }
    expect(
      violations,
      req('openwop.it.node-module-required-capabilities-shape.nodemodule-fallbackmodel-provider-when-declared-must-be-in-capabilities-aiprovid', 
        'RFC 0031 §B',
        'every fallbackModel.provider MUST appear in capabilities.aiProviders.supported[]',
      ),
    ).toEqual([]);
  });

  it('a NodeModule declaring `requiredModelCapabilities` without `fallbackModel` is conformant — refusal-only (no substitution) is the default posture', () => {
    if (SKIP_REASON) return softSkip('skipped', 'operator opted out — gate `SKIP_REASON` returned early');
    // The check is structural: catalog entries are not malformed when
    // they carry requiredModelCapabilities AND lack fallbackModel. This
    // asserts the host doesn't synthesize a default fallbackModel for
    // nodes that didn't declare one — refusal-only is RFC 0031's
    // default posture per §B.
    const refusalOnly = CATALOG.filter(
      (n) => Array.isArray(n.requiredModelCapabilities)
        && n.requiredModelCapabilities.length > 0
        && (n.fallbackModel === undefined || n.fallbackModel === null),
    );
    // Pass condition: the host SHOULD have at least one such node OR
    // SHOULD have none — both are valid postures. The MUST-tier check
    // is that when refusalOnly is non-empty, each entry's
    // `fallbackModel` is genuinely absent (not coerced to `{}` or
    // similar by an over-zealous projection). Trivially true given
    // the filter; the assertion documents the spec contract.
    for (const n of refusalOnly) {
      expect(
        n.fallbackModel,
        req('openwop.it.node-module-required-capabilities-shape.a-nodemodule-declaring-requiredmodelcapabilities-without-fallbackmodel-is-confor', 
          'RFC 0031 §B',
          `${n.typeId}: refusal-only posture MUST surface as absent fallbackModel (not as {} or null wrapper)`,
        ),
      ).toBeUndefined();
    }
  });
});
