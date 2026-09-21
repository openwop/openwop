/**
 * RFC 0158 §E item 11 — watching a run across a real process death.
 *
 * Two facts are wanted from one watch: (a) did resumption appear within the
 * budget, and (b) was the run EVER observable as `completed` without having
 * been re-executed. (b) is a statement about two pieces of host state — the
 * status and the log — and they come from two requests, so the ORDER of the
 * reads decides whether a conclusion is sound.
 *
 * Until 2.33.1 each iteration read the LOG, then the STATUS, and latched (b)
 * when the status said `completed` and the (older) log showed no resumption. A
 * host that re-dispatched between the two requests therefore read as "completed
 * un-re-executed" while being neither: the log read predated the re-execution,
 * the status read followed its completion. The staged work is `conformance-noop`,
 * which re-executes in milliseconds, so the window is real — per run roughly
 * (gap between the two requests) / (poll interval), a few percent. Measured on
 * a tier-1 host: after a genuine SIGKILL and a correct recovery by lease expiry
 * (727 s, inside a declared 750 s bound), the row failed with the message
 * "read status completed with 2 run.started" — it printed the re-execution it
 * was denying, because the message used a LATER read than the latch did. It had
 * passed on the two previous runs of the same host and code.
 *
 * The rule: STATUS FIRST, LOG SECOND. A run's log is append-only, so a log read
 * taken AFTER a `completed` status can only show MORE than the status implied.
 * If that later log still shows no resumption, the run really was observable as
 * completed un-re-executed. If it shows resumption, nothing was wrong. If it is
 * unreadable, nothing is concluded — an unreadable log is never evidence.
 *
 * Readers are injected so the ordering itself is testable without a host.
 */
export interface Observation { readonly readable: boolean; readonly runStarted: number; readonly nodeStarted: number; readonly restored: number }
export interface Watch { readonly resumedAfterMs: number | null; readonly last: Observation; readonly completedUnresumed: boolean; readonly waitedMs: number; readonly transportErrors: number }
export interface WatchIo {
  readStatus(): Promise<string | null>;
  readLog(): Promise<Observation>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const UNREADABLE: Observation = { readable: false, runStarted: 0, nodeStarted: 0, restored: 0 };

/**
 * A TRANSPORT failure is an unreadable observation, never a verdict (2.34.2).
 *
 * The kill rows are the one place the suite causes the host to disappear, and a
 * seam may kill at a point AFTER it has answered - `during-execution` dies at
 * the first `node.started`, which can land seconds later. `waitBack()` already
 * treated a refused connection as "down, keep waiting"; these two reads did
 * not, so a process that died mid-watch threw `fetch failed` out of the
 * scenario and failed the row - for recovering. Measured on a tier-1 host at
 * its production image, behind a port proxy that accepts and then closes: four
 * of five RFC 0158 rows `executed-fail` on `UND_ERR_SOCKET: other side closed`,
 * twice. A status that cannot be read is `null`; a log that cannot be read is
 * `readable: false` - both already mean "conclude nothing, poll again", and the
 * budget still bounds the wait, so a host that never comes back still fails.
 */
async function orNull<T>(read: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try { return { value: await read(), failed: false }; } catch { return { value: fallback, failed: true }; }
}

export async function watchForResumption(io: WatchIo, budgetMs: number, resumed: (o: Observation) => boolean, pollMs = 500): Promise<Watch> {
  const t0 = io.now();
  let completedUnresumed = false;
  let transportErrors = 0;
  for (;;) {
    const st = await orNull(() => io.readStatus(), null);   // FIRST
    const lg = await orNull(() => io.readLog(), UNREADABLE); // SECOND — never older than the status it is judged against
    if (st.failed || lg.failed) transportErrors++;
    const status = st.value; const last = lg.value;
    const waitedMs = io.now() - t0;
    const isResumed = last.readable && resumed(last);
    if (status === 'completed' && last.readable && !isResumed) completedUnresumed = true;
    if (isResumed) return { resumedAfterMs: waitedMs, last, completedUnresumed, waitedMs, transportErrors };
    if (waitedMs >= budgetMs) return { resumedAfterMs: null, last, completedUnresumed, waitedMs, transportErrors };
    await io.sleep(pollMs);
  }
}
