/**
 * RFC 0175 §A.1 / §B.1 — `no-transport-advertisement` (suite 2.0.0, target major 2; unaided).
 *
 * REST and SSE are the wire. A v2 host MUST NOT advertise a transport list:
 * `supportedTransports` does not exist in `schemas/v2/capabilities.schema.json`
 * (row C8.2), and the `grpc` block is removed from the closed root because an
 * unwitnessable family is not advertisable (row C8.3; RFC 0169 §A.1). A2A and
 * MCP are compositions advertised by their own facets (`spec/v2/core/interop.md`
 * §REST is the wire, §gRPC).
 *
 * Unaided: the v2 representation of `/.well-known/openwop` is enough. The
 * schema check (closed root) is the belt; the named-key checks are the braces,
 * so a host whose document fails validation for some other reason still gets
 * the specific finding.
 *
 * @see spec/v2/core/interop.md §REST is the wire, §gRPC
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('RFC 0175 §A.1/§B.1 — no-transport-advertisement (unaided)', () => {
  it('the v2 root carries no supportedTransports and no grpc block', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    expect(
      'supportedTransports' in doc,
      req('openwop.requirement.0175.no-transport-advertisement', 'interop.md §REST is the wire', 'a v2 host MUST NOT advertise a transport list — `supportedTransports` does not exist in v2 (RFC 0175 §B.1, row C8.2)'),
    ).toBe(false);
    expect(
      'grpc' in doc,
      req('openwop.requirement.0175.no-transport-advertisement', 'interop.md §gRPC', 'a v2 host MUST NOT advertise a `grpc` capability block — an unwitnessable family is not advertisable (RFC 0175 §A.1, row C8.3)'),
    ).toBe(false);
    // Neither may hide inside a nested family: an `a2a.transports` or
    // `mcp.supportedTransports` would be the same claim one level down.
    for (const family of ['a2a', 'mcp']) {
      const rec = doc[family];
      if (rec && typeof rec === 'object') {
        expect(
          'supportedTransports' in (rec as Record<string, unknown>),
          req('openwop.requirement.0175.no-transport-advertisement', 'interop.md §The facets', `${family} is a composition facet, not a transport advertisement — no supportedTransports inside it`),
        ).toBe(false);
      }
    }
    const check = v2Validator('capabilities')(doc);
    expect(
      check.ok,
      req('openwop.requirement.0175.no-transport-advertisement', 'capabilities.schema.json (closed root)', `the v2 discovery document MUST validate against the closed root — a transport list or a grpc block fails it: ${check.errors}`),
    ).toBe(true);
  });
});
