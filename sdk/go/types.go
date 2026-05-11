// Package openwopclient implements a Go client for OpenWOP-compliant servers.
//
// Types mirror the OpenAPI 3.1 spec (../../api/openapi.yaml) and JSON
// Schemas (../../schemas/). Hand-authored — see README.md §rationale.
package openwopclient

import "encoding/json"

// RunStatus values per `RunSnapshot.status`.
type RunStatus string

const (
	StatusPending         RunStatus = "pending"
	StatusRunning         RunStatus = "running"
	StatusPaused          RunStatus = "paused"
	StatusWaitingApproval RunStatus = "waiting-approval"
	StatusWaitingInput    RunStatus = "waiting-input"
	StatusCompleted       RunStatus = "completed"
	StatusFailed          RunStatus = "failed"
	StatusCancelled       RunStatus = "cancelled"
)

// StreamMode values per `?streamMode=` on the events SSE endpoint.
type StreamMode string

const (
	StreamModeValues   StreamMode = "values"
	StreamModeUpdates  StreamMode = "updates"
	StreamModeMessages StreamMode = "messages"
	StreamModeDebug    StreamMode = "debug"
)

// CapabilitiesLimits holds the engine-enforced caps.
type CapabilitiesLimits struct {
	ClarificationRounds int  `json:"clarificationRounds"`
	SchemaRounds        int  `json:"schemaRounds"`
	EnvelopesPerTurn    int  `json:"envelopesPerTurn"`
	MaxNodeExecutions   *int `json:"maxNodeExecutions,omitempty"`
}

// Capabilities mirrors `schemas/capabilities.schema.json`.
type Capabilities struct {
	ProtocolVersion       string             `json:"protocolVersion"`
	SupportedEnvelopes    []string           `json:"supportedEnvelopes"`
	SchemaVersions        map[string]int     `json:"schemaVersions"`
	Limits                CapabilitiesLimits `json:"limits"`
	Extensions            map[string]any     `json:"extensions,omitempty"`
	Implementation        map[string]any     `json:"implementation,omitempty"`
	EngineVersion         *int               `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int               `json:"eventLogSchemaVersion,omitempty"`
	SupportedTransports   []string           `json:"supportedTransports,omitempty"`
	Configurable          map[string]any     `json:"configurable,omitempty"`
	Observability         map[string]any     `json:"observability,omitempty"`
	MinClientVersion      *string            `json:"minClientVersion,omitempty"`
}

// RunSnapshotError mirrors `RunSnapshot.error`.
type RunSnapshotError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// RunSnapshot mirrors `schemas/run-snapshot.schema.json`.
type RunSnapshot struct {
	RunID                 string            `json:"runId"`
	WorkflowID            string            `json:"workflowId"`
	Status                RunStatus         `json:"status"`
	CurrentNodeID         string            `json:"currentNodeId,omitempty"`
	StartedAt             string            `json:"startedAt,omitempty"`
	CompletedAt           string            `json:"completedAt,omitempty"`
	NodeStates            map[string]any    `json:"nodeStates,omitempty"`
	Variables             map[string]any    `json:"variables,omitempty"`
	Channels              map[string]any    `json:"channels,omitempty"`
	Error                 *RunSnapshotError `json:"error,omitempty"`
	EngineVersion         string            `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int              `json:"eventLogSchemaVersion,omitempty"`
	Tags                  []string          `json:"tags,omitempty"`
	Metadata              map[string]any    `json:"metadata,omitempty"`
	Configurable          map[string]any    `json:"configurable,omitempty"`
}

// RunConfigurable carries per-run overrides. Reserved keys are typed;
// unknown keys live in `Extras`. See run-options.md.
type RunConfigurable struct {
	RecursionLimit  *int              `json:"recursionLimit,omitempty"`
	Model           string            `json:"model,omitempty"`
	Temperature     *float64          `json:"temperature,omitempty"`
	MaxTokens       *int              `json:"maxTokens,omitempty"`
	PromptOverrides map[string]string `json:"promptOverrides,omitempty"`
	Extras          map[string]any    `json:"-"`
}

// MarshalJSON folds Extras into the same JSON object so the wire shape
// matches the spec (a flat map of reserved + unknown keys).
func (c RunConfigurable) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, 5+len(c.Extras))
	if c.RecursionLimit != nil {
		out["recursionLimit"] = *c.RecursionLimit
	}
	if c.Model != "" {
		out["model"] = c.Model
	}
	if c.Temperature != nil {
		out["temperature"] = *c.Temperature
	}
	if c.MaxTokens != nil {
		out["maxTokens"] = *c.MaxTokens
	}
	if c.PromptOverrides != nil {
		out["promptOverrides"] = c.PromptOverrides
	}
	for k, v := range c.Extras {
		out[k] = v
	}
	return json.Marshal(out)
}

// CreateRunRequest mirrors POST /v1/runs body.
type CreateRunRequest struct {
	WorkflowID   string           `json:"workflowId"`
	Inputs       map[string]any   `json:"inputs,omitempty"`
	TenantID     string           `json:"tenantId,omitempty"`
	ScopeID      string           `json:"scopeId,omitempty"`
	CallbackURL  string           `json:"callbackUrl,omitempty"`
	Configurable *RunConfigurable `json:"configurable,omitempty"`
	Tags         []string         `json:"tags,omitempty"`
	Metadata     map[string]any   `json:"metadata,omitempty"`
}

// CreateRunResponse mirrors the 201 payload.
type CreateRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"`
	EventsURL string    `json:"eventsUrl"`
	StatusURL string    `json:"statusUrl,omitempty"`
}

// CancelRunRequest is the optional body for POST /v1/runs/{id}/cancel.
type CancelRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// CancelRunResponse mirrors the cancel response.
type CancelRunResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"` // "cancelled" | "cancelling"
}

// ForkRunRequest mirrors POST /v1/runs/{id}:fork body.
type ForkRunRequest struct {
	FromSeq           int            `json:"fromSeq"`
	Mode              string         `json:"mode"` // "replay" | "branch"
	RunOptionsOverlay map[string]any `json:"runOptionsOverlay,omitempty"`
}

// ForkRunResponse mirrors the 201 fork payload.
type ForkRunResponse struct {
	RunID       string    `json:"runId"`
	SourceRunID string    `json:"sourceRunId"`
	Mode        string    `json:"mode"`
	Status      RunStatus `json:"status"`
	EventsURL   string    `json:"eventsUrl"`
	FromSeq     *int      `json:"fromSeq,omitempty"`
}

// ResolveInterruptRequest mirrors the body for either resolve endpoint.
type ResolveInterruptRequest struct {
	ResumeValue any `json:"resumeValue"`
}

// ResolveInterruptResponse mirrors the run-scoped resolve response.
type ResolveInterruptResponse struct {
	RunID  string    `json:"runId"`
	NodeID string    `json:"nodeId"`
	Status RunStatus `json:"status"`
}

// InterruptByTokenInspection mirrors GET /v1/interrupts/{token} —
// see suspend-request.schema.json (InterruptPayload).
type InterruptByTokenInspection struct {
	Kind         string         `json:"kind"`
	Key          string         `json:"key"`
	Data         any            `json:"data"`
	ResumeSchema map[string]any `json:"resumeSchema,omitempty"`
	TimeoutMs    *int           `json:"timeoutMs,omitempty"`
}

// RunEventDoc mirrors `schemas/run-event.schema.json` — top-level shape.
// Per-event payload schemas live in run-event-payloads.schema.json;
// callers needing strict payload validation should layer that themselves.
type RunEventDoc struct {
	EventID       string `json:"eventId"`
	RunID         string `json:"runId"`
	Type          string `json:"type"`
	Payload       any    `json:"payload"`
	Timestamp     string `json:"timestamp"`
	Sequence      int    `json:"sequence"`
	NodeID        string `json:"nodeId,omitempty"`
	SchemaVersion *int   `json:"schemaVersion,omitempty"`
	EngineVersion string `json:"engineVersion,omitempty"`
	CausationID   string `json:"causationId,omitempty"`
}

// PollEventsResponse mirrors the events/poll response.
type PollEventsResponse struct {
	Events     []RunEventDoc `json:"events"`
	IsComplete bool          `json:"isComplete"`
}

// ErrorEnvelope mirrors `schemas/error-envelope.schema.json`.
type ErrorEnvelope struct {
	Error   string         `json:"error"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// HTTP error-envelope codes from auth.md, rest-endpoints.md, and adjacent
// v1 specs. ErrorEnvelope.Error remains string-typed for forward
// compatibility; use IsHTTPErrorCode for common branching.
const (
	HTTPErrorUnauthenticated              = "unauthenticated"
	HTTPErrorForbidden                    = "forbidden"
	HTTPErrorKeyExpired                   = "key_expired"
	HTTPErrorKeyRevoked                   = "key_revoked"
	HTTPErrorValidationError              = "validation_error"
	HTTPErrorNotFound                     = "not_found"
	HTTPErrorRateLimited                  = "rate_limited"
	HTTPErrorRunAlreadyActive             = "run_already_active"
	HTTPErrorIdempotencyInFlight          = "idempotency_in_flight"
	HTTPErrorIdempotencyKeyMismatch       = "idempotency_key_mismatch"
	HTTPErrorUnsupportedStreamMode        = "unsupported_stream_mode"
	HTTPErrorForceEngineVersionForbidden  = "force_engine_version_forbidden"
	HTTPErrorMockProviderForbidden        = "mock_provider_forbidden"
	HTTPErrorCapabilityNotProvided        = "capability_not_provided"
	HTTPErrorCredentialRequired           = "credential_required"
	HTTPErrorCredentialForbidden          = "credential_forbidden"
	HTTPErrorCredentialUnavailable        = "credential_unavailable"
	HTTPErrorInterruptNotFound            = "interrupt_not_found"
	HTTPErrorApprovalTokenInvalid         = "approval_token_invalid"
	HTTPErrorApprovalTokenExpired         = "approval_token_expired"
	HTTPErrorApprovalTokenConsumed        = "approval_token_consumed"
	HTTPErrorInternalError                = "internal_error"
)

// HTTPErrorCodes lists canonical ErrorEnvelope.Error codes for common
// branching. Treat it as read-only.
var HTTPErrorCodes = []string{
	HTTPErrorUnauthenticated,
	HTTPErrorForbidden,
	HTTPErrorKeyExpired,
	HTTPErrorKeyRevoked,
	HTTPErrorValidationError,
	HTTPErrorNotFound,
	HTTPErrorRateLimited,
	HTTPErrorRunAlreadyActive,
	HTTPErrorIdempotencyInFlight,
	HTTPErrorIdempotencyKeyMismatch,
	HTTPErrorUnsupportedStreamMode,
	HTTPErrorForceEngineVersionForbidden,
	HTTPErrorMockProviderForbidden,
	HTTPErrorCapabilityNotProvided,
	HTTPErrorCredentialRequired,
	HTTPErrorCredentialForbidden,
	HTTPErrorCredentialUnavailable,
	HTTPErrorInterruptNotFound,
	HTTPErrorApprovalTokenInvalid,
	HTTPErrorApprovalTokenExpired,
	HTTPErrorApprovalTokenConsumed,
	HTTPErrorInternalError,
}

// IsHTTPErrorCode returns true when value is a known canonical HTTP error
// envelope code. It returns false for host extensions and future additions.
func IsHTTPErrorCode(value string) bool {
	for _, code := range HTTPErrorCodes {
		if value == code {
			return true
		}
	}
	return false
}
