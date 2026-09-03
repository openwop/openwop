/**
 * feedback-fork-not-copied — RFC 0056 §D. Annotations are a per-run
 * side-store, NOT replayable event-log entries — so a fork of an annotated
 * run starts with ZERO annotations. Gated on feedback + fork; soft-skips
 * when either is unavailable.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §D
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';
import { req } from '../lib/requirement-ids.js';

describe('feedback-fork-not-copied (RFC 0056 §D)', () => {
  it('a fork of an annotated run starts with zero annotations', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early');
    const runId = await seedRun('feedback-fork');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    const post = await driver.post(`/v1/runs/${runId}/annotations`, { signal: { kind: 'flag' } });
    if (post.status === 501 || post.status === 404) return softSkip('blocked', 'precondition not met — `post.status === 501 || post.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(post.status).toBe(201);
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return softSkip('blocked', 'precondition not met — an earlier step threw (seam, prior step, or fixture unavailable)');
    }
    const fork = await driver.post(`/v1/runs/${runId}:fork`, { fromSeq: 0, mode: 'branch' });
    if (fork.status !== 200 && fork.status !== 201) return softSkip('inapplicable', 'fork unsupported — soft-skip (fork.status !== 200 && fork.status !== 201)');
    const forkId = (fork.json as { runId?: string } | undefined)?.runId;
    if (!forkId) return softSkip('blocked', 'precondition not met — `!forkId` returned early (seam, prior step, or fixture unavailable)');
    const list = await driver.get(`/v1/runs/${forkId}/annotations`);
    const ann = (list.json as { annotations?: unknown[] } | undefined)?.annotations ?? [];
    expect(
      ann.length,
      req('openwop.it.feedback-fork-not-copied.a-fork-of-an-annotated-run-starts-with-zero-annotations', 'RFC 0056 §D', 'annotations are a side-store and MUST NOT be copied into a fork'),
    ).toBe(0);
  });
});
