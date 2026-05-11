# Idempotent Runs

Demonstrates Layer-1 HTTP idempotency per `spec/v1/idempotency.md`. Three identical `POST /v1/runs` calls with the same `Idempotency-Key` collapse to a single run; a fourth call with the same key but a different body returns 409.

## Run

Against the in-memory reference host (start it in another terminal first — see `examples/hosts/in-memory/`):

```bash
npm start
```

Output:

```
Idempotency-Key: idempotent-example-3b...

→ Call 1 (fresh)
  status:  201
  runId:   run-...abc
  replay:  false
→ Call 2 (same key, same body — expect cached replay)
  status:  201
  runId:   run-...abc
  replay:  true
→ Call 3 (same key, same body — expect cached replay)
  status:  201
  runId:   run-...abc
  replay:  true

✓ All three responses share runId run-...abc

→ Call 4 (same key, DIFFERENT body — expect 409 conflict)
  status: 409
  error:  idempotency_key_conflict
✓ Body conflict correctly rejected
```

## What this teaches

- **Same key + same body** → cached replay. Server returns the original response with `openwop-Idempotent-Replay: true`.
- **Same key + different body** → `409 idempotency_key_conflict`. The key pins exactly one logical operation; reusing it for a different request is caller misuse.
- The `openwop-Idempotent-Replay` response header lets clients distinguish "fresh result" from "replayed result" — useful for analytics and audit.

## Why this matters

A network blip, retry storm, or competing tab can cause the same logical operation to fire multiple times. Without idempotency, each retry would create a new run (extra cost, race conditions, duplicate side effects). With `Idempotency-Key`, the second-through-Nth call gets the same response cheaply, no matter how many retries happen.

Per `spec/v1/idempotency.md`, hosts MUST handle ≥5 retries 100ms apart with the cached response — drive a retry storm against a host and every retry should land on the same `runId`.

## ~80 lines, zero dependencies

Pure Node `fetch`. The protocol contract is what's interesting; the client code is incidental.
