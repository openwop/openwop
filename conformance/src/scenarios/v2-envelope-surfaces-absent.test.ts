/**
 * v2 — the AI Envelope is absent (RFC 0255 §A). Unaided: it reads only the
 * host's v2 discovery document.
 *
 * RFC 0255 deleted the families `aiEnvelope`, `supportedEnvelopes`,
 * `schemaVersions`, `envelopeStrictness`, `envelopeContracts`, `envelopes` and
 * the ext family `a2uiSurface`, and the `limits` facets `schemaRounds` and
 * `envelopesPerTurn`. The discovery root is closed, so a host still publishing
 * one of them publishes a document the v2 schema refuses; this leg names which
 * key it is. `envelopes.reasoning`, `.tierOneSubsetCompliance` and
 * `.reliability` now live on `aiProviders` (`host-services.md` §Structured
 * output), so a host that moved them passes.
 *
 * Disposition: discovery unreadable ⇒ `blocked`. Every readable document is
 * judged; there is no `inapplicable` state, because absence is the requirement.
 *
 * @see RFCS/0255-delete-the-ai-envelope.md §A
 * @see spec/v2/corrections.json openwop.correction.v2.5
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0255.surfaces-absent';
const SECTION = 'RFC 0255 §A';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const DELETED_ROOT_KEYS = ['aiEnvelope', 'supportedEnvelopes', 'schemaVersions', 'envelopeStrictness', 'envelopeContracts', 'envelopes', 'a2uiSurface'] as const;
const DELETED_LIMITS = ['schemaRounds', 'envelopesPerTurn'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every deleted surface the document still publishes, as a dotted path. */
function deletedSurfaces(doc: Record<string, unknown>): string[] {
  const found: string[] = DELETED_ROOT_KEYS.filter((k) => k in doc).map((k) => k);
  const limits = doc['limits'];
  if (isRecord(limits)) for (const k of DELETED_LIMITS) if (k in limits) found.push(`limits.${k}`);
  const extensions = doc['extensions'];
  if (isRecord(extensions)) {
    for (const [org, rec] of Object.entries(extensions)) {
      if (isRecord(rec) && ('a2ui-surface' in rec || 'a2uiSurface' in rec)) found.push(`extensions.${org}.a2ui-surface`);
    }
  }
  return found;
}

describe('v2-envelope-surfaces-absent (RFC 0255 §A)', () => {
  it('the discovery document publishes no deleted envelope family or limit', async () => {
    let doc: Record<string, unknown> | null = null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', UNREADABLE);
    expect(deletedSurfaces(doc), req(ID, SECTION, 'a v2 discovery document MUST NOT publish a family or limit RFC 0255 deleted')).toEqual([]);
  });
});
