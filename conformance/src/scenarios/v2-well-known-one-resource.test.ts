/**
 * RFC 0176 §C — `well-known-one-resource` (suite 2.0.0, target major 2; gated
 * on a host advertising two majors).
 *
 * `/.well-known/openwop` is ONE resource whose representation the RFC 0172
 * §A.3 header selects: no `OpenWOP-Version` ⇒ the v1 document (with
 * `protocolVersions[]` additive, RFC 0165 §A) through the overlap;
 * `OpenWOP-Version: 2.0` ⇒ the closed v2 root (RFC 0169 §A.4). A single fetch
 * answers the major the client speaks and names the other, so
 * `protocolVersions[]` is equal in both representations (§C.1). The wrapper
 * (`capabilities-wrapper`), the dotted mirror (`host-dotted-mirror`),
 * `Capabilities-Etag` (`capabilities-etag-header`) and the root `profiles[]`
 * are absent from the v2 representation at the cut (§C.2; RFC 0169 §C.1).
 *
 * The two GETs are issued raw (lib/driver.ts always names a version under
 * target major 2 and the header-less request is the point of leg 1);
 * `getCapabilities` carries `security: []`, so neither is authenticated.
 *
 * @see spec/v2/core/versioning.md (RFC 0172 §A.3 — the header selects)
 * @see spec/v2/core/capabilities.md §7 (no `profiles[]` at the root)
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const PATH = '/.well-known/openwop';
const DOC = 'RFC 0176 §C.1 (one well-known resource)';

interface Representation { readonly status: number; readonly headers: Headers; readonly body: Record<string, unknown> | null }

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function representation(version: string | null): Promise<Representation | null> {
  const env = loadEnv();
  try {
    const res = await fetch(`${env.baseUrl}${PATH}`, { headers: { Accept: 'application/json', ...(version === null ? {} : { 'OpenWOP-Version': version }) } });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try { const j = JSON.parse(text) as unknown; body = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { body = null; }
    return { status: res.status, headers: res.headers, body };
  } catch {
    return null;
  }
}

function versionsOf(doc: Record<string, unknown> | null): string[] | null {
  const v = doc?.['protocolVersions'];
  return Array.isArray(v) ? v.map(String) : null;
}

/** Both majors advertised by the v2 representation, else the reason the scenario does not apply. */
function twoMajors(doc: Record<string, unknown>): string | null {
  const versions = versionsOf(doc) ?? [];
  const majors = new Set(versions.map((v) => v.split('.')[0]));
  if (majors.has('1') && majors.has('2')) return null;
  return `the host advertises protocolVersions [${versions.join(', ')}] — one major only; the one-resource rule is witnessable on a dual-advertising host (RFC 0176 falsifiability §C.1 "gated on two majors")`;
}

describe('RFC 0176 §C — well-known-one-resource (gated on two majors)', () => {
  it('a header-less GET and an OpenWOP-Version: 2.0 GET are two representations of one path with equal protocolVersions[]', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = twoMajors(doc);
    if (gate !== null) return softSkip('inapplicable', gate);
    const v1 = await representation(null);
    const v2 = await representation('2.0');
    if (v1 === null || v2 === null) return softSkip('blocked', `${PATH} unreachable (fetch failed) for one of the two representations`);
    expect(
      v1.status,
      req('openwop.requirement.0176.well-known-one-resource', DOC, `the header-less GET selects the v1 representation through the overlap and MUST answer 200 (got ${v1.status}) — no header ⇒ v1 (RFC 0172 §A.3)`),
    ).toBe(200);
    expect(
      v2.status,
      req('openwop.requirement.0176.well-known-one-resource', DOC, `GET ${PATH} with OpenWOP-Version: 2.0 MUST answer 200 with the closed v2 root (got ${v2.status})`),
    ).toBe(200);
    expect(v1.body !== null && v2.body !== null, req('openwop.requirement.0176.well-known-one-resource', DOC, 'both representations MUST be JSON objects')).toBe(true);
    const v1Versions = versionsOf(v1.body);
    const v2Versions = versionsOf(v2.body);
    expect(
      v1Versions,
      req('openwop.requirement.0176.well-known-one-resource', DOC, 'the v1 representation MUST carry protocolVersions[] (RFC 0165 §A, additive) — a single fetch names the other major'),
    ).not.toBeNull();
    expect(
      v2Versions,
      req('openwop.requirement.0176.well-known-one-resource', DOC, 'the v2 representation MUST carry protocolVersions[]'),
    ).not.toBeNull();
    expect(
      [...(v1Versions ?? [])].sort(),
      req('openwop.requirement.0176.well-known-one-resource', DOC, `protocolVersions[] MUST be equal in both representations — one resource, two renderings (v1: [${(v1Versions ?? []).join(', ')}], v2: [${(v2Versions ?? []).join(', ')}])`),
    ).toEqual([...(v2Versions ?? [])].sort());
    // The two are representations, not one document: the v1 rendering is the
    // wrapped document and the v2 rendering is the closed root, so they differ.
    expect(
      JSON.stringify(v1.body) === JSON.stringify(v2.body),
      req('openwop.requirement.0176.well-known-one-resource', DOC, 'the header MUST select a representation — a host that serves one document for both majors is the charter\'s "per-major sub-objects" the RFC does not adopt (adversarial review 3)'),
    ).toBe(false);
  });

  it('the v2 representation carries no `capabilities` wrapper, no dotted `host.*` key, no `profiles[]`, no Capabilities-Etag', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const gate = twoMajors(doc);
    if (gate !== null) return softSkip('inapplicable', gate);
    const v2 = await representation('2.0');
    if (v2 === null || v2.status !== 200 || v2.body === null) return softSkip('blocked', `GET ${PATH} with OpenWOP-Version: 2.0 answered ${v2?.status ?? 'no response'} without a JSON object`);
    const keys = Object.keys(v2.body);
    expect(
      keys.includes('capabilities'),
      req('openwop.requirement.0176.well-known-one-resource.v2-representation', 'RFC 0176 §C.2', 'the `capabilities` wrapper (deprecation capabilities-wrapper, removalTrigger v2.0-cut) MUST be absent from the v2 representation'),
    ).toBe(false);
    expect(
      keys.filter((k) => k.startsWith('host.')),
      req('openwop.requirement.0176.well-known-one-resource.v2-representation', 'RFC 0176 §C.2', 'the dotted `host.*` mirror (deprecation host-dotted-mirror) MUST be absent from the v2 representation'),
    ).toEqual([]);
    expect(
      keys.includes('profiles'),
      req('openwop.requirement.0176.well-known-one-resource.v2-representation', 'spec/v2/core/capabilities.md §7', 'no `profiles[]` exists at the v2 root (RFC 0169 §C.1, row C2.10)'),
    ).toBe(false);
    expect(
      v2.headers.get('capabilities-etag'),
      req('openwop.requirement.0176.well-known-one-resource.v2-representation', 'RFC 0176 §C.2', 'Capabilities-Etag (deprecation capabilities-etag-header) MUST be absent from the v2 representation — the standard ETag is the probe handle'),
    ).toBeNull();
  });
});
