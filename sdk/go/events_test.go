// Tests for the typed agent.* event helpers (RFC 0002 + RFC 0024).
//
// Parallel to:
//   - sdk/typescript/src/__tests__/event-helpers.test.ts
//   - sdk/python/tests/test_events.py
//
// Schema-mirror sanity test reads schemas/run-event-payloads.schema.json
// and asserts the required[] arrays for each agent.* $def match the
// hand-authored Go structs in events.go.

package openwopclient

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func makeEvent(eventType string, payload any) RunEventDoc {
	return RunEventDoc{
		EventID:   "evt-x",
		RunID:     "run-x",
		Type:      eventType,
		Payload:   payload,
		Timestamp: "2026-05-19T00:00:00Z",
		Sequence:  0,
	}
}

func TestIsAgentReasoned_TruePositive(t *testing.T) {
	ev := makeEvent("agent.reasoned", map[string]any{
		"agentId":   "asst-1",
		"reasoning": "thinking…",
		"verbosity": "full",
	})
	if !IsAgentReasoned(ev) {
		t.Fatal("expected IsAgentReasoned to return true for well-formed event")
	}
	p, err := UnmarshalAgentReasoned(ev)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Reasoning != "thinking…" {
		t.Errorf("Reasoning = %q; want \"thinking…\"", p.Reasoning)
	}
	if p.Verbosity != ReasoningVerbosityFull {
		t.Errorf("Verbosity = %q; want %q", p.Verbosity, ReasoningVerbosityFull)
	}
}

func TestIsAgentReasoningDelta_TruePositive(t *testing.T) {
	ev := makeEvent("agent.reasoning.delta", map[string]any{
		"agentId":  "asst-1",
		"delta":    "step 1",
		"sequence": float64(0), // JSON unmarshal yields float64 for numbers
	})
	if !IsAgentReasoningDelta(ev) {
		t.Fatal("expected IsAgentReasoningDelta to return true")
	}
	p, err := UnmarshalAgentReasoningDelta(ev)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Delta != "step 1" || p.Sequence != 0 {
		t.Errorf("got delta=%q sequence=%d; want \"step 1\" / 0", p.Delta, p.Sequence)
	}
}

func TestIsAgentReasoningDelta_RejectsBadSequence(t *testing.T) {
	cases := []any{
		float64(-1),  // negative
		float64(1.5), // non-integer
		"0",          // string
		nil,          // missing
		true,         // bool — Go's type-switch falls to default; verify
		false,
	}
	for _, seq := range cases {
		ev := makeEvent("agent.reasoning.delta", map[string]any{
			"agentId":  "asst-1",
			"delta":    "x",
			"sequence": seq,
		})
		if IsAgentReasoningDelta(ev) {
			t.Errorf("expected rejection for sequence=%v", seq)
		}
	}
}

func TestIsAgentReasoningDelta_AcceptsEmptyDelta(t *testing.T) {
	// Schema's `delta` field has no minLength constraint — predicate
	// must accept empty-string deltas. Cross-SDK contract: TS and Python
	// also accept this shape.
	ev := makeEvent("agent.reasoning.delta", map[string]any{
		"agentId":  "asst-1",
		"delta":    "",
		"sequence": float64(0),
	})
	if !IsAgentReasoningDelta(ev) {
		t.Fatal("predicate must accept empty-string delta per schema (no minLength)")
	}
}

func TestIsAgentHandoff_DistinctFieldNames(t *testing.T) {
	// Reject events that use single agentId (wrong contract).
	ev := makeEvent("agent.handoff", map[string]any{
		"agentId":   "asst-1",
		"toAgentId": "x",
	})
	if IsAgentHandoff(ev) {
		t.Fatal("agent.handoff with single agentId must be rejected")
	}
	// Accept events with the canonical fromAgentId / toAgentId pair.
	ev2 := makeEvent("agent.handoff", map[string]any{
		"fromAgentId": "asst-1",
		"toAgentId":   "researcher",
		"reason":      "specialist",
	})
	if !IsAgentHandoff(ev2) {
		t.Fatal("agent.handoff with fromAgentId+toAgentId must be accepted")
	}
	p, err := UnmarshalAgentHandoff(ev2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.FromAgentID != "asst-1" || p.ToAgentID != "researcher" {
		t.Errorf("got from=%q to=%q; want asst-1 / researcher", p.FromAgentID, p.ToAgentID)
	}
}

func TestUnmarshalAgent_ReturnsErrNotMatchingEventOnMissedType(t *testing.T) {
	// Wrong type discriminator — Unmarshal MUST return ErrNotMatchingEvent.
	ev := makeEvent("node.message", map[string]any{"agentId": "asst-1", "reasoning": "x"})
	_, err := UnmarshalAgentReasoned(ev)
	if !errors.Is(err, ErrNotMatchingEvent) {
		t.Fatalf("got err=%v; want ErrNotMatchingEvent", err)
	}
}

func TestUnknownEventType_AllPredicatesReturnFalse(t *testing.T) {
	// Forward-compat per COMPATIBILITY.md §2.1 — unknown event types
	// MUST NOT crash; every predicate returns false cleanly.
	ev := makeEvent("vendor.future.event", map[string]any{"stuff": "x"})
	if IsAgentReasoned(ev) || IsAgentReasoningDelta(ev) || IsAgentToolCalled(ev) ||
		IsAgentToolReturned(ev) || IsAgentHandoff(ev) || IsAgentDecided(ev) {
		t.Fatal("unknown event type must not match any agent.* predicate")
	}
}

func TestAgent_NonMapPayload_Rejected(t *testing.T) {
	cases := []any{nil, "string", 42, []any{}, true}
	for _, p := range cases {
		ev := makeEvent("agent.reasoned", p)
		if IsAgentReasoned(ev) {
			t.Errorf("expected rejection for payload=%v (type %T)", p, p)
		}
	}
}

func TestSchemaMirror_AgentDefsMatchExpectedRequired(t *testing.T) {
	// Find the canonical schema. Path: sdk/go/ → sdk/ → repo-root/
	// → schemas/run-event-payloads.schema.json.
	schemaPath := filepath.Join("..", "..", "schemas", "run-event-payloads.schema.json")
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	var doc struct {
		Defs map[string]struct {
			Required []string `json:"required"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse schema: %v", err)
	}

	cases := []struct {
		defName  string
		required []string
	}{
		{"agentReasoned", []string{"agentId", "reasoning"}},
		{"agentReasoningDelta", []string{"agentId", "delta", "sequence"}},
		{"agentToolCalled", []string{"agentId", "toolName", "callId"}},
		{"agentToolReturned", []string{"agentId", "toolName", "callId"}},
		{"agentHandoff", []string{"fromAgentId", "toAgentId"}},
		{"agentDecided", []string{"agentId", "decision"}},
	}

	for _, c := range cases {
		t.Run(c.defName, func(t *testing.T) {
			def, ok := doc.Defs[c.defName]
			if !ok {
				t.Fatalf("$def.%s not found in schema", c.defName)
			}
			got := append([]string(nil), def.Required...)
			sort.Strings(got)
			want := append([]string(nil), c.required...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("$def.%s required = %v; want %v", c.defName, got, want)
			}
		})
	}
}
