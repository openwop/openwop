/**
 * v1-webhook-unregister-contract — the `tenantId` the v1 prose requires on
 * unregister is declared by the v1 contract.
 *
 * `spec/v1/webhooks.md` §Unregister: "`tenantId` query parameter is required
 * (the route is not path-nested under workspaces)". `api/openapi.yaml`
 * `unregisterWebhook` declared only the path parameter, so a client generated
 * from the contract omitted the one argument the prose makes required — the
 * mirror image of the rotate-secret route openwop#1512 added, whose own
 * `tenantId` description read "Required, exactly as on `unregisterWebhook`"
 * while `unregisterWebhook` declared no such thing.
 *
 * Like `v1-webhook-rotation-contract`, this leg starts from the PROSE and
 * asserts the contract answers it. The v2 twin carries the tenant inside the
 * tenant-bound `webhookId` (`identity.md` §5), so the v2 contract must NOT
 * grow the v1 query parameter — asserted too, because `derive-v2-api.py`
 * derives v2 from v1 and would otherwise copy it across.
 *
 * Server-free: reads `spec/v1/webhooks.md`, `api/openapi.yaml` and
 * `api/v2/openapi.yaml` on disk; no host is contacted. Runs in the spec repo's
 * corpus gate (`scripts/check-spec-coherence.mjs`), never in a host bundle.
 *
 * @see spec/v1/webhooks.md §Unregister
 * @see api/openapi.yaml `unregisterWebhook`
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

export const HOST_CALLBACK_NOT_REQUIRED =
  'server-free: compares the v1 prose against the v1 and v2 OpenAPI contracts on disk; no host is contacted';

const ID = 'openwop.requirement.webhooks.v1-unregister-tenantid-in-contract';
const V2_ID = 'openwop.requirement.webhooks.v2-unregister-no-tenantid-query';
const SECTION = 'spec/v1/webhooks.md §Unregister';

/** The `  <pathKey>:` block of a contract, up to the next path key — text-scanned, as the sibling legs do. */
function pathBlock(raw: string, pathKey: string): string | null {
  const start = raw.indexOf(`\n  ${pathKey}:\n`);
  if (start < 0) return null;
  const rest = raw.slice(start + 1);
  const next = /^(?: {2}\/|[a-zA-Z])/m.exec(rest.slice(rest.indexOf('\n') + 1));
  return next === null ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next.index);
}

/** The `delete:` operation inside a path block, up to the next sibling method. */
function deleteOp(block: string): string | null {
  const m = /^( +)delete:\n/m.exec(block);
  if (m === null) return null;
  const indent = m[1]!.length;
  const rest = block.slice(m.index + m[0].length);
  const end = new RegExp(`^ {${indent}}[a-z]+:`, 'm').exec(rest);
  return end === null ? rest : rest.slice(0, end.index);
}

/** True when the operation declares a `tenantId` query parameter that is required. */
function requiresTenantIdQuery(op: string): boolean {
  // Parameters are list items; find the item naming tenantId and read its own lines.
  const items = op.split(/\n\s*- /);
  return items.some((it) => /\bin:\s*query\b/.test(it) && /\bname:\s*tenantId\b/.test(it) && /\brequired:\s*true\b/.test(it));
}

describe('v1-webhook-unregister-contract (spec/v1/webhooks.md §Unregister)', () => {
  it('the tenantId the v1 prose requires on unregister is a required query parameter of api/openapi.yaml unregisterWebhook', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout — the v1 prose dir is absent (published tarball layout)');

    const prose = readFileSync(join(V1_DIR, 'webhooks.md'), 'utf8');
    expect(
      prose,
      req(ID, SECTION, 'spec/v1/webhooks.md §Unregister MUST still require the tenantId query parameter — this leg is only meaningful while it does'),
    ).toMatch(/`tenantId` query parameter is required/);

    const block = pathBlock(readFileSync(join(API_DIR, 'openapi.yaml'), 'utf8'), '/v1/webhooks/{webhookId}');
    const op = block === null ? null : deleteOp(block);
    expect(op, req(ID, SECTION, 'api/openapi.yaml MUST define DELETE /v1/webhooks/{webhookId}')).not.toBeNull();
    expect(op ?? '', req(ID, SECTION, 'the v1 operation is unregisterWebhook')).toMatch(/operationId:\s*unregisterWebhook\b/);
    expect(
      requiresTenantIdQuery(op ?? ''),
      req(ID, SECTION, 'unregisterWebhook MUST declare `tenantId` as a REQUIRED query parameter — the prose requires it, and a client generated from a contract that omits it cannot issue a conforming request'),
    ).toBe(true);
  });

  it('the v2 twin carries the tenant in its id and does not grow the v1 query parameter', () => {
    const block = pathBlock(readFileSync(join(API_DIR, 'v2', 'openapi.yaml'), 'utf8'), '/webhooks/{webhookId}');
    const op = block === null ? null : deleteOp(block);
    expect(op, req(V2_ID, 'api/v2/openapi.yaml unregisterWebhook', 'api/v2/openapi.yaml MUST define DELETE /webhooks/{webhookId}')).not.toBeNull();
    expect(
      /name:\s*tenantId\b/.test(op ?? ''),
      req(V2_ID, 'identity.md §5 (RFC 0187 §A.1)', 'the v2 unregisterWebhook MUST NOT declare a tenantId parameter — v2 carries the tenant inside the tenant-bound webhookId, and a second tenant source could disagree with it'),
    ).toBe(false);
  });
});
