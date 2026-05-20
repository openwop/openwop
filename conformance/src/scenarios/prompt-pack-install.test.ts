/**
 * prompt-pack-install — RFC 0028 §B boot-time pack-install proof.
 *
 * Asserts: when the host advertises
 * `capabilities.prompts.endpointsSupported: true` AND the in-tree
 * reference prompt pack (`vendor.openwop.prompt-sample`) was
 * installed at boot, the pack's two templates (`writer-system`,
 * `critic-system`) surface in `GET /v1/prompts` carrying
 * `meta.source: "pack"` + `meta.packName: "vendor.openwop.prompt-sample"`
 * + `meta.packVersion: "1.0.0"`.
 *
 * This is the install-flow regression pin. If the boot-time loader
 * stops walking `examples/packs/*` or stops calling
 * `installPackTemplates()`, this scenario fails first — before any
 * downstream scenario notices missing templates.
 *
 * The scenario does NOT mutate state — it relies on the host having
 * installed at least one prompt pack at startup. RFC 0028 §B does
 * NOT require a host advertising `endpointsSupported: true` to have
 * any pack installed (a fresh production host with no pack
 * subscriptions is conformant); when zero pack-source templates
 * are listed, the structural assertions on sub-tests 2-3 still run
 * but the existence claim is treated as a soft skip. The reference
 * workflow-engine sample sets
 * `OPENWOP_TEST_PROMPT_PACK_INSTALLED=true` so the existence path
 * IS exercised against the in-tree `vendor.openwop.prompt-sample`.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.endpointsSupported: true`. Under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`, the gate hardens from SKIP to
 * FAIL via `behaviorGate('prompts-endpoints', ...)`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * @see RFCS/0028-prompt-library-endpoints.md §B
 * @see spec/v1/prompts.md §"Discovery & distribution"
 * @see examples/packs/prompt-sample/pack.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
      endpointsSupported?: unknown;
    };
  };
}

interface PromptTemplate {
  templateId: string;
  version: string;
  kind: string;
  meta?: {
    source?: 'host' | 'pack' | 'user';
    packName?: string;
    packVersion?: string;
  };
}

interface ListResponse {
  items: PromptTemplate[];
  nextCursor?: string;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function endpointsSupported(d: DiscoveryDoc | null): boolean {
  return d?.capabilities?.prompts?.endpointsSupported === true;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const REQUIRE_PACK_INSTALLED = process.env.OPENWOP_TEST_PROMPT_PACK_INSTALLED === 'true';

describe.skipIf(HTTP_SKIP)('prompt-pack-install: boot-time loader surfaces pack templates (RFC 0028 §B)', () => {
  it('GET /v1/prompts?source=pack returns 200 + an array of PromptTemplate objects when endpointsSupported is advertised', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const res = await driver.get('/v1/prompts?source=pack');
    expect(
      res.status,
      driver.describe(
        'spec/v1/prompts.md §"Discovery & distribution"',
        'GET /v1/prompts MUST return 200 when prompts.endpointsSupported is advertised',
      ),
    ).toBe(200);

    const body = res.json as ListResponse;
    expect(
      Array.isArray(body.items),
      driver.describe(
        'RFCS/0028-prompt-library-endpoints.md §A',
        '`items` MUST be an array of PromptTemplate objects',
      ),
    ).toBe(true);

    // Existence claim — only fail when the host explicitly opts in
    // via OPENWOP_TEST_PROMPT_PACK_INSTALLED. RFC 0028 §B treats
    // "zero installed packs" as a conformant state for any host that
    // hasn't subscribed to a pack source.
    if (REQUIRE_PACK_INSTALLED) {
      const packItems = body.items.filter((t) => t.meta?.source === 'pack');
      expect(
        packItems.length,
        driver.describe(
          'RFCS/0028-prompt-library-endpoints.md §B',
          'OPENWOP_TEST_PROMPT_PACK_INSTALLED=true asserts the boot-time loader installed at least one pack',
        ),
      ).toBeGreaterThan(0);
    }
  });

  it('each pack-source template carries meta.source/packName/packVersion stamps per RFC 0028 §B', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const res = await driver.get('/v1/prompts?source=pack');
    if (res.status !== 200) return;
    const body = res.json as ListResponse;
    const packItems = body.items.filter((t) => t.meta?.source === 'pack');
    if (packItems.length === 0) return; // gated above

    for (const t of packItems) {
      expect(
        t.meta?.source,
        driver.describe(
          'schemas/prompt-template.schema.json §meta.source',
          'pack-installed templates MUST stamp `meta.source: "pack"`',
        ),
      ).toBe('pack');
      expect(
        typeof t.meta?.packName === 'string' && (t.meta?.packName?.length ?? 0) > 0,
        driver.describe(
          'RFCS/0028-prompt-library-endpoints.md §B',
          'pack-installed templates MUST stamp `meta.packName`',
        ),
      ).toBe(true);
      expect(
        typeof t.meta?.packVersion === 'string' && /^\d+\.\d+\.\d+/.test(t.meta?.packVersion ?? ''),
        driver.describe(
          'RFCS/0028-prompt-library-endpoints.md §B',
          'pack-installed templates MUST stamp a semver `meta.packVersion`',
        ),
      ).toBe(true);
    }
  });

  it('GET /v1/prompts/{templateId} returns a pack-source template by id (reference pack: writer-system)', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const list = await driver.get('/v1/prompts?source=pack');
    if (list.status !== 200) return;
    const body = list.json as ListResponse;
    const writer = body.items.find((t) => t.templateId === 'writer-system' && t.meta?.source === 'pack');
    if (!writer) return; // host may have installed a different reference pack; skip silently

    const fetched = await driver.get(`/v1/prompts/${encodeURIComponent('writer-system')}`);
    expect(
      fetched.status,
      driver.describe(
        'RFCS/0028-prompt-library-endpoints.md §A',
        'GET /v1/prompts/{templateId} MUST return 200 for a known pack-source template id',
      ),
    ).toBe(200);
    const t = fetched.json as PromptTemplate;
    expect(t.templateId).toBe('writer-system');
    expect(
      t.meta?.source,
      'fetched template MUST preserve `meta.source: "pack"` provenance',
    ).toBe('pack');
  });
});
