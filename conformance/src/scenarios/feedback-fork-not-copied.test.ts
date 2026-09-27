/**
 * feedback-fork-not-copied — RFC 0056 §D. Annotations are a per-run
 * side-store, NOT replayable event-log entries — so a fork of an annotated
 * run starts with ZERO annotations. Gated on feedback + fork; soft-skips
 * when either is unavailable.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §D
 */

import { describe, it, expect } from 'vitest';
import { softSkip, blockedDespiteAssertions } from '../lib/soft-skip.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';
import { req } from '../lib/requirement-ids.js';

describe('feedback-fork-not-copied (RFC 0056 §D)', () => {
  it('a fork of an annotated run starts with zero annotations', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early');
    // unfailable-leg audit wave 2, 2026-09-27: three holes, all passing a
    // non-conforming host. (1) Fork support was discovered only AFTER the
    // annotation 201 assert, so a host with no fork recorded a partial-witness
    // pass — gate on advertised `replay.modes` ⊇ ['branch'] BEFORE asserting.
    // (2) `annotations ?? []` read a 404/500/non-array list as "zero
    // annotations" — the fork list must now be 200 + an array. (3) No positive
    // control: a host whose annotation list NEVER returns anything passed —
    // the SOURCE run must list the annotation just posted.
    const replayCap = await readCapabilityFamily<{ supported?: unknown; modes?: unknown }>('replay');
    const modes = replayCap?.supported === true && Array.isArray(replayCap.modes) ? replayCap.modes : [];
    if (!modes.includes('branch')) return softSkip('inapplicable', 'host does not advertise replay.modes including "branch" — fork leg not applicable');
    const runId = await seedRun('feedback-fork');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    const post = await driver.post(`/v1/runs/${runId}/annotations`, { signal: { kind: 'flag' } });
    if (post.status === 501 || post.status === 404) return softSkip('blocked', 'precondition not met — `post.status === 501 || post.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(post.status, req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §B', 'POST /v1/runs/{runId}/annotations MUST return 201')).toBe(201);
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return blockedDespiteAssertions('source run did not reach a terminal state within 10s — fork not attempted');
    }
    const srcList = await driver.get(`/v1/runs/${runId}/annotations`);
    expect(srcList.status, req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §B', 'GET /v1/runs/{runId}/annotations MUST return 200')).toBe(200);
    const srcAnn = (srcList.json as { annotations?: unknown } | undefined)?.annotations;
    expect(
      Array.isArray(srcAnn) && srcAnn.length >= 1,
      req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §B', 'positive control: the source run MUST list the annotation just posted'),
    ).toBe(true);
    const fork = await driver.post(`/v1/runs/${runId}:fork`, { fromSeq: 0, mode: 'branch' });
    if (fork.status !== 200 && fork.status !== 201) return blockedDespiteAssertions(`branch fork declined (HTTP ${fork.status}) although replay.modes advertises "branch" — fork annotation state not observed`);
    const forkId = (fork.json as { runId?: string } | undefined)?.runId;
    if (!forkId) return blockedDespiteAssertions('fork response carried no runId — fork annotation state not observed');
    const list = await driver.get(`/v1/runs/${forkId}/annotations`);
    expect(list.status, req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §B', 'GET /v1/runs/{forkId}/annotations MUST return 200 for the fork')).toBe(200);
    const ann = (list.json as { annotations?: unknown } | undefined)?.annotations;
    expect(Array.isArray(ann), req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §B', 'the annotation list MUST carry an annotations[] array')).toBe(true);
    expect(
      Array.isArray(ann) ? ann.length : -1,
      req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §D', 'annotations are a side-store and MUST NOT be copied into a fork'),
    ).toBe(0);
  });
});
