/**
 * `spec/v2/core/versioning.md` §1.4 + `errors.md` — a malformed JSON body on a
 * major-2 POST is answered by the HOST: `400`, the error envelope, and the
 * `OpenWOP-Version` header (suite 2.0.0, target major 2; unaided; creates
 * nothing).
 *
 * §1.4: "A response on any path MUST carry `OpenWOP-Version`". The response
 * most likely to escape that rule is the one a framework produces before the
 * host's own middleware runs. Measured on a tier-2 host's public origin on
 * 2026-09-05: `POST /runs` with body `{` answered `400 text/html` with no
 * header under BOTH majors — Express's JSON parser was mounted before
 * negotiation, and its error left the middleware chain for the default HTML
 * handler. Every well-formed request on that host carried the header; only
 * the malformed one did not, which is exactly the request a scenario never
 * sends by accident. The host suggested this probe: "`POST /runs` with `{` is
 * cheaper than any run."
 *
 * The same probe distinguishes a host from the hosting layer in front of it: a
 * fallback that answers `200 text/html` to everything fails here too.
 *
 * @see spec/v2/core/versioning.md §1.4
 * @see spec/v2/core/errors.md
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0172.malformed-body-envelope';
const DOC = 'spec/v2/core/versioning.md §1.4';

interface Answer { readonly status: number; readonly version: string | null; readonly contentType: string; readonly body: unknown; readonly text: string }

async function postMalformed(path: string): Promise<Answer | null> {
  const { baseUrl, apiKey } = loadEnv();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'OpenWOP-Version': '2.0' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: '{' });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, version: res.headers.get('openwop-version'), contentType: res.headers.get('content-type') ?? '', body, text };
  } catch {
    return null;
  }
}

describe('v2 malformed-body-envelope (versioning.md §1.4; errors.md)', () => {
  for (const path of ['/runs', '/webhooks']) {
    it(`POST ${path} with a malformed JSON body is answered by the host: 400, the error envelope, OpenWOP-Version`, async () => {
      try { if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable'); } catch { return softSkip('blocked', 'v2 discovery unreachable'); }
      const a = await postMalformed(path);
      if (a === null) return softSkip('blocked', `POST ${path} unreachable (fetch failed)`);
      if (a.status === 404 && a.version !== null) return softSkip('inapplicable', `${path} is not mounted on this host (404 with the header — a host answer, not a fallback)`);

      expect(
        a.version,
        req(ID, DOC, `POST ${path} with body '{': the response MUST carry OpenWOP-Version — a response without it did not come from the host's negotiation layer (a framework parser or a hosting fallback answered instead). Got status ${a.status}, content-type ${JSON.stringify(a.contentType)}`),
      ).not.toBeNull();
      expect(
        a.status,
        req(ID, 'spec/v2/core/errors.md', `a malformed JSON body MUST be refused with 400 validation_error, not accepted and not passed to a default handler (got ${a.status})`),
      ).toBe(400);
      expect(
        a.body !== null && typeof a.body === 'object' && !/text\/html/i.test(a.contentType),
        req(ID, 'spec/v2/core/errors.md', `the 400 MUST be the JSON error envelope, not a framework's HTML error page (content-type ${JSON.stringify(a.contentType)}, body starts ${JSON.stringify(a.text.slice(0, 40))})`),
      ).toBe(true);
      const r = v2Validator('error-envelope')(a.body);
      expect(r.ok, req(ID, 'spec/v2/core/errors.md', `the body MUST validate against error-envelope.schema.json (${r.errors})`)).toBe(true);
      expect(
        (a.body as { error?: unknown }).error,
        req(ID, 'spec/v2/core/errors.md', 'the envelope\'s `error` MUST be the registered code for a malformed request body, validation_error'),
      ).toBe('validation_error');
    });
  }
});
