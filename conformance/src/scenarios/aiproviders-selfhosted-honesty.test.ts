/**
 * Self-hosted provider truthful-advertisement + endpoint non-disclosure
 * (RFC 0108 §A.2 / §D) — behavioral.
 *
 * Gated on `capabilities.aiProviders.selfHosted.length > 0` (root-first per
 * RFC 0073) via `behaviorGate('openwop-selfhosted-providers', …)`. Soft-skips
 * when the host advertises no self-hosted class (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `aiproviders-selfhosted-shape.test.ts`; this asserts host BEHAVIOR via the
 * documented host-sample seam `POST /v1/host/sample/ai/call` (soft-skips on 404
 * until a host wires it):
 *
 *   - **§A.2 truthful advertisement.** A dispatch against the advertised
 *     `selfHosted` provider id MUST reach a real configured endpoint — it
 *     either succeeds OR fails with a transport-class error from that endpoint.
 *     It MUST NOT come back `capability_not_provided` / `provider_not_supported`
 *     (a "no endpoint configured" refusal would prove the advertisement is
 *     dishonest — the host listed a `selfHosted` id with nothing backing it).
 *   - **§D endpoint non-disclosure.** When the host's endpoint location is
 *     supplied out-of-band via `OPENWOP_TEST_COMPAT_ENDPOINT`, that string (and
 *     its bare host[:port]) MUST NOT appear anywhere in the seam response — the
 *     success body or the error payload. The endpoint is operator-private
 *     infrastructure (`self-hosted-endpoint-no-disclosure`); the base-URL is
 *     config, not secret-shaped, so the host's SR-1 redaction won't auto-scrub
 *     it — the host MUST scrub it deliberately (a generic transport error).
 *
 * The §D leg requires `OPENWOP_TEST_COMPAT_ENDPOINT` (the host operator + the
 * conformance runner agree on the configured endpoint location out-of-band, the
 * same pattern as `OPENWOP_CANARY_SECRET_VALUE` / `OPENWOP_TEST_SAML_IDP_URL`).
 * Without it, the §A.2 leg still runs; the §D string check is skipped with a
 * loud note (it has no endpoint to grep for).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md (§aiProviders.selfHosted)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0108-self-hosted-openai-compatible-provider-class.md (§A.2, §D, §E)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SEAM = '/v1/host/sample/ai/call';

/** Read the canonical error code from a seam response body (tolerant of
 *  `{error}` / `{code}` / `{error:{code}}` shapes). */
function errCode(json: unknown): string | undefined {
  const j = json as { error?: unknown; code?: unknown };
  if (typeof j?.code === 'string') return j.code;
  if (typeof j?.error === 'string') return j.error;
  const e = j?.error as { code?: unknown } | undefined;
  if (e && typeof e.code === 'string') return e.code;
  return undefined;
}

/**
 * The §A.2 dishonest-advertisement tell: a host that advertised a `selfHosted`
 * id with no configured/reachable endpoint behind it refuses the dispatch as
 * "no such provider configured" rather than reaching a real endpoint.
 */
const NO_ENDPOINT_CODES = new Set([
  'capability_not_provided',
  'provider_not_supported',
  'provider_not_configured',
  'no_provider_configured',
]);

/** Derive the bare `host` and `host:port` from an endpoint URL/string for the
 *  §D substring check (so a host that scrubs the scheme but leaks `vllm:8000`
 *  is still caught). */
function endpointNeedles(endpoint: string): string[] {
  const needles = new Set<string>([endpoint]);
  try {
    const u = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`);
    if (u.host) needles.add(u.host); // host:port
    if (u.hostname) needles.add(u.hostname); // bare host
  } catch {
    /* not URL-parseable; the raw string check still applies */
  }
  return [...needles].filter((s) => s.length > 0);
}

describe('aiproviders-selfhosted-honesty (RFC 0108 §A.2/§D)', () => {
  it('a selfHosted dispatch reaches a real endpoint (§A.2) and never discloses the endpoint location (§D)', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const selfHosted = Array.isArray(ai?.selfHosted) ? (ai!.selfHosted as string[]) : [];
    if (!behaviorGate('openwop-selfhosted-providers', selfHosted.length > 0)) return;

    const providerId = selfHosted[0]!; // an advertised self-hosted/compat id
    const res = await driver.post(SEAM, {
      provider: providerId,
      messages: [{ role: 'user', content: 'ping' }],
    });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip the behavioral suite) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip the behavioral suite

    // §A.2 — the advertisement must be backed by a real endpoint. A success or a
    // transport-class failure both prove a real endpoint was reached; a
    // "no provider configured" refusal proves the §A.2 dishonest-advertisement
    // violation (the host listed selfHosted with nothing behind it).
    const code = errCode(res.json);
    expect(
      code === undefined || !NO_ENDPOINT_CODES.has(code),
      req('openwop.it.aiproviders-selfhosted-honesty.a-selfhosted-dispatch-reaches-a-real-endpoint-a-2-and-never-discloses-the-endpoi', 
        'RFC 0108 §A.2',
        `an advertised selfHosted id (${providerId}) MUST be backed by a configured, reachable endpoint ` +
          `(dispatch succeeds or fails with a transport error) — MUST NOT refuse "${code}" (no endpoint configured)`,
      ),
    ).toBe(true);

    // §D — the endpoint location MUST NOT surface on the wire (success body OR
    // error payload). Requires the out-of-band endpoint to grep for.
    const endpoint = process.env.OPENWOP_TEST_COMPAT_ENDPOINT?.trim();
    if (!endpoint) {
      // eslint-disable-next-line no-console
      console.warn(
        '[openwop-selfhosted-providers] §D disclosure check skipped — set OPENWOP_TEST_COMPAT_ENDPOINT ' +
          "to the host's configured compat endpoint to assert non-disclosure on the wire.",
      );
      return softSkip('blocked', 'precondition not met — `!endpoint` returned early (seam, prior step, or fixture unavailable)');
    }

    const serialized = JSON.stringify(res.json ?? {});
    for (const needle of endpointNeedles(endpoint)) {
      expect(
        !serialized.includes(needle),
        req('openwop.it.aiproviders-selfhosted-honesty.a-selfhosted-dispatch-reaches-a-real-endpoint-a-2-and-never-discloses-the-endpoi', 
          'RFC 0108 §D (self-hosted-endpoint-no-disclosure)',
          `the endpoint location ("${needle}") MUST NOT appear in any selfHosted dispatch response or error payload`,
        ),
      ).toBe(true);
    }
  });
});
