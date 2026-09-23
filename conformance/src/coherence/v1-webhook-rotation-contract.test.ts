/**
 * v1-webhook-rotation-contract — the v1 route the v1 prose mandates is in the
 * v1 contract.
 *
 * RFC 0201 §E.18 makes one route normative for any host advertising
 * `capabilities.webhooks.secretRotation`: at v2
 * `POST /webhooks/{webhookId}/rotate-secret`, and at v1
 * `POST /v1/webhooks/{webhookId}/rotate-secret?tenantId=…`. The RFC's own
 * §Affects row names BOTH `api/openapi.yaml` and `api/v2/openapi.yaml`.
 *
 * Only the v2 half landed. For two releases `spec/v1/webhooks.md` and
 * `spec/v1/capabilities.md` told a v1 host it MUST serve a route that
 * `api/openapi.yaml` did not define — so no generated client could issue it,
 * and no gate said a word. `check-path-parity` compares the contract against
 * the manifest and AsyncAPI; `check-openapi-security` compares it against
 * `rest-endpoints.md`; `spec-corpus-validity` compares it against
 * `coverage.md`. Every one of them starts from the contract, so an operation
 * the contract never had was invisible to all three: they agreed about a route
 * none of them contained.
 *
 * This leg starts from the PROSE instead. It reads the normative sentence, and
 * asserts the contract answers it — path, operationId, scopes, the three
 * refusals the prose enumerates, and the response that carries no secret.
 *
 * Server-free: reads `spec/v1/webhooks.md` and `api/openapi.yaml` on disk, no
 * host is contacted. Runs in the spec repo's corpus gate
 * (`scripts/check-spec-coherence.mjs`), never in a host bundle.
 *
 * @see RFCS/0201-standard-webhooks-signature-scheme.md §E.18
 * @see spec/v1/webhooks.md §"Standard Webhooks companion scheme" → Rotation
 * @see api/openapi.yaml `rotateWebhookSecret`
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

export const HOST_CALLBACK_NOT_REQUIRED =
  'server-free: compares the v1 prose against the v1 OpenAPI contract on disk; no host is contacted';

const ID = 'openwop.requirement.0201.v1-rotation-route-in-contract';
const SECTION = 'RFC 0201 §E.18 / spec/v1/webhooks.md §"Standard Webhooks companion scheme"';
/** A second `it` in one file may not reuse the first id (check-req-only, openwop#1367). */
const SHAPE_ID = 'openwop.requirement.0201.v1-rotation-response-carries-no-secret';

const PATH_KEY = '/v1/webhooks/{webhookId}/rotate-secret';

/** The `  <pathKey>:` block of the v1 contract, up to the next path key or the
 *  end of the `paths:` section. Text-scanned like the other corpus legs — the
 *  conformance package deliberately carries no YAML parser. */
function pathBlock(raw: string, pathKey: string): string | null {
  const start = raw.indexOf(`\n  ${pathKey}:\n`);
  if (start < 0) return null;
  const rest = raw.slice(start + 1);
  const next = /^(?: {2}\/|[a-zA-Z])/m.exec(rest.slice(rest.indexOf('\n') + 1));
  return next === null ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next.index);
}

describe('v1-webhook-rotation-contract (RFC 0201 §E.18)', () => {
  it('the v1 rotation route the prose mandates is an api/openapi.yaml operation with the scopes and refusals the prose names', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout — the v1 prose dir is absent (published tarball layout)');

    // 1. The prose still mandates the route. If this sentence is ever removed,
    //    this leg must fail loudly rather than quietly stop meaning anything.
    const prose = readFileSync(join(V1_DIR, 'webhooks.md'), 'utf8');
    expect(
      prose,
      req(ID, SECTION, 'spec/v1/webhooks.md §Rotation MUST still mandate `POST /v1/webhooks/{webhookId}/rotate-secret` — this leg is only meaningful while it does'),
    ).toContain('POST /v1/webhooks/{webhookId}/rotate-secret');

    // 2. The contract answers it.
    const raw = readFileSync(join(API_DIR, 'openapi.yaml'), 'utf8');
    const block = pathBlock(raw, PATH_KEY);
    expect(
      block,
      req(ID, SECTION, `api/openapi.yaml MUST define \`${PATH_KEY}\` — the v1 prose makes it normative for a host advertising \`webhooks.secretRotation\`, and a route only the prose knows cannot be generated, typed or called`),
    ).not.toBeNull();
    const op = block ?? '';
    expect(op, req(ID, SECTION, `${PATH_KEY} MUST be a POST`)).toMatch(/^ {4}post:$/m);
    expect(op, req(ID, SECTION, 'the v1 operation MUST carry the same operationId as its v2 twin, so one SDK surface spans both majors')).toMatch(/^ {6}operationId:\s*rotateWebhookSecret\s*$/m);

    // 3. The scopes RFC 0200 declared for v1 operations: the three alternatives,
    //    each carrying `webhooks:manage` — the scope `unregisterWebhook` enforces.
    for (const scheme of ['ApiKeyAuth', 'OAuth2', 'OpenIdConnect']) {
      expect(
        op,
        req(ID, SECTION, `${scheme} MUST require \`webhooks:manage\` on the rotation operation (RFC 0200 §F.2 — a caller on any lane needs the same scope)`),
      ).toMatch(new RegExp(`^ {8}- ${scheme}: \\['webhooks:manage'\\]$`, 'm'));
    }

    // 4. The three refusals the prose enumerates: `400 validation_error` for a
    //    subscription that did not opt in, `403` for a non-member, `404` for an
    //    unknown subscription AND for a host that does not advertise the facet.
    for (const status of ['400', '401', '403', '404']) {
      expect(
        op,
        req(ID, SECTION, `the rotation operation MUST declare a \`${status}\` response — the prose enumerates 400 (not opted in), 403 (not a tenant member) and 404 (unknown, or facet not advertised)`),
      ).toMatch(new RegExp(`^ {8}'${status}':`, 'm'));
    }
  });

  it('the v1 rotation request takes the new secret and the response returns none', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout — the v1 prose dir is absent (published tarball layout)');
    const raw = readFileSync(join(API_DIR, 'openapi.yaml'), 'utf8');
    const op = pathBlock(raw, PATH_KEY);
    expect(op, req(SHAPE_ID, SECTION, `api/openapi.yaml MUST define \`${PATH_KEY}\``)).not.toBeNull();
    const body = op ?? '';

    // The request carries the NEW secret in the §B.6 `whsec_<base64>` form.
    expect(body, req(SHAPE_ID, SECTION, 'the rotation request MUST require `secret`')).toMatch(/required:\s*\[secret\]/);
    expect(body, req(SHAPE_ID, SECTION, 'the new secret MUST be constrained to the RFC 0201 §B.6 `whsec_<base64>` form')).toContain('whsec_');

    // The 200 returns the overlap window and NOTHING ELSE. `secret` appearing
    // in the response half would re-leak a value the host is never allowed to
    // echo (`spec/v1/webhooks.md`: the secret is returned ONCE, at registration).
    const responses = body.slice(body.indexOf('\n      responses:'));
    const ok = responses.slice(0, responses.indexOf("\n        '400'"));
    expect(ok, req(SHAPE_ID, SECTION, 'the 200 MUST return `rotatedAt`')).toContain('rotatedAt');
    expect(ok, req(SHAPE_ID, SECTION, 'the 200 MUST return `previousSecretExpiresAt` — a rotation whose overlap end the caller cannot read is not zero-downtime')).toContain('previousSecretExpiresAt');
    expect(
      /\bsecret\b/.test(ok.replace(/previousSecretExpiresAt|No secret is returned/g, '')),
      req(SHAPE_ID, SECTION, 'the rotation 200 MUST NOT carry a `secret` property — the caller already holds the new one, and echoing it re-leaks a value the host issues once'),
    ).toBe(false);
    expect(ok, req(SHAPE_ID, SECTION, 'the 200 body MUST be closed (`additionalProperties: false`) so a secret cannot be smuggled back in a later edit')).toContain('additionalProperties: false');
  });
});
