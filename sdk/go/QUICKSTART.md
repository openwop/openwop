# `openwopclient` Go Quickstart

5-minute walkthrough: install the SDK, boot the in-memory reference host on your laptop, and run an end-to-end workflow lifecycle. Zero external services required.

> Prefer the wire-level walkthrough? See the top-level [`QUICKSTART.md`](../../QUICKSTART.md) — language-agnostic, curl-based, deeper coverage.

## Prerequisites

- Go 1.22+
- Node 20+ (only to run the in-memory reference host below; the SDK itself has zero runtime deps)
- A clone of `github.com/openwop/openwop`

## Install

```bash
go get github.com/openwop/openwop/sdk/go
```

The SDK is **stdlib-only at runtime** — `net/http` for HTTP, no `gorilla`/`fiber`/`chi`. Idiomatic Go: explicit `context.Context` on every method, structured errors, typed response bodies.

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

Create `quickstart.go`:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	openwopclient "github.com/openwop/openwop/sdk/go"
)

func main() {
	ctx := context.Background()

	client, err := openwopclient.NewClient("http://127.0.0.1:3737", "openwop-inmem-dev-key")
	if err != nil {
		log.Fatal(err)
	}

	// 1. Discovery — confirm protocol version + advertised capabilities.
	discovery, err := client.Discovery(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("protocol: %s\n", discovery.ProtocolVersion)
	fmt.Printf("transports: %v\n", discovery.SupportedTransports)

	// 2. Create a run against a conformance fixture.
	run, err := client.CreateRun(ctx, &openwopclient.CreateRunRequest{
		WorkflowID: "conformance-noop",
		Inputs:     map[string]any{},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("created run: %s (status=%s)\n", run.RunID, run.Status)

	// 3. Poll the snapshot until terminal.
	for {
		snap, err := client.GetRun(ctx, run.RunID)
		if err != nil {
			log.Fatal(err)
		}
		if snap.Status == "completed" || snap.Status == "failed" || snap.Status == "cancelled" {
			fmt.Printf("terminal: %s\n", snap.Status)
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// 4. Read the event log (poll mode — JSON).
	events, err := client.GetRunEventsPoll(ctx, run.RunID, nil)
	if err != nil {
		log.Fatal(err)
	}
	for _, e := range events.Events {
		fmt.Printf("  %3d  %s\n", e.Sequence, e.Type)
	}
}
```

Run it:

```bash
go run quickstart.go
```

Expected output:

```
protocol: 1.0
transports: [rest]
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
| Discovery | `client.Discovery(ctx)` | [`capabilities.md`](../../spec/v1/capabilities.md) |
| Create run | `client.CreateRun(ctx, &CreateRunRequest{...})` | [`rest-endpoints.md`](../../spec/v1/rest-endpoints.md) `POST /v1/runs` |
| Poll snapshot | `client.GetRun(ctx, runID)` | [`rest-endpoints.md`](../../spec/v1/rest-endpoints.md) `GET /v1/runs/{runId}` |
| Read events | `client.GetRunEventsPoll(ctx, runID, nil)` | [`rest-endpoints.md`](../../spec/v1/rest-endpoints.md) `GET /v1/runs/{runId}/events` (JSON mode) |

Every method on `Client` maps 1:1 to an OpenAPI operation in [`api/openapi.yaml`](../../api/openapi.yaml).

## Streaming events (live SSE)

```go
ch, err := client.StreamRunEvents(ctx, run.RunID)
if err != nil {
	log.Fatal(err)
}
for event := range ch {
	fmt.Printf("%s: %v\n", event.Type, event.Payload)
	if event.Type == "run.completed" || event.Type == "run.failed" || event.Type == "run.cancelled" {
		break
	}
}
```

`StreamRunEvents` returns a buffered `<-chan RunEvent` — the goroutine reading the SSE socket closes the channel on `run.{completed,failed,cancelled}`. Cancel `ctx` to terminate early.

## Next steps

- **Survey the wire surface:** [`README.md`](./README.md) §"Endpoint coverage" lists every method.
- **Auth profiles:** [`auth-profiles.md`](../../spec/v1/auth-profiles.md) — API-key rotation, OAuth2 client credentials, OIDC user-bearer, mTLS.
- **Webhooks:** subscribe to run events out-of-band; see [`webhooks.md`](../../spec/v1/webhooks.md).
- **Replay:** time-travel debugging via `POST /v1/runs/{runId}:fork`; see [`replay.md`](../../spec/v1/replay.md).
- **Build your own host:** [`examples/hosts/sqlite/README.md`](../../examples/hosts/sqlite/README.md) doubles as a "Build Your Own Host" walkthrough.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dial tcp 127.0.0.1:3737: connect: connection refused` | The in-memory host isn't running | Boot `npm start` in `examples/hosts/in-memory/` first |
| `401 Unauthorized` from the API | API key mismatch | Pass `openwop-inmem-dev-key` as the second arg to `NewClient` |
| Run never reaches terminal | Workflow uses a fixture the host doesn't advertise | Check `discovery.Fixtures` — only listed fixtures will start |
| `go: github.com/openwop/openwop/sdk/go: missing go.sum entry` | First install | Run `go mod tidy` to populate `go.sum` |
