import type { Ctx } from './context.js';
/** Run-event streaming + REPL rendering — SSE with JSON-poll fallback. */

import { createInterface } from 'node:readline';
import { requestJson } from './api.js';
import { CliError, HttpError } from './errors.js';
import { sleep } from './util.js';

const CHAT_TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

/** Create a run and return its runId (throws if the response omits one). */
export async function submitTurn(ctx: Ctx, { workflowId, inputs, tenantId, scopeId }: any): Promise<string> {
  const body = {
    workflowId,
    ...(tenantId ? { tenantId } : {}),
    ...(scopeId ? { scopeId } : {}),
    inputs: inputs ?? {},
  };
  const res = await requestJson(ctx, '/v1/runs', { method: 'POST', body });
  if (!res.body || typeof res.body.runId !== 'string') {
    throw new CliError('Run create response did not include a runId');
  }
  return res.body.runId;
}

/**
 * Stream a run's events. Prefers SSE; on any SSE failure (non-streamable
 * body, non-2xx, or transport error) falls back to the JSON poll endpoint.
 * Calls `onEvent(eventRecord)` once per event in sequence order and resolves
 * when a terminal event is seen or the poll endpoint reports completion.
 */
export async function streamRunEvents(ctx: Ctx, runId: string, { onEvent, useStream = true, timeoutMs = 120000 }: { onEvent?: (e: any) => void; useStream?: boolean; timeoutMs?: number } = {}) {
  if (useStream) {
    try {
      const handled = await streamViaSse(ctx, runId, onEvent);
      if (handled) return;
    } catch {
      // Fall through to polling.
    }
  }
  await streamViaPoll(ctx, runId, onEvent, timeoutMs);
}

async function streamViaSse(ctx: Ctx, runId: string, onEvent: any) {
  const url = new URL(`/v1/runs/${encodeURIComponent(runId)}/events`, ctx.baseUrl);
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (ctx.apiKey) headers.authorization = `Bearer ${ctx.apiKey}`;
  const res = await ctx.fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const ct = res.headers?.get?.('content-type') ?? '';
  if (!ct.includes('text/event-stream') || !res.body || typeof res.body.getReader !== 'function') {
    // Server answered with JSON (or a non-streamable body) — let the
    // caller fall back to polling rather than mis-parsing.
    return false;
  }
  await consumeSse(res.body, (frame: any) => {
    if (frame.data === undefined) return;
    const ev = safeParseJson(frame.data);
    if (frame.event === 'batch' && Array.isArray(ev)) {
      for (const one of ev) onEvent(one);
    } else if (ev && typeof ev === 'object') {
      onEvent(ev);
    }
  });
  return true;
}

/**
 * Decode a web ReadableStream of SSE bytes into frames. Exported for tests so
 * the line-buffering / multi-line `data:` accumulation can be exercised
 * without a live socket. `onFrame` receives `{ event, data, id }`.
 */
export async function consumeSse(stream: any, onFrame: any) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flushFrame = (block: string) => {
    if (!block.trim()) return;
    const frame: Record<string, string> = {};
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue; // blank or comment/heartbeat
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'data') dataLines.push(value);
      else if (field === 'event') frame.event = value;
      else if (field === 'id') frame.id = value;
    }
    if (dataLines.length > 0) frame.data = dataLines.join('\n');
    if (frame.data !== undefined || frame.event !== undefined) onFrame(frame);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      flushFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
    if (done) {
      flushFrame(buffer);
      break;
    }
  }
}

async function streamViaPoll(ctx: Ctx, runId: string, onEvent: any, timeoutMs: number) {
  const started = Date.now();
  let lastSequence = -1;
  while (Date.now() - started < timeoutMs) {
    const query = lastSequence >= 0 ? `?lastSequence=${lastSequence}` : '';
    const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(runId)}/events/poll${query}`);
    const events = Array.isArray(res.body?.events) ? res.body.events : [];
    for (const ev of events) {
      onEvent(ev);
      if (typeof ev.sequence === 'number' && ev.sequence > lastSequence) lastSequence = ev.sequence;
    }
    const sawTerminal = events.some((ev: any) => CHAT_TERMINAL_EVENT_TYPES.has(ev.type));
    if (res.body?.isComplete === true || sawTerminal) return;
    await sleep(250);
  }
  throw new CliError(`Timed out streaming run ${runId} after ${timeoutMs}ms`, 1);
}

/**
 * Pretty-print one event record for the REPL. Returns null for events that
 * carry no useful surface (so the loop can skip them). Exported for tests.
 */
export function renderEvent(ev: any): string | null {
  if (!ev || typeof ev !== 'object') return null;
  const type = String(ev.type ?? 'event');
  const node = ev.nodeId ? ` ${ev.nodeId}` : '';
  switch (type) {
    case 'run.started':
      return '· run started';
    case 'node.started':
      return `·${node} running`;
    case 'node.completed': {
      const reply = extractAssistantText(ev);
      return reply ? `assistant> ${reply}` : `·${node} done`;
    }
    case 'run.completed': {
      const reply = extractAssistantText(ev);
      return reply ? `assistant> ${reply}` : '· run completed';
    }
    case 'node.failed':
    case 'run.failed': {
      const msg = errorMessageOf(ev);
      return `! ${type}${node}${msg ? `: ${msg}` : ''}`;
    }
    case 'run.cancelled':
      return '· run cancelled';
    default:
      return `· ${type}`;
  }
}

/**
 * Pull assistant-visible text out of an event payload. Handles the common
 * shapes the sample chat node emits: a `messages` array, an `output`/`result`
 * string, or a nested `content` field. Exported for tests.
 */
export function extractAssistantText(ev: any): string | null {
  const payload = ev && typeof ev === 'object' ? ev.payload : undefined;
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [payload.output, payload.result, payload.text, payload.content, payload.message];
  for (const c of candidates) {
    const t = coerceText(c);
    if (t) return t;
  }
  if (payload.outputs && typeof payload.outputs === 'object') {
    for (const v of Object.values(payload.outputs)) {
      const t = coerceText(v);
      if (t) return t;
    }
  }
  if (Array.isArray(payload.messages)) {
    for (let i = payload.messages.length - 1; i >= 0; i--) {
      const m = payload.messages[i];
      if (m && m.role === 'assistant') {
        const t = coerceText(m.content);
        if (t) return t;
      }
    }
  }
  return null;
}

function coerceText(value: any): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value)) {
      const joined = value.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
      return joined.length > 0 ? joined : null;
    }
  }
  return null;
}

function errorMessageOf(ev: any): string {
  const payload = ev && typeof ev === 'object' ? ev.payload : undefined;
  if (payload && typeof payload === 'object') {
    if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
    if (typeof payload.message === 'string') return payload.message;
  }
  return '';
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Default stdin line reader for the REPL. Resolves with each line, or null on
 * EOF (Ctrl-D). Uses readline so piped input and TTY input both work.
 */
export function defaultReadTurn(ctx: Ctx): (prompt: string) => Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  let closed = false;
  rl.on('close', () => { closed = true; });
  return (prompt: string) => new Promise((resolve) => {
    if (closed) { resolve(null); return; }
    if (!ctx.json) ctx.io.stdout.write(prompt);
    const onLine = (line: string) => { rl.removeListener('close', onClose); resolve(line); };
    const onClose = () => { rl.removeListener('line', onLine); resolve(null); };
    rl.once('line', onLine);
    rl.once('close', onClose);
  });
}
