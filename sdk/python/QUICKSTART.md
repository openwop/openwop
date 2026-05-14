# `openwop-client` Python Quickstart

5-minute walkthrough: install the SDK, boot the in-memory reference host on your laptop, and run an end-to-end workflow lifecycle. Zero external services required.

> Prefer the wire-level walkthrough? See the top-level [`QUICKSTART.md`](../../QUICKSTART.md) — language-agnostic, curl-based, deeper coverage.

## Prerequisites

- Python 3.11+
- Node 20+ (only to run the in-memory reference host below; the SDK itself has zero runtime deps)
- A clone of `github.com/openwop/openwop`

## Install

```bash
pip install openwop-client
```

The SDK is **stdlib-only at runtime** — `urllib.request` for HTTP, no `requests`/`httpx`/`pydantic`.

## Boot the in-memory reference host

In one terminal:

```bash
cd examples/hosts/in-memory
npm install
npm start
# → [openwop-host-in-memory] listening on http://127.0.0.1:3737 (api key: openwop-inmem-dev-key, 46 fixtures loaded)
```

The host loads 46 [conformance fixtures](../../conformance/fixtures.md) so the example below has workflows to run against.

## Walkthrough

Create `quickstart.py`:

```python
from openwop_client import OpenwopClient, CreateRunRequest

client = OpenwopClient(
    base_url="http://127.0.0.1:3737",
    api_key="openwop-inmem-dev-key",
)

# 1. Discovery — confirm protocol version + advertised capabilities.
discovery = client.discovery()
print(f"protocol: {discovery.protocol_version}")
print(f"transports: {discovery.supported_transports}")

# 2. Create a run against a conformance fixture.
run = client.create_run(
    CreateRunRequest(
        workflow_id="conformance-noop",
        inputs={},
    )
)
print(f"created run: {run.run_id} (status={run.status})")

# 3. Poll the snapshot until terminal.
import time
while True:
    snap = client.get_run(run.run_id)
    if snap.status in ("completed", "failed", "cancelled"):
        print(f"terminal: {snap.status}")
        break
    time.sleep(0.1)

# 4. Read the event log (poll mode — JSON).
events = client.get_run_events_poll(run.run_id)
for e in events.events:
    print(f"  {e.sequence:>3}  {e.type}")
```

Run it:

```bash
python quickstart.py
```

Expected output:

```
protocol: 1.0
transports: ['rest']
created run: run-<uuid> (status=pending)
terminal: completed
    0  run.started
    1  node.started
    2  node.completed
    3  run.completed
```

## What you exercised

| Step | SDK method | Spec |
|---|---|---|
| Discovery | `client.discovery()` | [`capabilities.md`](../../spec/v1/capabilities.md) |
| Create run | `client.create_run(CreateRunRequest)` | [`rest-endpoints.md`](../../spec/v1/rest-endpoints.md) `POST /v1/runs` |
| Poll snapshot | `client.get_run(run_id)` | [`rest-endpoints.md`](../../spec/v1/rest-endpoints.md) `GET /v1/runs/{runId}` |
| Read events | `client.get_run_events_poll(run_id)` | [`rest-endpoints.md`](../../spec/v1/rest-endpoints.md) `GET /v1/runs/{runId}/events` (JSON mode) |

Every method on `OpenwopClient` maps 1:1 to an OpenAPI operation in [`api/openapi.yaml`](../../api/openapi.yaml).

## Streaming events (live SSE)

```python
for event in client.stream_run_events(run.run_id):
    print(f"{event.type}: {event.payload}")
    if event.type in ("run.completed", "run.failed", "run.cancelled"):
        break
```

`stream_run_events` is a generator-style iterator over the SSE stream — pure stdlib (`urllib.request` + manual frame parsing).

## Next steps

- **Survey the wire surface:** [`README.md`](./README.md) §"Endpoint coverage" lists every method.
- **Auth profiles:** [`auth-profiles.md`](../../spec/v1/auth-profiles.md) — API-key rotation, OAuth2 client credentials, OIDC user-bearer, mTLS.
- **Webhooks:** subscribe to run events out-of-band; see [`webhooks.md`](../../spec/v1/webhooks.md).
- **Replay:** time-travel debugging via `POST /v1/runs/{runId}:fork`; see [`replay.md`](../../spec/v1/replay.md).
- **Build your own host:** [`examples/hosts/sqlite/README.md`](../../examples/hosts/sqlite/README.md) doubles as a "Build Your Own Host" walkthrough.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `urllib.error.URLError: <urlopen error [Errno 61] Connection refused>` | The in-memory host isn't running | Boot `npm start` in `examples/hosts/in-memory/` first |
| `401 Unauthorized` from the API | API key mismatch | Set `OPENWOP_API_KEY=openwop-inmem-dev-key` (or pass `api_key=...` explicitly to `OpenwopClient`) |
| Run never reaches terminal | Workflow uses a fixture the host doesn't advertise | Check `client.discovery().fixtures` — only listed fixtures will start |
