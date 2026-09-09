/**
 * Channel TTL scenarios (G5 / C3) — exercises `conformance-channel-ttl`.
 *
 * Workflow writes 3 entries (values a/b/c) to channel `events` with
 * ttlMs=200, waits 300ms via `core.delay`, then writes a 4th (value d).
 *
 * Verifies:
 *   1. Run reaches terminal `completed`.
 *   2. After the post-TTL write, the `events` channel state contains
 *      exactly one entry.
 *   3. The remaining entry has value `"d"` (the 3 priors were dropped at
 *      write time because their `_ts` predated `now - ttlMs`).
 *   4. The remaining entry preserves the `_ts` timestamp produced at write.
 *
 * Spec references:
 *   - channels-and-reducers.md §append + §TTL
 *   - node-packs.md §Reserved Core openwop typeIds → core.channelWrite
 *   - spec gap G5
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-channel-ttl';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

interface ChannelEntry {
  value: unknown;
  _ts: number;
}

describe.skipIf(SKIP_NO_FIXTURE)('channel-ttl: conformance-channel-ttl drops entries older than ttlMs at write time', () => {
  it('after the post-TTL write, the channel contains exactly one entry with value "d"', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, req('openwop.it.channel-ttl.after-the-post-ttl-write-the-channel-contains-exactly-one-entry-with-value-d', 
      'fixtures.md conformance-channel-ttl §Terminal status',
      'fixture MUST reach terminal `completed`',
    )).toBe('completed');

    const variables = terminal.variables ?? {};
    const events = variables.events as ChannelEntry[] | undefined;

    expect(Array.isArray(events), req('openwop.it.channel-ttl.after-the-post-ttl-write-the-channel-contains-exactly-one-entry-with-value-d', 
      'channels-and-reducers.md §append',
      'channel state MUST be stored as an array of {value, _ts} entries',
    )).toBe(true);

    expect(events!.length, req('openwop.it.channel-ttl.after-the-post-ttl-write-the-channel-contains-exactly-one-entry-with-value-d', 
      'channels-and-reducers.md §TTL — write-time filter',
      'after the post-TTL write, exactly 1 entry MUST remain (the 3 priors aged out)',
    )).toBe(1);

    expect(events![0].value, req('openwop.it.channel-ttl.after-the-post-ttl-write-the-channel-contains-exactly-one-entry-with-value-d', 
      'fixtures.md conformance-channel-ttl §Topology',
      'the surviving entry MUST be the post-delay write (value "d")',
    )).toBe('d');

    expect(typeof events![0]._ts, req('openwop.it.channel-ttl.after-the-post-ttl-write-the-channel-contains-exactly-one-entry-with-value-d', 
      'channels-and-reducers.md §append entry shape',
      'each channel entry MUST carry a numeric `_ts` write timestamp',
    )).toBe('number');
    expect(events![0]._ts).toBeGreaterThan(0);
  });
});
