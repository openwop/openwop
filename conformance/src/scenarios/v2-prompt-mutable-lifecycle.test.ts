/**
 * v2 — the mutable prompt library (`spec/v2/core/host-services.md` §`prompts`
 * → §Library; `api/v2/openapi.yaml` `createPromptTemplate`,
 * `updatePromptTemplate`, `deletePromptTemplate`; RFC 0028 §A). The v1 twin is
 * `prompt-mutable-lifecycle`; the legs live in `lib/prompt-library-witness.ts`.
 *
 * One round trip on a fresh user template, observed once
 * (`driveLifecycle`) and judged per step (`judgeLifecycle`, pure):
 *   create → 201 + Location; read → `meta.source: user`; duplicate
 *   (templateId, version) → 409; update with a greater SemVer → 200 and stored;
 *   a lower SemVer → 409; delete → 204, then 404.
 * Plus: a host built-in is read-only (DELETE → 403); NEW at v2, writes MUST be
 * authenticated (unauthenticated POST → 401); and, unaided, with
 * `mutableLibrary` unadvertised a write answers `404 not_found` (errors.md
 * §Unadvertised operations).
 *
 * Dispositions: no target ⇒ `inapplicable`; discovery unreadable ⇒ `blocked`;
 * `prompts` absent, or `endpointsSupported`/`mutableLibrary` not `true` ⇒ the
 * write legs are `inapplicable` (gated by presence, never a strict-mode
 * failure) and the gate-off leg binds; no host built-in listed ⇒ read-only leg
 * `inapplicable`.
 *
 * Proven against a scratch double in `lib/prompt-library-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §Library
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { driveLifecycle, gateOffWriteLeg, judgeLifecycle, promptAdverts, readOnlyLeg, unauthenticatedWriteLeg, type LifecycleObservation, type PromptAdverts, type Skip } from '../lib/prompt-library-witness.js';

const PROFILE = majorProfile(2);
const ID_CREATE = 'openwop.requirement.prompts.create-user-template';
const ID_READ = 'openwop.requirement.prompts.created-template-source-user';
const ID_DUP = 'openwop.requirement.prompts.duplicate-version-409';
const ID_UPDATE = 'openwop.requirement.prompts.update-greater-semver';
const ID_NONMONO = 'openwop.requirement.prompts.update-non-monotonic-409';
const ID_DELETE = 'openwop.requirement.prompts.delete-user-template';
const ID_READONLY = 'openwop.requirement.prompts.builtin-read-only';
const ID_AUTH = 'openwop.requirement.prompts.writes-authenticated';
const ID_GATE = 'openwop.requirement.prompts.mutable-gate-off-404';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];

type Ready = { ok: true; a: PromptAdverts } | { ok: false; skip: () => undefined };
async function ready(): Promise<Ready> {
  if (HTTP_SKIP) return { ok: false, skip: () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset') };
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, skip: () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0') };
  return { ok: true, a: promptAdverts(PROFILE, doc) };
}

/** The round trip runs once per file; each step's `it` judges its own part. */
let lifecycle: Promise<Skip | LifecycleObservation> | undefined;
type Step = { ok: true; o: LifecycleObservation } | { ok: false; skip: () => undefined };
async function step(): Promise<Step> {
  const r = await ready();
  if (!r.ok) return r;
  lifecycle ??= driveLifecycle(PROFILE, r.a);
  const o = await lifecycle;
  if ('kind' in o) return { ok: false, skip: () => softSkip(o.disposition, o.reason) };
  return { ok: true, o };
}

describe('v2 prompt library: user-template round trip (host-services.md §Library)', () => {
  it('POST /prompts creates a user template with 201 and a Location', async () => {
    const s = await step();
    if (!s.ok) return s.skip();
    for (const x of judgeLifecycle(s.o).create) expect(x.ok, req(ID_CREATE, x.doc, x.message)).toBe(true);
  });

  it('the created template reads back with meta.source user', async () => {
    const s = await step();
    if (!s.ok) return s.skip();
    for (const x of judgeLifecycle(s.o).read) expect(x.ok, req(ID_READ, x.doc, x.message)).toBe(true);
  });

  it('a second POST of the same templateId and version answers 409', async () => {
    const s = await step();
    if (!s.ok) return s.skip();
    for (const x of judgeLifecycle(s.o).duplicate) expect(x.ok, req(ID_DUP, x.doc, x.message)).toBe(true);
  });

  it('PUT with a greater SemVer replaces the template', async () => {
    const s = await step();
    if (!s.ok) return s.skip();
    for (const x of judgeLifecycle(s.o).update) expect(x.ok, req(ID_UPDATE, x.doc, x.message)).toBe(true);
  });

  it('PUT with a lower SemVer answers 409', async () => {
    const s = await step();
    if (!s.ok) return s.skip();
    for (const x of judgeLifecycle(s.o).nonMonotonic) expect(x.ok, req(ID_NONMONO, x.doc, x.message)).toBe(true);
  });

  it('DELETE answers 204 and the template then reads 404', async () => {
    const s = await step();
    if (!s.ok) return s.skip();
    for (const x of judgeLifecycle(s.o).remove) expect(x.ok, req(ID_DELETE, x.doc, x.message)).toBe(true);
  });
});

describe('v2 prompt library: write guards (host-services.md §Library; errors.md §Unadvertised operations)', () => {
  it('a host built-in template is read-only: DELETE answers 403', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await readOnlyLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_READONLY, x.doc, x.message)).toBe(true);
  });

  it('an unauthenticated write is refused 401', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await unauthenticatedWriteLeg(r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_AUTH, x.doc, x.message)).toBe(true);
  });

  it('with mutableLibrary unadvertised, POST /prompts answers 404 not_found', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const out = await gateOffWriteLeg(PROFILE, r.a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_GATE, x.doc, x.message)).toBe(true);
  });
});
