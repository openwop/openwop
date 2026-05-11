# Streaming Client

OpenWOP SSE event-stream consumer. Connects to a run's `/events` endpoint and prints each event as it arrives, exiting on the terminal event.

## Run

Against the in-memory reference host (start it in another terminal first — see `examples/hosts/in-memory/`):

```bash
npm start
```

Output:

```
→ POST /v1/runs { workflowId: "conformance-noop" }
  runId: run-...
→ Streaming /v1/runs/run-.../events
  [0] run.started
  [1] node.started node=noop
  [2] node.completed node=noop
  [3] run.completed
✓ Stream closed after 4 events
```

Override the workflow:

```bash
OPENWOP_WORKFLOW=conformance-cancellable npm start
```

## What this teaches

- SSE connect: `Accept: text/event-stream` + read response body as a stream.
- Frame parsing: events are `event:` + `data:` lines separated by blank lines.
- Backlog replay: on connect, the host replays prior events before catching up to live.
- Terminal close: the host closes the connection after `run.completed` / `run.failed` / `run.cancelled` so the client's loop exits cleanly without explicit polling.

## ~110 lines, zero dependencies

Pure Node `fetch` + a hand-written 25-line SSE parser. Real SDKs use `eventsource` (npm) or equivalent — but the protocol is small enough that a one-file implementation is correct.

For a more production-grade client with reconnect-with-Last-Event-ID semantics, use `@openwop/openwop` which handles reconnection automatically.
