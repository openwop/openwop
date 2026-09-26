/**
 * Self-tests for the RFC 0111 transcript-window checker — each sabotage the
 * 2026-09-26 correction names, run against the pure checker so the claim
 * "this row can fail" is itself tested. A host is modelled by its seam answer
 * plus its event log.
 */
import { describe, it, expect } from 'vitest';
import { checkTranscriptWindow, charCount, parseTranscriptWindow, summaryTexts, summarizationDeclared, type LogEvent, type TranscriptWindow } from './context-budget.js';

const ev = (eventId: string, sequence: number, type = 'agent.decided', nodeId = 'worker', payload: Record<string, unknown> = {}): LogEvent => ({ eventId, sequence, type, nodeId, payload });
// Six worker decisions, then the supervisor's decision for iteration 2 at seq 7.
const LOG: LogEvent[] = [
  ev('e1', 1), ev('e2', 2), ev('e3', 3), ev('e4', 4), ev('e5', 5), ev('e6', 6),
  ev('d2', 7, 'runOrchestrator.decided', 'supervisor', { iteration: 2 }),
];
const CAP = { transcriptTokenBudget: 12, tokenCounter: 'chars' };
const win = (ids: string[], texts: string[], tokenCount = texts.reduce((n, t) => n + charCount(t), 0)): TranscriptWindow => ({
  tokenCounter: 'chars', tokenCount, eventIds: ids, summarizedRanges: [], entries: ids.map((eventId, i) => ({ eventId, rendered: texts[i] })),
});

describe('context-budget checker — a host that honours the budget', () => {
  it('a recent tail that evicted older events is consistent AND shows pressure', () => {
    const v = checkTranscriptWindow(2, win(['e4', 'e5', 'e6'], ['aaaa', 'bbbb', 'cccc']), CAP, LOG);
    expect(v.violations).toEqual([]);
    expect(v.pressure).toBe(true);
  });
  it('chars is code points: an emoji counts once', () => {
    expect(charCount('a😀b')).toBe(3);
  });
});

describe('context-budget checker — each sabotage fails or withholds the full witness', () => {
  it('never evicts (budget far above the run) ⇒ no pressure, so the scenario can only record partial-witness', () => {
    const v = checkTranscriptWindow(2, win(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'], ['a', 'b', 'c', 'd', 'e', 'f']), { transcriptTokenBudget: 1e9, tokenCounter: 'chars' }, LOG);
    expect(v.violations).toEqual([]);
    expect(v.pressure).toBe(false);
  });
  it('rendered text that does not sum to tokenCount ⇒ violation', () => {
    const v = checkTranscriptWindow(2, win(['e5', 'e6'], ['aaaa', 'bbbb'], 3), CAP, LOG);
    expect(v.violations.join('\n')).toMatch(/sum to 8 chars but tokenCount is 3/);
  });
  it('a non-tail id set (an older event fed while a newer eligible one is dropped) ⇒ violation', () => {
    const v = checkTranscriptWindow(2, win(['e3', 'e6'], ['aaaa', 'bbbb']), CAP, LOG);
    expect(v.violations.join('\n')).toMatch(/"e4".*dropped while an older one/);
  });
  it('an unknown eventId ⇒ violation', () => {
    const v = checkTranscriptWindow(2, win(['e5', 'zz'], ['aaaa', 'bbbb']), CAP, LOG);
    expect(v.violations.join('\n')).toMatch(/"zz" is not an event of this run/);
  });
  it('chars advertised but no entries[] ⇒ violation, never a silent pass', () => {
    const v = checkTranscriptWindow(2, { tokenCounter: 'chars', tokenCount: 4, eventIds: ['e6'], summarizedRanges: [] }, CAP, LOG);
    expect(v.violations.join('\n')).toMatch(/no entries\[\]/);
  });
  it('over budget ⇒ violation', () => {
    const v = checkTranscriptWindow(2, win(['e4', 'e5', 'e6'], ['aaaaa', 'bbbbb', 'ccccc']), CAP, LOG);
    expect(v.violations.join('\n')).toMatch(/exceeds transcriptTokenBudget 12/);
  });
  it('feeding the iteration its own future ⇒ violation', () => {
    const log = [...LOG, ev('e7', 8)];
    const v = checkTranscriptWindow(2, win(['e6', 'e7'], ['aa', 'bb']), CAP, log);
    expect(v.violations.join('\n')).toMatch(/at or after the iteration's own decision/);
  });
  it('another node\'s events of the same type are NOT eligible — an honest host feeding only the worker is not convicted', () => {
    const log = [...LOG.slice(0, 6), ev('s1', 5.5, 'agent.decided', 'supervisor'), LOG[6]];
    const v = checkTranscriptWindow(2, win(['e5', 'e6'], ['aaaa', 'bbbb']), CAP, log);
    expect(v.violations).toEqual([]);
  });
  it('without an event log the log rules are UNMEASURED, not passed', () => {
    const v = checkTranscriptWindow(2, win(['e5', 'e6'], ['aaaa', 'bbbb']), CAP, null);
    expect(v.unmeasured.length).toBe(1);
    expect(v.pressure).toBe(false);
  });
});

describe('context-budget checker — summaries and parsing', () => {
  const SUM: LogEvent = ev('s', 6.5, 'context.summarized', 'supervisor', { summaryRef: 'art-1', replacedTurns: ['e1', 'e2', 'e3'] });
  const log = [...LOG.slice(0, 6), SUM, LOG[6]];
  const w: TranscriptWindow = {
    tokenCounter: 'chars', tokenCount: 10, eventIds: ['e4', 'e5', 'e6'],
    summarizedRanges: [{ summaryRef: 'art-1', replacedTurns: ['e1', 'e2', 'e3'] }],
    entries: [{ eventId: 's', rendered: 'sum' }, { eventId: 'e4', rendered: 'aa' }, { eventId: 'e5', rendered: 'bb' }, { eventId: 'e6', rendered: 'ccc' }],
  };
  it('a summary entry counts toward the recount and is the model-facing summary text', () => {
    expect(checkTranscriptWindow(2, w, CAP, log).violations).toEqual([]);
    expect(summaryTexts(w, log)).toEqual(['sum']);
  });
  it('a summary entry not listed in summarizedRanges ⇒ violation', () => {
    const v = checkTranscriptWindow(2, { ...w, summarizedRanges: [] }, CAP, log);
    expect(v.violations.join('\n')).toMatch(/not listed in summarizedRanges/);
  });
  it('a malformed entries[] makes the whole window unparseable', () => {
    expect(parseTranscriptWindow({ tokenCounter: 'chars', tokenCount: 1, eventIds: [], entries: [{ eventId: 'x' }] })).toBeUndefined();
    expect(parseTranscriptWindow({ tokenCounter: 'chars', tokenCount: 1, eventIds: ['x'], entries: [{ eventId: 'x', rendered: 'y' }] })?.entries?.length).toBe(1);
  });
  it('summarization is declared by `supported: true` at major 1 and by presence at major 2', () => {
    expect(summarizationDeclared({ summarization: { supported: true } }, 1)).toBe(true);
    expect(summarizationDeclared({ summarization: {} }, 1)).toBe(false);
    expect(summarizationDeclared({ summarization: { strategy: 'sliding' } }, 2)).toBe(true);
    expect(summarizationDeclared({}, 2)).toBe(false);
  });
});
