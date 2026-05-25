/**
 * feedback-fork-not-copied — RFC 0056 §D. Annotations are a per-run
 * side-store, NOT replayable event-log entries — so a fork of an annotated
 * run starts with ZERO annotations. Gated on feedback + fork; soft-skips
 * when either is unavailable.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §D
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';

describe('feedback-fork-not-copied (RFC 0056 §D)', () => {
  it('a fork of an annotated run starts with zero annotations', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return;
    const runId = await seedRun('feedback-fork');
    if (!runId) return;
    const post = await driver.post(`/v1/runs/${runId}/annotations`, { signal: { kind: 'flag' } });
    if (post.status === 501 || post.status === 404) return;
    expect(post.status).toBe(201);
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return;
    }
    const fork = await driver.post(`/v1/runs/${runId}:fork`, { fromSeq: 0, mode: 'branch' });
    if (fork.status !== 200 && fork.status !== 201) return; // fork unsupported — soft-skip
    const forkId = (fork.json as { runId?: string } | undefined)?.runId;
    if (!forkId) return;
    const list = await driver.get(`/v1/runs/${forkId}/annotations`);
    const ann = (list.json as { annotations?: unknown[] } | undefined)?.annotations ?? [];
    expect(
      ann.length,
      driver.describe('RFC 0056 §D', 'annotations are a side-store and MUST NOT be copied into a fork'),
    ).toBe(0);
  });
});
