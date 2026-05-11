// Streaming-client example — consume a run's event stream via SSE.
//
// 1. POST /v1/runs                            — create a run
// 2. GET  /v1/runs/{runId}/events             — connect to the SSE stream
// 3. Print each event until the terminal one arrives
//
// The host's SSE stream replays the backlog on connect and closes on
// the terminal event (run.completed / run.failed / run.cancelled), so
// we don't need a separate "is this run done?" polling loop.
//
// Configuration via env vars:
//   OPENWOP_BASE_URL   default http://127.0.0.1:3737
//   OPENWOP_API_KEY    default openwop-inmem-dev-key
//   OPENWOP_WORKFLOW   default conformance-noop
//
// Zero external dependencies — Node 20+ fetch + manual SSE parsing.

const BASE_URL = process.env.OPENWOP_BASE_URL ?? 'http://127.0.0.1:3737';
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-inmem-dev-key';
const WORKFLOW = process.env.OPENWOP_WORKFLOW ?? 'conformance-noop';
const TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

async function createRun(workflowId) {
  const res = await fetch(`${BASE_URL}/v1/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workflowId }),
  });
  if (res.status !== 201) {
    throw new Error(`Run create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Minimal SSE frame parser. Per the SSE spec (W3C) a frame is a sequence
// of field-name lines (event/id/data/retry/comment) terminated by a
// blank line. We only care about `event` and `data` here.
function parseSseFrames(text, carry) {
  const buffer = carry + text;
  const frames = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const blankLine = buffer.indexOf('\n\n', cursor);
    if (blankLine < 0) break;
    const frame = buffer.slice(cursor, blankLine);
    cursor = blankLine + 2;
    const fields = {};
    for (const line of frame.split('\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      fields[name] = (fields[name] ?? '') + value;
    }
    if (fields.event || fields.data) {
      frames.push({
        event: fields.event ?? 'message',
        data: fields.data ?? '',
        id: fields.id,
      });
    }
  }
  return { frames, carry: buffer.slice(cursor) };
}

async function streamEvents(runId, onEvent) {
  const res = await fetch(
    `${BASE_URL}/v1/runs/${encodeURIComponent(runId)}/events`,
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'text/event-stream',
      },
    },
  );
  if (!res.ok) throw new Error(`Stream connect failed: ${res.status}`);
  if (!res.body) throw new Error('Response body is not streamable');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let carry = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const { frames, carry: newCarry } = parseSseFrames(chunk, carry);
    carry = newCarry;
    for (const frame of frames) {
      let payload;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        payload = { raw: frame.data };
      }
      if (await onEvent(frame.event, payload) === 'stop') return;
    }
  }
}

async function main() {
  console.log(`→ POST /v1/runs { workflowId: "${WORKFLOW}" }`);
  const created = await createRun(WORKFLOW);
  console.log(`  runId: ${created.runId}`);

  console.log(`→ Streaming /v1/runs/${created.runId}/events`);
  let count = 0;
  await streamEvents(created.runId, async (eventType, payload) => {
    count++;
    const seq = payload.seq ?? payload.sequence ?? '?';
    const node = payload.nodeId ? ` node=${payload.nodeId}` : '';
    console.log(`  [${seq}] ${eventType}${node}`);
    if (TERMINAL_TYPES.has(eventType)) return 'stop';
  });
  console.log(`✓ Stream closed after ${count} events`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
