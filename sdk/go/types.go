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

// DebugBundle is the portable JSON diagnostic export per
// spec/v1/debug-bundle.md + schemas/debug-bundle.schema.json.
// Hosts MAY omit non-required fields. Consumers MUST treat
// masked/omitted/hashed values as the spec-canonical content per
// RedactionMode — they are NOT placeholders for missing data.
type DebugBundle struct {
	BundleVersion    string           `json:"bundleVersion"`
	GeneratedAt      string           `json:"generatedAt"`
	Host             map[string]any   `json:"host"`
	Run              map[string]any   `json:"run"`
	Events           []map[string]any `json:"events"`
	RedactionApplied bool             `json:"redactionApplied"`
	// RedactionMode is one of "mask" / "omit" / "hash" / "passthrough".
	RedactionMode   string `json:"redactionMode"`
	Truncated       bool   `json:"truncated,omitempty"`
	TruncatedReason string `json:"truncatedReason,omitempty"`
}

// DebugBundleOptions carries query parameters for GetDebugBundle.
// MaxEvents is a host-extension parameter (the SQLite reference
// convention); zero means "use host default". Spec-canonical hosts
// MAY ignore it. Non-zero values lower the host's size cap for
// testing the truncation path without driving the bundle past 8 MB.
type DebugBundleOptions struct {
	MaxEvents int
}

// PauseRunRequest is the optional body for POST /v1/runs/{id}:pause.
type PauseRunRequest struct {
	Reason      string `json:"reason,omitempty"`
	DrainPolicy string `json:"drainPolicy,omitempty"` // "immediate" | "drain-current-node"
}

// PauseRunResponse mirrors the 202 pause payload.
type PauseRunResponse struct {
	RunID    string    `json:"runId"`
	Status   RunStatus `json:"status"` // "paused"
	PausedAt string    `json:"pausedAt,omitempty"`
}

// ResumeRunRequest is the optional body for POST /v1/runs/{id}:resume.
type ResumeRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// ResumeRunResponse mirrors the 202 resume payload.
type ResumeRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"` // "running"
	ResumedAt string    `json:"resumedAt,omitempty"`
}

// BulkCancelRunsRequest mirrors POST /v1/runs:bulk-cancel body
// per rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
type BulkCancelRunsRequest struct {
	RunIDs []string `json:"runIds"`
	Reason string   `json:"reason,omitempty"`
}

// BulkCancelRunResult is the per-id outcome inside BulkCancelRunsResponse.Results.
type BulkCancelRunResult struct {
	RunID  string         `json:"runId"`
	OK     bool           `json:"ok"`
	Status string         `json:"status,omitempty"`
	Error  *ErrorEnvelope `json:"error,omitempty"`
}

// BulkCancelRunsResponse mirrors the 200 bulk-cancel payload.
type BulkCancelRunsResponse struct {
	Results []BulkCancelRunResult `json:"results"`
}

// RegisterWebhookRequest is the body for POST /v1/webhooks per
// spec/v1/webhooks.md.
type RegisterWebhookRequest struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	// Secret is optional; if omitted the host generates one and
	// returns it in the response.
	Secret string `json:"secret,omitempty"`
	// Tags filters delivery to runs carrying these tags.
	Tags []string `json:"tags,omitempty"`
}

// RegisterWebhookResponse mirrors the 201 register-webhook payload.
// Secret is returned ONCE on registration — store it server-side for
// HMAC verification; the host cannot recover it.
type RegisterWebhookResponse struct {
	SubscriptionID string   `json:"subscriptionId"`
	URL            string   `json:"url"`
	Secret         string   `json:"secret"`
	EventTypes     []string `json:"eventTypes"`
	CreatedAt      string   `json:"createdAt"`
}

// AuditVerifyCheckpoint is one entry in AuditVerifyResult.Checkpoints
// per auth-profiles.md §"openwop-audit-log-integrity" §4.
type AuditVerifyCheckpoint struct {
	Checkpoint string `json:"checkpoint"`
	AtSequence int64  `json:"atSequence"`
	MerkleRoot string `json:"merkleRoot"`
	Signature  string `json:"signature"`
}

// AuditVerifyAnomaly is one entry in AuditVerifyResult.Anomalies.
type AuditVerifyAnomaly struct {
	AtSeq            int64  `json:"atSeq"`
	ExpectedPrevHash string `json:"expectedPrevHash"`
	ActualPrevHash   string `json:"actualPrevHash"`
}

// AuditVerifyResult is the response shape from GET /v1/audit/verify.
type AuditVerifyResult struct {
	FromSeq          int64                   `json:"fromSeq"`
	ToSeq            int64                   `json:"toSeq"`
	ChainValid       bool                    `json:"chainValid"`
	CheckpointsValid *bool                   `json:"checkpointsValid,omitempty"`
	Checkpoints      []AuditVerifyCheckpoint `json:"checkpoints"`
	Anomalies        []AuditVerifyAnomaly    `json:"anomalies"`
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

// Annotation mirrors annotation.schema.json (RFC 0056) — a non-blocking
// quality signal recorded against a run, event, or node. Target and actor
// are flat string maps; signal carries mixed-type fields (kind, rating,
// label, correction) so it is map[string]any.
type Annotation struct {
	AnnotationID string            `json:"annotationId"`
	Target       map[string]string `json:"target"`
	Signal       map[string]any    `json:"signal"`
	Actor        map[string]string `json:"actor"`
	CreatedAt    string            `json:"createdAt"`
	Note         *string           `json:"note,omitempty"`
}

// CreateAnnotationRequest is the POST /v1/runs/{runID}/annotations body per
// annotation-create.schema.json (RFC 0056). The host assigns annotationId,
// createdAt, and actor; target.runId is path-bound and omitted here.
type CreateAnnotationRequest struct {
	Signal map[string]any    `json:"signal"`
	Target map[string]string `json:"target,omitempty"`
	Note   *string           `json:"note,omitempty"`
}

// ListAnnotationsResponse mirrors the 200 listAnnotations payload.
type ListAnnotationsResponse struct {
	Annotations []Annotation `json:"annotations"`
}

// RunAncestryParent is the populated branch of RunAncestryResponse.Parent —
// names the run's immediate dispatcher per RFC 0040 §C. WellKnownURL is
// set only when the parent is on a different host (callers walk the
// chain by following it one hop at a time).
type RunAncestryParent struct {
	RunID        string `json:"runId"`
	HostID       string `json:"hostId"`
	Cause        string `json:"cause"` // "mcp-tool-call" | "a2a-message" | "core.subWorkflow" | "core.dispatch"
	WellKnownURL string `json:"wellKnownUrl,omitempty"`
}

// RunAncestryResponse mirrors GET /v1/runs/{id}/ancestry per RFC 0040 §C
// (schemas/run-ancestry-response.schema.json). Parent is nil for
// top-level runs (not dispatched from any other run). Capability-gated
// on capabilities.multiAgent.executionModel.crossHostCausation
// .ancestryEndpointSupported; hosts not advertising return 404 and the
// SDK surfaces that as (nil, nil) via OpenwopClient.RunAncestry.
type RunAncestryResponse struct {
	RunID  string             `json:"runId"`
	HostID string             `json:"hostId"`
	Parent *RunAncestryParent `json:"parent"`
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
	HTTPErrorUnauthenticated             = "unauthenticated"
	HTTPErrorForbidden                   = "forbidden"
	HTTPErrorKeyExpired                  = "key_expired"
	HTTPErrorKeyRevoked                  = "key_revoked"
	HTTPErrorValidationError             = "validation_error"
	HTTPErrorNotFound                    = "not_found"
	HTTPErrorRateLimited                 = "rate_limited"
	HTTPErrorRunAlreadyActive            = "run_already_active"
	HTTPErrorIdempotencyInFlight         = "idempotency_in_flight"
	HTTPErrorIdempotencyKeyMismatch      = "idempotency_key_mismatch"
	HTTPErrorUnsupportedStreamMode       = "unsupported_stream_mode"
	HTTPErrorForceEngineVersionForbidden = "force_engine_version_forbidden"
	HTTPErrorMockProviderForbidden       = "mock_provider_forbidden"
	HTTPErrorCapabilityNotProvided       = "capability_not_provided"
	HTTPErrorCapabilityRequired          = "capability_required"
	HTTPErrorCredentialRequired          = "credential_required"
	HTTPErrorCredentialForbidden         = "credential_forbidden"
	HTTPErrorCredentialUnavailable       = "credential_unavailable"
	// Node-pack lifecycle (registry + lockfile) per node-packs.md §"Dependency resolution + lockfile".
	HTTPErrorPackIntegrityMismatch     = "pack_integrity_mismatch"
	HTTPErrorPackSignatureInvalid      = "pack_signature_invalid"
	HTTPErrorPackPeerDependencyMissing = "pack_peer_dependency_missing"
	HTTPErrorPackLockfileIncomplete    = "pack_lockfile_incomplete"
	HTTPErrorPackVersionNotFound       = "pack_version_not_found"
	HTTPErrorInterruptNotFound         = "interrupt_not_found"
	HTTPErrorApprovalTokenInvalid      = "approval_token_invalid"
	HTTPErrorApprovalTokenExpired      = "approval_token_expired"
	HTTPErrorApprovalTokenConsumed     = "approval_token_consumed"
	// Phase H.1″ — AI provider policy enforcement per capabilities.md §"aiProviders.policies".
	HTTPErrorProviderPolicyDenied = "provider_policy_denied"
	// Phase H.2 — MCP client.
	HTTPErrorMcpServerNotConfigured = "mcp_server_not_configured"
	HTTPErrorMcpTimeout             = "mcp_timeout"
	HTTPErrorMcpNetworkError        = "mcp_network_error"
	HTTPErrorMcpServerError         = "mcp_server_error"
	HTTPErrorMcpProtocolError       = "mcp_protocol_error"
	HTTPErrorMcpToolError           = "mcp_tool_error"
	// Phase H.3 — HTTP client.
	HTTPErrorHttpUrlRejected      = "http_url_rejected"
	HTTPErrorHttpTimeout          = "http_timeout"
	HTTPErrorHttpNetworkError     = "http_network_error"
	HTTPErrorHttpUnexpectedStatus = "http_unexpected_status"
	// Phase H webhook codes (spec-de-facto per webhook-negative.test.ts).
	HTTPErrorWebhookUrlRejected   = "webhook_url_rejected"
	HTTPErrorSubscriptionNotFound = "subscription_not_found"
	HTTPErrorInternalError        = "internal_error"
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
	HTTPErrorCapabilityRequired,
	HTTPErrorCredentialRequired,
	HTTPErrorCredentialForbidden,
	HTTPErrorCredentialUnavailable,
	HTTPErrorPackIntegrityMismatch,
	HTTPErrorPackSignatureInvalid,
	HTTPErrorPackPeerDependencyMissing,
	HTTPErrorPackLockfileIncomplete,
	HTTPErrorPackVersionNotFound,
	HTTPErrorInterruptNotFound,
	HTTPErrorApprovalTokenInvalid,
	HTTPErrorApprovalTokenExpired,
	HTTPErrorApprovalTokenConsumed,
	HTTPErrorProviderPolicyDenied,
	HTTPErrorMcpServerNotConfigured,
	HTTPErrorMcpTimeout,
	HTTPErrorMcpNetworkError,
	HTTPErrorMcpServerError,
	HTTPErrorMcpProtocolError,
	HTTPErrorMcpToolError,
	HTTPErrorHttpUrlRejected,
	HTTPErrorHttpTimeout,
	HTTPErrorHttpNetworkError,
	HTTPErrorHttpUnexpectedStatus,
	HTTPErrorWebhookUrlRejected,
	HTTPErrorSubscriptionNotFound,
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

// ─── Run statuses (forward-compatible) ──────────────────────────────────

// ActiveRunStatuses lists run statuses considered active — the run MAY
// still transition. Hosts MAY emit additional terminal values per the
// schema's forward-compat clause; readers MUST treat unknown statuses as
// terminal-unknown, NOT as still-active. Use IsTerminalRunStatus for
// forward-compatible checks. Mirrors the TypeScript SDK's
// ACTIVE_RUN_STATUSES constant + isTerminalRunStatus predicate.
var ActiveRunStatuses = []string{
	"pending",
	"running",
	"paused",
	"waiting-approval",
	"waiting-input",
}

// TerminalRunStatuses lists the spec-known terminal statuses. Hosts MAY
// emit additional terminal values (e.g., "timed-out", "interrupted"); use
// IsTerminalRunStatus for forward-compat checks instead of literal-set
// membership.
var TerminalRunStatuses = []string{
	"completed",
	"failed",
	"cancelled",
}

// IsTerminalRunStatus returns true when status indicates the run will not
// transition further. Implemented as a negative check against
// ActiveRunStatuses: any value NOT in the spec's known-active set is
// treated as terminal. This implements the schema's forward-compat clause
// — the alternative (positive check against TerminalRunStatuses) would
// loop polling forever on any unknown value.
func IsTerminalRunStatus(status string) bool {
	for _, active := range ActiveRunStatuses {
		if status == active {
			return false
		}
	}
	return true
}

// ─── Run-document error codes ───────────────────────────────────────────

// RunErrorCodes lists canonical RunSnapshot.Error.Code identifiers used
// when a run reaches `failed`. Distinct from HTTPErrorCodes, which describe
// HTTP-level request failures (a request can fail with `unauthenticated`
// before a run exists; a run can fail later with `node_execution_failed`).
// Mirrors the TypeScript SDK's RUN_ERROR_CODES constant.
var RunErrorCodes = []string{
	// Authorization / access
	"auth_required",
	"forbidden",
	"workspace_not_found",

	// Run-state conflicts
	"run_already_active",
	"run_not_found",
	"run_terminal",
	"engine_version_mismatch",

	// Validation
	"invalid_workflow_definition",
	"invalid_trigger_input",
	"node_type_not_found",
	"config_validation_failed",

	// Quota / budget
	"token_budget_exceeded",
	"concurrent_run_limit_reached",
	"rate_limited",

	// Execution
	"node_timeout",
	"global_timeout",
	"node_execution_failed",
	"external_call_failed",
	"recursion_limit_exceeded",
	"capability_not_provided",

	// Approval
	"approval_timeout",
	"approval_token_invalid",
	"approval_token_expired",
	"approval_token_consumed",

	// Persistence
	"persistence_failed",
	"doc_budget_exceeded",
}

// IsRunErrorCode returns true when value is a known canonical
// RunSnapshot.Error.Code. Returns false for unknown / malformed values
// rather than panicking — SDK consumers usually want to display a fallback
// for unknown codes.
func IsRunErrorCode(value string) bool {
	for _, code := range RunErrorCodes {
		if value == code {
			return true
		}
	}
	return false
}
