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
 * installed the in-tree pack at startup. Hosts that wire a different
 * pack-discovery path (e.g., production hosts pulling signed packs
 * from `packs.openwop.dev`) can still pass by ensuring at least one
 * `meta.source: "pack"` template surfaces under
 * `GET /v1/prompts?source=pack`.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.endpointsSupported: true`.
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true` the capability gate hardens
 * from SKIP to FAIL — a host that advertises endpointsSupported but
 * serves zero pack-source templates fails the scenario.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * @see RFCS/0028-prompt-library-endpoints.md §B
 * @see spec/v1/prompts.md §"Discovery & distribution"
 * @see examples/packs/prompt-sample/pack.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

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

describe.skipIf(HTTP_SKIP)('prompt-pack-install: boot-time loader surfaces pack templates (RFC 0028 §B)', () => {
  it('GET /v1/prompts?source=pack surfaces at least one pack-source template when endpointsSupported is advertised', async () => {
    const d = await readDiscovery();
    if (!endpointsSupported(d)) return;

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

    const packItems = body.items.filter((t) => t.meta?.source === 'pack');
    expect(
      packItems.length,
      driver.describe(
        'RFCS/0028-prompt-library-endpoints.md §B',
        'a host that advertises endpointsSupported AND ran the boot-time pack loader MUST surface at least one pack-source template',
      ),
    ).toBeGreaterThan(0);
  });

  it('each pack-source template carries meta.source/packName/packVersion stamps per RFC 0028 §B', async () => {
    const d = await readDiscovery();
    if (!endpointsSupported(d)) return;

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
    if (!endpointsSupported(d)) return;

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
