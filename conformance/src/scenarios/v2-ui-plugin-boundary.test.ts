/**
 * v2 — the front-end plugin boundary is observable (RFC 0238; `spec/v2/core/packs.md`
 * §Front-end plugin packs). Gated on `uiPlugins.served`.
 *
 * The four `frontend-plugin-*` SECURITY invariants were witnessed only by the v1
 * sample seam `POST /v1/host/sample/ui-plugin/rpc`; v2 mounts no plugin seam. This
 * scenario reads the two normative operations instead, against the operator-installed
 * `ui-plugin-pack-narrow` fixture (one plugin, `narrow`, declaring only
 * `artifact.read` and no `connectSrc`):
 *
 *   frame-isolated      the frame's Content-Security-Policy `sandbox` admits
 *                       `allow-scripts` and never `allow-same-origin`
 *                       (`cross-origin-iframe` hosts only);
 *   frame-deny-egress   the same policy sets `default-src 'none'` and admits no
 *                       `connect-src` source;
 *   rpc-allowlist       `artifact.write` and `host.navigate` (in the enum, not
 *                       declared) return `method_not_allowed`; `host.exec` (outside
 *                       the enum) is not executed; `artifact.read` succeeds (control);
 *   no-byok             no dispatch response carries canary material.
 *
 * The legs live in `lib/ui-plugin-boundary-witness.ts`, proven against a double in
 * `lib/ui-plugin-boundary-witness.test.ts`.
 *
 * Dispositions: no `uiPlugins.served` ⇒ every leg `inapplicable`. The fixture not
 * installed (its frame or dispatch answers 404) ⇒ `inapplicable`: installing it is the
 * operator's choice (RFC 0238 §D). An isolation other than `cross-origin-iframe` ⇒ the
 * isolation leg `inapplicable` (RFC 0238 §Decisions 3).
 *
 * @see RFCS/0238-ui-plugin-observation-path.md §B, §C, §F
 * @see spec/v2/core/packs.md §Front-end plugin packs
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { allowlistLeg, egressLeg, isolationLeg, noByokLeg } from '../lib/ui-plugin-boundary-witness.js';

const DOC = 'spec/v2/core/packs.md §Front-end plugin packs';
const ID_ISOLATED = 'openwop.requirement.0238.ui-plugin.frame-isolated';
const ID_EGRESS = 'openwop.requirement.0238.ui-plugin.frame-deny-egress';
const ID_ALLOWLIST = 'openwop.requirement.0238.ui-plugin.rpc-allowlist';
const ID_NO_BYOK = 'openwop.requirement.0238.ui-plugin.no-byok';

describe('v2 ui-plugin boundary (RFC 0238)', () => {
  it('the frame is sandboxed without same-origin', async () => {
    const out = await isolationLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req(ID_ISOLATED, DOC, 'a cross-origin-iframe plugin frame MUST carry a sandbox directive admitting allow-scripts and never allow-same-origin')).toBe('');
  });

  it('the frame denies egress', async () => {
    const out = await egressLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req(ID_EGRESS, DOC, "the frame MUST set default-src 'none' and admit no connect-src source the plugin did not declare")).toBe('');
  });

  it('the dispatch refuses methods outside the allowlists and runs the declared one', async () => {
    const out = await allowlistLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req(ID_ALLOWLIST, DOC, "a method outside the plugin's declared hostApi or the advertised uiPlugins.hostApi MUST return method_not_allowed and MUST NOT execute")).toBe('');
  });

  it('no dispatch response carries credential material', async () => {
    const out = await noByokLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req(ID_NO_BYOK, DOC, 'a ui-plugin/1 response MUST NOT carry credential material across the boundary')).toBe('');
  });
});
