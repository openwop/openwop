// Go smoke for github.com/openwop/openwop/sdk/go.
//
// Exercises the wire round-trip against a running SQLite reference host:
//   1. Capability discovery (unauthenticated)
//   2. Run create + terminal poll for `conformance-noop`
//   3. Error envelope on unknown workflowId
//
// Exits non-zero on any contract violation. Run from repo root with the
// SQLite host listening on 127.0.0.1:3838 (default OPENWOP_BASE_URL).

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	openwop "github.com/openwop/openwop/sdk/go"
)

const fixture = "conformance-noop"

var terminalStatuses = map[openwop.RunStatus]bool{
	openwop.StatusCompleted: true,
	openwop.StatusFailed:    true,
	openwop.StatusCancelled: true,
}

func fail(msg string) {
	fmt.Fprintf(os.Stderr, "[smoke-go] FAIL: %s\n", msg)
	os.Exit(1)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func pollTerminal(ctx context.Context, client *openwop.OpenwopClient, runID string) openwop.RunStatus {
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		snap, err := client.GetRun(ctx, runID)
		if err != nil {
			fail(fmt.Sprintf("GetRun failed: %v", err))
		}
		if terminalStatuses[snap.Status] {
			return snap.Status
		}
		time.Sleep(50 * time.Millisecond)
	}
	fail(fmt.Sprintf("run %s did not terminate within 10s", runID))
	return ""
}

func main() {
	baseURL := envOr("OPENWOP_BASE_URL", "http://127.0.0.1:3838")
	apiKey := envOr("OPENWOP_API_KEY", "openwop-sqlite-dev-key")

	client, err := openwop.NewClient(baseURL, apiKey)
	if err != nil {
		fail(fmt.Sprintf("NewClient: %v", err))
	}

	ctx := context.Background()

	// 1. Discovery
	caps, err := client.GetCapabilities(ctx)
	if err != nil {
		fail(fmt.Sprintf("GetCapabilities: %v", err))
	}
	if caps.ProtocolVersion != "1.0" {
		fail(fmt.Sprintf("protocolVersion %s != 1.0", caps.ProtocolVersion))
	}

	// 2. Run + poll
	create, err := client.CreateRun(ctx, openwop.CreateRunRequest{WorkflowID: fixture}, openwop.MutationOptions{})
	if err != nil {
		fail(fmt.Sprintf("CreateRun: %v", err))
	}
	if create.RunID == "" {
		fail("CreateRun did not return RunID")
	}
	if create.EventsURL == "" {
		fail("CreateRun did not return EventsURL")
	}
	terminal := pollTerminal(ctx, client, create.RunID)
	if terminal != openwop.StatusCompleted {
		fail(fmt.Sprintf("terminal status %s != completed", terminal))
	}

	// 3. Error envelope on bad workflow
	_, err = client.CreateRun(ctx, openwop.CreateRunRequest{WorkflowID: "__does_not_exist__"}, openwop.MutationOptions{})
	if err == nil {
		fail("expected error for unknown workflow")
	}
	var wopErr *openwop.WopError
	if !errors.As(err, &wopErr) {
		fail(fmt.Sprintf("expected *WopError, got %T", err))
	}
	if wopErr.Status != 400 && wopErr.Status != 404 {
		fail(fmt.Sprintf("expected 400/404 for unknown workflow, got %d", wopErr.Status))
	}

	fmt.Println("[smoke-go] PASS")
}
