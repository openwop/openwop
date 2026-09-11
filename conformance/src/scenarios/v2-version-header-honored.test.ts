/**
 * RFC 0172 §A.3 — the `OpenWOP-Version` header is HONORED or REFUSED, never
 * ignored (suite 2.0.0, target major 2; unaided).
 *
 * A host that does not implement v2 has two correct answers to
 * `OpenWOP-Version: 2`: serve the v2 representation, or refuse with `406
 * protocol_version_unsupported`. There is a third thing it can do, and it is
 * the dangerous one — return `200` with the v1 document, ignoring the header
 * entirely.
 *
 * That third case is invisible to every presence-gated scenario in the suite.
 * A scenario that skips when a v2 shape is absent records `inapplicable`
 * whether the host REFUSED major 2 or silently handed back v1; both are
 * non-failures, so a bundle looks clean while witnessing nothing. This is not
 * hypothetical: it is the shape that let RFC 0165 sit `Accepted` on a host
 * that served none of it — the acceptance cited merged PRs, the gated
 * scenarios recorded `inapplicable`, and nothing in the chain ever compared
 * the two representations. Measured on a live tier-1 host 2026-09-04:
 * `OpenWOP-Version: 2` returned `200` with a body byte-identical to the
 * header-less fetch. Credit to the openwop-app session for the probe.
 *
 * The check is cheap and needs no v2 support: fetch the resource twice, once
 * with the header and once without. A host advertising two majors MUST NOT
 * return the same bytes for both, because the two representations differ by
 * construction (`capabilities.md` §1). A host advertising one major MUST
 * refuse rather than ignore.
 *
 * Suite 2.1.2 — the second sentence had never been implemented, and the first
 * was applied to every host. On a host with no `1.x` member the header-less
 * request is served major 2 itself (§1.3 row 3 with §1.1: `preferredVersion`
 * MUST equal the single major served, RFC 0179 §A.1), so asking for `2.0`
 * names THE SAME CONTRACT as asking for nothing and byte identity is the only
 * conformant answer. This leg called that "the header was IGNORED… the host
 * served v1 and called it v2" on a host holding no v1 at all. Every host
 * retires into that state; the only reason it survived is that no host had
 * ever been measured there. Reported by the MyndHyve session from a
 * throwaway v1-retired lane, reproduced here against a stub implementing
 * §1.3's table exactly, 2026-09-11.
 *
 * `inapplicable` would have been the wrong repair. On a retired host
 * `v2-dual-stack-negotiation` gates itself off for want of a second major and
 * takes its unlisted-major probe with it — so §1.3 row 2, *"a major not in
 * `protocolVersions[]` MUST be answered `406 protocol_version_unsupported`
 * with `details.protocolVersions[]`"*, would be measured by nothing at all.
 * The property is falsifiable from that side too, so that is the side this
 * leg probes when the byte comparison has nothing to compare.
 *
 * @see spec/v2/core/versioning.md §1.3
 * @see RFCS/0172-v2-versioning-and-release.md §A.3
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';

const ID = 'openwop.requirement.0172.version-header-honored';
const DOC = 'spec/v2/core/versioning.md §1.3';
const PATH = '/.well-known/openwop';

interface Fetched {
  readonly status: number;
  readonly body: string;
  readonly version: string | null;
}

async function fetchRepresentation(header: string | null): Promise<Fetched | null> {
  const { baseUrl, apiKey } = loadEnv();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (header !== null) headers['OpenWOP-Version'] = header;
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${PATH}`, { headers });
    return { status: res.status, body: await res.text(), version: res.headers.get('openwop-version') };
  } catch {
    return null;
  }
}

/** `protocolVersions[]` from a discovery body; `null` when it is not a JSON object. */
function readVersions(body: string): string[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== 'object') return null;
  const v = (doc as { protocolVersions?: unknown }).protocolVersions;
  return Array.isArray(v) ? v.map(String) : [];
}

describe('v2-version-header-honored (RFC 0172 §A.3)', () => {
  it('OpenWOP-Version is honored or refused — never ignored', async () => {
    const bare = await fetchRepresentation(null);
    const asked = await fetchRepresentation('2.0');
    if (bare === null || asked === null) {
      return softSkip('blocked', `${PATH} unreachable for one of the two probes — the comparison needs both`);
    }
    if (bare.status !== 200) {
      return softSkip('blocked', `the header-less GET ${PATH} answered ${bare.status}; there is no baseline representation to compare against`);
    }

    const advertised = readVersions(bare.body);
    if (advertised === null) {
      return softSkip('blocked', `${PATH} did not return a JSON object, so protocolVersions[] cannot be read`);
    }
    const majors = new Set(advertised.map((v) => v.split('.')[0]));

    // No `1.x` member: the header-less request is already served major 2, so
    // the two probes name one contract and their bytes agree by construction.
    // Probe the rule that still discriminates — §1.3 row 2 — using the major
    // this host does not serve. On a retired host that is `1`, which is what
    // its clients will actually send.
    if (!majors.has('1')) {
      const unserved = ['1', '9'].find((m) => !majors.has(m)) ?? '9';
      const refused = await fetchRepresentation(unserved);
      if (refused === null) {
        return softSkip('blocked', `${PATH} unreachable under OpenWOP-Version: ${unserved}`);
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(refused.body);
      } catch {
        envelope = undefined;
      }
      // `details` sits at the ROOT of the envelope beside `error` and
      // `message` (`schemas/v2/error-envelope.schema.json`), not under `error`.
      const echoed = (envelope as { details?: { protocolVersions?: unknown } } | undefined)?.details?.protocolVersions;
      return expect(
        {
          status: refused.status,
          code: readErrorCode(envelope),
          echoed: Array.isArray(echoed) ? [...echoed].map(String).sort() : echoed,
        },
        req(
          ID,
          DOC,
          `this host advertises [${advertised.join(', ')}] — one major, so a header naming it selects the same contract as no header and their bytes MUST agree. What discriminates honored from ignored here is the refusal: OpenWOP-Version: ${unserved} names a major not in protocolVersions[], which §1.3 MUST answer 406 protocol_version_unsupported with details.protocolVersions[] echoing the list. Answering 200 means the header was ignored — the same defect this scenario exists to catch, probed from the side a retired host still has`,
        ),
      ).toEqual({ status: 406, code: 'protocol_version_unsupported', echoed: [...advertised].sort() });
    }

    // A refusal is a correct answer and ends the check: the host has told the
    // truth about not serving major 2.
    if (asked.status === 406) {
      expect(
        asked.status,
        req(ID, DOC, 'a host that does not serve major 2 MUST refuse with 406 protocol_version_unsupported, which it did'),
      ).toBe(406);
      return softSkip('inapplicable', 'the host refused major 2 with the specified 406 — a correct answer, and there is no second representation to compare bytes against');
    }
    if (asked.status !== 200) {
      return softSkip('blocked', `GET ${PATH} with OpenWOP-Version: 2.0 answered ${asked.status} — neither the v2 representation (200) nor the specified refusal (406), so this scenario cannot rule on it`);
    }

    // 200 means the host claims to have served major 2. The bytes decide
    // whether it actually did.
    expect(
      asked.body === bare.body,
      req(ID, DOC, `answering 200 to OpenWOP-Version: 2.0 with a body byte-identical to the header-less fetch means the header was IGNORED, not honored — the host served v1 and called it v2. Refusing with 406 is the correct answer for a host that does not implement major 2; silently returning v1 is the one answer that no presence-gated scenario can detect, because an absent v2 shape records \`inapplicable\` whether the host refused or ignored`),
    ).toBe(false);
  });

  it('a host advertising two majors serves two different representations', async () => {
    const bare = await fetchRepresentation(null);
    if (bare === null || bare.status !== 200) {
      return softSkip('blocked', `the header-less GET ${PATH} answered ${bare?.status ?? 'no response'}`);
    }
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(bare.body) as Record<string, unknown>;
    } catch {
      return softSkip('blocked', `${PATH} did not return a JSON object`);
    }
    const versions = Array.isArray(doc['protocolVersions']) ? (doc['protocolVersions'] as unknown[]).map(String) : [];
    const majors = new Set(versions.map((v) => v.split('.')[0]));
    if (!(majors.has('1') && majors.has('2'))) {
      return softSkip('inapplicable', `the host advertises [${versions.join(', ') || 'no protocolVersions'}] — one major or none, so there is no second representation to differ from`);
    }

    const asked = await fetchRepresentation('2.0');
    if (asked === null) return softSkip('blocked', `${PATH} unreachable under OpenWOP-Version: 2.0`);
    expect(
      asked.status,
      req(ID, DOC, `a host advertising both majors MUST serve major 2 when asked for it, not refuse (got ${asked.status})`),
    ).toBe(200);
    expect(
      asked.body === bare.body,
      req(ID, DOC, 'the v1 document and the closed v2 root differ by construction (capabilities.md §1), so a host advertising both majors returning identical bytes for both has advertised a major it does not actually serve'),
    ).toBe(false);
    expect(
      asked.version?.trim().split('.')[0] ?? null,
      req(ID, DOC, `the response to OpenWOP-Version: 2.0 MUST carry OpenWOP-Version naming the major it served (got ${String(asked.version)})`),
    ).toBe('2');
  });
});
