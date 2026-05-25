// Typed helpers for the agent.* event family (RFC 0002 §B + RFC 0024).
//
// The Go SDK keeps RunEventDoc.Payload as `any` for forward-compat per
// COMPATIBILITY.md §2.1. This file adds typed payload structs + a
// pair of helpers per agent.* event type:
//
//	IsAgentReasoningDelta(ev)              -> bool      // discriminator + required-field check
//	UnmarshalAgentReasoningDelta(ev)       -> (payload, error)  // typed extraction
//
// The Unmarshal helpers re-marshal the untyped payload to JSON and
// decode into the typed struct so callers don't have to do
// map-of-any spelunking. Returns a non-nil error when the event
// doesn't match the type discriminator OR when payload decoding fails;
// callers check err==nil before consuming the typed payload.
//
// See:
//   - schemas/run-event-payloads.schema.json
//   - RFCS/0002-agent-identity-and-reasoning-events.md
//   - RFCS/0024-agent-reasoning-streaming.md

package openwopclient

import (
	"encoding/json"
	"errors"
	"fmt"
)

// ReasoningVerbosity per capabilities.md §`agents.reasoning`.
type ReasoningVerbosity string

const (
	ReasoningVerbosityOff     ReasoningVerbosity = "off"
	ReasoningVerbositySummary ReasoningVerbosity = "summary"
	ReasoningVerbosityFull    ReasoningVerbosity = "full"
)

// AgentReasonedPayload mirrors `agent.reasoned` (RFC 0002 §B).
// Required: AgentID, Reasoning. Optional: Verbosity. Per the schema's
// `additionalProperties: true` (Phase-1 multi-agent-shift carve-out),
// hosts MAY emit additional keys; this struct declares the typed
// fields without forbidding others (decoder ignores unknown JSON keys).
type AgentReasonedPayload struct {
	AgentID   string             `json:"agentId"`
	Reasoning string             `json:"reasoning"`
	Verbosity ReasoningVerbosity `json:"verbosity,omitempty"`
}

// AgentReasoningDeltaPayload mirrors `agent.reasoning.delta` (RFC 0024).
// Required: AgentID, Delta, Sequence (>= 0). Optional: Verbosity.
type AgentReasoningDeltaPayload struct {
	AgentID   string             `json:"agentId"`
	Delta     string             `json:"delta"`
	Sequence  int                `json:"sequence"`
	Verbosity ReasoningVerbosity `json:"verbosity,omitempty"`
}

// AgentToolCalledPayload mirrors `agent.toolCalled` (RFC 0002 §B).
// Pairs with `agent.toolReturned` via shared CallID; the toolReturned
// event's causationId equals the toolCalled event's eventId.
type AgentToolCalledPayload struct {
	AgentID  string `json:"agentId"`
	ToolName string `json:"toolName"`
	CallID   string `json:"callId"`
	Inputs   any    `json:"inputs,omitempty"`
}

// AgentToolReturnedPayload mirrors `agent.toolReturned` (RFC 0002 §B).
// Outcome and Error are mutually-exclusive; success returns set
// Outcome, failures set Error.
type AgentToolReturnedPayload struct {
	AgentID  string         `json:"agentId"`
	ToolName string         `json:"toolName"`
	CallID   string         `json:"callId"`
	Outcome  any            `json:"outcome,omitempty"`
	Error    *ErrorEnvelope `json:"error,omitempty"`
}

// AgentHandoffPayload mirrors `agent.handoff` (RFC 0002 §B). Note the
// distinct field names — FromAgentID / ToAgentID, NOT a single AgentID.
type AgentHandoffPayload struct {
	FromAgentID string `json:"fromAgentId"`
	ToAgentID   string `json:"toAgentId"`
	Reason      string `json:"reason,omitempty"`
}

// AgentDecidedPayload mirrors `agent.decided` (RFC 0002 §B). Confidence
// in [0, 1] drives the low-confidence escalation contract (host MUST
// suspend with `node.suspended { reason: 'low-confidence' }` when
// below the resolved threshold).
type AgentDecidedPayload struct {
	AgentID    string   `json:"agentId"`
	Decision   any      `json:"decision"`
	Confidence *float64 `json:"confidence,omitempty"`
}

// ErrNotMatchingEvent is returned by the UnmarshalAgent* helpers when
// the event's Type doesn't match the expected discriminator. Callers
// who want to branch on this case use errors.Is(err, ErrNotMatchingEvent).
var ErrNotMatchingEvent = errors.New("openwop: event type does not match")

// ── Predicates ────────────────────────────────────────────────────────

func payloadAsMap(payload any) (map[string]any, bool) {
	m, ok := payload.(map[string]any)
	return m, ok
}

func payloadHasString(payload any, field string) bool {
	m, ok := payloadAsMap(payload)
	if !ok {
		return false
	}
	_, ok = m[field].(string)
	return ok
}

// IsAgentReasoned reports whether the event is a well-formed
// `agent.reasoned` (RFC 0002 §B): correct discriminator + required
// payload fields present with the right primitive types.
func IsAgentReasoned(ev RunEventDoc) bool {
	return ev.Type == "agent.reasoned" &&
		payloadHasString(ev.Payload, "agentId") &&
		payloadHasString(ev.Payload, "reasoning")
}

// IsAgentReasoningDelta reports whether the event is a well-formed
// `agent.reasoning.delta` (RFC 0024). Verifies Sequence is a
// non-negative integer.
func IsAgentReasoningDelta(ev RunEventDoc) bool {
	if ev.Type != "agent.reasoning.delta" {
		return false
	}
	if !payloadHasString(ev.Payload, "agentId") {
		return false
	}
	if !payloadHasString(ev.Payload, "delta") {
		return false
	}
	m, ok := payloadAsMap(ev.Payload)
	if !ok {
		return false
	}
	// JSON unmarshal lands integers in float64; accept either, reject
	// non-integer values and negatives.
	switch seq := m["sequence"].(type) {
	case float64:
		return seq >= 0 && seq == float64(int(seq))
	case int:
		return seq >= 0
	default:
		return false
	}
}

// IsAgentToolCalled reports whether the event is a well-formed
// `agent.toolCalled` (RFC 0002 §B).
func IsAgentToolCalled(ev RunEventDoc) bool {
	return ev.Type == "agent.toolCalled" &&
		payloadHasString(ev.Payload, "agentId") &&
		payloadHasString(ev.Payload, "toolName") &&
		payloadHasString(ev.Payload, "callId")
}

// IsAgentToolReturned reports whether the event is a well-formed
// `agent.toolReturned` (RFC 0002 §B). Doesn't enforce the Outcome /
// Error mutual exclusion; callers inspect after extraction.
func IsAgentToolReturned(ev RunEventDoc) bool {
	return ev.Type == "agent.toolReturned" &&
		payloadHasString(ev.Payload, "agentId") &&
		payloadHasString(ev.Payload, "toolName") &&
		payloadHasString(ev.Payload, "callId")
}

// IsAgentHandoff reports whether the event is a well-formed
// `agent.handoff` (RFC 0002 §B). Note distinct field names —
// FromAgentID / ToAgentID.
func IsAgentHandoff(ev RunEventDoc) bool {
	return ev.Type == "agent.handoff" &&
		payloadHasString(ev.Payload, "fromAgentId") &&
		payloadHasString(ev.Payload, "toAgentId")
}

// IsAgentDecided reports whether the event is a well-formed
// `agent.decided` (RFC 0002 §B). Decision is `any` per the schema;
// predicate only confirms its presence.
func IsAgentDecided(ev RunEventDoc) bool {
	if ev.Type != "agent.decided" || !payloadHasString(ev.Payload, "agentId") {
		return false
	}
	m, ok := payloadAsMap(ev.Payload)
	if !ok {
		return false
	}
	_, present := m["decision"]
	return present
}

// ── Unmarshalers ──────────────────────────────────────────────────────

// reencode marshals the untyped payload then decodes into T. Slower
// than direct deref but avoids the map-of-any spelunking and survives
// future schema additions cleanly (the JSON decoder ignores unknown
// keys, preserving forward-compat).
func reencode[T any](payload any, out *T) error {
	buf, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("openwop: payload marshal: %w", err)
	}
	if err := json.Unmarshal(buf, out); err != nil {
		return fmt.Errorf("openwop: payload decode: %w", err)
	}
	return nil
}

// UnmarshalAgentReasoned extracts the typed payload from an
// `agent.reasoned` event. Returns ErrNotMatchingEvent if the event's
// Type doesn't match the expected discriminator.
func UnmarshalAgentReasoned(ev RunEventDoc) (AgentReasonedPayload, error) {
	var p AgentReasonedPayload
	if !IsAgentReasoned(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentReasoningDelta extracts the typed payload from an
// `agent.reasoning.delta` event (RFC 0024).
func UnmarshalAgentReasoningDelta(ev RunEventDoc) (AgentReasoningDeltaPayload, error) {
	var p AgentReasoningDeltaPayload
	if !IsAgentReasoningDelta(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentToolCalled extracts the typed payload from an
// `agent.toolCalled` event.
func UnmarshalAgentToolCalled(ev RunEventDoc) (AgentToolCalledPayload, error) {
	var p AgentToolCalledPayload
	if !IsAgentToolCalled(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentToolReturned extracts the typed payload from an
// `agent.toolReturned` event.
func UnmarshalAgentToolReturned(ev RunEventDoc) (AgentToolReturnedPayload, error) {
	var p AgentToolReturnedPayload
	if !IsAgentToolReturned(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentHandoff extracts the typed payload from an
// `agent.handoff` event.
func UnmarshalAgentHandoff(ev RunEventDoc) (AgentHandoffPayload, error) {
	var p AgentHandoffPayload
	if !IsAgentHandoff(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentDecided extracts the typed payload from an
// `agent.decided` event.
func UnmarshalAgentDecided(ev RunEventDoc) (AgentDecidedPayload, error) {
	var p AgentDecidedPayload
	if !IsAgentDecided(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// ── RFC 0057 — memory.written ────────────────────────────────────────

// MemoryWrittenPayload mirrors `memory.written` (RFC 0057). Required:
// MemoryRef, MemoryID. Optional: NodeID, AgentID, Tags. Content-free —
// identifiers + non-secret tags only; never the entry content (the read
// side serves that, already SR-1-redacted).
type MemoryWrittenPayload struct {
	MemoryRef string   `json:"memoryRef"`
	MemoryID  string   `json:"memoryId"`
	NodeID    string   `json:"nodeId,omitempty"`
	AgentID   string   `json:"agentId,omitempty"`
	Tags      []string `json:"tags,omitempty"`
}

// IsMemoryWritten reports whether the event is a well-formed
// `memory.written` (RFC 0057) — type discriminator + required
// MemoryRef/MemoryID identifier strings.
func IsMemoryWritten(ev RunEventDoc) bool {
	return ev.Type == "memory.written" &&
		payloadHasString(ev.Payload, "memoryRef") &&
		payloadHasString(ev.Payload, "memoryId")
}

// UnmarshalMemoryWritten extracts the typed payload from a
// `memory.written` event.
func UnmarshalMemoryWritten(ev RunEventDoc) (MemoryWrittenPayload, error) {
	var p MemoryWrittenPayload
	if !IsMemoryWritten(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}
