/**
 * v2 — `preferred-version-default` (suite 2.0.0; RFC 0172 §A.1, §A.3;
 * `spec/v2/core/versioning.md` §1.1 "Advertisement", §1.3 "The request header";
 * `spec/v2/core/capabilities.md` §1 "One well-known resource").
 *
 * Witness class: witnessable — unaided. `preferredVersion` MUST be a member of
 * `protocolVersions[]`; a header-less request on an unversioned path MUST be
 * served `preferredVersion`'s major, so a header-less `GET /.well-known/openwop`
 * is the `preferredVersion` representation and its `OpenWOP-Version` response
 * header names that major. The header-less fetch bypasses the driver (which
 * stamps `OpenWOP-Version: 2.0` under target major 2). Any OTHER unversioned path
 * is the v2 surface (§1.2), so a header-less request there is served major 2.
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/versioning.md §1.1';
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function headerless(): Promise<{ status: number; version: string | null; json: unknown } | null> {
  try {
    const res = await fetch(`${loadEnv().baseUrl}/.well-known/openwop`, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let json: unknown;
    try { json = text.length > 0 ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, version: res.headers.get('openwop-version'), json };
  } catch {
    return null;
  }
}

describe('v2 preferred-version-default (RFC 0172 §A.1, §A.3)', () => {
  it('preferredVersion is a member of protocolVersions[]', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const versions = Array.isArray(doc['protocolVersions']) ? (doc['protocolVersions'] as unknown[]) : [];
    const preferred = doc['preferredVersion'];
    expect(typeof preferred === 'string' && VERSION.test(preferred), req('openwop.requirement.0172.preferred-version-default.member', DOC, 'preferredVersion is REQUIRED root metadata with the <major>.<minor> grammar')).toBe(true);
    expect(versions.includes(preferred), req('openwop.requirement.0172.preferred-version-default.member', DOC, `preferredVersion (${String(preferred)}) MUST be a member of protocolVersions[] [${versions.map(String).join(', ')}]`)).toBe(true);
    if (versions.length === 1) {
      expect(doc['protocolVersion'] === undefined || doc['protocolVersion'] === preferred, req('openwop.requirement.0172.preferred-version-default.member', DOC, 'on a host serving a single major, preferredVersion MUST equal protocolVersion (RFC 0179 §A.1)')).toBe(true);
    }
  });

  it('a header-less GET /.well-known/openwop is the preferredVersion representation', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const preferred = String(doc['preferredVersion']);
    const res = await headerless();
    if (res === null) return softSkip('blocked', 'header-less GET /.well-known/openwop unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0172.preferred-version-default.headerless', 'spec/v2/core/versioning.md §1.3', 'the discovery resource MUST answer a header-less request')).toBe(200);
    const preferredMajor = preferred.split('.')[0];
    expect(res.version?.trim().split('.')[0], req('openwop.requirement.0172.preferred-version-default.headerless', 'spec/v2/core/versioning.md §1.3', `with the header absent the host MUST serve preferredVersion's major (${preferredMajor}) and report it in OpenWOP-Version`)).toBe(preferredMajor);
    const body = res.json as Record<string, unknown> | undefined;
    if (preferredMajor === '2') {
      const r = v2Validator('capabilities')(body);
      expect(r.ok, req('openwop.requirement.0172.preferred-version-default.headerless', 'spec/v2/core/capabilities.md §1', `preferredVersion is 2.x, so the header-less representation MUST be the closed v2 root (${r.errors})`)).toBe(true);
    } else {
      expect(typeof body?.['protocolVersion'], req('openwop.requirement.0172.preferred-version-default.headerless', 'spec/v2/core/capabilities.md §1', 'preferredVersion is 1.x, so the header-less representation MUST be the v1 document (protocolVersion present) through the overlap')).toBe('string');
      expect(Array.isArray(body?.['protocolVersions']) && typeof body?.['preferredVersion'] === 'string', req('openwop.requirement.0172.preferred-version-default.headerless', 'spec/v2/core/capabilities.md §1', 'the v1 representation MUST carry protocolVersions[] and preferredVersion additively so a single fetch names the other major')).toBe(true);
    }
  });
  it('a header-less request on any other unversioned path is served major 2', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    // versioning.md §1.2/§1.3: an unversioned operation path is the v2 surface, so the
    // header-less default (preferredVersion) applies to /.well-known/openwop only. Any
    // answer carries OpenWOP-Version (§1.4), so an unknown run id is enough to read it.
    const path = `/runs/openwop-conformance~2F${'h'.repeat(22)}`;
    let version: string | null = null;
    try {
      const res = await fetch(`${loadEnv().baseUrl}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${loadEnv().apiKey}` } });
      await res.text();
      version = res.headers.get('openwop-version');
    } catch {
      return softSkip('blocked', `header-less GET ${path} unreachable (fetch failed)`);
    }
    expect(version?.trim().split('.')[0], req('openwop.requirement.0172.preferred-version-default.unversioned-is-v2', 'spec/v2/core/versioning.md §1.2, §1.3', `a header-less request on an unversioned operation path MUST be served major 2 and say so in OpenWOP-Version — the preferredVersion default is for /.well-known/openwop only (got ${JSON.stringify(version)})`)).toBe('2');
  });
  it('through the overlap preferredVersion names a 1.x member', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const advertised = Array.isArray(doc['protocolVersions']) ? (doc['protocolVersions'] as unknown[]).map(String) : [];
    if (!advertised.some((v) => v.startsWith('1.'))) return softSkip('inapplicable', `the host advertises no 1.x member (${advertised.join(', ') || 'none'}) — it is past the overlap, so preferredVersion is a 2.x and the header-less representation is the closed v2 root`);
    // The header-less representation is the v1 document through the overlap
    // (capabilities.md §1) and the header-less default is preferredVersion's
    // major (§1.3); the two agree only when preferredVersion is the 1.x member.
    expect(
      String(doc['preferredVersion']).split('.')[0],
      req('openwop.requirement.0172.preferred-version-default.overlap', 'spec/v2/core/versioning.md §1.1', `the host advertises a 1.x member (${advertised.join(', ')}), so preferredVersion MUST be that 1.x — otherwise versioning.md §1.3 and RFC 0176 §C.1 select different representations for the same header-less request (got ${String(doc['preferredVersion'])})`),
    ).toBe('1');
  });
});
